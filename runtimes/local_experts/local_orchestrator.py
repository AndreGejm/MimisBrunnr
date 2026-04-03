"""
Single FastMCP entry point for the vendored local-expert system.
server.py stays a pure module.
"""
from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Dict, Optional, Protocol

from fastmcp import FastMCP

from . import config, server
from .escalation_controller import (
    ControllerConfig,
    ControllerResult,
    EscalationController,
    TaskRequest,
)

mcp = FastMCP("Local Agent Expert (Vendored)")


class WorkerClient(Protocol):
    async def call_tool(self, tool_name: str, args: Dict[str, Any]) -> Dict[str, Any]:
        ...


@dataclass
class OrchestratorRequest:
    task_type: str
    task: str
    context: str = ""
    file_path: Optional[str] = None
    symbol_name: Optional[str] = None
    diff_text: Optional[str] = None
    pytest_target: Optional[str] = None
    lint_target: Optional[str] = None
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class OrchestratorResponse:
    status: str
    reason: str
    route: str
    controller_result: Dict[str, Any]
    escalation_bundle: Optional[Dict[str, Any]] = None


_ALLOWED_TOOLS: frozenset[str] = frozenset(
    {
        "read_file",
        "list_files",
        "grep_code",
        "extract_function",
        "extract_patch_block",
        "apply_unified_diff",
        "restore_files",
        "run_py_compile",
        "run_lint",
        "run_pytest",
        "triage_issue",
        "review_code",
        "draft_patch",
        "propose_fix",
        "generate_tests",
        "summarize_diff",
    }
)


class MCPWorkerAdapter:
    async def call_tool(self, tool_name: str, args: Dict[str, Any]) -> Dict[str, Any]:
        if tool_name not in _ALLOWED_TOOLS:
            return {
                "success": False,
                "stderr": f"Tool '{tool_name}' is not in the allowed tool surface.",
            }
        fn = getattr(server, tool_name, None)
        if fn is None or not callable(fn):
            return {"success": False, "stderr": f"Tool '{tool_name}' not found in server module."}
        try:
            result = await fn(**args)
        except Exception as exc:
            return {"success": False, "stderr": str(exc)}
        if isinstance(result, str):
            try:
                return json.loads(result)
            except Exception:
                return {"success": True, "output": result}
        if isinstance(result, dict):
            return result
        return {"success": True, "output": result}


def _make_orchestrator(allowed_patch_root: Optional[str] = None) -> "LocalOrchestrator":
    return LocalOrchestrator(
        worker=MCPWorkerAdapter(),
        controller_config=ControllerConfig(
            max_context_chars_local=30_000,
            max_file_lines_local=1_200,
            max_diff_lines_local=200,
            max_functions_local=40,
            max_local_repair_attempts=1,
            max_validation_failures_before_escalate=1,
            max_patch_chars=25_000,
            allowed_patch_root=allowed_patch_root,
        ),
    )


class LocalOrchestrator:
    def __init__(self, worker: WorkerClient, controller_config: Optional[ControllerConfig] = None) -> None:
        self.worker = worker
        self.controller = EscalationController(worker, controller_config)

    async def handle_or_fail(self, request: OrchestratorRequest) -> str:
        result = await self.handle(request)
        return json.dumps(asdict(result), ensure_ascii=False, indent=2)

    async def handle(self, request: OrchestratorRequest) -> OrchestratorResponse:
        normalized = self._normalize_request(request)

        controller_result = await self.controller.handle(
            TaskRequest(
                task_type=normalized.task_type,  # type: ignore[arg-type]
                task=normalized.task,
                context=normalized.context,
                file_path=normalized.file_path,
                symbol_name=normalized.symbol_name,
                diff_text=normalized.diff_text,
                pytest_target=normalized.pytest_target,
                lint_target=normalized.lint_target,
            )
        )

        if controller_result.status == "escalate":
            bundle = self._build_escalation_bundle(normalized, controller_result)
            return OrchestratorResponse(
                status="escalate",
                reason=controller_result.reason,
                route="stronger_model",
                controller_result=self._serialize_controller_result(controller_result),
                escalation_bundle=bundle,
            )

        if controller_result.status == "success":
            return OrchestratorResponse(
                status="success",
                reason=controller_result.reason,
                route="local_worker",
                controller_result=self._serialize_controller_result(controller_result),
            )

        return OrchestratorResponse(
            status="fail",
            reason=controller_result.reason,
            route="local_worker",
            controller_result=self._serialize_controller_result(controller_result),
        )

    def _normalize_request(self, req: OrchestratorRequest) -> OrchestratorRequest:
        task_type = req.task_type.strip()
        task = req.task.strip()
        if not task:
            raise ValueError("task cannot be empty")
        allowed = {"triage", "review", "draft_patch", "generate_tests", "summarize_diff", "propose_fix"}
        if task_type not in allowed:
            raise ValueError(f"unsupported task_type: {task_type}")
        file_path = str(Path(req.file_path)) if req.file_path else None
        return OrchestratorRequest(
            task_type=task_type,
            task=task,
            context=req.context or "",
            file_path=file_path,
            symbol_name=req.symbol_name,
            diff_text=req.diff_text,
            pytest_target=req.pytest_target,
            lint_target=req.lint_target,
            metadata=req.metadata,
        )

    def _build_escalation_bundle(
        self,
        req: OrchestratorRequest,
        controller_result: ControllerResult,
    ) -> Dict[str, Any]:
        bundle: Dict[str, Any] = {
            "task_type": req.task_type,
            "task": req.task,
            "reason_for_escalation": controller_result.reason,
            "attempts": controller_result.attempts,
            "metadata": req.metadata,
            "controller_metadata": controller_result.escalation_metadata,
        }
        if req.file_path:
            bundle["file_path"] = req.file_path
        if req.symbol_name:
            bundle["symbol_name"] = req.symbol_name
        if req.pytest_target:
            bundle["pytest_target"] = req.pytest_target
        if req.lint_target:
            bundle["lint_target"] = req.lint_target
        if req.diff_text:
            bundle["diff_text"] = req.diff_text[:12000]
        if req.context:
            bundle["context"] = req.context[:12000]
        if controller_result.local_result:
            bundle["local_result"] = controller_result.local_result
        if controller_result.validations:
            bundle["validations"] = [asdict(item) for item in controller_result.validations]
        return bundle

    def _serialize_controller_result(self, result: ControllerResult) -> Dict[str, Any]:
        return {
            "status": result.status,
            "reason": result.reason,
            "tool_used": result.tool_used,
            "attempts": result.attempts,
            "local_result": result.local_result,
            "validations": [asdict(item) for item in result.validations],
            "escalation_metadata": result.escalation_metadata,
        }


def _resolve_repo_root(repo_root: Optional[str]) -> Optional[str]:
    return repo_root or config.DEFAULT_REPO_ROOT


def _missing_repo_root_error() -> str:
    return json.dumps(
        {
            "status": "error",
            "reason": (
                "repo_root is required for patching tasks. Pass the repo_root parameter "
                "or set the LOCAL_EXPERT_REPO_ROOT environment variable."
            ),
        }
    )


@mcp.tool()
async def read_file(path: str, max_chars: int = 10000) -> str:
    return await server.read_file(path, max_chars)


@mcp.tool()
async def list_files(root: str = ".", include: str = "", exclude: str = "") -> str:
    return await server.list_files(root, include, exclude)


@mcp.tool()
async def grep_code(pattern: str, path: str) -> str:
    return await server.grep_code(pattern, path)


@mcp.tool()
async def extract_function(path: str, symbol: str, include_docstring: bool = False) -> str:
    return await server.extract_function(path, symbol, include_docstring)


@mcp.tool()
async def triage_issue(task: str, context: str = "", file_path: Optional[str] = None) -> str:
    orch = _make_orchestrator()
    req = OrchestratorRequest(task_type="triage", task=task, context=context, file_path=file_path)
    return await orch.handle_or_fail(req)


@mcp.tool()
async def review_code(task: str, context: str = "", file_path: Optional[str] = None) -> str:
    orch = _make_orchestrator()
    req = OrchestratorRequest(task_type="review", task=task, context=context, file_path=file_path)
    return await orch.handle_or_fail(req)


@mcp.tool()
async def generate_tests(task: str, context: str = "", file_path: Optional[str] = None) -> str:
    orch = _make_orchestrator()
    req = OrchestratorRequest(task_type="generate_tests", task=task, context=context, file_path=file_path)
    return await orch.handle_or_fail(req)


@mcp.tool()
async def summarize_diff(task: str, context: str = "", diff_text: Optional[str] = None) -> str:
    orch = _make_orchestrator()
    req = OrchestratorRequest(task_type="summarize_diff", task=task, context=context, diff_text=diff_text)
    return await orch.handle_or_fail(req)


@mcp.tool()
async def propose_fix(
    task: str,
    context: str = "",
    file_path: Optional[str] = None,
    repo_root: Optional[str] = None,
) -> str:
    root = _resolve_repo_root(repo_root)
    if not root:
        return _missing_repo_root_error()
    orch = _make_orchestrator(allowed_patch_root=root)
    req = OrchestratorRequest(task_type="propose_fix", task=task, context=context, file_path=file_path)
    return await orch.handle_or_fail(req)


@mcp.tool()
async def draft_patch(
    task: str,
    context: str = "",
    file_path: Optional[str] = None,
    repo_root: Optional[str] = None,
) -> str:
    root = _resolve_repo_root(repo_root)
    if not root:
        return _missing_repo_root_error()
    orch = _make_orchestrator(allowed_patch_root=root)
    req = OrchestratorRequest(task_type="draft_patch", task=task, context=context, file_path=file_path)
    return await orch.handle_or_fail(req)


if __name__ == "__main__":
    mcp.run()
