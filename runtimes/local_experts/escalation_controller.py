"""
Routes tasks between local and escalated paths.
Enforces pre-apply safety gates for all mutating operations.
"""
from __future__ import annotations

import fnmatch
import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Literal, Optional, Protocol, Sequence

from . import config
from .utils import file_ops

Status = Literal["success", "fail", "escalate"]
TaskType = Literal[
    "triage",
    "review",
    "draft_patch",
    "generate_tests",
    "summarize_diff",
    "propose_fix",
]

_MUTATING_TASKS: frozenset[str] = frozenset({"draft_patch", "propose_fix"})
_READ_ONLY_TASKS: frozenset[str] = frozenset({"triage", "review", "generate_tests", "summarize_diff"})
_COMPLEXITY_THRESHOLD_MUTATING: int = 12
_COMPLEXITY_THRESHOLD_READONLY: int = 20


class RollbackError(RuntimeError):
    """Raised when rollback fails and workspace state is indeterminate."""


class WorkerClient(Protocol):
    async def call_tool(self, tool_name: str, args: Dict[str, Any]) -> Dict[str, Any]:
        ...


@dataclass
class EscalationDecision:
    status: Status
    tool_name: Optional[str] = None
    reason: str = ""
    complexity_score: int = 0
    sliced_context: Optional[str] = None
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class ValidationResult:
    success: bool
    step: str
    exit_code: Optional[int] = None
    stdout: str = ""
    stderr: str = ""
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class ControllerConfig:
    max_context_chars_local: int = 30_000
    max_file_lines_local: int = 1_200
    max_diff_lines_local: int = 200
    max_functions_local: int = 40
    max_local_repair_attempts: int = 1
    max_validation_failures_before_escalate: int = 1
    max_patch_chars: int = 25_000
    allowed_patch_root: Optional[str] = None


@dataclass
class TaskRequest:
    task_type: TaskType
    task: str
    context: str = ""
    file_path: Optional[str] = None
    symbol_name: Optional[str] = None
    diff_text: Optional[str] = None
    pytest_target: Optional[str] = None
    lint_target: Optional[str] = None


@dataclass
class ControllerResult:
    status: Status
    reason: str
    tool_used: Optional[str] = None
    local_result: Optional[Dict[str, Any]] = None
    validations: List[ValidationResult] = field(default_factory=list)
    attempts: int = 0
    escalation_metadata: Dict[str, Any] = field(default_factory=dict)


class EscalationController:
    def __init__(self, worker: WorkerClient, config: Optional[ControllerConfig] = None) -> None:
        self.worker = worker
        self.config = config or ControllerConfig()

    async def handle(self, req: TaskRequest) -> ControllerResult:
        decision = await self._preflight_decide(req)
        if decision.status == "escalate":
            return ControllerResult(
                status="escalate",
                reason=decision.reason,
                attempts=0,
                escalation_metadata=decision.metadata,
            )

        local_args: Dict[str, Any] = {
            "task": req.task,
            "context": decision.sliced_context if decision.sliced_context is not None else req.context,
            "strict": True,
        }

        if req.task_type in _READ_ONLY_TASKS:
            result = await self.worker.call_tool(decision.tool_name, local_args)
            parsed = self._normalize_worker_result(result)
            if parsed["status"] == "escalate":
                return ControllerResult(
                    status="escalate",
                    reason=parsed["reason"],
                    tool_used=decision.tool_name,
                    local_result=parsed,
                    attempts=1,
                )
            return ControllerResult(
                status=parsed["status"],
                reason=parsed["reason"],
                tool_used=decision.tool_name,
                local_result=parsed,
                attempts=1,
            )

        if req.task_type in _MUTATING_TASKS:
            attempts = 0
            validations: List[ValidationResult] = []
            apply_snapshot: Optional[Dict[str, Optional[bytes]]] = None
            applied_files: Optional[List[str]] = None

            while attempts <= self.config.max_local_repair_attempts:
                if apply_snapshot is not None and applied_files is not None:
                    try:
                        await self._rollback_from_snapshot(apply_snapshot, applied_files)
                    except Exception as rb_exc:
                        return ControllerResult(
                            status="escalate",
                            reason=f"CRITICAL: rollback failed - workspace may be dirty. {rb_exc}",
                            tool_used=decision.tool_name,
                            attempts=attempts,
                        )
                    apply_snapshot = None
                    applied_files = None

                attempts += 1

                result = await self.worker.call_tool(decision.tool_name, local_args)
                parsed = self._normalize_worker_result(result)

                if parsed["status"] == "escalate":
                    return ControllerResult(
                        status="escalate",
                        reason=parsed["reason"],
                        tool_used=decision.tool_name,
                        local_result=parsed,
                        attempts=attempts,
                    )

                if parsed["status"] != "success":
                    return ControllerResult(
                        status="fail",
                        reason=parsed["reason"],
                        tool_used=decision.tool_name,
                        local_result=parsed,
                        attempts=attempts,
                    )

                patch_text: Optional[str] = None
                raw_result = parsed.get("raw", {})
                if isinstance(raw_result, dict):
                    patch_text = raw_result.get("patch_output") or None

                if not patch_text:
                    try:
                        ext_raw = await self.worker.call_tool(
                            "extract_patch_block",
                            {"text": parsed.get("output", "")},
                        )
                        if isinstance(ext_raw, dict):
                            patch_text = ext_raw.get("patch_text") or None
                    except Exception:
                        patch_text = None

                if not patch_text:
                    patch_text = self._extract_patch_or_code(parsed.get("output", ""))

                if not patch_text:
                    return ControllerResult(
                        status="escalate",
                        reason="Local worker returned no extractable patch/code.",
                        tool_used=decision.tool_name,
                        local_result=parsed,
                        attempts=attempts,
                    )

                if len(patch_text) > self.config.max_patch_chars:
                    return ControllerResult(
                        status="escalate",
                        reason="Patch output too large for safe local application.",
                        tool_used=decision.tool_name,
                        local_result=parsed,
                        attempts=attempts,
                    )

                declared_files: Optional[List[str]] = None
                if req.file_path and self.config.allowed_patch_root:
                    try:
                        rel = str(
                            Path(req.file_path).resolve().relative_to(
                                Path(self.config.allowed_patch_root).resolve()
                            )
                        ).replace("\\", "/")
                        declared_files = [rel]
                    except ValueError:
                        declared_files = None

                apply_result = await self._apply_patch_if_possible(patch_text, declared_files)
                validations.append(apply_result)

                if not apply_result.success:
                    return ControllerResult(
                        status="escalate",
                        reason=f"Patch application failed: {apply_result.stderr or apply_result.stdout}",
                        tool_used=decision.tool_name,
                        local_result=parsed,
                        validations=validations,
                        attempts=attempts,
                    )

                apply_snapshot = apply_result.metadata.get("snapshot")
                applied_files = apply_result.metadata.get("changed_files", [])

                post_validations = await self._run_post_patch_validations(req)
                validations.extend(post_validations)

                failed_validations = [
                    item for item in validations if not item.success and item.step in {"py_compile", "lint", "pytest"}
                ]
                if not failed_validations:
                    return ControllerResult(
                        status="success",
                        reason="Patch applied and validations passed.",
                        tool_used=decision.tool_name,
                        local_result=parsed,
                        validations=validations,
                        attempts=attempts,
                    )

                if attempts > self.config.max_local_repair_attempts:
                    if apply_snapshot and applied_files:
                        try:
                            await self._rollback_from_snapshot(apply_snapshot, applied_files)
                        except Exception as rb_exc:
                            return ControllerResult(
                                status="escalate",
                                reason=f"CRITICAL: rollback failed before escalation - workspace may be dirty. {rb_exc}",
                                tool_used=decision.tool_name,
                                attempts=attempts,
                            )
                    return ControllerResult(
                        status="escalate",
                        reason="Deterministic validation failed after local repair attempts.",
                        tool_used=decision.tool_name,
                        local_result=parsed,
                        validations=validations,
                        attempts=attempts,
                    )

                failure_bundle = self._build_failure_bundle(req, failed_validations)
                local_args["context"] = self._merge_contexts(local_args["context"], failure_bundle)

            if apply_snapshot and applied_files:
                try:
                    await self._rollback_from_snapshot(apply_snapshot, applied_files)
                except Exception as rb_exc:
                    return ControllerResult(
                        status="escalate",
                        reason=f"CRITICAL: rollback failed at loop exit - workspace may be dirty. {rb_exc}",
                        tool_used=decision.tool_name,
                        attempts=attempts,
                    )
            return ControllerResult(
                status="escalate",
                reason="Exceeded local repair attempts.",
                tool_used=decision.tool_name,
                validations=validations,
                attempts=attempts,
            )

        return ControllerResult(status="escalate", reason=f"Unsupported task type routing: {req.task_type}")

    async def _preflight_decide(self, req: TaskRequest) -> EscalationDecision:
        tool_map: Dict[str, str] = {
            "triage": "triage_issue",
            "review": "review_code",
            "draft_patch": "draft_patch",
            "generate_tests": "generate_tests",
            "summarize_diff": "summarize_diff",
            "propose_fix": "propose_fix",
        }

        complexity = 0
        metadata: Dict[str, Any] = {}

        if req.task_type in _MUTATING_TASKS and not self.config.allowed_patch_root:
            return EscalationDecision(
                status="escalate",
                reason="Mutating task requires allowed_patch_root. Pass repo_root or set LOCAL_EXPERT_REPO_ROOT.",
                complexity_score=100,
                metadata=metadata,
            )

        context = req.context

        if req.file_path and not context and req.symbol_name:
            sliced = await self._try_extract_symbol(req.file_path, req.symbol_name)
            if sliced:
                context = sliced
                metadata["used_scope_slice"] = True
            else:
                context = Path(req.file_path).read_text(encoding="utf-8", errors="replace")
                metadata["used_scope_slice"] = False

        if req.file_path and req.task_type in _MUTATING_TASKS:
            file_path = req.file_path.replace("\\", "/")
            orch_root = Path(config.ORCHESTRATION_ROOT)
            abs_fp = Path(req.file_path).resolve()
            if abs_fp.is_relative_to(orch_root):
                return EscalationDecision(
                    status="escalate",
                    reason="Cannot patch orchestration system files.",
                    complexity_score=100,
                    metadata=metadata,
                )
            for pattern in config.DANGEROUS_PATCH_TARGETS:
                if fnmatch.fnmatch(file_path, pattern) or fnmatch.fnmatch(Path(file_path).name, pattern):
                    return EscalationDecision(
                        status="escalate",
                        reason=f"Target file matches dangerous pattern '{pattern}': {req.file_path}",
                        complexity_score=100,
                        metadata=metadata,
                    )

        if req.diff_text:
            diff_lines = len(req.diff_text.splitlines())
            metadata["diff_lines"] = diff_lines
            if diff_lines > self.config.max_diff_lines_local:
                return EscalationDecision(
                    status="escalate",
                    reason=f"Diff too large for safe local handling ({diff_lines} lines).",
                    complexity_score=100,
                    metadata=metadata,
                )

        context_chars = len(context)
        metadata["context_chars"] = context_chars
        if context_chars > self.config.max_context_chars_local:
            return EscalationDecision(
                status="escalate",
                reason=f"Context too large for reliable local handling ({context_chars} chars).",
                complexity_score=100,
                metadata=metadata,
            )

        if context:
            line_count = context.count("\n") + 1
            function_count = self._count_functions(context)

            high_risk_keywords = [
                "multiprocessing",
                "multithreading",
                "shared_memory",
                "extension_module",
                "ctypes",
                "cython",
                "metaclass",
                "descriptor",
                "monkeypatch",
                "bytecode",
            ]
            for keyword in high_risk_keywords:
                if keyword in context.lower():
                    complexity += 8
                    metadata[f"risk_{keyword}"] = True

            if line_count > self.config.max_file_lines_local:
                return EscalationDecision(
                    status="escalate",
                    reason=f"File too large for reliable local reasoning ({line_count} lines).",
                    complexity_score=100,
                    metadata=metadata,
                )

            if function_count > self.config.max_functions_local:
                return EscalationDecision(
                    status="escalate",
                    reason=f"Too many functions for reliable local reasoning ({function_count}).",
                    complexity_score=100,
                    metadata=metadata,
                )

            complexity += line_count // 100
            complexity += function_count // 4

        if req.task_type in ("propose_fix", "review", "draft_patch"):
            complexity += 10
        elif req.task_type == "triage":
            complexity += 4
        elif req.task_type == "summarize_diff":
            complexity += 2

        if "async " in context:
            complexity += 5
            metadata["async_detected"] = True
        if "thread" in context or "lock" in context:
            complexity += 5
            metadata["concurrency_detected"] = True

        threshold = (
            _COMPLEXITY_THRESHOLD_MUTATING
            if req.task_type in _MUTATING_TASKS
            else _COMPLEXITY_THRESHOLD_READONLY
        )

        if complexity >= threshold:
            return EscalationDecision(
                status="escalate",
                reason=f"Complexity score {complexity} >= threshold {threshold} for {req.task_type}.",
                complexity_score=complexity,
                metadata=metadata,
            )

        return EscalationDecision(
            status="success",
            tool_name=tool_map[req.task_type],
            reason="Local handling allowed.",
            complexity_score=complexity,
            sliced_context=context,
            metadata=metadata,
        )

    async def _try_extract_symbol(self, file_path: str, symbol_name: str) -> Optional[str]:
        try:
            result = await self.worker.call_tool(
                "extract_function",
                {"path": file_path, "symbol_name": symbol_name},
            )
            if isinstance(result, dict) and result.get("success") is False:
                return None
            text = self._extract_text_field(result)
            return text.strip() if text.strip() else None
        except Exception:
            return None

    async def _apply_patch_if_possible(
        self,
        patch_text: str,
        declared_files: Optional[List[str]] = None,
    ) -> ValidationResult:
        if not self.config.allowed_patch_root:
            return ValidationResult(
                success=False,
                step="apply_patch",
                stderr=(
                    "allowed_patch_root must be set before applying patches. "
                    "Pass repo_root to the tool or set LOCAL_EXPERT_REPO_ROOT."
                ),
            )
        try:
            args: Dict[str, Any] = {"patch_text": patch_text, "root": self.config.allowed_patch_root}
            if declared_files:
                args["declared_files"] = declared_files
            result = await self.worker.call_tool("apply_unified_diff", args)
            return self._normalize_command_result("apply_patch", result)
        except Exception as exc:
            return ValidationResult(success=False, step="apply_patch", stderr=str(exc))

    async def _rollback_from_snapshot(
        self,
        snapshot: Dict[str, Optional[bytes]],
        changed_files: List[str],
    ) -> None:
        if not self.config.allowed_patch_root or not changed_files or not snapshot:
            return
        repo_root = Path(self.config.allowed_patch_root)
        file_ops.rollback_files(snapshot, repo_root)

    async def _run_post_patch_validations(self, req: TaskRequest) -> List[ValidationResult]:
        results: List[ValidationResult] = []
        cwd = self.config.allowed_patch_root
        compile_target = req.file_path or "."
        results.append(
            await self._safe_tool_command(
                "py_compile",
                "run_py_compile",
                {"paths": compile_target, "cwd": cwd},
            )
        )
        if req.lint_target:
            results.append(
                await self._safe_tool_command(
                    "lint",
                    "run_lint",
                    {"paths": req.lint_target, "cwd": cwd},
                )
            )
        if req.pytest_target:
            results.append(
                await self._safe_tool_command(
                    "pytest",
                    "run_pytest",
                    {"paths": req.pytest_target, "cwd": cwd},
                )
            )
        return results

    async def _safe_tool_command(self, step: str, tool_name: str, args: Dict[str, Any]) -> ValidationResult:
        try:
            result = await self.worker.call_tool(tool_name, args)
            return self._normalize_command_result(step, result)
        except Exception as exc:
            return ValidationResult(success=False, step=step, stderr=str(exc))

    def _normalize_worker_result(self, raw: Dict[str, Any]) -> Dict[str, Any]:
        if isinstance(raw, dict):
            if raw.get("success") is False:
                return {
                    "status": "fail",
                    "reason": str(
                        raw.get("reason")
                        or raw.get("error")
                        or raw.get("stderr")
                        or raw.get("output")
                        or "Worker reported unsuccessful execution."
                    ),
                    "output": self._extract_text_field(raw),
                    "raw": raw,
                }
            if raw.get("error"):
                return {
                    "status": "fail",
                    "reason": str(raw.get("error")),
                    "output": self._extract_text_field(raw),
                    "raw": raw,
                }

        text = self._extract_text_field(raw)
        status: Status = "success"
        reason = "Worker completed successfully."
        lower = text.lower()

        if "strict validation failed" in lower:
            status = "fail"
            reason = "Worker output failed strict validation."
        elif re.search(r"^ESCALATE:\s*\S", text, re.MULTILINE):
            status = "escalate"
            match = re.search(r"^ESCALATE:\s*(.+)$", text, re.MULTILINE)
            reason = match.group(1).strip() if match else "Worker requested escalation."
        elif re.search(r"\bsuccess:\s*false\b", lower):
            status = "fail"
            reason = "Worker reported unsuccessful execution."

        return {"status": status, "reason": reason, "output": text, "raw": raw}

    def _normalize_command_result(self, step: str, raw: Dict[str, Any]) -> ValidationResult:
        if isinstance(raw, dict):
            return ValidationResult(
                success=bool(raw.get("success", False)),
                step=step,
                exit_code=raw.get("exit_code") if isinstance(raw.get("exit_code"), int) else None,
                stdout=str(raw.get("stdout", "")),
                stderr=str(raw.get("stderr", "")),
                metadata=raw,
            )
        return ValidationResult(
            success=False,
            step=step,
            stderr=f"Unexpected command result shape: {type(raw)!r}",
        )

    def _extract_text_field(self, raw: Dict[str, Any]) -> str:
        if isinstance(raw, dict):
            for key in (
                "patch_output",
                "text",
                "output",
                "content",
                "result",
                "source",
                "patch_text",
                "stderr",
                "error",
            ):
                value = raw.get(key)
                if isinstance(value, str):
                    return value
        return json.dumps(raw, ensure_ascii=False, indent=2)

    def _extract_patch_or_code(self, output: str) -> Optional[str]:
        diff_match = re.search(r"```diff\s*(.*?)```", output, flags=re.DOTALL | re.IGNORECASE)
        if diff_match:
            return diff_match.group(1).strip()

        code_match = re.search(r"```(?:python|py|text)?\s*(.*?)```", output, flags=re.DOTALL | re.IGNORECASE)
        if code_match:
            return code_match.group(1).strip()

        section_match = re.search(
            r"5\.\s*Code(?: block)?\s*\n(.*?)(?=\n\d+\.\s|\Z)",
            output,
            flags=re.DOTALL | re.IGNORECASE,
        )
        if section_match:
            return section_match.group(1).strip()

        return None

    def _build_failure_bundle(self, req: TaskRequest, failed_validations: Sequence[ValidationResult]) -> str:
        parts = [
            "[DETERMINISTIC VALIDATION FAILURES]",
            f"Task type: {req.task_type}",
            f"Task: {req.task}",
        ]
        for item in failed_validations:
            parts.append(f"[{item.step}] success={item.success} exit_code={item.exit_code}")
            if item.stdout:
                parts.append("STDOUT:")
                parts.append(item.stdout[:2000])
            if item.stderr:
                parts.append("STDERR:")
                parts.append(item.stderr[:2000])
        return "\n".join(parts)

    def _merge_contexts(self, original: str, extra: str) -> str:
        merged = (original + "\n\n" + extra).strip()
        if len(merged) > self.config.max_context_chars_local:
            return merged[-self.config.max_context_chars_local :]
        return merged

    def _count_functions(self, text: str) -> int:
        return len(re.findall(r"^\s*(?:async\s+def|def)\s+\w+\s*\(", text, flags=re.MULTILINE))
