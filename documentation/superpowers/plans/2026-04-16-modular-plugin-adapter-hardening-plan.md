# Modular Plugin and Adapter Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Mimir easier to extend with new providers, tools, transports, and external knowledge sources by extracting real extension boundaries without changing intended product behavior.

**Architecture:** Keep a small kernel centered on lifecycle, contract enforcement, command catalog ownership, and service wiring. Move provider-specific factories, transport dispatch branching, tool-registry sub-responsibilities, and external-source registration behind explicit adapters and registries. Preserve Mimisbrunnr governance and existing transport contracts.

**Tech Stack:** TypeScript, pnpm workspaces, Node.js, Fastify HTTP server, MCP transport, local CLI wrappers, filesystem-backed tool manifests, Qdrant, SQLite, Ollama/local model adapters.

---

## 1. Scope and guardrails

### In scope
- Extract provider construction out of `build-service-container.ts` into an explicit provider-factory registry.
- Replace transport-local runtime command switch statements with a shared runtime-command dispatcher.
- Split the tool registry into smaller modules with clearer ownership.
- Break monolithic environment loading into layered config modules while preserving current env vars.
- Add a registry boundary for external knowledge sources so future Obsidian and similar adapters do not couple directly to bootstrap.
- Tighten authorization internals where one module currently owns token parsing, actor lookup, and policy decisions.
- Update architecture docs to match the new boundaries.

### Explicitly out of scope
- No dynamic plugin loader in this pass.
- No changes to canonical-memory governance, promotion rules, or Mimisbrunnr persistence authority.
- No provider behavior changes, model routing policy changes, or transport contract changes unless required to preserve existing behavior.
- No new vendor integrations in this pass.
- No renaming of env vars, CLI commands, MCP tool names, API routes, package names, or persisted identifiers.

### Must remain behaviorally unchanged
- `apps/mimir-cli/src/main.ts` command behavior and output contracts.
- `apps/mimir-api/src/server.ts` route names, auth behavior, and response semantics.
- `apps/mimir-mcp/src/main.ts` tool names and request validation behavior.
- `packages/infrastructure/src/tools/tool-registry.ts` manifest validation rules, especially the Mimisbrunnr mount prohibition.
- `packages/orchestration/src/root/mimir-orchestrator.ts` public orchestration behavior.
- Current env var surface parsed by `packages/infrastructure/src/config/env.ts`.

---

## 2. Current problems and why they matter

### Problem A: Bootstrap owns too much provider-specific logic
Evidence:
- `packages/infrastructure/src/bootstrap/build-service-container.ts:390`
- `packages/infrastructure/src/bootstrap/build-service-container.ts:412`
- `packages/infrastructure/src/bootstrap/build-service-container.ts:455`
- `packages/infrastructure/src/bootstrap/build-service-container.ts:476`

`buildServiceContainer` is currently both the composition root and the provider-specific factory switchboard for embeddings, reasoning, drafting, and reranking. That makes the composition root harder to test and forces every provider addition through a broad, brittle module.

### Problem B: Runtime command execution is duplicated across transports
Evidence:
- `apps/mimir-cli/src/main.ts:413`
- `apps/mimir-api/src/server.ts:408`
- `apps/mimir-mcp/src/main.ts:273`

The command catalog and validation are centralized, but actual dispatch is still spread across CLI, HTTP, and MCP. That increases drift risk whenever a command is added or changed.

### Problem C: Tool registry is a real subsystem hidden in one file
Evidence:
- `packages/infrastructure/src/tools/tool-registry.ts:72`
- `packages/infrastructure/src/tools/tool-registry.ts:144`
- `packages/infrastructure/src/tools/tool-registry.ts:214`
- `packages/infrastructure/src/tools/tool-registry.ts:278`
- `packages/infrastructure/src/tools/tool-registry.ts:309`

The current file owns manifest discovery, schema validation, runtime descriptor projection, package-plan projection, and command-shape validation. Those are distinct concerns with different tests and future extension pressures.

### Problem D: Environment loading is monolithic and mixes unrelated domains
Evidence:
- `packages/infrastructure/src/config/env.ts:100`
- `packages/infrastructure/src/config/env.ts:188`
- `packages/infrastructure/src/config/env.ts:293`
- `packages/infrastructure/src/config/env.ts:369`

`env.ts` currently owns base env parsing, legacy compatibility, role binding construction, tool registry configuration, auth material, and coding runtime settings. That creates high edit risk when adding one configuration dimension.

### Problem E: External source integration has no first-class registry boundary
Evidence:
- `packages/contracts/src/external-sources/source-registry.ts`
- bootstrap usage is still composition-root centric rather than adapter-registry centric.

The contracts exist, but the runtime registration story is weak. That will make future Obsidian, codesight, or API-source adapters harder to add without bootstrap churn.

### Problem F: Authorization logic has too many responsibilities in one place
Evidence:
- `packages/orchestration/src/root/actor-authorization-policy.ts`

This module currently mixes token interpretation, actor lookup, and command-policy checks. That boundary is still manageable, but it will become harder to extend once more transports and plugin-like capabilities appear.

---

## 3. Target architecture after this plan

### Stable core
The stable core after this pass should be:
- runtime command catalog and request contracts
- orchestration services and application ports
- lifecycle/bootstrap wiring
- validation boundaries
- observability hooks
- authorization policy surface

### Explicit extension boundaries
Add or strengthen these boundaries:
1. **Provider factory registry**: infrastructure-owned, provider-specific creation isolated from bootstrap.
2. **Runtime command dispatcher**: shared dispatch layer used by CLI, API, and MCP adapters.
3. **Tool registry submodules**: discovery, validation, runtime projection, package-plan projection.
4. **Layered config modules**: core config facade backed by domain-specific parsers.
5. **External source registry**: infrastructure registration point for optional source adapters.
6. **Authorization internals split**: internal policy pieces behind a stable authorization facade.

### What should not become a plugin yet
- `MimirOrchestrator`
- canonical-memory repositories
- promotion governance flows
- request validation catalog
- core transport contracts

These are core product behavior, not optional capability modules.

---

## 4. Implementation phases

## Phase 0: Baseline safety net

### Outcome
Freeze current behavior before structural refactors.

### Steps
- [ ] Run the current verification baseline:
  - `corepack pnpm test`
  - `corepack pnpm typecheck`
  - `node scripts/launch-mimir-cli.mjs doctor --json`
- [ ] Save the doctor output into a scratch note under `tmp/` if the repo already uses that folder for local verification artifacts.
- [ ] Read these tests before touching code:
  - `tests/e2e/command-catalog.test.mjs`
  - `tests/e2e/transport-adapters.test.mjs`
  - `tests/e2e/tool-registry.test.mjs`
- [ ] Add a narrow regression test if any targeted module currently lacks direct coverage before extraction begins.

### Notes
This phase is mandatory because the refactor will move coordination logic, not replace product behavior.

---

## Phase 1: Extract a provider-factory registry

### Problem
Provider creation logic is hardcoded in bootstrap switches.

### Root cause
The composition root is acting as an adapter directory rather than only wiring adapters together.

### Smallest effective change
Move provider-specific creation into a registry that remains infrastructure-owned and synchronous with the current provider set.

### Files to add
- `packages/infrastructure/src/providers/provider-factory-registry.ts`

### Files to change
- `packages/infrastructure/src/bootstrap/build-service-container.ts`
- `packages/infrastructure/src/index.ts`
- `tests/e2e/provider-factory-registry.test.mjs`

### Target structure
```ts
// packages/infrastructure/src/providers/provider-factory-registry.ts
import type {
  DraftingProvider,
  EmbeddingProvider,
  LocalReasoningProvider,
  RerankerProvider,
} from "@mimir/application";
import type { ModelRoleBinding } from "@mimir/orchestration";
import type { AppEnvironment } from "../config/env.js";

export interface ProviderFactoryContext {
  env: AppEnvironment;
  binding: ModelRoleBinding;
}

export type EmbeddingProviderFactory = (context: ProviderFactoryContext) => EmbeddingProvider;
export type ReasoningProviderFactory = (context: ProviderFactoryContext) => LocalReasoningProvider;
export type DraftingProviderFactory = (context: ProviderFactoryContext) => DraftingProvider;
export type RerankerProviderFactory = (context: ProviderFactoryContext) => RerankerProvider | undefined;

export class ProviderFactoryRegistry {
  registerEmbedding(providerId: string, factory: EmbeddingProviderFactory): void;
  registerReasoning(providerId: string, factory: ReasoningProviderFactory): void;
  registerDrafting(providerId: string, factory: DraftingProviderFactory): void;
  registerReranker(providerId: string, factory: RerankerProviderFactory): void;
  createEmbedding(context: ProviderFactoryContext): EmbeddingProvider;
  createReasoning(context: ProviderFactoryContext): LocalReasoningProvider;
  createDrafting(context: ProviderFactoryContext): DraftingProvider;
  createReranker(context: ProviderFactoryContext): RerankerProvider | undefined;
}

export function buildDefaultProviderFactoryRegistry(): ProviderFactoryRegistry;
```

### Implementation steps
- [ ] Add `ProviderFactoryRegistry` with separate internal maps per provider role.
- [ ] Move all provider-specific switch logic from `build-service-container.ts` into `buildDefaultProviderFactoryRegistry()`.
- [ ] Keep the same concrete adapter classes and constructor arguments.
- [ ] Change `buildServiceContainer()` so it creates the default registry once and calls `registry.createEmbedding(...)`, `registry.createReasoning(...)`, `registry.createDrafting(...)`, and `registry.createReranker(...)`.
- [ ] Export the registry from `packages/infrastructure/src/index.ts` so future tests and adapters can use it without importing bootstrap internals.

### Required tests
```js
// tests/e2e/provider-factory-registry.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDefaultProviderFactoryRegistry,
} from "../../packages/infrastructure/dist/index.js";

test("default provider registry creates Ollama-backed reasoning providers", () => {
  const registry = buildDefaultProviderFactoryRegistry();
  const provider = registry.createReasoning({
    env: { /* minimal env fixture */ },
    binding: { role: "reasoning", providerId: "ollama", model: "qwen3-coder" },
  });

  assert.equal(typeof provider.generate, "function");
});
```
- [ ] Add one test per supported provider family.
- [ ] Add one negative test asserting that an unknown provider id still fails with a clear error.

### Behavioral invariants
- Provider ids stay the same.
- Existing role binding env vars stay the same.
- All current local-model defaults continue to resolve exactly as before.

### Benefit
Adding a new provider now becomes a registry registration change instead of a bootstrap rewrite.

---

## Phase 2: Extract a shared runtime-command dispatcher

### Problem
CLI, API, and MCP all re-implement runtime command dispatch.

### Root cause
The catalog owns command names and descriptions, but transport adapters still own execution branching.

### Smallest effective change
Introduce a dispatcher that accepts a validated runtime command and forwards it to the correct orchestrator or service method.

### Files to add
- `packages/infrastructure/src/transport/runtime-command-dispatcher.ts`

### Files to change
- `packages/infrastructure/src/index.ts`
- `apps/mimir-cli/src/main.ts`
- `apps/mimir-api/src/server.ts`
- `apps/mimir-mcp/src/main.ts`
- `tests/e2e/runtime-command-dispatcher.test.mjs`
- `tests/e2e/transport-adapters.test.mjs`

### Target structure
```ts
// packages/infrastructure/src/transport/runtime-command-dispatcher.ts
import type { RuntimeCliCommandName } from "@mimir/contracts";
import type { ServiceContainer } from "../bootstrap/build-service-container.js";
import type { JsonObject } from "../shared/json.js";

export interface RuntimeDispatchResult {
  body: unknown;
  statusCode?: number;
}

export class RuntimeCommandDispatcher {
  constructor(private readonly services: ServiceContainer) {}

  async dispatch(commandName: RuntimeCliCommandName, request: JsonObject): Promise<RuntimeDispatchResult>;
}
```

### Implementation steps
- [ ] Create `RuntimeCommandDispatcher` with one private method per runtime command family instead of one transport-local switch per app.
- [ ] Keep request validation in transport adapters exactly where it already lives.
- [ ] In the CLI, replace the `runCommand` switch with `dispatcher.dispatch(commandName, validated.payload)`.
- [ ] In the API, replace the runtime route switch with the shared dispatcher and keep HTTP-specific status shaping local to the API adapter.
- [ ] In the MCP adapter, map MCP runtime tool names to runtime command names and call the same dispatcher.
- [ ] Leave admin-only command handling outside this dispatcher if those flows are transport-specific today.

### Required tests
- [ ] Add dispatcher tests that assert each runtime command reaches the correct service method using fakes.
- [ ] Extend `tests/e2e/transport-adapters.test.mjs` so CLI, API, and MCP still return the same payload shapes for at least:
  - `search-context`
  - `fetch-note`
  - `capture-note`
  - `list-ai-tools`
  - `tools-package-plan`

### Behavioral invariants
- Validation still occurs before dispatch.
- Transport-specific auth still stays in each transport boundary.
- CLI and MCP outputs remain byte-for-byte stable where existing tests already enforce that.

### Benefit
A new runtime command no longer requires editing three separate execution switches.

---

## Phase 3: Decompose the tool registry into smaller modules

### Problem
One file owns discovery, validation, descriptor projection, and package-plan logic.

### Root cause
Tooling was initially small and the file grew into a subsystem.

### Smallest effective change
Keep `tool-registry.ts` as a compatibility facade while moving responsibilities into narrowly scoped modules.

### Files to add
- `packages/infrastructure/src/tools/tool-manifest.ts`
- `packages/infrastructure/src/tools/tool-manifest-store.ts`
- `packages/infrastructure/src/tools/tool-runtime-descriptor.ts`
- `packages/infrastructure/src/tools/tool-package-planner.ts`

### Files to change
- `packages/infrastructure/src/tools/tool-registry.ts`
- `packages/infrastructure/src/index.ts`
- `tests/e2e/tool-registry.test.mjs`

### Target ownership
- `tool-manifest.ts`: types, schema assertions, manifest normalization helpers.
- `tool-manifest-store.ts`: filesystem discovery and manifest loading.
- `tool-runtime-descriptor.ts`: conversion to runtime descriptors used by transports.
- `tool-package-planner.ts`: package-plan projection and command-shape checks.
- `tool-registry.ts`: public facade that composes the modules for compatibility.

### Implementation steps
- [ ] Move pure manifest validation into `tool-manifest.ts`.
- [ ] Move directory scanning and file reading into `tool-manifest-store.ts`.
- [ ] Move `toRuntimeDescriptor` into `tool-runtime-descriptor.ts`.
- [ ] Move `toPackagePlanTool` and runtime CLI command array validation into `tool-package-planner.ts`.
- [ ] Keep `loadToolRegistryFromDirectory()` as the stable entry point, but rewrite it as composition over the new modules.
- [ ] Preserve the current safety rule that rejects direct Mimisbrunnr mounts.

### Required tests
- [ ] Keep the existing direct Mimisbrunnr mount rejection test.
- [ ] Add a test for manifest-store failure isolation when one manifest file is malformed.
- [ ] Add a test for runtime-descriptor projection ordering if current behavior is sorted and externally visible.
- [ ] Add a test for package-plan projection so a manifest that lacks a runtime CLI command array still fails clearly.

### Behavioral invariants
- Tool discovery path and manifest format stay unchanged.
- Existing starter manifests still load.
- Existing package-plan output stays stable.

### Benefit
Future tool sources and health checks can extend one submodule instead of inflating one broad file.

---

## Phase 4: Layer the configuration surface without breaking compatibility

### Problem
`env.ts` mixes unrelated configuration domains.

### Root cause
Compatibility, legacy env support, and new settings all landed in one parser module.

### Smallest effective change
Split parsing into domain-specific modules while preserving `loadEnvironment()` and the exported `AppEnvironment` shape.

### Files to add
- `packages/infrastructure/src/config/core-config.ts`
- `packages/infrastructure/src/config/provider-config.ts`
- `packages/infrastructure/src/config/storage-config.ts`
- `packages/infrastructure/src/config/tool-config.ts`
- `packages/infrastructure/src/config/auth-config.ts`
- `packages/infrastructure/src/config/coding-runtime-config.ts`

### Files to change
- `packages/infrastructure/src/config/env.ts`
- `packages/infrastructure/src/index.ts`
- `tests/e2e/config-boundaries.test.mjs`

### Target structure
```ts
// packages/infrastructure/src/config/env.ts
import { loadCoreConfig } from "./core-config.js";
import { loadProviderConfig } from "./provider-config.js";
import { loadStorageConfig } from "./storage-config.js";
import { loadToolConfig } from "./tool-config.js";
import { loadAuthConfig } from "./auth-config.js";
import { loadCodingRuntimeConfig } from "./coding-runtime-config.js";

export function loadEnvironment(source = process.env): AppEnvironment {
  return normalizeEnvironment({
    ...loadCoreConfig(source),
    ...loadStorageConfig(source),
    ...loadProviderConfig(source),
    ...loadToolConfig(source),
    ...loadAuthConfig(source),
    ...loadCodingRuntimeConfig(source),
  });
}
```

### Implementation steps
- [ ] Identify the current exported `AppEnvironment` shape and keep it unchanged.
- [ ] Move only parsing logic, not the public type contract.
- [ ] Keep legacy env compatibility helpers in `env.ts` or one dedicated compatibility section if they span multiple config domains.
- [ ] Add module-local validation functions so future config changes are localized.
- [ ] Add a comment block in `env.ts` documenting that it is now the compatibility facade.

### Required tests
- [ ] Create a fixture env object with all currently important settings.
- [ ] Assert `loadEnvironment(fixture)` returns the same normalized output before and after the refactor.
- [ ] Add one test proving legacy role-binding env vars still map into the same `roleBindings` structure.

### Behavioral invariants
- No env var names change.
- No config file names change.
- No caller imports need to change unless they explicitly want the new submodules.

### Benefit
Future provider or transport config work can land in one bounded parser rather than inside a monolith.

---

## Phase 5: Promote external-source registration to a first-class adapter boundary

### Problem
The contracts for external sources exist, but registration still depends too much on direct bootstrap knowledge.

### Root cause
The extension surface was defined before runtime registration was made explicit.

### Smallest effective change
Add an infrastructure registry that owns external-source adapter registration and discovery.

### Files to add
- `packages/infrastructure/src/external-sources/external-source-registry.ts`

### Files to change
- `packages/infrastructure/src/bootstrap/build-service-container.ts`
- `packages/infrastructure/src/index.ts`
- relevant source adapters already present in the repo
- `tests/e2e/external-source-registry.test.mjs`

### Target structure
```ts
// packages/infrastructure/src/external-sources/external-source-registry.ts
import type {
  ExternalSourceDefinition,
  ExternalSourceRegistry,
} from "@mimir/contracts/external-sources";

export class InMemoryExternalSourceRegistry implements ExternalSourceRegistry {
  register(definition: ExternalSourceDefinition): void;
  list(): ExternalSourceDefinition[];
  get(sourceId: string): ExternalSourceDefinition | undefined;
}
```

### Implementation steps
- [ ] Create a registry implementation with deterministic registration ordering.
- [ ] Register current external sources through the registry instead of inline bootstrap arrays or ad hoc wiring.
- [ ] Keep source adapter construction in infrastructure.
- [ ] Do not let sources write directly to canonical Mimisbrunnr stores; the registry is for discovery and controlled access only.
- [ ] Add an adapter-facing interface note explaining that future Obsidian integration should register here.

### Required tests
- [ ] Assert current source definitions are all present after container bootstrap.
- [ ] Assert duplicate source ids fail fast.
- [ ] Assert listing order is stable if any UI or API output depends on it.

### Behavioral invariants
- Existing external source IDs and schemas stay unchanged.
- No source gains new write powers.

### Benefit
Future optional sources become additive registrations instead of bootstrap surgery.

---

## Phase 6: Split authorization internals behind the current facade

### Problem
Authorization logic is still concentrated in one broad module.

### Root cause
Early-stage policy growth concentrated parsing and decision logic in one place.

### Smallest effective change
Keep the current exported facade while moving internals into focused modules.

### Files to add
- `packages/orchestration/src/root/actor-token-inspector.ts`
- `packages/orchestration/src/root/actor-registry-policy.ts`
- `packages/orchestration/src/root/command-authorization-matrix.ts`

### Files to change
- `packages/orchestration/src/root/actor-authorization-policy.ts`
- `packages/orchestration/src/index.ts`
- `tests/e2e/authorization-policy.test.mjs`

### Target ownership
- `actor-token-inspector.ts`: extract and normalize actor identity from transport tokens or headers.
- `actor-registry-policy.ts`: map identities to known actor capabilities.
- `command-authorization-matrix.ts`: declare which command families each actor type may run.
- `actor-authorization-policy.ts`: compose the above and preserve the public API.

### Implementation steps
- [ ] Move token/header parsing logic into `actor-token-inspector.ts`.
- [ ] Move actor lookup and trust-policy logic into `actor-registry-policy.ts`.
- [ ] Move command-family allow/deny checks into a static matrix module.
- [ ] Keep the old facade signature intact so transports do not change.

### Required tests
- [ ] Add actor-token parsing tests for malformed, missing, and valid tokens.
- [ ] Add actor capability tests for at least one allowed and one denied command family.
- [ ] Keep transport auth tests green without rewriting them.

### Behavioral invariants
- Same actors retain the same permissions.
- Denials remain denials.
- No transport-specific auth logic migrates inward.

### Benefit
Policy changes become easier to reason about and less likely to produce hidden side effects.

---

## Phase 7: Documentation and boundary normalization

### Files to update
- `documentation/architecture/invariants-and-boundaries.md`
- `documentation/reference/repo-map.md`
- `documentation/reference/runtime-command-catalog.md` if present, otherwise create it
- `README.md` only if it currently describes the old structure inaccurately

### Required documentation changes
- [ ] Add a short section naming the new extension boundaries:
  - provider factory registry
  - runtime command dispatcher
  - tool registry submodules
  - layered config facade
  - external source registry
- [ ] Document what is still core and intentionally not pluggable.
- [ ] Add one diagram or bullet flow showing how a runtime command travels from transport -> validation -> dispatcher -> orchestrator/service.
- [ ] Add one diagram or bullet flow showing how an external source adapter is registered without gaining direct canonical-write authority.

### Documentation rule
Do not document hypothetical dynamic plugins or future provider marketplaces. Document only the extension points actually present after the refactor.

---

## 5. Execution order and checkpoints

### Recommended order
1. Phase 0 baseline
2. Phase 1 provider-factory registry
3. Phase 2 runtime-command dispatcher
4. Phase 3 tool registry decomposition
5. Phase 4 layered config
6. Phase 5 external-source registry
7. Phase 6 authorization split
8. Phase 7 docs and cleanup

### Checkpoints after each phase
- [ ] `corepack pnpm typecheck`
- [ ] `corepack pnpm test`
- [ ] `git diff --check`
- [ ] If the phase touches transport wiring, also run:
  - `node scripts/launch-mimir-cli.mjs doctor --json`

### Stop conditions
Pause the refactor and reassess if any phase causes one of the following:
- transport output contracts begin to drift in snapshot-like tests
- provider selection behavior changes for existing role bindings
- tool-registry safety rules weaken
- external sources gain direct canonical-memory write paths
- auth behavior becomes transport-dependent or inconsistent

---

## 6. Acceptance criteria

This plan is complete only when all of the following are true:
- [ ] Adding a new provider no longer requires editing provider switches in `build-service-container.ts`.
- [ ] Adding a new runtime command no longer requires transport-local execution switches in three apps.
- [ ] Tool-registry responsibilities are split into at least discovery, validation, and projection modules.
- [ ] `env.ts` remains the compatibility facade, but config parsing is materially decomposed.
- [ ] External source adapters can register through one registry boundary.
- [ ] Authorization internals are easier to test in isolation.
- [ ] Existing CLI, HTTP, and MCP behavior remains stable.
- [ ] Architecture docs describe the new boundaries accurately.

---

## 7. Risks and mitigation

### Risk: abstraction theater
Mitigation:
- Do not introduce interfaces where there is no substitution pressure.
- Keep registries concrete and local until a second implementation appears.
- Prefer facades that preserve imports over tree-wide rewrites.

### Risk: transport regressions
Mitigation:
- Keep validation and auth in current transport layers.
- Move only dispatch selection into the shared dispatcher.
- Extend existing cross-transport tests before deleting old switches.

### Risk: bootstrap churn still leaks through
Mitigation:
- Limit the provider-factory registry to construction concerns.
- Do not move container ownership or domain policy into the registry.

### Risk: config split breaks compatibility
Mitigation:
- Treat `env.ts` as the stable public entry point.
- Snapshot or deep-compare normalized config output for representative env fixtures.

### Risk: external source registry expands source power accidentally
Mitigation:
- Preserve current governance boundaries.
- Explicitly document that source adapters can expose data for review and retrieval, not write canonical memory directly.

---

## 8. Follow-on work deliberately deferred

These are useful later, but they should not be part of this pass:
- dynamic plugin loading from manifests or npm packages
- hot-swappable provider installation
- transport plugin discovery
- runtime tool sandbox orchestration redesign
- canonical-memory schema changes
- autonomous background write agents

Those ideas only become worthwhile after the current hardcoded extension seams are reduced.

---

## 9. Practical success test

After this plan is implemented, a developer should be able to do the following with localized changes:

### Add a provider
- register one provider factory in `provider-factory-registry.ts`
- add focused tests
- avoid editing the composition root switchboard

### Add a runtime command
- extend the command catalog and validator
- add one dispatcher handler
- avoid editing three different transport execution switches

### Add a tool manifest capability
- update one tool submodule and its tests
- avoid adding more branches to a single broad registry file

### Add an external source adapter
- implement the adapter in infrastructure
- register it through the external-source registry
- avoid changing canonical-memory governance

If those workflows are not materially simpler, the refactor is not done.