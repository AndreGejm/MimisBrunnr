# qwen3-coder Local Profile

`qwen3-coder` is an explicit local coding lane. It improves local-agent ergonomics, but it does not grant memory-write authority.

Profile defaults:

- provider: `docker-model-runner`
- role: `coding`
- context window: `262144` tokens
- temperature: `0`
- seed: `42`
- planning budget: `32000`
- implementation budget: `128000`
- verification budget: `48000`
- summary budget: `16000`

The TypeScript bridge passes these values to the vendored Python runtime as:

- `CODING_MODEL`
- `CODING_MODEL_CONTEXT_TOKENS`
- `CODING_MODEL_TEMPERATURE`
- `CODING_MODEL_SEED`
- `CODING_MODEL_PHASE_BUDGETS_JSON`

The Python runtime applies the phase budgets to prompt construction while preserving existing prior-output budgets for review and fix phases.

## Smoke Check

Verify the local model is available:

```powershell
docker model run qwen3-coder
```

Run the bridge environment test path:

```powershell
corepack pnpm build
node --test --test-name-pattern "qwen3-coder|python coding bridge|local experts config" tests/e2e/hermes-bridge-runtime.test.mjs
```

## Authority Boundary

Large context does not replace retrieval discipline. Coding tasks should still receive fenced memory context through `memoryContext`, and oversized tool outputs should spill to `state/tool-output` instead of inflating prompts. Any durable memory output must go through capture, staging, review, and promotion.

The qwen profile is for local coding capability only. It is not a background memory writer, not a paid-model escalation path, and not an approval bypass.
