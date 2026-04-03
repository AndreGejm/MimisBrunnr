"""
Builds prompts and runs LLM phases via the local model.
Enforces per-phase input budgets and preserves the system/task header.
"""
from __future__ import annotations

import re
import time
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Sequence

from . import llm_client
from .config import (
    DEFAULT_TIMEOUT_SEC,
    MAX_PROMPT_CHARS_PER_PHASE,
    PHASE_DEFINITIONS,
    PHASE_INPUT_BUDGETS,
)


@dataclass(frozen=True)
class PhaseResult:
    phase_name: str
    success: bool
    output: str
    duration_sec: float
    validation_passed: bool
    raw_output: Optional[str] = None


@dataclass
class PipelineResult:
    success: bool
    final_state: str
    final_output: str
    duration_sec: float
    phase_results: Sequence[PhaseResult]
    phase_map: Dict[str, PhaseResult] = field(default_factory=dict)

    def get_phase_output(self, name: str) -> Optional[str]:
        result = self.phase_map.get(name)
        return result.output if result else None


def validate_markers(output: str, markers: List[str]) -> List[str]:
    output_lower = output.lower()
    return [marker for marker in markers if marker.lower() not in output_lower]


def _compress_prior_output(text: str, max_chars: int) -> str:
    sections = re.findall(r"(\d+\.\s+[^\n]+(?:\n(?!\d+\.\s)[^\n]*)*)", text)
    if sections:
        compressed = "\n".join(section.strip() for section in sections)
        return compressed[:max_chars]
    return text[:max_chars]


def build_phase_prompt(
    phase_name: str,
    task_description: str,
    base_context: Optional[str],
    prior_results: Optional[List[PhaseResult]] = None,
) -> str:
    if prior_results is None:
        prior_results = []

    phase_def = PHASE_DEFINITIONS[phase_name]
    system_prompt = phase_def["system_prompt"]
    budget = PHASE_INPUT_BUDGETS.get(phase_name, {"base_context": 20000, "prior_outputs": 0})

    header = f"System: {system_prompt}\n\nTask: {task_description}\n\n"

    prior_budget = budget["prior_outputs"]
    prior_section = ""
    if prior_results and prior_budget > 0:
        per_phase = max(400, prior_budget // max(len(prior_results), 1))
        parts = [
            f"--- {result.phase_name} ---\n{_compress_prior_output(result.output, per_phase)}"
            for result in prior_results
        ]
        combined = "\n".join(parts)
        prior_section = f"Prior phase results:\n{combined[:prior_budget]}\n\n"

    context_budget = budget["base_context"]
    context_text = (base_context or "")[:context_budget]
    context_section = f"Context:\n{context_text}\n\n" if context_text else ""

    prompt = header + context_section + prior_section

    max_chars = MAX_PROMPT_CHARS_PER_PHASE.get(phase_name, 32000)
    if len(prompt) > max_chars:
        fixed = header + prior_section
        remaining = max_chars - len(fixed)
        if remaining > 0 and base_context:
            context_section = f"Context:\n{base_context[:remaining]}\n\n"
        else:
            context_section = ""
        prompt = header + context_section + prior_section

    return prompt


async def run_phase(
    phase_name: str,
    task_description: str,
    base_context: Optional[str] = None,
    prior_phase_results: Optional[List[PhaseResult]] = None,
    strict: bool = True,
    timeout_sec: int = DEFAULT_TIMEOUT_SEC,
) -> PhaseResult:
    if prior_phase_results is None:
        prior_phase_results = []

    start_t = time.monotonic()
    prompt = build_phase_prompt(phase_name, task_description, base_context, prior_phase_results)

    response = await llm_client.run_ollama_api(prompt, phase_name, timeout_sec)
    output = response.get("response", "").strip()

    if not output:
        return PhaseResult(
            phase_name=phase_name,
            success=False,
            output="Empty output from model.",
            duration_sec=time.monotonic() - start_t,
            validation_passed=False,
        )

    phase_def = PHASE_DEFINITIONS[phase_name]
    missing = validate_markers(output, phase_def.get("required_markers", []))

    success = True
    if strict and missing:
        success = False
        output = f"[STRICT VALIDATION FAILED] Missing: {', '.join(missing)}\n\n" + output

    if phase_name == "fix_final_decision":
        lower = output.lower()
        if "pipeline_failed" in lower or "rejected" in lower:
            success = False

    return PhaseResult(
        phase_name=phase_name,
        success=success,
        output=output,
        duration_sec=time.monotonic() - start_t,
        validation_passed=(not missing),
        raw_output=output,
    )


async def run_pipeline(
    mode: str,
    task_description: str,
    context: Optional[str],
    phase_names: Sequence[str],
    strict: bool = True,
    timeout_sec: int = DEFAULT_TIMEOUT_SEC,
) -> PipelineResult:
    del mode
    start = time.monotonic()
    phase_results: List[PhaseResult] = []

    for phase_name in phase_names:
        result = await run_phase(
            phase_name,
            task_description,
            context,
            phase_results,
            strict,
            timeout_sec,
        )
        phase_results.append(result)
        if not result.success:
            break

    success = all(result.success for result in phase_results)
    final_output = phase_results[-1].output if phase_results else "No phases run."
    phase_map = {result.phase_name: result for result in phase_results}

    return PipelineResult(
        success=success,
        final_state="accepted" if success else "failed",
        final_output=final_output,
        duration_sec=time.monotonic() - start,
        phase_results=phase_results,
        phase_map=phase_map,
    )
