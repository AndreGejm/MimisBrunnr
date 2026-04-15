# Hermes vs mimir GAP analysis

Date: 2026-04-13

Repo A: `inspiration/hermes-agent`
Repo B: this mimir workspace

Evidence standard used: source files and manifests first, docs only for scope framing. I generated Codesight for Hermes for orientation and removed the generated `.codesight` directory afterwards; no source claim below relies on Codesight alone. I did not treat any Hermes `.codesight` artifact as source evidence; local source files, manifests, and runtime entrypoints remain the evidence basis.

## 1. Executive judgment

Hermes is worth mining, but selectively. It is not a better memory system than mimir; it is a more complete interactive agent runtime. The useful Hermes ideas are mostly runtime and operator-loop ideas: agent session handling, cross-channel execution, context compression, tool result spillover, delegation, provider routing/failover, and eval/trajectory capture.

Highest Hermes learning value:

1. First-class conversational agent runtime: `run_agent.py` defines `AIAgent`; `cli.py`, `gateway/run.py`, `cron/scheduler.py`, and `acp_adapter/server.py` provide CLI, gateway, scheduled, and ACP surfaces.
2. Context assembly and compression: `agent/context_compressor.py`, `agent/context_engine.py`, and `run_agent.py:1207-1346` implement model-aware compression and pluggable context engines.
3. Delegated subagents: `tools/delegate_tool.py:1-17`, `tools/delegate_tool.py:623-760`, and `run_agent.py:3308-3336` implement isolated, capped, restricted child agents.
4. Tool registry and tool-output budget control: `tools/registry.py:1-180`, `tools/tool_result_storage.py:1-170`, and `tools/tool_result_storage.py:190-226`.
5. Provider routing and operational recovery: `agent/smart_model_routing.py:1-180`, `agent/error_classifier.py:222-310`, `agent/model_metadata.py:74-91`, and `run_agent.py:8730-8744`.
6. Eval and trace data generation: `agent/trajectory.py:30-56`, `batch_runner.py:514-680`, and `environments/benchmarks/*`.

Areas where mimir is already ahead:

1. Governed memory authority: `NoteCaptureService`, `StagingDraftService`, `DraftReviewService`, `ReviewOperatorService`, and `PromotionOrchestratorService` enforce capture, staging, review, promotion, revision, duplicate, and audit gates.
2. Canonical/staging split and SQLite audit role: `build-service-container.ts:140-330`, `sqlite-metadata-control-store.ts:1188-1337`, `packages/infrastructure/src/fts/sqlite-fts-index.ts:31-137`.
3. Retrieval as bounded, explainable service: `RetrieveContextService:72-213`, `HierarchicalRetrievalService:68-180`, `ContextPacketService:18-60`, `ContextPacketService:286-399`, `RetrievalTraceService:18-84`.
4. Auth and thin transports: CLI/API/MCP all call `validateTransportRequest` and the orchestrator, with `ActorAuthorizationPolicy.authorize` in the route.
5. Operator review workflow maturity: `scripts/review-note-gui.py`, Obsidian review plugin, and `ReviewOperatorService.acceptNote/rejectNote`.
6. Local expert safety gate: `runtimes/local_experts/escalation_controller.py:97-302` has preflight, bounded local handling, rollback, validation, and escalation.

## 2. Repo identity and scope validation

Hermes is the Nous Research `hermes-agent` repository. Evidence: `pyproject.toml` names `hermes-agent`, version `0.8.0`, author `Nous Research`, and exposes `hermes`, `hermes-agent`, and `hermes-acp` scripts; `git remote -v` points to `https://github.com/NousResearch/hermes-agent`. Its README describes a self-improving AI agent with CLI, messaging gateway, skills, memory, cron, delegation, terminal backends, and research trajectory generation.

mimir is `@mimir/workspace` in the `mimisbrunnr` Git repository. Evidence: `package.json` names the private workspace and scripts `build`, `cli`, `api`, `mcp`, and `test:e2e`; `README.md` states the current scope: governed note memory, bounded retrieval, auth-gated transports, and a vendored Python coding runtime; `git remote -v` points to `https://github.com/AndreGejm/mimisbrunnr.git`.

Comparison validity caveat: Hermes is an agent runtime with memory features. mimir is primarily a governed memory/retrieval service plus local expert runtime. Hermes should not be copied wholesale into mimir; it should be mined for runtime adapters around the existing governed core.

Retrieval-health caveat: mimir's lexical fallback is valuable, but it can hide vector retrieval degradation from agents and operators unless the response carries an explicit health signal. Any agent-facing adapter should surface that health state instead of letting lexical results look fully healthy.

## 3. Repo maps

### Hermes map

Core entrypoints:

- `pyproject.toml`: scripts `hermes`, `hermes-agent`, `hermes-acp`.
- `cli.py`: interactive CLI, model routing, slash commands, session execution.
- `run_agent.py`: central `AIAgent` loop, model calls, tool dispatch, memory/context/compression integration.
- `gateway/run.py`: long-running multi-platform gateway.
- `cron/scheduler.py`: scheduled job runner.
- `acp_adapter/server.py`: ACP server/session integration.
- `mcp_serve.py` and `tools/mcp_tool.py`: MCP serving/consuming surfaces.

Major runtime flows:

- Agent turn: `AIAgent` builds cached system context, resolves model runtime, calls model, executes tools, sanitizes tool call/result pairs, compresses as needed, persists session, and optionally stores trajectory.
- Memory: built-in file memory (`tools/memory_tool.py`) plus one external provider through `MemoryManager`; provider recall is prefetched and fenced as non-user input (`agent/memory_manager.py:54-69`, `167-184`).
- Tools: each tool registers schema/handler in `ToolRegistry`; runtime dispatches through registry or special paths for memory/delegation/MCP.
- Delegation: parent builds child agents with restricted toolsets and capped concurrency; parent sees summarized results rather than full child histories.
- Operability: gateway sessions inject channel/user context; cron jobs create unattended agent runs; trajectories and batch runner support regression/research workflows.

### mimir map

Core entrypoints:

- `apps/mimir-cli/src/main.ts`: validates payloads and invokes orchestrator methods.
- `apps/mimir-api/src/server.ts`: HTTP routes, actor context, auth-control routes, and orchestrator dispatch.
- `apps/mimir-mcp/src/main.ts` plus `tool-definitions.ts`: stdio MCP adapter over the same transport contracts.
- `packages/infrastructure/src/bootstrap/build-service-container.ts`: constructs repositories, SQLite stores, indexes, model providers, services, controllers, auth, and orchestrator.

Major runtime flows:

- Write path: `draft-note` -> `StagingDraftService.createDraft` -> deterministic validation through `validate-note` -> explicit operator review -> `promote-note` / `PromotionOrchestratorService.promoteDraft` -> canonical file write, metadata, chunks, FTS/vector sync, audit/outbox.
- Retrieval/read path: request validation -> `RetrieveContextService` or `HierarchicalRetrievalService` -> lexical/vector retrieval -> rank fusion -> optional reranker -> context packet budget enforcement -> audit and optional trace.
- Review path: current exposed surfaces include `validate-note`, `list-review-queue`, `read-review-note`, `accept-note`, `reject-note`, and explicit operator-controlled `promote-note`; the review GUI and Obsidian plugin call the thin review frontends instead of moving files directly.
- Local coding path: orchestrator routes `execute_coding_task` to a Python bridge and local expert controller.
- Session path: `create-session-archive` persists immutable non-authoritative transcript archives, explicitly not canonical memory.

## 4. Comparative architecture matrix

| Dimension | Hermes implementation | mimir implementation | Stronger | Why it matters |
|---|---|---|---|---|
| A. Memory architecture | File-backed `MEMORY.md`/`USER.md`; one external provider; live writes but frozen prompt snapshot (`tools/memory_tool.py:1-24`, `100-135`; `agent/memory_manager.py:72-184`). | Staging/canonical split, metadata identity, duplicate gate, review, promotion, chunks/indexes (`note-capture-service.ts:17-65`; `staging-draft-service.ts:44-190`, `266-349`; `promotion-orchestrator-service.ts:60-250`). | mimir clearly stronger | Hermes is useful for agent-time recall, but mimisbrunnr has safer authority and promotion discipline. |
| B. Retrieval architecture | Session search and provider prefetch exist; no evidence of a canonical multi-stage ranked memory retrieval service equivalent to mimir. | Lexical + vector + fusion + rerank + hierarchical + budgeted packets + trace (`retrieve-context-service.ts:72-213`; `hierarchical-retrieval-service.ts:68-180`; `retrieval-trace-service.ts:18-84`). | mimir clearly stronger | Retrieval quality and explainability are central to local-agent memory usefulness. |
| C. Agent orchestration | Full `AIAgent`, CLI, gateway, ACP, cron, tool execution, delegation (`run_agent.py:492`, `gateway/run.py:512`, `cron/scheduler.py:575`, `tools/delegate_tool.py`). | Command router and domain controllers, not a full conversational agent loop (`task-family-router.ts:1-159`; `multi-agent-orchestrator.ts:36-220`). | Hermes clearly stronger | mimir can be the runtime, but Hermes has the body for daily agent operation. |
| D. Session/task state | Gateway session context prompt, SQLite session store, context compression, cron runs, auto titles (`gateway/session.py:187-270`, `1050-1080`; `run_agent.py:1039-1077`). | Session archives only store immutable non-authoritative transcript artifacts (`session-archive-service.ts:25-75`; tests confirm no canonical/staging writes). | Hermes clearly stronger for active sessions | mimir preserves provenance but does not manage working memory loops. |
| E. Tool calling/safety | Dynamic registry, dangerous command approval, Tirith integration, delegation tool restrictions, code-execution RPC (`tools/registry.py`; `tools/approval.py`; `tools/code_execution_tool.py:896-1015`). | Static MCP/CLI/API command surface, actor auth, transport validation, local expert preflight/rollback (`request-validation.ts:116-181`; `actor-authorization-policy.ts:233-241`; `escalation_controller.py:304-440`). | Different tradeoff | Hermes has richer tools; mimir has stronger command authority. Combine selectively. |
| F. Local model integration | Broad provider/client routing, context length metadata, cheap-turn routing, API error classification (`agent/model_metadata.py:74-91`; `agent/smart_model_routing.py:62-180`). | Role-based providers for mimisbrunnr/coding/embedding/reranker/escalation with Ollama/OpenAI-compatible implementations (`model-role-registry.ts:1-56`; `env.ts:27-66`; `ollama-local-reasoning-provider.ts:39-160`). | Hermes stronger for breadth; mimir stronger for deterministic role contracts | Local agents need both model-role determinism and operational fallback. |
| G. Governance/review/promotion | Memory writes are immediate and file-backed; memory scanning blocks some prompt-injection/exfiltration patterns (`tools/memory_tool.py:56-97`). | Review states, self-review prevention, promotion readiness, revision matching, retrieval verification (`draft-review-service.ts:123-180`; `review-operator-service.ts:151-289`; `promotion-orchestrator-service.ts:120-168`). | mimir clearly stronger | This is where mimir should not regress. |
| H. Observability/explainability | Logs, rate limits, trajectory JSONL, batch stats, gateway status, debug helpers (`agent/trajectory.py:30-56`; `batch_runner.py:514-680`). | Audit entries, retrieval traces, candidate counts, warnings, librarian run records (`retrieve-context-service.ts:155-213`; `retrieval-trace-service.ts:31-84`; `memory-librarian-service.ts:135-190`). | Different tradeoff | Hermes explains runtime behavior; mimir explains memory/retrieval authority. |
| I. Failure/retry/recovery | Structured API error classifier drives compression, credential rotation, fallback, retry decisions (`agent/error_classifier.py:222-310`; `run_agent.py:8682-8744`). | ServiceResult errors, local expert rollback/validation/escalation, Qdrant soft-fail; fewer provider-recovery loops. | Hermes clearly stronger operationally | Local agents need graceful API/model degradation. |
| J. Determinism/auditability | Flexible runtime with many hidden states; trajectories optional; delegation hides child intermediate context from parent (`tools/delegate_tool.py:15-16`). | Transport contracts, actor auth, audit log, immutable metadata and review transitions. | mimir clearly stronger | mimisbrunnr's core quality goal is governed memory. |
| K. Developer/operator ergonomics | TUI, slash commands, gateway, cron, MCP consumer, many backends (`README.md`; `pyproject.toml`). | CLI/API/MCP plus review GUI/plugin, but less agent-facing daily UX. | Hermes stronger for daily local agents; mimir stronger for memory operators | Strong local agents need both. |
| L. Performance/boundedness | Context compression plus per-tool and per-turn result spillover (`tool_result_storage.py:1-23`, `116-170`, `190-226`). | Packet budget enforcement reduces sources/raw excerpts/summaries until within budget (`context-packet-service.ts:286-399`). | Different tradeoff | Hermes bounds active conversation; mimir bounds retrieval packets. |
| M. Tests/eval | Large pytest suite plus batch/trajectory/benchmark environments. | Focused Node e2e tests for authority, retrieval, transport, MCP, session archives, local providers, librarian. | Hermes stronger eval surface; mimir stronger contract tests | mimir lacks task-quality regression harnesses. |
| N. Practical workflows | Cron, gateway, delegated subagents, cross-platform delivery. | Capture/review/promote workflows, default-access launchers, review frontends. | Different tradeoff | Hermes helps work happen; mimir helps memory stay trustworthy. |

## 5. GAP analysis

### A. Capability gaps

1. Agent-time context adapter
   - Hermes has: memory prefetch and fenced context injection (`agent/memory_manager.py:54-69`, `167-184`).
   - mimir state: retrieval packets exist, but there is no first-class local-agent turn adapter that automatically calls `search-context`, fences packets, and feeds them into the model turn.
   - Why it matters: local agents need memory in their active read path, not only as a service command.
   - Adoption: medium. Fit risk: low. Recommendation: adapt.

2. Working-memory/session loop
   - Hermes has: session DB, cached system prompt, gateway session context, compression warnings, and automatic compression (`run_agent.py:1039-1077`, `1207-1346`; `gateway/session.py:187-270`).
   - mimir state: `SessionArchiveService` stores non-authoritative transcript archives and deliberately avoids canonical/staging writes.
   - Why it matters: long-running agents need bounded working context separate from canonical memory.
   - Adoption: medium-high. Fit risk: medium. Recommendation: adapt as separate `working_memory`, not canonical memory.

3. Delegation/handoff runtime
   - Hermes has: `delegate_task` with isolated child context, blocked tools, depth/concurrency caps, and parent summary result.
   - mimir state: local expert routing exists for coding tasks, but not general agent-to-agent task decomposition or handoff.
   - Why it matters: local agents get stronger when they can split exploration/review/implementation safely.
   - Adoption: medium. Fit risk: medium. Recommendation: adapt with audit events and explicit child-task records.

4. Tool-output spillover and active-context compression
   - Hermes has: per-result persistence and aggregate turn-budget enforcement for large tool outputs.
   - mimir state: retrieval packet budgets are strong, but tool-call result overflow is outside the core service.
   - Why it matters: local agents fail in practice when tool output silently consumes context.
   - Adoption: low-medium. Fit risk: low. Recommendation: copy the pattern, not the implementation.

5. Provider recovery and model routing
   - Hermes has: cheap-turn routing, context metadata, structured error classification and recovery hints.
   - mimir state: model roles and provider fallbacks are deterministic, but runtime provider health/retry/fallback is less developed.
   - Why it matters: local models and OpenAI-compatible endpoints fail in predictable ways; agents should recover without manual operator intervention.
   - Adoption: medium. Fit risk: low-medium. Recommendation: adapt into role-provider health and retry policy.

6. Long-running operator workflows
   - Hermes has: gateway and cron scheduler.
   - mimir state: CLI/API/MCP and review tools, but no tracked scheduler/daemon for refresh, librarian, or daily memory tasks.
   - Why it matters: memory hygiene and refresh become useful only when they can run predictably.
   - Adoption: medium. Fit risk: medium. Recommendation: adapt narrowly for mimir jobs.

7. Eval/trajectory harness
   - Hermes has: trajectory JSONL and batch runner.
   - mimir state: e2e contract tests exist, but no retrieval-quality or local-agent task-quality eval harness.
   - Why it matters: changes to ranking, packets, and local model roles need regression data.
   - Adoption: low-medium. Fit risk: low. Recommendation: adapt.

### B. Quality/robustness gaps

1. Runtime provider failure handling
   - Hermes classifies API, auth, context, rate-limit, model-not-found, billing, transport, and server disconnect failures.
   - mimir mostly returns service errors and relies on provider fallbacks or local expert escalation.
   - Value: fewer dead local-agent turns.
   - Recommendation: adapt the taxonomy into TypeScript provider wrappers.

2. Concurrency robustness around SQLite
   - Evidence observed during this investigation: parallel `mimir search-context` CLI calls contended and one process hit `database is locked`. Source does set WAL and `PRAGMA busy_timeout = 5000` in `shared-sqlite-connection.ts`, so the gap is not absence of configuration but insufficient multi-process resilience for slow concurrent reads.
   - Value: local agents often run multiple tools or automations concurrently.
   - Recommendation: add a concurrency stress test and retry/backoff around connection initialization and high-read paths.

3. Practical tool result budgeting
   - Hermes has implemented result spillover. mimir has packet budgeting but not generic tool output budgeting.
   - Recommendation: implement for any future mimir-owned agent runtime or MCP client adapter.

### C. Operability/workflow gaps

1. Daily agent UX
   - Hermes has interactive CLI, slash commands, gateway, cron, voice/platform surfaces.
   - mimir has memory/review operations but no single local-agent UX that uses the memory system as part of every turn.
   - Recommendation: build a thin local-agent shell around mimir retrieval/capture rather than expanding the memory core.

2. Scheduled memory maintenance
   - Hermes has cron jobs; mimir has `run-memory-librarian` and `create-refresh-drafts` but no tracked scheduler.
   - Recommendation: add an operator-safe scheduler that invokes existing commands and opens review items, not a free-form agent cron.

### D. Observability/explainability gaps

1. Runtime traces
   - Hermes has trajectories and batch records; mimir has retrieval traces and audit records but no model/tool turn trace.
   - Recommendation: add a local-agent trace envelope with retrieval packet ID, model role, prompt token estimate, tool calls, capture decision, and final outcome.

2. Human-readable recovery explanations
   - Hermes can explain model/API failure categories. mimir should expose provider health in `search-context` warnings and local-agent traces.

### E. Test/eval gaps

1. Retrieval-quality eval
   - mimir e2e tests cover behavior and boundaries, but not ranking quality over a stable query corpus.
   - Recommendation: build a JSONL eval set: query, expected note IDs/chunks, expected answerability, budget. Run before changing retrieval/rerank logic.

2. Agent capability eval
   - Hermes has batch trajectory infrastructure. mimir has local expert tests but not daily-agent task decomposition/retrieval-use evals.
   - Recommendation: adapt only enough to run deterministic local-agent scenarios.

## 6. Adoption candidates

| Priority | Candidate | Expected value | mimir implementation surface | Conflict/risk | Minimal first implementation | Test |
|---|---|---|---|---|---|---|
| P0 | Fenced agent-context packet adapter | Makes memory useful every turn | New thin adapter over `RetrieveContextService` or CLI/MCP `search-context` | Low; keep packets non-authoritative | `assembleAgentMemoryBlock(query, budget, includeTrace)` that emits fenced packet text plus provenance | Fixture query returns expected note IDs and cannot be mistaken for user input |
| P0 | Non-authoritative session recall | Gives agents useful continuity without promoting transcript text into fact memory | `SessionArchiveService`, SQLite FTS, CLI/API/MCP search surface, agent-context assembly | Low-medium; authority labels must be impossible to miss | Search immutable session archive messages with strict caps and `authority: "non_authoritative"` labels | Archive search returns bounded hits and never creates staging or canonical records |
| P0 | Retrieval/runtime trace envelope | Debuggable local-agent behavior | Extend retrieval trace or add local-agent trace store | Low-medium; avoid storing secrets | JSON trace with query, candidate counts, selected evidence, model role, tool calls, capture outcome | E2E asserts trace stages and redaction |
| P0 | SQLite concurrency stress and retry | More reliable multi-agent use | `shared-sqlite-connection.ts`, CLI read commands | Low | retry/backoff around database open/configure plus test parallel reads | Parallel CLI/API retrieval test |
| P1 | Context spillover/compression | Prevents long-turn context collapse | Future local-agent runtime, MCP client, coding runtime | Low | persist oversized tool outputs and replace with summary/path | Tool output > threshold stays bounded |
| P1 | Delegated task records | Safe agent-to-agent decomposition | New orchestration command or local-agent runtime using current auth/audit | Medium | create child task record, pass bounded context, disallow canonical writes, record audit | Child cannot self-promote or write canonical memory |
| P1 | Provider error taxonomy | Better model fallback | Provider wrappers and model role registry | Low-medium | classify timeout/rate/context/model/auth; return structured warning and retry hint | Simulated provider errors map to expected actions |
| P1 | qwen3-coder local capability profile | Makes the local coding lane explicit and budgeted without adding paid-model assumptions | Domain model profile, coding bridge env, local expert runtime config | Low; profile must not imply memory-write authority | Add deterministic qwen3-coder metadata, phase budgets, and bridge environment values | Profile selection and bridge env tests assert context, temperature, seed, phase budgets, and no authority escalation |
| P1 | Scheduler for governed maintenance | More useful unattended operation | New script/service invoking `run-memory-librarian` and `create-refresh-drafts` | Medium | local scheduled runner that only opens review items or safe archives | Dry-run and apply-safe-actions tests |
| P2 | Eval/trajectory harness | Regression protection | `tests/eval` plus JSONL fixtures | Low | retrieval eval command with expected notes/chunks | Ranking changes must preserve baseline |
| P2 | MCP consumer registry | Lets mimir-backed agents use external tools | Local-agent runtime, not core memory service | Medium-high | typed allowlisted registry with actor-auth wrappers | Unknown tool rejected, allowed tool audited |

## 7. Things not to copy

1. Direct file-backed memory writes as canonical memory. Hermes `memory` writes are immediate and live on disk; mimir should keep capture, staging, review, promotion, indexes, and audit as the only canonical path.
2. One external memory provider as an opaque authority. Hermes limits schema bloat by allowing one provider, but that does not provide mimir's provenance, duplicate, review, or corpus boundaries.
3. Hidden child-agent histories as the only delegation record. Hermes intentionally keeps child intermediate tool calls out of parent context. mimir should record child task metadata, inputs, outputs, and authority boundaries.
4. Monolithic runtime coupling. Hermes centralizes much runtime behavior in `run_agent.py`; mimir should borrow contracts and execution ideas, not merge a giant loop into the governed core.
5. Ungoverned cron-to-memory behavior. Scheduled jobs are valuable, but mimir scheduled tasks should invoke governed commands and open review items unless a safe autonomy policy accepts them.
6. Code execution RPC without mimir auth/audit wrapping. Hermes's RPC tool is powerful; copied directly it would bypass mimir's actor and audit model.
7. Large organic env/config sprawl. Hermes supports many providers/platforms; mimir should keep explicit role bindings and typed environment normalization.

## 8. Concrete roadmap

This week:

1. Add `agent-context-packet` helper: call `search-context`, include trace by default in dev, fence memory as non-user input, and cap raw excerpts.
2. Add a retrieval eval fixture set: 20 to 40 queries with expected note IDs/chunks and answerability.
3. Add SQLite multi-process read stress test and connection retry/backoff if it reproduces the lock.
4. Add a simple local-agent trace JSON shape that joins retrieval packet, selected model role, tool calls, and capture decision.

Medium term:

1. Build a thin local-agent shell around mimir instead of expanding the core service: retrieve before turn, capture after meaningful turn, use existing review and promotion.
2. Add provider health/error taxonomy to role providers.
3. Add a governed scheduler for librarian, freshness, and eval runs.
4. Add delegation as an audited child-task workflow with strict no-canonical-write defaults.

Long term:

1. Explore working memory separate from canonical memory: resumable task state, scratch traces, current objective, and bounded compression.
2. Add retrieval-driven planning: decompose ambiguous memory questions into subqueries, compare traces, and produce answerability decisions.
3. Build task-quality evals for local agents: retrieval-use, handoff quality, failure recovery, and no-unsafe-promotion guarantees.

## 9. Final verdict

Hermes can teach mimir how to become more useful to daily local agents: active session handling, agent-context assembly, delegation, tool-output boundedness, model recovery, scheduling, and eval traces.

Hermes cannot teach mimir better memory governance. The code evidence points the other way: mimir is already stronger on canonical authority, staging, promotion, duplicate control, review discipline, auditability, auth, and bounded retrieval packets.

The best path is selective adaptation, not direct adoption. Borrow Hermes runtime patterns around the mimir core; reject any pattern that turns governed memory into direct, hidden, or opportunistic agent state.
