"""
Pure module - no FastMCP instance.
All tool functions are async and called by MCPWorkerAdapter.
"""
from __future__ import annotations

import fnmatch
import json
import os
import shutil
import sys
import tempfile
from pathlib import Path
from typing import Any, Dict, List, Optional

from . import config, llm_orchestrator
from .utils import file_ops


def _assert_inside_root(path: str, root: str) -> Path:
    root_path = Path(root).resolve()
    target = (root_path / path).resolve()
    try:
        target.relative_to(root_path)
    except ValueError as exc:
        raise ValueError(f"Path '{path}' resolves outside the allowed root '{root}'.") from exc
    return target


async def read_file(path: str, max_chars: int = 10000, allowed_root: Optional[str] = None) -> str:
    try:
        file_path = _assert_inside_root(path, allowed_root) if allowed_root else Path(path)
        if not file_path.exists():
            return json.dumps({"success": False, "error": "Not found"})
        return json.dumps(
            {
                "success": True,
                "content": file_path.read_text(encoding="utf-8", errors="replace")[:max_chars],
            }
        )
    except Exception as exc:
        return json.dumps({"success": False, "error": str(exc)})


async def write_file(path: str, content: str, allowed_root: Optional[str] = None) -> str:
    try:
        if not allowed_root:
            return json.dumps({"success": False, "error": "allowed_root must be provided to write_file."})
        file_path = _assert_inside_root(path, allowed_root)
        file_path.parent.mkdir(parents=True, exist_ok=True)
        file_path.write_text(content, encoding="utf-8")
        return json.dumps({"success": True})
    except Exception as exc:
        return json.dumps({"success": False, "error": str(exc)})


async def list_files(root: str = ".", include: str = "", exclude: str = "", allowed_root: Optional[str] = None) -> str:
    try:
        effective_root = str(_assert_inside_root(root, allowed_root)) if allowed_root else root
        result = file_ops.list_files(effective_root, include, exclude)
        return json.dumps(result, indent=2)
    except Exception as exc:
        return json.dumps({"success": False, "error": str(exc)})


async def grep_code(pattern: str, path: str) -> str:
    return json.dumps(file_ops.grep_code(pattern, path), indent=2)


async def extract_function(path: str, symbol: str, include_docstring: bool = False) -> str:
    return json.dumps(
        file_ops.extract_function(path, symbol=symbol, include_docstring=include_docstring),
        indent=2,
    )


async def extract_patch_block(text: str) -> str:
    return json.dumps(file_ops.extract_patch_block(text), indent=2)


async def apply_unified_diff(
    patch_text: str,
    root: str,
    declared_files: Optional[List[str]] = None,
    allow_new_files: bool = False,
) -> Dict[str, Any]:
    repo_root = Path(root).resolve()
    if not (repo_root / ".git").exists():
        return {
            "success": False,
            "exit_code": -1,
            "stdout": "",
            "stderr": f"root '{root}' is not a git repository (.git not found).",
        }

    changed_files = file_ops.parse_patch_manifest(patch_text)
    if not changed_files:
        return {
            "success": False,
            "exit_code": -1,
            "stdout": "",
            "stderr": "Patch contains no recognisable file changes (no +++ headers).",
        }

    max_files = 5
    if len(changed_files) > max_files:
        return {
            "success": False,
            "exit_code": -1,
            "stdout": "",
            "stderr": f"Patch touches {len(changed_files)} files; limit is {max_files}.",
        }

    for rel in changed_files:
        abs_path = (repo_root / rel).resolve()
        if not abs_path.is_relative_to(repo_root):
            return {
                "success": False,
                "exit_code": -1,
                "stdout": "",
                "stderr": f"Path traversal detected: '{rel}' resolves outside repo root.",
            }

    for rel in changed_files:
        if Path(rel).suffix not in config.ALLOWED_PATCH_EXTENSIONS:
            return {
                "success": False,
                "exit_code": -1,
                "stdout": "",
                "stderr": f"File extension not in allowlist: '{rel}'.",
            }

    orch_root = Path(config.ORCHESTRATION_ROOT)
    for rel in changed_files:
        abs_path = (repo_root / rel).resolve()
        if abs_path.is_relative_to(orch_root):
            return {
                "success": False,
                "exit_code": -1,
                "stdout": "",
                "stderr": f"Cannot patch orchestration system files: '{rel}'.",
            }
        for pattern in config.DANGEROUS_PATCH_TARGETS:
            if fnmatch.fnmatch(rel, pattern) or fnmatch.fnmatch(Path(rel).name, pattern):
                return {
                    "success": False,
                    "exit_code": -1,
                    "stdout": "",
                    "stderr": f"'{rel}' matches dangerous pattern '{pattern}'.",
                }

    if declared_files:
        undeclared = set(changed_files) - set(declared_files)
        if undeclared:
            return {
                "success": False,
                "exit_code": -1,
                "stdout": "",
                "stderr": f"Patch touches undeclared files: {sorted(undeclared)}.",
            }

    if not allow_new_files:
        for rel in changed_files:
            if not (repo_root / rel).exists():
                return {
                    "success": False,
                    "exit_code": -1,
                    "stdout": "",
                    "stderr": f"Patch would create a new file (allow_new_files=False): '{rel}'.",
                }

    added = sum(1 for line in patch_text.splitlines() if line.startswith("+") and not line.startswith("+++"))
    removed = sum(1 for line in patch_text.splitlines() if line.startswith("-") and not line.startswith("---"))
    max_lines = 300
    if added + removed > max_lines:
        return {
            "success": False,
            "exit_code": -1,
            "stdout": "",
            "stderr": f"Patch changes {added + removed} lines; limit is {max_lines}.",
        }

    snapshot = file_ops.snapshot_files(changed_files, repo_root)

    with tempfile.NamedTemporaryFile(mode="w", suffix=".patch", delete=False, encoding="utf-8") as handle:
        handle.write(patch_text)
        patch_file = handle.name

    try:
        dry = await file_ops._run_subprocess(
            ["git", "apply", "--check", patch_file],
            cwd=str(repo_root),
            timeout_sec=config.DEFAULT_TIMEOUT_SEC,
        )
        if not dry.success:
            return {
                "success": False,
                "exit_code": dry.exit_code,
                "stdout": dry.stdout,
                "stderr": f"Dry-run failed: {dry.stderr}",
            }

        result = await file_ops._run_subprocess(
            ["git", "apply", patch_file],
            cwd=str(repo_root),
            timeout_sec=config.DEFAULT_TIMEOUT_SEC,
        )
        if not result.success:
            file_ops.rollback_files(snapshot, repo_root)
            return {
                "success": False,
                "exit_code": result.exit_code,
                "stdout": result.stdout,
                "stderr": f"Apply failed (rolled back): {result.stderr}",
            }

        return {
            "success": True,
            "exit_code": 0,
            "stdout": result.stdout,
            "stderr": "",
            "changed_files": changed_files,
            "snapshot": snapshot,
        }
    finally:
        try:
            Path(patch_file).unlink()
        except Exception:
            pass


async def restore_files(paths: List[str], root: str) -> Dict[str, Any]:
    if not paths:
        return {"success": True, "exit_code": 0, "stdout": "Nothing to restore.", "stderr": ""}
    repo_root = Path(root).resolve()
    if not (repo_root / ".git").exists():
        return {
            "success": False,
            "exit_code": -1,
            "stdout": "",
            "stderr": f"root '{root}' is not a git repository.",
        }
    result = await file_ops._run_subprocess(
        ["git", "checkout", "HEAD", "--"] + paths,
        cwd=str(repo_root),
        timeout_sec=config.DEFAULT_TIMEOUT_SEC,
    )
    return {
        "success": result.success,
        "exit_code": result.exit_code,
        "stdout": result.stdout,
        "stderr": result.stderr,
    }


async def run_py_compile(paths: str, cwd: Optional[str] = None) -> Dict[str, Any]:
    target = paths.strip()
    if target.endswith(os.sep) or Path(target).is_dir():
        cmd = [sys.executable, "-m", "compileall", "-q", target]
    else:
        cmd = [sys.executable, "-m", "py_compile", target]
    result = await file_ops._run_subprocess(cmd, cwd=cwd, timeout_sec=config.DEFAULT_TIMEOUT_SEC)
    return {
        "success": result.success,
        "exit_code": result.exit_code,
        "stdout": result.stdout,
        "stderr": result.stderr,
    }


async def run_lint(paths: str, cwd: Optional[str] = None) -> Dict[str, Any]:
    linter = shutil.which("ruff") or shutil.which("flake8")
    if not linter:
        return {"success": True, "exit_code": 0, "stdout": "", "stderr": "[lint skipped - ruff/flake8 not found]"}
    result = await file_ops._run_subprocess([linter, paths], cwd=cwd, timeout_sec=config.DEFAULT_TIMEOUT_SEC)
    return {
        "success": result.success,
        "exit_code": result.exit_code,
        "stdout": result.stdout,
        "stderr": result.stderr,
    }


async def run_pytest(paths: str, cwd: Optional[str] = None) -> Dict[str, Any]:
    if not shutil.which("pytest"):
        return {"success": True, "exit_code": 0, "stdout": "", "stderr": "[pytest skipped - not found]"}
    result = await file_ops._run_subprocess(
        [sys.executable, "-m", "pytest", paths, "-x", "-q", "--tb=short"],
        cwd=cwd,
        timeout_sec=config.DEFAULT_TIMEOUT_SEC,
    )
    return {
        "success": result.success,
        "exit_code": result.exit_code,
        "stdout": result.stdout,
        "stderr": result.stderr,
    }


async def triage_issue(task: str, context: str = "", strict: bool = True) -> str:
    result = await llm_orchestrator.run_phase("triage", task, context, strict=strict)
    return json.dumps({"success": result.success, "output": result.output}, indent=2)


async def review_code(task: str, context: str = "", strict: bool = True) -> str:
    phases = ["review_scope", "review_findings", "review_synthesis"]
    result = await llm_orchestrator.run_pipeline("review", task, context, phases, strict=strict)
    return json.dumps({"success": result.success, "output": result.final_output}, indent=2)


async def draft_patch(task: str, context: str = "", strict: bool = True) -> str:
    result = await llm_orchestrator.run_phase("draft_patch", task, context, strict=strict)
    return json.dumps({"success": result.success, "output": result.output}, indent=2)


async def propose_fix(task: str, context: str = "", strict: bool = True) -> str:
    phases = ["fix_pre_review", "fix_patch", "fix_post_review", "fix_test_plan", "fix_final_decision"]
    result = await llm_orchestrator.run_pipeline("fix", task, context, phases, strict=strict)
    patch_output = result.get_phase_output("fix_patch") or ""
    decision_output = result.get_phase_output("fix_final_decision") or result.final_output
    return json.dumps(
        {
            "success": result.success,
            "patch_output": patch_output,
            "decision_output": decision_output,
            "output": patch_output,
        },
        indent=2,
    )


async def generate_tests(task: str, context: str = "", strict: bool = True) -> str:
    result = await llm_orchestrator.run_phase("generate_tests", task, context, strict=strict)
    return json.dumps({"success": result.success, "output": result.output}, indent=2)


async def summarize_diff(task: str, context: str = "", strict: bool = True) -> str:
    result = await llm_orchestrator.run_phase("summarize_diff", task, context, strict=strict)
    return json.dumps({"success": result.success, "output": result.output}, indent=2)
