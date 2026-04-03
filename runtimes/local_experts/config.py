"""
config.py

Central configuration for the vendored local-expert runtime.
ControllerConfig lives in escalation_controller.py.
"""
from __future__ import annotations

import os
from typing import Any, Dict, List, Optional, Set

# ---------------------------------------------------------------------------
# Ollama / model settings
# ---------------------------------------------------------------------------

OLLAMA_API_URL: str = os.getenv("OLLAMA_API_URL", "http://localhost:12434/api/generate")
CODING_MODEL: str = os.getenv("CODING_MODEL", "qwen3-coder")
DEFAULT_TIMEOUT_SEC: int = 300
DEFAULT_MAX_RETRIES: int = 2
DEFAULT_RETRY_DELAY_SEC: float = 2.0

# ---------------------------------------------------------------------------
# Safety configuration
# ---------------------------------------------------------------------------

ORCHESTRATION_ROOT: str = os.path.dirname(os.path.abspath(__file__))

DANGEROUS_PATCH_TARGETS: List[str] = [
    "*.yml",
    "*.yaml",
    "*.toml",
    "Makefile",
    "makefile",
    "Dockerfile",
    "*.dockerfile",
    ".github/*",
    "*.env",
    ".env*",
    "*secret*",
    "*credential*",
    "*token*",
]

ALLOWED_PATCH_EXTENSIONS: Set[str] = {".py", ".md", ".txt", ".json", ".rst"}

DEFAULT_REPO_ROOT: Optional[str] = os.getenv("LOCAL_EXPERT_REPO_ROOT", None)

# ---------------------------------------------------------------------------
# Budget and phase configuration
# ---------------------------------------------------------------------------

PHASE_INPUT_BUDGETS: Dict[str, Dict[str, int]] = {
    "plan": {"base_context": 32000, "prior_outputs": 0},
    "code": {"base_context": 22000, "prior_outputs": 0},
    "review_scope": {"base_context": 28000, "prior_outputs": 0},
    "review_findings": {"base_context": 26000, "prior_outputs": 6000},
    "review_synthesis": {"base_context": 8000, "prior_outputs": 12000},
    "fix_pre_review": {"base_context": 26000, "prior_outputs": 0},
    "fix_patch": {"base_context": 16000, "prior_outputs": 12000},
    "fix_post_review": {"base_context": 12000, "prior_outputs": 14000},
    "fix_test_plan": {"base_context": 10000, "prior_outputs": 10000},
    "fix_final_decision": {"base_context": 4000, "prior_outputs": 12000},
    "draft_patch": {"base_context": 18000, "prior_outputs": 0},
    "generate_tests": {"base_context": 18000, "prior_outputs": 0},
    "summarize_diff": {"base_context": 22000, "prior_outputs": 0},
    "triage": {"base_context": 22000, "prior_outputs": 0},
    "summary": {"base_context": 22000, "prior_outputs": 0},
}

MAX_PROMPT_CHARS_PER_PHASE: Dict[str, int] = {
    "plan": 36000,
    "code": 24000,
    "review_scope": 32000,
    "review_findings": 32000,
    "review_synthesis": 24000,
    "fix_pre_review": 32000,
    "fix_patch": 32000,
    "fix_post_review": 30000,
    "fix_test_plan": 22000,
    "fix_final_decision": 20000,
    "draft_patch": 28000,
    "generate_tests": 28000,
    "summarize_diff": 26000,
    "triage": 26000,
    "summary": 26000,
}

MAX_OUTPUT_TOKENS: Dict[str, int] = {
    "plan": 1600,
    "code": 2600,
    "review_scope": 1200,
    "review_findings": 2200,
    "review_synthesis": 1400,
    "fix_pre_review": 1800,
    "fix_patch": 2600,
    "fix_post_review": 2200,
    "fix_test_plan": 1400,
    "fix_final_decision": 1200,
    "draft_patch": 2400,
    "generate_tests": 2200,
    "summarize_diff": 1200,
    "triage": 1600,
    "summary": 1200,
}

TEMPERATURES: Dict[str, float] = {key: 0.0 for key in MAX_OUTPUT_TOKENS}

# ---------------------------------------------------------------------------
# Phase definitions
# ---------------------------------------------------------------------------

BASE_REVIEW_PROMPT = (
    "You are a senior software reviewer.\n"
    "Be skeptical, evidence-driven, and concise.\n"
    "Do not praise.\n"
    "Do not give generic best-practice advice.\n"
    "If evidence is weak, label it as Inference.\n"
    "Prefer the smallest safe corrective action."
)

BASE_FIX_PROMPT = (
    "You are a cautious software engineer working under a gated pipeline.\n"
    "Do not assume the requested fix is correct.\n"
    "Prefer minimal changes.\n"
    "Be explicit about risks, edge cases, and uncertainty.\n"
    "Do not redesign unless necessary."
)

PHASE_DEFINITIONS: Dict[str, Dict[str, Any]] = {
    "review_scope": {
        "system_prompt": (
            BASE_REVIEW_PROMPT
            + "\n\nReview only the provided code/context.\n"
            + "Determine what is actually in scope and what is not.\n"
            + "Do not invent coverage.\n"
            + "Maximum 3 suspicious areas.\n\n"
            + "Required headings:\n"
            + "1. Scope reviewed\n"
            + "2. Coverage limits\n"
            + "3. Suspicious areas"
        ),
        "required_markers": ["1. Scope reviewed", "2. Coverage limits", "3. Suspicious areas"],
        "quality_markers": [],
    },
    "review_findings": {
        "system_prompt": (
            BASE_REVIEW_PROMPT
            + "\n\nMaximum 5 findings.\n"
            + "Every finding must include:\n"
            + "- Severity\n"
            + "- File path or area\n"
            + "- Evidence\n"
        ),
        "required_markers": ["Severity", "File path or area", "Evidence"],
        "quality_markers": [],
    },
    "review_synthesis": {
        "system_prompt": (
            BASE_REVIEW_PROMPT
            + "\n\nSynthesize the prior findings into a final report.\n"
            + "Be brief.\n\n"
            + "Required headings:\n"
            + "1. Synthesis summary\n"
            + "2. Major risks\n"
            + "3. Suggested actions"
        ),
        "required_markers": ["1. Synthesis summary", "2. Major risks", "3. Suggested actions"],
        "quality_markers": [],
    },
    "fix_pre_review": {
        "system_prompt": (
            BASE_FIX_PROMPT
            + "\n\nReview the requested fix before drafting the patch.\n"
            + "Determine if the request is sound and what files are involved.\n\n"
            + "Required headings:\n"
            + "1. Pre-review assessment\n"
            + "2. Involved areas\n"
            + "3. Implementation strategy"
        ),
        "required_markers": ["1. Pre-review assessment", "2. Involved areas", "3. Implementation strategy"],
        "quality_markers": [],
    },
    "fix_patch": {
        "system_prompt": (
            BASE_FIX_PROMPT
            + "\n\nDraft the smallest safe code patch.\n"
            + "Preserve existing behavior.\n\n"
            + "Required headings:\n"
            + "1. Patch summary\n"
            + "2. Risk mitigation\n"
            + "3. Implementation details\n"
            + "4. Verification\n"
            + "5. Code"
        ),
        "required_markers": [
            "1. Patch summary",
            "2. Risk mitigation",
            "3. Implementation details",
            "4. Verification",
            "5. Code",
        ],
        "quality_markers": ["5. Code"],
    },
    "fix_post_review": {
        "system_prompt": (
            BASE_REVIEW_PROMPT
            + "\n\nCritically review the proposed patch.\n"
            + "Assume the patch may be wrong.\n"
            + "Look for regressions.\n"
            + "Required headings:\n"
            + "1. Patch assessment\n"
            + "2. Findings\n"
            + "3. Missing tests\n"
            + "4. Decision"
        ),
        "required_markers": ["1. Patch assessment", "2. Findings", "3. Missing tests", "4. Decision"],
        "quality_markers": ["Severity", "Evidence", "Decision"],
    },
    "fix_test_plan": {
        "system_prompt": (
            BASE_FIX_PROMPT
            + "\n\nProduce a deterministic test and verification plan.\n"
            + "Required headings:\n"
            + "1. Test scope\n"
            + "2. Test cases\n"
            + "3. Manual verification\n"
            + "4. Remaining risk"
        ),
        "required_markers": ["1. Test scope", "2. Test cases", "3. Manual verification", "4. Remaining risk"],
        "quality_markers": [],
    },
    "fix_final_decision": {
        "system_prompt": (
            "You are the final gate in a code-change pipeline.\n"
            "Choose one final state: accepted, risky_accept, rejected, pipeline_failed.\n"
            "Required headings:\n"
            "1. Final state\n"
            "2. Reason\n"
            "3. Mandatory checks"
        ),
        "required_markers": ["1. Final state", "2. Reason", "3. Mandatory checks"],
        "quality_markers": ["Final state"],
    },
    "triage": {
        "system_prompt": (
            "You are a first-pass bug triage worker.\n"
            "Required headings:\n"
            "1. Symptom summary\n"
            "2. Likely causes\n"
            "3. Evidence\n"
            "4. Reproduction ideas\n"
            "5. Minimal patch candidates\n"
            "6. Unknowns"
        ),
        "required_markers": [
            "1. Symptom summary",
            "2. Likely causes",
            "3. Evidence",
            "4. Reproduction ideas",
            "5. Minimal patch candidates",
            "6. Unknowns",
        ],
        "quality_markers": ["Evidence"],
    },
    "draft_patch": {
        "system_prompt": (
            BASE_FIX_PROMPT
            + "\n\nDraft the smallest safe code patch.\n"
            + "Required headings:\n"
            + "1. Draft summary\n"
            + "2. Implementation assumptions\n"
            + "3. Mitigation of risks\n"
            + "4. Verification plan\n"
            + "5. Code block"
        ),
        "required_markers": [
            "1. Draft summary",
            "2. Implementation assumptions",
            "3. Mitigation of risks",
            "4. Verification plan",
            "5. Code block",
        ],
        "quality_markers": ["5. Code block"],
    },
    "generate_tests": {
        "system_prompt": (
            "You are a regression test generator.\n"
            "Required headings:\n"
            "1. Test scope\n"
            "2. Assumptions\n"
            "3. Test cases\n"
            "4. Coverage gaps\n"
            "5. Test code"
        ),
        "required_markers": [
            "1. Test scope",
            "2. Assumptions",
            "3. Test cases",
            "4. Coverage gaps",
            "5. Test code",
        ],
        "quality_markers": ["5. Test code"],
    },
    "summarize_diff": {
        "system_prompt": (
            "You are a code diff summarizer.\n"
            "Required headings:\n"
            "1. Summary\n"
            "2. Touched areas\n"
            "3. Risk areas\n"
            "4. Suggested checks"
        ),
        "required_markers": ["1. Summary", "2. Touched areas", "3. Risk areas", "4. Suggested checks"],
        "quality_markers": [],
    },
    "summary": {
        "system_prompt": (
            "You are a code change summarizer.\n"
            "Required headings:\n"
            "1. Summary\n"
            "2. Touched areas\n"
            "3. Risk areas\n"
            "4. Suggested checks"
        ),
        "required_markers": ["1. Summary", "2. Touched areas", "3. Risk areas", "4. Suggested checks"],
        "quality_markers": [],
    },
}
