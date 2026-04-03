from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any, Dict, List

from ..llm_client import run_ollama_api


class BaseExpert(ABC):
    """Base class for local specialist experts."""

    def __init__(self, name: str, phase_name: str):
        self.name = name
        self.phase_name = phase_name

    @abstractmethod
    async def execute(self, task: str, context: str, timeout_sec: int) -> Dict[str, Any]:
        """Execute the expert's task."""

    def _validate_output(self, output: str, required_markers: List[str]) -> bool:
        output_lower = output.lower()
        for marker in required_markers:
            if marker.lower() not in output_lower:
                return False
        return True

    async def _call_model(self, prompt: str, timeout_sec: int) -> Dict[str, Any]:
        return await run_ollama_api(prompt, self.phase_name, timeout_sec)
