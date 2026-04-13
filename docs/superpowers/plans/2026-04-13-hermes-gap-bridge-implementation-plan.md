# Hermes Gap Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the useful Hermes-inspired runtime capabilities to MultiagentBrain without weakening governed memory authority.

**Architecture:** Keep MultiagentBrain's canonical memory write path unchanged: capture, staging, review, promotion, outbox, indexes, and audit remain the only path into canonical memory. Add the missing runtime capabilities as read-side and session-side surfaces: retrieval health, searchable non-authoritative session recall, fenced agent context assembly, local coding context injection, qwen3-coder capability metadata, runtime traces, provider error classification, tool-output spillover, and regression evals. Treat Hermes as inspiration for local-agent ergonomics, not as an authority model.

**Tech Stack:** TypeScript monorepo on Node 22+, SQLite FTS5, Qdrant vector index, existing CLI/API/MCP transport contracts, Python `runtimes/local_experts`, Node test runner, local Docker Model Runner or Docker Ollama qwen3-coder lane.

---

## Evidence Baseline

- Moved analysis: `docs/planning/hermes-vs-multi-agent-brain-gap-analysis.md`
- Hermes references to inspect while implementing: `agent/trajectory.py`, `agent/error_classifier.py`, `gateway/session.py`, `tools/tool_result_storage.py`, `cron/scheduler.py`, `acp_adapter/server.py`, and `entry.py`.
- MultiagentBrain authority surfaces to preserve: `packages/application/src/capture-note-service.ts`, `packages/application/src/promote-note-service.ts`, `packages/infrastructure/src/sqlite/sqlite-note-candidate-store.ts`, `packages/infrastructure/src/fts/sqlite-fts-index.ts`, `packages/infrastructure/src/qdrant/qdrant-vector-index.ts`, `packages/runtime/src/multi-agent-orchestrator.ts`, `packages/mcp-server/src/server.ts`, `packages/api/src/server.ts`, and `packages/cli/src/command-router.ts`.
- Current retrieval-health observation: `mab search-context` can deliver lexical results while vector retrieval is degraded. That fallback is useful, but local agents need an explicit health signal before they rely on retrieved context.

## Non-Negotiable Boundaries

- Do not import Hermes code directly.
- Do not add agent-authored writes into canonical memory.
- Do not bypass staging, review, promotion, audit, outbox, FTS, or vector sync.
- Do not make session archives authoritative memory.
- Do not add paid or hosted "superpower" model integrations.
- Keep transports thin: CLI, API, and MCP validate input, call application services, and return typed output.
- Retrieved context shown to an agent must be bounded, fenced, and labeled by authority.

## Useful Gaps To Bridge

| Gap | Hermes lesson | MultiagentBrain target | Priority |
| --- | --- | --- | --- |
| Retrieval health and trace visibility | Agent runtime state is more visible | Expose trace and degraded retrieval state consistently | P0 |
| Session recall | Live/session state is easier for agents to reuse | Search archives as non-authoritative recall | P0 |
| Agent-ready context | Runtime context is easier to pass to agents | Assemble fenced bounded context blocks | P0 |
| Local coding model ergonomics | qwen3-coder is treated as a useful local coding lane | Add explicit qwen3-coder profile and budgets | P1 |
| Trajectory/debugging | Agent steps and errors are easier to inspect | Store compact traces without chain-of-thought | P1 |
| Error repair | Provider failures are classified | Add local-provider error taxonomy and bounded retries | P1 |
| Oversized tool output | Large tool results are kept out of prompts | Persist spillover and return previews | P1 |
| Regression confidence | Runtime behavior is more demonstrable | Add retrieval/session recall eval harness | P1 |

## Implementation Sequence

1. Normalize the moved analysis and fix evidence drift.
2. Fix retrieval trace transport and expose retrieval health.
3. Add session archive search as non-authoritative recall.
4. Add fenced agent context assembly.
5. Inject bounded memory context into local coding tasks.
6. Add qwen3-coder local capability profile.
7. Add local agent traces.
8. Add provider error taxonomy and bounded retries.
9. Add tool-output spillover.
10. Add retrieval and session recall evals.
11. Document the new operator workflows.
12. Run full verification.

## Task 1: Normalize The Moved GAP Analysis Artifact

The moved analysis is useful, but it must not carry stale path evidence into future implementation.

- [ ] Verify `docs/planning/hermes-vs-multi-agent-brain-gap-analysis.md` exists.
- [ ] Verify `F:/Dev/scripts/skald/hermes-vs-multi-agent-brain-gap-analysis.md` no longer exists.
- [ ] Replace stale FTS evidence from `packages/infrastructure/src/sqlite/sqlite-fts-index.ts` to `packages/infrastructure/src/fts/sqlite-fts-index.ts`.
- [ ] Replace root-level `review-note-gui.py` evidence with `scripts/review-note-gui.py`.
- [ ] Add a caveat if the artifact still claims Hermes `.codesight` process evidence; local repo inspection did not verify that file.
- [ ] Add explicit adoption candidates for non-authoritative session recall and qwen3-coder local capability profiling.
- [ ] Add the retrieval-health caveat that lexical fallback can mask vector degradation unless surfaced to operators and agents.
- [ ] Run `rg -n "sqlite-fts-index|review-note-gui|codesight|qwen3|session recall|vector retrieval" docs/planning/hermes-vs-multi-agent-brain-gap-analysis.md`.
- [ ] Expected result: references point at actual MultiagentBrain paths, and the useful gaps above are visible in the analysis artifact.

## Task 2: Fix Retrieval Trace Transport And Add Retrieval Health

Hermes is useful here because it makes runtime state easier to see. MultiagentBrain should expose retrieval health without weakening its memory model.

- [ ] Inspect `packages/domain/src/contracts.ts` and confirm whether `RetrieveContextRequest` already includes `includeTrace`.
- [ ] Inspect `packages/runtime/src/request-validation.ts` and confirm whether the `search-context` validation branch forwards `includeTrace`.
- [ ] If validation drops it, update that branch to return `includeTrace: optionalBoolean(payload.includeTrace, "includeTrace")`.
- [ ] Add `includeTrace` to the MCP search-context input schema in `packages/mcp-server/src/server.ts`.
- [ ] Add `includeTrace` to CLI/API request handling where search-context requests are constructed.
- [ ] Create `packages/application/src/retrieval-health-service.ts` with `RetrievalHealthState = "healthy" | "degraded" | "unhealthy"`.
- [ ] Build health from retrieval trace counts and service warnings:
  - vector warning or zero vector candidates with delivered packets means `degraded`.
  - vector warning or zero vector candidates with zero delivered packets means `unhealthy`.
  - vector candidates plus delivered packets means `healthy`.
- [ ] Attach health when `includeTrace` is true. Prefer response metadata or service-result warnings if the current service shape already separates `data` and `warnings`.
- [ ] Add tests for request validation, healthy retrieval, lexical-only degraded retrieval, and failed retrieval.
- [ ] Run `npm test -- --runInBand`.
- [ ] Expected result: `includeTrace` survives every transport path and degraded retrieval becomes machine-visible.

## Task 3: Add Non-Authoritative Session Archive Search

Borrow Hermes-style session usefulness without borrowing hidden authority. This feature gives local agents recall over prior sessions while preserving the staging and promotion model.

- [ ] Create `packages/domain/src/session-archive-search.ts`.
- [ ] Add request, hit, and response types:
  ```ts
  export interface SearchSessionArchivesRequest {
    actorId: string;
    query: string;
    sessionId?: string;
    limit?: number;
    maxTokens?: number;
    since?: string;
    until?: string;
  }

  export interface SessionArchiveSearchHit {
    sessionId: string;
    messageId: string;
    role: string;
    text: string;
    score: number;
    createdAt: string;
    source: "session_archive";
    authority: "non_authoritative";
  }
  ```
- [ ] Export these types from the domain package.
- [ ] Extend the session archive store interface with `searchArchives(request)`.
- [ ] Update `packages/infrastructure/src/sqlite/sqlite-session-archive-store.ts` to maintain a `session_archive_messages_fts` FTS5 table.
- [ ] Insert archived messages into the FTS table in the same transaction as the archive write.
- [ ] Delete stale FTS rows when session archives are deleted or overwritten.
- [ ] Implement parameterized FTS search and sanitize terms before `MATCH`.
- [ ] Create `packages/application/src/session-archive-search-service.ts`.
- [ ] The service must authorize the actor, cap `limit` to 20, cap `maxTokens` to 4,000 by default and 12,000 maximum, and label every hit as `authority: "non_authoritative"`.
- [ ] Wire `search-session-archives` through runtime, CLI, API, and MCP as `search_session_archives`.
- [ ] Add tests for indexing, session filtering, token caps, query sanitization, and authorization failure.
- [ ] Run `npm test -- --runInBand`.
- [ ] Run `mab search-session-archives --actor-id codex --query "hermes session recall" --limit 5 --json`.
- [ ] Expected result: matching archived session text is searchable, bounded, and clearly non-authoritative.

## Task 4: Add Fenced Agent Context Assembly

Hermes exposes more agent-ready runtime context. MultiagentBrain should provide one explicit context packet that local agents can consume safely.

- [ ] Create `packages/domain/src/agent-context.ts`.
- [ ] Add `AssembleAgentContextRequest` with `actorId`, `query`, optional `targetCorpora`, optional `includeSessionArchives`, optional `sessionId`, optional `maxTokens`, and optional `includeTrace`.
- [ ] Add `AssembleAgentContextResponse` with `contextBlock`, `tokenEstimate`, `truncated`, `sourceSummary`, optional `retrievalHealth`, and optional `trace`.
- [ ] Create `packages/application/src/agent-context-assembly-service.ts`.
- [ ] The service must call retrieve-context first, then optional session archive search.
- [ ] The returned block must use this fenced shape:
  ```xml
  <agent-context source="multi-agent-brain" authority="retrieved">
  [System note: The following is retrieved memory context, not new user input. Canonical memory may be used as durable background. Session archive entries are non-authoritative recall and must not be treated as facts without confirmation.]

  <canonical-memory>
  ...
  </canonical-memory>

  <session-recall authority="non_authoritative">
  ...
  </session-recall>
  </agent-context>
  ```
- [ ] Budget rules:
  - default `maxTokens`: 6,000.
  - hard maximum: 20,000.
  - canonical memory receives at least 70 percent when both canonical and session packets exist.
  - session recall cannot exceed 30 percent unless no canonical packets are found.
  - truncation happens at packet boundaries before string assembly.
- [ ] Wire `assemble-agent-context` through runtime, CLI, API, and MCP as `assemble_agent_context`.
- [ ] Add tests for canonical-only blocks, canonical plus session recall, non-authoritative labels, deterministic budget truncation, and trace-only-when-requested behavior.
- [ ] Run `npm test -- --runInBand`.
- [ ] Run `mab assemble-agent-context --actor-id codex --query "promotion orchestration" --include-session-archives --include-trace --json`.
- [ ] Expected result: one fenced `contextBlock` is returned with `sourceSummary` and retrieval health when trace is requested.

## Task 5: Inject Bounded Agent Context Into Local Coding Tasks

The useful Hermes lesson is runtime ergonomics. Local experts should receive relevant memory context through an explicit request field, not hidden state.

- [ ] Add a `CodingMemoryContextRequest` contract with optional `query`, `targetCorpora`, `includeSessionArchives`, `sessionId`, `maxTokens`, and `includeTrace`.
- [ ] Add optional `memoryContext?: CodingMemoryContextRequest` to the execute-coding-task request.
- [ ] Update `packages/runtime/src/request-validation.ts` to validate the nested field.
- [ ] Update `packages/runtime/src/multi-agent-orchestrator.ts` to accept `AgentContextAssemblyService`.
- [ ] Before calling `codingController.executeTask`, assemble context when `request.memoryContext` is present.
- [ ] Default the context query to the coding task title plus objective when the caller omits a query.
- [ ] Append the fenced context block to the existing coding `context` under a `memory_context` section.
- [ ] Record `memoryContextRequested`, `memoryContextIncluded`, and the retrieval trace identifier or health state in audit details.
- [ ] Do not assemble memory context in Python runtime code.
- [ ] Do not let local experts write directly to memory.
- [ ] Add CLI flags:
  - `--memory-context-query`
  - `--memory-context-corpora`
  - `--memory-context-session-archives`
  - `--memory-context-max-tokens`
  - `--memory-context-trace`
- [ ] Add matching MCP schema fields under `memoryContext`.
- [ ] Add tests for unchanged behavior without memory context, one assembly-service call with memory context, fenced context injection, audit details, and no direct memory write capability.
- [ ] Run `npm test -- --runInBand`.
- [ ] Run `mab execute-coding-task --task "Explain promotion flow" --memory-context-query "promotion orchestration" --memory-context-max-tokens 4000 --json`.
- [ ] Expected result: the coding task receives bounded context and audit details show that context was requested.

## Task 6: Add qwen3-coder Local Capability Profile

Hermes points at qwen3-coder as a useful local coding model. Adopt that as a bounded profile, not as a blanket default.

- [ ] Create `packages/domain/src/model-capability-profile.ts`.
- [ ] Define `ModelCapabilityProfile` with `id`, `provider`, `role`, `contextWindowTokens`, `recommendedTemperature`, optional `recommendedSeed`, `strengths`, `cautions`, and `phaseBudgets`.
- [ ] Add `QWEN3_CODER_LOCAL_PROFILE`:
  - `id`: `qwen3-coder`.
  - `provider`: `docker-model-runner`.
  - `role`: `coding`.
  - `contextWindowTokens`: `262144`.
  - `recommendedTemperature`: `0`.
  - `recommendedSeed`: `42`.
  - phase budgets: planning `32000`, implementation `128000`, verification `48000`, summary `16000`.
  - caution: model profile does not grant memory-write authority.
- [ ] Export the profile from the domain package.
- [ ] Update local coding provider selection so `qwen3-coder` maps to this profile when selected.
- [ ] Pass these environment values into `runtimes/local_experts/coding_task_bridge.py`:
  - `CODING_MODEL_CONTEXT_TOKENS`
  - `CODING_MODEL_TEMPERATURE`
  - `CODING_MODEL_SEED`
  - `CODING_MODEL_PHASE_BUDGETS_JSON`
- [ ] Update the Python bridge to load those values and apply them to prompt construction and provider calls.
- [ ] If a provider does not support seed, record `seedApplied: false` in the local agent trace.
- [ ] Add tests for profile selection, phase budget propagation, deterministic defaults, and no memory authority escalation.
- [ ] Add docs showing the smoke command `docker model run qwen3-coder`.
- [ ] Run `npm test -- --runInBand`.
- [ ] Expected result: qwen3-coder becomes an explicit local coding lane with visible budgets and no new authority.

## Task 7: Add Local Agent Execution Traces

Hermes trajectory storage is worth adapting, but MultiagentBrain should store compact operational traces only. Do not store chain-of-thought.

- [ ] Create `packages/domain/src/local-agent-trace.ts`.
- [ ] Add `LocalAgentTraceRecord` with `traceId`, `requestId`, `actorId`, `taskType`, `modelRole`, `modelId`, `memoryContextIncluded`, `retrievalTraceIncluded`, optional `toolUsed`, `status`, optional `reason`, and `createdAt`.
- [ ] Add `LocalAgentTraceStore` with `append(record)` and `listByRequest(requestId)`.
- [ ] Create `packages/infrastructure/src/sqlite/sqlite-local-agent-trace-store.ts`.
- [ ] Add table `local_agent_trace` with indexes on `request_id`, `actor_id`, and `created_at`.
- [ ] Wire the store in `packages/runtime/src/service-container.ts`.
- [ ] Update `packages/coding/src/domain-controller.ts` to append:
  - `started` before local execution.
  - `succeeded` after successful execution.
  - `failed` when local execution fails.
  - `retried` when provider retry logic retries.
- [ ] Add CLI command `list-agent-traces`.
- [ ] Add API route and MCP tool `list_agent_traces`.
- [ ] Add tests for persistence, ordering, failure reason capture, and absence of hidden reasoning text.
- [ ] Run `npm test -- --runInBand`.
- [ ] Run `mab list-agent-traces --request-id sample --json`.
- [ ] Expected result: trace listing returns an empty array for unknown request IDs and ordered records for known request IDs.

## Task 8: Add Provider Error Taxonomy And Bounded Retries

Hermes classifies execution failures. MultiagentBrain should use a small local-provider taxonomy so operators can distinguish context errors from model availability, transport, timeout, and server failures.

- [ ] Create `packages/application/src/provider-error-classifier.ts`.
- [ ] Add `ProviderErrorKind`: `context_length`, `auth`, `rate_limit`, `model_not_found`, `transport`, `server`, `timeout`, and `unknown`.
- [ ] Add `ClassifiedProviderError` with `kind`, `retryable`, and `operatorAction`.
- [ ] Classify common local-provider messages:
  - context/token length means `context_length`, not retryable.
  - missing or unknown model means `model_not_found`, not retryable.
  - connection refused or network failure means `transport`, retryable once.
  - timed-out calls mean `timeout`, retryable once.
  - 5xx provider responses mean `server`, retryable once.
- [ ] Use the classifier in `packages/coding/src/ollama-provider.ts`, `packages/coding/src/docker-ollama-provider.ts`, and any Docker Model Runner adapter if present.
- [ ] Never retry `context_length` unless the caller explicitly reduces context.
- [ ] When `context_length` occurs and memory context was included, return a structured failure recommending a lower `memoryContext.maxTokens`.
- [ ] Record the error kind and retry count in local agent traces.
- [ ] Add tests for each classifier branch, one bounded retry for retryable kinds, no blind retry for context length, and operator action in failure details.
- [ ] Run `npm test -- --runInBand`.
- [ ] Expected result: local-provider failures become typed and recoverable where recovery is safe.

## Task 9: Add Tool Output Spillover

Hermes keeps oversized tool results out of the active prompt. MultiagentBrain should adapt that pattern for local coding runs and diagnostics.

- [ ] Create `packages/application/src/tool-output-budget-service.ts`.
- [ ] Create `packages/infrastructure/src/sqlite/sqlite-tool-output-store.ts`.
- [ ] Add table `tool_output_spillover` with `output_id`, `request_id`, `actor_id`, `tool_name`, `storage_path`, `byte_length`, `preview`, and `created_at`.
- [ ] Store payload files under `state/tool-output/<request-id>/<output-id>.txt`.
- [ ] Ensure resolved spillover paths stay under `state/tool-output`.
- [ ] Add `ToolOutputBudgetService.prepareOutput`:
  - output within budget returns unchanged.
  - output over budget is persisted.
  - returned prompt text contains only a preview wrapper with output ID, total bytes, preview bytes, and preview text.
- [ ] Default inline budget: 64 KiB.
- [ ] Hard inline budget maximum: 256 KiB.
- [ ] Integrate this service wherever local coding execution captures shell or tool output.
- [ ] Add CLI command `show-tool-output --output-id`.
- [ ] Add MCP tool `show_tool_output`.
- [ ] Add tests for inline output, persisted output, path containment, missing IDs, and authorization.
- [ ] Run `npm test -- --runInBand`.
- [ ] Expected result: large outputs remain inspectable without inflating prompt context.

## Task 10: Add Retrieval And Session Recall Eval Harness

The borrowed ideas should be measured. This eval lane proves the changes improve agent context quality without weakening authority boundaries.

- [ ] Create `tests/eval/retrieval-quality.fixtures.jsonl`.
- [ ] Include at least ten fixtures covering:
  - promotion and staging.
  - FTS/vector sync.
  - duplicate detection and supersession.
  - thin MCP transport.
  - session recall non-authority.
  - qwen3-coder local profile.
  - retrieval degraded health.
  - tool-output spillover.
  - local agent traces.
  - review GUI path.
- [ ] Fixture shape:
  ```json
  {"name":"promotion flow recalls staging before canonical","query":"How does note promotion work?","expected":["staging","promotion","canonical"],"forbidden":["direct canonical write from agent"],"targetCorpora":["general_notes"],"includeSessionArchives":false}
  ```
- [ ] Create `tests/eval/run-retrieval-eval.mjs`.
- [ ] Runner behavior:
  - load fixtures.
  - call the built CLI or orchestrator for `assemble-agent-context`.
  - assert expected terms are present.
  - assert forbidden terms are not endorsed as facts.
  - fail on `unhealthy` retrieval.
  - warn on `degraded` retrieval only when the fixture permits lexical fallback.
  - write `state/eval/retrieval-quality-last.json`.
- [ ] Add package script `test:eval:retrieval`.
- [ ] Add tests for the eval runner with fake CLI responses.
- [ ] Run `npm run test:eval:retrieval`.
- [ ] Expected result: retrieval, session recall, and authority labeling are regression-tested.

## Task 11: Document Operator Workflows

- [ ] Create `docs/local-agent-context.md`.
- [ ] Document canonical memory authority, session recall non-authority, fenced context semantics, and examples for `assemble-agent-context`, `search-session-archives`, and memory-context-enabled coding tasks.
- [ ] Create `docs/qwen3-coder-local-profile.md`.
- [ ] Document local qwen3-coder verification, expected model role, context budget, deterministic defaults, and why large context still needs retrieval fences and spillover.
- [ ] Update command references for new CLI and MCP tools.
- [ ] Run `rg -n "assemble-agent-context|search-session-archives|qwen3-coder|non-authoritative|memoryContext" docs packages`.
- [ ] Expected result: operators can discover the new local-agent workflows without reading implementation code.

## Task 12: Full Verification

- [ ] Run `npm run lint`.
- [ ] Run `npm run typecheck`.
- [ ] Run `npm test -- --runInBand`.
- [ ] Run `npm run test:eval:retrieval`.
- [ ] Run `mab doctor --json`.
- [ ] Run smoke tests:
  ```powershell
  mab assemble-agent-context --actor-id codex --query "promotion orchestration" --include-session-archives --include-trace --json
  mab execute-coding-task --task "Summarize promotion flow" --memory-context-query "promotion orchestration" --memory-context-max-tokens 4000 --json
  ```
- [ ] Expected result:
  - lint passes.
  - type checks pass.
  - unit tests pass.
  - retrieval eval passes or reports a specific degraded retrieval reason.
  - doctor remains healthy.
  - smoke commands return bounded, fenced context and no direct memory writes.

## Deferred Phase: Restricted Delegation

Hermes-style agent-to-agent delegation is not an immediate adoption candidate. MultiagentBrain should revisit this only after retrieval health, session recall, context assembly, local model profiles, traces, spillover, and evals are stable.

- [ ] Design a `DelegationDraft` record that is non-authoritative by default.
- [ ] Require every delegated output that wants durable memory to enter note-capture staging.
- [ ] Add an operator-visible handoff trace before enabling autonomous multi-agent chains.
- [ ] Add evals proving delegation cannot bypass review.

## Self-Review Checklist

- [ ] No implementation weakens staging, review, promotion, audit, or sync repair.
- [ ] Session recall is searchable but never canonical.
- [ ] Retrieved context is fenced and labeled.
- [ ] Local model profile improves ergonomics without granting authority.
- [ ] Trace storage records decisions and statuses, not hidden reasoning.
- [ ] Provider retries are bounded and typed.
- [ ] Tool-output spillover is path-safe and authorized.
- [ ] Evals measure retrieval and recall behavior before claiming improvement.

## Execution Handoff

Implement in the numbered task order. Tasks 1 and 2 are the first checkpoint because they fix evidence drift and expose current retrieval health. Tasks 3 through 5 add the core agent-strength improvements. Tasks 6 through 10 improve local-model use, debugging, boundedness, recovery, and regression confidence. Tasks 11 and 12 close the loop with docs and verification.

Do not start the deferred delegation phase until the P0 and P1 work above is passing.
