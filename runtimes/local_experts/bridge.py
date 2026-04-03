"""
JSON stdin/stdout bridge for the vendored local-experts runtime.

This keeps Node/TypeScript transports and orchestration logic decoupled from the
Python implementation details while preserving the existing coding safety model.
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
from dataclasses import asdict
from pathlib import Path
from typing import Any, Dict, Optional

from . import config
from .escalation_controller import ControllerConfig, ControllerResult, EscalationController, TaskRequest

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


class RuntimeWorkerAdapter:
    async def call_tool(self, tool_name: str, args: Dict[str, Any]) -> Dict[str, Any]:
        if tool_name not in _ALLOWED_TOOLS:
            return {
                "success": False,
                "stderr": f"Tool '{tool_name}' is not in the allowed tool surface.",
            }

        try:
            from . import server as runtime_server
        except Exception as exc:
            return {
                "success": False,
                "stderr": f"Failed to load local_experts.server: {exc}",
            }

        fn = getattr(runtime_server, tool_name, None)
        if fn is None or not callable(fn):
            return {
                "success": False,
                "stderr": f"Tool '{tool_name}' not found in server module.",
            }

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


def _resolve_repo_root(payload: Dict[str, Any]) -> Optional[str]:
    repo_root = payload.get("repoRoot")
    if isinstance(repo_root, str) and repo_root.strip():
        return repo_root

    metadata = payload.get("metadata")
    if isinstance(metadata, dict):
        metadata_root = metadata.get("repoRoot")
        if isinstance(metadata_root, str) and metadata_root.strip():
            return metadata_root

    resolved = config.DEFAULT_REPO_ROOT or os.getenv("LOCAL_EXPERT_REPO_ROOT")
    if isinstance(resolved, str) and resolved.strip():
        return str(Path(resolved).resolve())
    return None


def _resolve_file_path(value: Any, repo_root: Optional[str]) -> Optional[str]:
    if not isinstance(value, str) or not value.strip():
        return None
    if repo_root and not Path(value).is_absolute():
        return str((Path(repo_root) / value).resolve())
    return value


def _serialize_result(result: ControllerResult) -> Dict[str, Any]:
    return {
        "status": result.status,
        "reason": result.reason,
        "toolUsed": result.tool_used,
        "attempts": result.attempts,
        "localResult": result.local_result,
        "validations": [asdict(item) for item in result.validations],
        "escalationMetadata": result.escalation_metadata,
    }


async def execute(payload: Dict[str, Any]) -> Dict[str, Any]:
    repo_root = _resolve_repo_root(payload)
    controller = EscalationController(
        RuntimeWorkerAdapter(),
        ControllerConfig(
            max_context_chars_local=30_000,
            max_file_lines_local=1_200,
            max_diff_lines_local=200,
            max_functions_local=40,
            max_local_repair_attempts=1,
            max_validation_failures_before_escalate=1,
            max_patch_chars=25_000,
            allowed_patch_root=repo_root,
        ),
    )

    request = TaskRequest(
        task_type=payload["taskType"],
        task=payload["task"],
        context=payload.get("context", "") or "",
        file_path=_resolve_file_path(payload.get("filePath"), repo_root),
        symbol_name=payload.get("symbolName"),
        diff_text=payload.get("diffText"),
        pytest_target=payload.get("pytestTarget"),
        lint_target=payload.get("lintTarget"),
    )
    result = await controller.handle(request)
    return _serialize_result(result)


async def main() -> int:
    raw = sys.stdin.read()
    if not raw.strip():
        sys.stdout.write(
            json.dumps(
                {
                    "status": "fail",
                    "reason": "Bridge request payload was empty.",
                    "attempts": 0,
                }
            )
        )
        return 1

    try:
        payload = json.loads(raw)
        if not isinstance(payload, dict):
            raise ValueError("Bridge request must be a JSON object.")
        result = await execute(payload)
        sys.stdout.write(json.dumps(result, ensure_ascii=False))
        return 0
    except Exception as exc:
        sys.stdout.write(
            json.dumps(
                {
                    "status": "fail",
                    "reason": f"Bridge execution failed: {exc}",
                    "attempts": 0,
                    "escalationMetadata": {"bridgeError": True},
                },
                ensure_ascii=False,
            )
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
