# Coding Advisory VoltAgent Profile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** add a role-specific VoltAgent profile for `coding_advisory` with hooks, middleware, and guardrails, without changing `paid_escalation`.

**Architecture:** keep the shared `VoltAgentHarnessRuntime`, but introduce an infrastructure-owned role-profile builder that assembles advisory-specific hooks, middleware, and guardrails. The coding advisory adapter consumes that profile and maps enriched runtime behavior back into Mimir-owned telemetry and contract output.

**Tech Stack:** TypeScript, zod, @voltagent/core, Node test runner

---

### Task 1: Add failing tests for advisory role-profile behavior

**Files:**
- Modify: `tests/e2e/local-model-providers.test.mjs`

- [ ] **Step 1: Add failing tests for advisory prompt normalization and output normalization**
- [ ] **Step 2: Add failing tests for advisory guardrail rejection**
- [ ] **Step 3: Run `node --test tests/e2e/local-model-providers.test.mjs` and verify the new tests fail**

### Task 2: Implement the advisory role-profile builder

**Files:**
- Create: `packages/infrastructure/src/providers/voltagent-role-profile.ts`
- Modify: `packages/infrastructure/src/index.ts`

- [ ] **Step 1: Add `buildCodingAdvisoryVoltAgentProfile(...)`**
- [ ] **Step 2: Export the new profile builder**
- [ ] **Step 3: Re-run the focused failing tests**

### Task 3: Wire the role profile into the coding advisory adapter

**Files:**
- Modify: `packages/infrastructure/src/providers/voltagent-coding-advisory-adapter.ts`
- Modify: `packages/infrastructure/src/providers/voltagent-harness-runtime.ts`

- [ ] **Step 1: Pass advisory hooks, middleware, and guardrails into the runtime**
- [ ] **Step 2: Preserve current fallback semantics while enriching telemetry**
- [ ] **Step 3: Run `node --test tests/e2e/local-model-providers.test.mjs` and verify green**

### Task 4: Run branch-level verification for the new advisory profile slice

**Files:**
- Modify: `tests/e2e/local-model-providers.test.mjs` (if assertions need refinement)

- [ ] **Step 1: Run `pnpm build`**
- [ ] **Step 2: Run `node --test tests/e2e/local-model-providers.test.mjs tests/e2e/service-boundaries-and-regression.test.mjs tests/e2e/coding-advisory-transport-parity.test.mjs`**
- [ ] **Step 3: Run `git diff --check`**
