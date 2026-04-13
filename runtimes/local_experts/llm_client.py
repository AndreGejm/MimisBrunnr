from __future__ import annotations

import logging
from typing import Any, Dict

import httpx

from .config import CODING_MODEL, CODING_MODEL_SEED, MAX_OUTPUT_TOKENS, OLLAMA_API_URL, TEMPERATURES


async def run_ollama_api(
    prompt: str,
    phase_name: str,
    timeout_sec: int,
) -> Dict[str, Any]:
    """Execute a raw request against the local Ollama API."""
    payload = {
        "model": CODING_MODEL,
        "prompt": prompt,
        "stream": False,
        "options": {
            "temperature": TEMPERATURES.get(phase_name, 0.0),
            "num_predict": MAX_OUTPUT_TOKENS.get(phase_name, 1200),
            "seed": CODING_MODEL_SEED,
        },
    }

    try:
        async with httpx.AsyncClient(timeout=timeout_sec) as client:
            response = await client.post(OLLAMA_API_URL, json=payload)
            response.raise_for_status()
            return response.json()
    except Exception as exc:
        logging.error("Ollama API call failed: %s", exc)
        return {"error": str(exc)}
