"""
Foundational file-system and patch utilities.
All functions are pure Python and have no FastMCP dependencies.
"""
from __future__ import annotations

import ast
import asyncio
import logging
import re
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence

_SNAPSHOT_WARN_BYTES = 10 * 1024 * 1024


@dataclass(frozen=True)
class CommandResult:
    success: bool
    exit_code: int
    stdout: str
    stderr: str
    command: str
    duration_sec: float


async def _run_subprocess(
    command: Sequence[str],
    cwd: Optional[str] = None,
    timeout_sec: float = 120.0,
) -> CommandResult:
    start_t = time.monotonic()
    cmd = [str(value) for value in command]
    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            cwd=cwd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            stdout_bytes, stderr_bytes = await asyncio.wait_for(
                proc.communicate(),
                timeout=timeout_sec,
            )
        except asyncio.TimeoutError:
            try:
                proc.kill()
            except Exception:
                pass
            return CommandResult(
                success=False,
                exit_code=-1,
                stdout="",
                stderr=f"[TIMEOUT] Command exceeded {timeout_sec}s limit: {' '.join(cmd)}",
                command=" ".join(cmd),
                duration_sec=time.monotonic() - start_t,
            )

        duration = time.monotonic() - start_t
        return CommandResult(
            success=(proc.returncode == 0),
            exit_code=proc.returncode or 0,
            stdout=stdout_bytes.decode(errors="replace"),
            stderr=stderr_bytes.decode(errors="replace"),
            command=" ".join(cmd),
            duration_sec=duration,
        )
    except Exception as exc:
        return CommandResult(
            success=False,
            exit_code=-1,
            stdout="",
            stderr=str(exc),
            command=" ".join(cmd),
            duration_sec=time.monotonic() - start_t,
        )


def list_files(root: str = ".", include: str = "", exclude: str = "") -> Dict[str, Any]:
    try:
        root_path = Path(root)
        files: List[str] = []
        for path in root_path.rglob("*"):
            if path.is_file():
                rel = str(path.relative_to(root_path))
                if include and include not in rel:
                    continue
                if exclude and exclude in rel:
                    continue
                files.append(rel)
        return {"success": True, "files": files}
    except Exception as exc:
        return {"success": False, "error": str(exc)}


def grep_code(pattern: str, path: str) -> Dict[str, Any]:
    matches: List[Dict[str, Any]] = []
    try:
        regex = re.compile(pattern)
        with open(path, "r", encoding="utf-8", errors="replace") as handle:
            for lineno, line in enumerate(handle, start=1):
                if regex.search(line):
                    matches.append({"line": lineno, "text": line.rstrip("\n")})
        return {"success": True, "matches": matches}
    except Exception as exc:
        return {"success": False, "error": str(exc)}


def extract_function(
    path: str,
    symbol: Optional[str] = None,
    symbol_name: Optional[str] = None,
    include_docstring: bool = False,
) -> Dict[str, Any]:
    target_symbol = symbol or symbol_name or ""
    try:
        source = Path(path).read_text(encoding="utf-8", errors="replace")
        tree = ast.parse(source)
        result_source: Optional[str] = None
        for node in ast.walk(tree):
            if (
                isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef))
                and getattr(node, "name", None) == target_symbol
            ):
                start = node.lineno - 1
                end = (
                    node.end_lineno - 1
                    if hasattr(node, "end_lineno") and node.end_lineno is not None
                    else node.lineno - 1
                )
                lines = source.splitlines()
                if not include_docstring and node.body:
                    first_stmt = node.body[0]
                    if (
                        isinstance(first_stmt, ast.Expr)
                        and isinstance(first_stmt.value, ast.Constant)
                        and isinstance(first_stmt.value.value, str)
                    ):
                        ds_end = (
                            first_stmt.end_lineno - 1
                            if hasattr(first_stmt, "end_lineno") and first_stmt.end_lineno is not None
                            else first_stmt.lineno - 1
                        )
                        start = ds_end + 1
                result_source = "\n".join(lines[start : end + 1])
                break
        if result_source is None:
            raise Exception(f"Symbol '{target_symbol}' not found in {path}")
        return {"success": True, "source": result_source}
    except Exception as exc:
        return {"success": False, "error": str(exc)}


def extract_patch_block(text: str) -> Dict[str, Any]:
    diff_match = re.search(r"```diff\s*\n(.*?)```", text, flags=re.DOTALL | re.IGNORECASE)
    if diff_match:
        return {"success": True, "patch_text": diff_match.group(1).strip()}

    code_match = re.search(r"```(?:[^\n]*)\n(.*?)```", text, flags=re.DOTALL)
    if code_match:
        return {"success": True, "patch_text": code_match.group(1).strip()}

    return {"success": False, "patch_text": ""}


def parse_patch_manifest(patch_text: str) -> List[str]:
    paths: List[str] = []
    seen: set[str] = set()
    for line in patch_text.splitlines():
        if line.startswith("+++ "):
            raw = line[4:].split("\t")[0].strip()
            if raw.startswith("b/"):
                raw = raw[2:]
            if raw and raw != "/dev/null" and raw not in seen:
                paths.append(raw)
                seen.add(raw)
    return paths


def snapshot_files(paths: List[str], repo_root: Path) -> Dict[str, Optional[bytes]]:
    snapshot: Dict[str, Optional[bytes]] = {}
    for rel in paths:
        full = repo_root / rel
        if full.exists():
            size = full.stat().st_size
            if size > _SNAPSHOT_WARN_BYTES:
                logging.warning(
                    "snapshot_files: '%s' is %s MB - proceeding but this is unusually large for local patching.",
                    rel,
                    size // (1024 * 1024),
                )
            snapshot[rel] = full.read_bytes()
        else:
            snapshot[rel] = None
    return snapshot


def rollback_files(snapshot: Dict[str, Optional[bytes]], repo_root: Path) -> None:
    for rel, original in snapshot.items():
        full = repo_root / rel
        if original is None:
            if full.exists():
                full.unlink()
        else:
            full.parent.mkdir(parents=True, exist_ok=True)
            full.write_bytes(original)
