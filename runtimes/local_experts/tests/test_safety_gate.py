"""
Critical invariant tests for the vendored local-expert safety layer.
Run with: python -m pytest runtimes/local_experts/tests/test_safety_gate.py -v
"""
from __future__ import annotations

import json
import sys
import textwrap
from pathlib import Path
from typing import Any, Dict

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from local_experts import config, server  # noqa: E402
from local_experts.escalation_controller import (  # noqa: E402
    ControllerConfig,
    EscalationController,
    TaskRequest,
)
from local_experts.llm_orchestrator import build_phase_prompt  # noqa: E402
from local_experts.utils import file_ops  # noqa: E402


@pytest.fixture()
def tmp_git_repo(tmp_path: Path) -> Path:
    (tmp_path / ".git").mkdir()
    py_file = tmp_path / "src" / "foo.py"
    py_file.parent.mkdir(parents=True)
    py_file.write_bytes(b'def greet(name: str) -> str:\n    return f"Hello, {name}"\n')
    return tmp_path


class TestSnapshotRollback:
    def test_snapshot_captures_existing_file(self, tmp_git_repo: Path) -> None:
        original = b'def greet(name: str) -> str:\n    return f"Hello, {name}"\n'
        snap = file_ops.snapshot_files(["src/foo.py"], tmp_git_repo)
        assert snap["src/foo.py"] == original

    def test_snapshot_stores_none_for_missing_file(self, tmp_git_repo: Path) -> None:
        snap = file_ops.snapshot_files(["src/does_not_exist.py"], tmp_git_repo)
        assert snap["src/does_not_exist.py"] is None

    def test_rollback_restores_modified_file(self, tmp_git_repo: Path) -> None:
        original = (tmp_git_repo / "src" / "foo.py").read_bytes()
        snap = file_ops.snapshot_files(["src/foo.py"], tmp_git_repo)
        (tmp_git_repo / "src" / "foo.py").write_text("# modified", encoding="utf-8")
        file_ops.rollback_files(snap, tmp_git_repo)
        assert (tmp_git_repo / "src" / "foo.py").read_bytes() == original

    def test_rollback_deletes_newly_created_file(self, tmp_git_repo: Path) -> None:
        snap = file_ops.snapshot_files(["src/new.py"], tmp_git_repo)
        (tmp_git_repo / "src" / "new.py").write_text("# new", encoding="utf-8")
        file_ops.rollback_files(snap, tmp_git_repo)
        assert not (tmp_git_repo / "src" / "new.py").exists()


class TestParsePatchManifest:
    def test_parses_git_style_paths(self) -> None:
        patch = "--- a/src/foo.py\n+++ b/src/foo.py\n@@ -1 +1 @@\n-old\n+new\n"
        paths = file_ops.parse_patch_manifest(patch)
        assert paths == ["src/foo.py"]

    def test_ignores_dev_null(self) -> None:
        patch = "--- /dev/null\n+++ b/src/new.py\n"
        paths = file_ops.parse_patch_manifest(patch)
        assert paths == ["src/new.py"]

    def test_multiple_files(self) -> None:
        patch = "--- a/a.py\n+++ b/a.py\n--- a/b.py\n+++ b/b.py\n"
        paths = file_ops.parse_patch_manifest(patch)
        assert set(paths) == {"a.py", "b.py"}


@pytest.mark.asyncio
class TestApplyUnifiedDiffGate:
    async def test_rejects_non_git_root(self, tmp_path: Path) -> None:
        patch = "--- a/foo.py\n+++ b/foo.py\n@@ -1 +1 @@\n-old\n+new\n"
        result = await server.apply_unified_diff(patch, str(tmp_path))
        assert result["success"] is False
        assert ".git" in result["stderr"]

    async def test_rejects_path_traversal(self, tmp_git_repo: Path) -> None:
        patch = "--- a/../../evil.py\n+++ b/../../evil.py\n@@ -1 +1 @@\n-x\n+y\n"
        result = await server.apply_unified_diff(patch, str(tmp_git_repo))
        assert result["success"] is False

    async def test_rejects_yml_extension(self, tmp_git_repo: Path) -> None:
        (tmp_git_repo / ".github").mkdir()
        (tmp_git_repo / ".github" / "ci.yml").write_text("name: CI", encoding="utf-8")
        patch = "--- a/.github/ci.yml\n+++ b/.github/ci.yml\n@@ -1 +1 @@\n-name: CI\n+name: EVIL\n"
        result = await server.apply_unified_diff(patch, str(tmp_git_repo))
        assert result["success"] is False

    async def test_rejects_dangerous_pattern(self, tmp_git_repo: Path) -> None:
        (tmp_git_repo / "Makefile").write_text("build:", encoding="utf-8")
        patch = "--- a/Makefile\n+++ b/Makefile\n@@ -1 +1 @@\n-build:\n+evil:\n"
        result = await server.apply_unified_diff(patch, str(tmp_git_repo))
        assert result["success"] is False

    async def test_rejects_undeclared_file(self, tmp_git_repo: Path) -> None:
        patch = "--- a/src/foo.py\n+++ b/src/foo.py\n@@ -1 +1 @@\n-x\n+y\n"
        result = await server.apply_unified_diff(
            patch,
            str(tmp_git_repo),
            declared_files=["src/bar.py"],
        )
        assert result["success"] is False
        assert "undeclared" in result["stderr"]

    async def test_rejects_new_file_by_default(self, tmp_git_repo: Path) -> None:
        patch = "--- /dev/null\n+++ b/src/brand_new.py\n@@ -0,0 +1 @@\n+print('hi')\n"
        result = await server.apply_unified_diff(patch, str(tmp_git_repo), allow_new_files=False)
        assert result["success"] is False
        assert "new file" in result["stderr"]

    async def test_rejects_orchestration_self_patch(self, tmp_git_repo: Path) -> None:
        orch = Path(config.ORCHESTRATION_ROOT)
        patch = "--- a/server.py\n+++ b/server.py\n@@ -1 +1 @@\n-x\n+y\n"
        result = await server.apply_unified_diff(patch, str(orch.parent))
        assert result["success"] is False


class FakeWorker:
    def __init__(self, response: Dict[str, Any]) -> None:
        self._response = response

    async def call_tool(self, tool_name: str, args: Dict[str, Any]) -> Dict[str, Any]:
        del tool_name, args
        return self._response


@pytest.mark.asyncio
class TestControllerRouting:
    async def test_mutating_task_without_patch_root_escalates(self) -> None:
        worker = FakeWorker({"success": True, "output": "5. Code block\n```diff\n--- a/x.py\n+++ b/x.py\n```"})
        ctrl = EscalationController(worker, ControllerConfig(allowed_patch_root=None))
        result = await ctrl.handle(TaskRequest(task_type="propose_fix", task="fix bug", context="x = 1\n"))
        assert result.status == "escalate"

    async def test_read_only_task_proceeds_locally(self) -> None:
        worker = FakeWorker(
            {
                "success": True,
                "output": (
                    "1. Symptom summary\n2. Likely causes\n3. Evidence\n"
                    "4. Reproduction ideas\n5. Minimal patch candidates\n6. Unknowns"
                ),
            }
        )
        ctrl = EscalationController(worker, ControllerConfig())
        result = await ctrl.handle(TaskRequest(task_type="triage", task="bug", context="x = 1\n" * 10))
        assert result.status != "escalate" or "allowed_patch_root" not in result.reason

    async def test_dangerous_file_target_escalates_for_mutating_task(self, tmp_path: Path) -> None:
        (tmp_path / ".git").mkdir()
        makefile = tmp_path / "Makefile"
        makefile.write_text("build:", encoding="utf-8")
        worker = FakeWorker({"success": True, "output": "some output"})
        ctrl = EscalationController(worker, ControllerConfig(allowed_patch_root=str(tmp_path)))
        result = await ctrl.handle(
            TaskRequest(task_type="draft_patch", task="change build", file_path=str(makefile))
        )
        assert result.status == "escalate"

    async def test_escalation_signal_in_prose_does_not_trigger(self) -> None:
        worker = FakeWorker(
            {
                "success": True,
                "output": (
                    "You should ESCALATE: your concerns to management.\n"
                    "1. Symptom summary\n2. Likely causes\n3. Evidence\n"
                    "4. Reproduction ideas\n5. Minimal patch candidates\n6. Unknowns"
                ),
            }
        )
        ctrl = EscalationController(worker, ControllerConfig())
        result = await ctrl.handle(TaskRequest(task_type="triage", task="bug", context="x\n"))
        assert result.status != "escalate"

    async def test_line_start_escalation_signal_is_respected(self) -> None:
        worker = FakeWorker(
            {
                "success": True,
                "output": "Analysis complete.\nESCALATE: Task requires paid model - too risky.\n",
            }
        )
        ctrl = EscalationController(worker, ControllerConfig())
        result = await ctrl.handle(TaskRequest(task_type="triage", task="bug", context="x\n"))
        assert result.status == "escalate"


class TestPromptBuilding:
    def test_system_instruction_survives_large_context(self) -> None:
        large_context = "x" * 50_000
        prompt = build_phase_prompt("triage", "find the bug", large_context)
        assert "first-pass bug triage" in prompt.lower()
        assert "find the bug" in prompt

    def test_context_is_trimmed_not_header(self) -> None:
        large_context = "UNIQUE_MARKER_" + ("y" * 50_000)
        prompt = build_phase_prompt("triage", "task", large_context)
        assert "System:" in prompt
        assert "Task: task" in prompt
        assert len(prompt) <= 26_200


@pytest.mark.asyncio
class TestSubprocessTimeout:
    async def test_subprocess_times_out(self) -> None:
        result = await file_ops._run_subprocess(
            [sys.executable, "-c", "import time; time.sleep(30)"],
            timeout_sec=1.0,
        )
        assert result.success is False
        assert "TIMEOUT" in result.stderr or "timeout" in result.stderr.lower()
        assert result.exit_code == -1


@pytest.mark.asyncio
class TestValidationCwd:
    async def test_run_py_compile_accepts_cwd(self, tmp_git_repo: Path) -> None:
        (tmp_git_repo / "src" / "foo.py").write_text("x = 1\n", encoding="utf-8")
        result = await server.run_py_compile(str(tmp_git_repo / "src" / "foo.py"), cwd=str(tmp_git_repo))
        assert isinstance(result, dict)
        assert "success" in result


@pytest.mark.asyncio
class TestProposeFixPipelineContract:
    async def test_propose_fix_returns_patch_output_key(self) -> None:
        from local_experts.llm_orchestrator import PhaseResult, PipelineResult
        import unittest.mock as mock

        fake_patch_phase = PhaseResult(
            phase_name="fix_patch",
            success=True,
            output="--- a/x.py\n+++ b/x.py\n@@ -1 +1 @@\n-old\n+new\n",
            duration_sec=0.1,
            validation_passed=True,
        )
        fake_decision_phase = PhaseResult(
            phase_name="fix_final_decision",
            success=True,
            output="ACCEPTED. The patch is valid.",
            duration_sec=0.1,
            validation_passed=True,
        )
        fake_result = PipelineResult(
            success=True,
            final_state="accepted",
            final_output=fake_decision_phase.output,
            duration_sec=0.2,
            phase_results=[fake_patch_phase, fake_decision_phase],
            phase_map={
                "fix_patch": fake_patch_phase,
                "fix_final_decision": fake_decision_phase,
            },
        )

        with mock.patch("local_experts.llm_orchestrator.run_pipeline", return_value=fake_result):
            raw = await server.propose_fix(task="fix it", context="x = 1")

        data = json.loads(raw)
        assert "patch_output" in data
        assert "decision_output" in data
        assert "--- a/x.py" in data["patch_output"]
        assert "ACCEPTED" in data["decision_output"]
