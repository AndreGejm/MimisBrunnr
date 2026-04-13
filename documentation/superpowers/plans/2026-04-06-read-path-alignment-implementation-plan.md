# Read-Path Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a governed context namespace, layered read representations, retrieval traces, hierarchical retrieval rollout gates, controlled imports, and session archives without weakening Multi Agent Brain's existing authority, freshness, auth, or promotion model.

**Architecture:** Preserve the current authority plane: canonical Markdown, staging drafts, SQLite metadata and audit authority, FTS, Qdrant, deterministic promotion, and actor-scoped authz all remain in place. Add a read-only namespace projection, derived `L0` and `L1` representations, optional hierarchical retrieval, and new read/import/session artifacts as additive layers that always expose authority state and never bypass staged promotion.

**Tech Stack:** TypeScript monorepo, Node 22, pnpm workspaces, raw HTTP server, MCP adapter, SQLite, Qdrant, Node test runner.

---

## File Structure

### New domain and contract units

- Create `packages/domain/src/contexts/context-authority-state.ts` for the six authority states from `documentation/planning/read-path-alignment-rfc.md`.
- Create `packages/domain/src/contexts/context-kind.ts` for namespace-visible context kinds.
- Create `packages/domain/src/contexts/context-owner-scope.ts` for namespace owner scopes.
- Create `packages/domain/src/contexts/context-representation-layer.ts` for `L0` / `L1` / `L2`.
- Create `packages/domain/src/contexts/context-node.ts` for the authoritative node descriptor shape.
- Create `packages/domain/src/contexts/index.ts` to re-export context-domain primitives.
- Create `packages/domain/src/imports/import-artifact-state.ts` and `packages/domain/src/imports/import-job.ts` for import lifecycle state.
- Create `packages/domain/src/sessions/session-archive.ts` for immutable session archive descriptors.
- Create `packages/domain/src/retrieval/retrieval-trace.ts` for retrieval trace event envelopes.

- Create `packages/contracts/src/common/context-node-descriptor.ts` for transport-safe namespace node payloads.
- Create `packages/contracts/src/common/context-representation-ref.ts` for exposing representation availability and selection.
- Create `packages/contracts/src/common/retrieval-trace-ref.ts` for transport-safe trace payloads.
- Create `packages/contracts/src/retrieval/list-context-tree.contract.ts` for namespace tree listing.
- Create `packages/contracts/src/retrieval/read-context-node.contract.ts` for reading namespace nodes and selecting `L0` / `L1` / `L2`.
- Create `packages/contracts/src/retrieval/grep-context.contract.ts` for regex search over namespace-visible `L2` content.
- Create `packages/contracts/src/retrieval/glob-context.contract.ts` for path-pattern queries.
- Create `packages/contracts/src/maintenance/import-resource.contract.ts` for staged imports.
- Create `packages/contracts/src/history/create-session-archive.contract.ts` for explicit session archive creation.

### New application ports and services

- Create `packages/application/src/ports/context-namespace-store.ts` for namespace projection persistence.
- Create `packages/application/src/ports/context-representation-store.ts` for derived `L0` / `L1` persistence.
- Create `packages/application/src/ports/import-job-store.ts` for import job state.
- Create `packages/application/src/ports/session-archive-store.ts` for archive persistence.
- Create `packages/application/src/services/context-namespace-service.ts` for browse/list/read resolution.
- Create `packages/application/src/services/context-representation-service.ts` for projection and backfill of `L0` / `L1`.
- Create `packages/application/src/services/retrieval-trace-service.ts` for building trace payloads and packet diffs.
- Create `packages/application/src/services/hierarchical-retrieval-service.ts` for the opt-in retrieval strategy.
- Create `packages/application/src/services/import-orchestration-service.ts` for staged imports.
- Create `packages/application/src/services/session-archive-service.ts` for immutable archive creation and lookup.

### New infrastructure adapters

- Create `packages/infrastructure/src/sqlite/sqlite-context-namespace-store.ts` for namespace metadata.
- Create `packages/infrastructure/src/sqlite/sqlite-context-representation-store.ts` for `L0` / `L1` projections.
- Create `packages/infrastructure/src/sqlite/sqlite-import-job-store.ts` for import workflow state.
- Create `packages/infrastructure/src/sqlite/sqlite-session-archive-store.ts` for archive state.

### Transport and test updates

- Modify `apps/brain-cli/src/main.ts` to expose new browse/read/import/archive commands as thin wrappers.
- Modify `apps/brain-api/src/server.ts` to expose HTTP routes for the same bounded operations.
- Modify `apps/brain-mcp/src/tool-definitions.ts` to expose read-only browse and trace tools plus controlled import/archive tools.
- Create `tests/e2e/context-authority-contracts.test.mjs`.
- Create `tests/e2e/context-namespace.test.mjs`.
- Create `tests/e2e/retrieval-trace.test.mjs`.
- Create `tests/e2e/context-representations.test.mjs`.
- Create `tests/e2e/hierarchical-retrieval.test.mjs`.
- Create `tests/e2e/import-pipeline.test.mjs`.
- Create `tests/e2e/session-archives.test.mjs`.
- Modify `package.json` to run the new test files under `test:e2e`.

### Explicitly deferred from this plan

- Extraction drafts from session material are deferred until namespace, traces, and retrieval evaluation are stable.
- Automatic memory synthesis heuristics are out of scope.

## Task 1: Encode authority-state invariants and namespace contracts

**Files:**
- Create: `packages/domain/src/contexts/context-authority-state.ts`
- Create: `packages/domain/src/contexts/context-kind.ts`
- Create: `packages/domain/src/contexts/context-owner-scope.ts`
- Create: `packages/domain/src/contexts/context-representation-layer.ts`
- Create: `packages/domain/src/contexts/context-node.ts`
- Create: `packages/domain/src/contexts/index.ts`
- Modify: `packages/domain/src/index.ts`
- Create: `packages/contracts/src/common/context-node-descriptor.ts`
- Create: `packages/contracts/src/common/context-representation-ref.ts`
- Modify: `packages/contracts/src/index.ts`
- Create: `tests/e2e/context-authority-contracts.test.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write the failing contract test**

```js
import assert from "node:assert/strict";
import test from "node:test";
import * as domain from "../../packages/domain/dist/index.js";

test("context node descriptors preserve authority and freshness fields", async () => {
  assert.equal(typeof domain.createContextAuthorityStateSet, "function");
  const descriptor = {
    uri: "mab://context_brain/note/test-note",
    ownerScope: "context_brain",
    contextKind: "note",
    authorityState: "canonical",
    sourceType: "canonical_note",
    sourceRef: "test-note",
    freshness: {
      validFrom: "2026-04-06",
      validUntil: "2026-04-30",
      freshnessClass: "current",
      freshnessReason: "within validity window"
    },
    representationAvailability: { L0: true, L1: true, L2: true },
    promotionStatus: "promoted",
    supersessionStatus: "active",
    createdAt: "2026-04-06T00:00:00.000Z",
    updatedAt: "2026-04-06T00:00:00.000Z"
  };

  assert.equal(descriptor.authorityState, "canonical");
  assert.equal(descriptor.freshness.freshnessClass, "current");
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `corepack pnpm build && node --test tests/e2e/context-authority-contracts.test.mjs`

Expected: FAIL because the new context-domain exports and descriptor shapes do not exist yet.

- [ ] **Step 3: Add the domain and contract primitives**

```ts
export const CONTEXT_AUTHORITY_STATES = [
  "canonical",
  "staging",
  "derived",
  "imported",
  "session",
  "extracted"
] as const;

export type ContextAuthorityState = (typeof CONTEXT_AUTHORITY_STATES)[number];

export interface ContextNode {
  uri: string;
  ownerScope: ContextOwnerScope;
  contextKind: ContextKind;
  authorityState: ContextAuthorityState;
  sourceType: ContextSourceType;
  sourceRef: string;
  freshness: ContextFreshness;
  representationAvailability: Record<ContextRepresentationLayer, boolean>;
  promotionStatus: ContextPromotionStatus;
  supersessionStatus: ContextSupersessionStatus;
  createdAt: string;
  updatedAt: string;
}
```

- [ ] **Step 4: Re-run the focused test and typecheck**

Run: `corepack pnpm build && node --test tests/e2e/context-authority-contracts.test.mjs`

Expected: PASS with the descriptor shape and exports available.

- [ ] **Step 5: Commit**

```bash
git add package.json packages/domain/src packages/contracts/src tests/e2e/context-authority-contracts.test.mjs
git commit -m "feat: add context authority and namespace contracts"
```

## Task 2: Add a read-only namespace projection over current authority stores

**Files:**
- Create: `packages/application/src/ports/context-namespace-store.ts`
- Create: `packages/application/src/services/context-namespace-service.ts`
- Create: `packages/infrastructure/src/sqlite/sqlite-context-namespace-store.ts`
- Modify: `packages/application/src/index.ts`
- Modify: `packages/infrastructure/src/index.ts`
- Modify: `packages/infrastructure/src/bootstrap/build-service-container.ts`
- Modify: `packages/infrastructure/src/sqlite/sqlite-metadata-control-store.ts`
- Create: `tests/e2e/context-namespace.test.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write the failing namespace projection test**

```js
import assert from "node:assert/strict";
import test from "node:test";
import { buildServiceContainer } from "../../packages/infrastructure/dist/index.js";

test("namespace service projects canonical and staging notes without collapsing authority state", async () => {
  const container = buildServiceContainer();
  assert.ok(container.services.contextNamespaceService);
  const tree = await container.services.contextNamespaceService.listTree({
    actor: { actorId: "operator", actorRole: "operator", source: "test", transport: "internal" },
    ownerScope: "context_brain"
  });
  assert.equal(tree.ok, true);
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `corepack pnpm build && node --test tests/e2e/context-namespace.test.mjs`

Expected: FAIL because the service, port, and SQLite adapter do not exist yet.

- [ ] **Step 3: Implement the namespace store and service**

```ts
export interface ContextNamespaceStore {
  listNodes(input: {
    ownerScope?: ContextOwnerScope;
    authorityStates?: ContextAuthorityState[];
    parentUri?: string;
  }): Promise<ContextNode[]>;

  getNodeByUri(uri: string): Promise<ContextNode | undefined>;
}

export class ContextNamespaceService {
  constructor(private readonly namespaceStore: ContextNamespaceStore) {}

  async listTree(input: ListContextTreeRequest): Promise<ServiceResult<ListContextTreeResponse, "forbidden">> {
    const nodes = await this.namespaceStore.listNodes({
      ownerScope: input.ownerScope,
      authorityStates: input.authorityStates
    });
    return { ok: true, data: { nodes } };
  }
}
```

- [ ] **Step 4: Wire the service into the container and pass the focused test**

Run: `corepack pnpm build && node --test tests/e2e/context-namespace.test.mjs`

Expected: PASS with canonical and staging nodes listed as distinct authority states.

- [ ] **Step 5: Commit**

```bash
git add packages/application/src packages/infrastructure/src tests/e2e/context-namespace.test.mjs package.json
git commit -m "feat: add read-only context namespace projection"
```

## Task 3: Expose read-only browse and read surfaces through CLI, HTTP, and MCP

**Files:**
- Create: `packages/contracts/src/retrieval/list-context-tree.contract.ts`
- Create: `packages/contracts/src/retrieval/read-context-node.contract.ts`
- Create: `packages/contracts/src/retrieval/grep-context.contract.ts`
- Create: `packages/contracts/src/retrieval/glob-context.contract.ts`
- Create: `packages/contracts/src/mcp/list-context-tree.tool.ts`
- Create: `packages/contracts/src/mcp/read-context-node.tool.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/contracts/src/mcp/index.ts`
- Modify: `packages/infrastructure/src/transport/request-validation.ts`
- Modify: `apps/brain-cli/src/main.ts`
- Modify: `apps/brain-api/src/server.ts`
- Modify: `apps/brain-mcp/src/tool-definitions.ts`
- Modify: `tests/e2e/transport-adapters.test.mjs`
- Modify: `tests/e2e/mcp-adapter.test.mjs`
- Modify: `package.json`

- [ ] **Step 1: Add failing transport tests**

```js
test("brain-cli can list context tree nodes through the shared namespace service", async () => {
  const result = await runNodeCommand(
    path.join(process.cwd(), "apps", "brain-cli", "dist", "main.js"),
    ["list-context-tree", "--json", JSON.stringify({ ownerScope: "context_brain" })],
    process.env
  );
  assert.equal(result.exitCode, 0, result.stderr);
});
```

- [ ] **Step 2: Run the focused transport tests and verify they fail**

Run: `corepack pnpm build && node --test tests/e2e/transport-adapters.test.mjs tests/e2e/mcp-adapter.test.mjs`

Expected: FAIL because the new transport contracts and routes are missing.

- [ ] **Step 3: Implement the thin browse/read adapters**

```ts
{
  name: "list_context_tree",
  title: "List Context Tree",
  description: "List namespace nodes without mutating authority state.",
  defaultActorRole: "retrieval",
  inputSchema: {
    type: "object",
    properties: {
      ownerScope: { type: "string" },
      authorityStates: { type: "array", items: { type: "string" } }
    }
  }
}
```

- [ ] **Step 4: Re-run focused transport tests**

Run: `corepack pnpm build && node --test tests/e2e/transport-adapters.test.mjs tests/e2e/mcp-adapter.test.mjs`

Expected: PASS with CLI, HTTP, and MCP all delegating to the shared namespace service.

- [ ] **Step 5: Commit**

```bash
git add apps/brain-cli/src/main.ts apps/brain-api/src/server.ts apps/brain-mcp/src/tool-definitions.ts packages/contracts/src packages/infrastructure/src/transport/request-validation.ts tests/e2e/transport-adapters.test.mjs tests/e2e/mcp-adapter.test.mjs package.json
git commit -m "feat: expose namespace browse surfaces across transports"
```

## Task 4: Add retrieval trace payloads and packet diff tooling

**Files:**
- Create: `packages/domain/src/retrieval/retrieval-trace.ts`
- Create: `packages/contracts/src/common/retrieval-trace-ref.ts`
- Modify: `packages/contracts/src/retrieval/retrieve-context.contract.ts`
- Create: `packages/application/src/services/retrieval-trace-service.ts`
- Modify: `packages/application/src/services/retrieve-context-service.ts`
- Create: `tests/e2e/retrieval-trace.test.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write the failing trace test**

```js
test("retrieve context can emit a bounded trace and packet diff metadata", async () => {
  const result = await container.services.retrieveContextService.retrieveContext({
    actor: actor("retrieval"),
    query: "writer promotion policy",
    corpusIds: ["context_brain"],
    budget: { maxTokens: 1200, maxSources: 4, maxRawExcerpts: 2, maxSummarySentences: 6 },
    includeTrace: true
  });

  assert.equal(result.ok, true);
  assert.ok(result.data.trace);
  assert.ok(Array.isArray(result.data.trace.events));
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `corepack pnpm build && node --test tests/e2e/retrieval-trace.test.mjs`

Expected: FAIL because `includeTrace` and the trace payload do not exist.

- [ ] **Step 3: Implement trace capture without changing retrieval semantics**

```ts
export interface RetrievalTraceEvent {
  stage: "intent" | "lexical" | "vector" | "fusion" | "rerank" | "packet";
  message: string;
  data?: Record<string, unknown>;
}

export interface RetrievalTraceRef {
  strategy: "flat" | "hierarchical";
  events: RetrievalTraceEvent[];
  candidateCounts: {
    lexical: number;
    vector: number;
    reranked: number;
    delivered: number;
  };
}
```

- [ ] **Step 4: Re-run the focused trace test**

Run: `corepack pnpm build && node --test tests/e2e/retrieval-trace.test.mjs`

Expected: PASS with trace events present and packet output still bounded.

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/retrieval packages/contracts/src/common/retrieval-trace-ref.ts packages/contracts/src/retrieval/retrieve-context.contract.ts packages/application/src/services/retrieval-trace-service.ts packages/application/src/services/retrieve-context-service.ts tests/e2e/retrieval-trace.test.mjs package.json
git commit -m "feat: add retrieval traces and packet diff metadata"
```

## Task 5: Add derived `L0` and `L1` representations tied to promotion and backfill

**Files:**
- Create: `packages/application/src/ports/context-representation-store.ts`
- Create: `packages/application/src/services/context-representation-service.ts`
- Create: `packages/infrastructure/src/sqlite/sqlite-context-representation-store.ts`
- Modify: `packages/application/src/services/promotion-orchestrator-service.ts`
- Modify: `packages/application/src/services/context-packet-service.ts`
- Modify: `packages/infrastructure/src/bootstrap/build-service-container.ts`
- Modify: `packages/infrastructure/src/index.ts`
- Create: `tests/e2e/context-representations.test.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write the failing representation test**

```js
test("promotion regenerates L0 and L1 derived representations for canonical notes", async () => {
  const promote = await container.services.promotionOrchestratorService.promoteDraft({
    actor: actor("orchestrator"),
    draftNoteId,
    targetCorpus: "context_brain",
    promoteAsCurrentState: false
  });

  assert.equal(promote.ok, true);
  const representations = await container.services.contextRepresentationService.listForNode(promote.data.promotedNoteId);
  assert.equal(representations.L0.layer, "L0");
  assert.equal(representations.L1.layer, "L1");
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `corepack pnpm build && node --test tests/e2e/context-representations.test.mjs`

Expected: FAIL because no derived representation store or service exists.

- [ ] **Step 3: Implement the representation service and promotion hook**

```ts
export interface ContextRepresentationStore {
  upsertRepresentations(input: {
    sourceRef: string;
    representations: Record<"L0" | "L1", { content: string; generatedAt: string; sourceHash: string }>;
  }): Promise<void>;
}

await this.contextRepresentationService.regenerateForCanonicalNote({
  noteId: promotedNoteId,
  notePath: targetPath,
  title: normalizedFrontmatter.title,
  summary: normalizedFrontmatter.summary,
  body: draft.body
});
```

- [ ] **Step 4: Re-run the focused test**

Run: `corepack pnpm build && node --test tests/e2e/context-representations.test.mjs`

Expected: PASS with `L0` and `L1` derived rows available after promotion.

- [ ] **Step 5: Commit**

```bash
git add packages/application/src/ports/context-representation-store.ts packages/application/src/services/context-representation-service.ts packages/application/src/services/promotion-orchestrator-service.ts packages/infrastructure/src/sqlite/sqlite-context-representation-store.ts packages/infrastructure/src/bootstrap/build-service-container.ts packages/infrastructure/src/index.ts tests/e2e/context-representations.test.mjs package.json
git commit -m "feat: add derived context representations"
```

## Task 6: Add hierarchical retrieval behind a strategy flag and coexistence gate

**Files:**
- Create: `packages/application/src/services/hierarchical-retrieval-service.ts`
- Modify: `packages/contracts/src/retrieval/retrieve-context.contract.ts`
- Modify: `packages/application/src/services/retrieve-context-service.ts`
- Modify: `packages/application/src/services/ranking-fusion-service.ts`
- Modify: `packages/infrastructure/src/transport/request-validation.ts`
- Create: `tests/e2e/hierarchical-retrieval.test.mjs`
- Modify: `package.json`

- [ ] **Step 1: Add the failing hierarchical retrieval test**

```js
test("hierarchical retrieval is opt-in and preserves bounded packet guarantees", async () => {
  const result = await container.services.retrieveContextService.retrieveContext({
    actor: actor("retrieval"),
    query: "writer promotion policy",
    corpusIds: ["context_brain"],
    strategy: "hierarchical",
    budget: { maxTokens: 900, maxSources: 3, maxRawExcerpts: 1, maxSummarySentences: 5 },
    includeTrace: true
  });

  assert.equal(result.ok, true);
  assert.equal(result.data.trace.strategy, "hierarchical");
  assert.ok(result.data.packet.evidence.length <= 3);
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `corepack pnpm build && node --test tests/e2e/hierarchical-retrieval.test.mjs`

Expected: FAIL because `strategy: "hierarchical"` is unsupported.

- [ ] **Step 3: Implement the hierarchical strategy as an optional branch**

```ts
if (request.strategy === "hierarchical") {
  return this.hierarchicalRetrievalService.retrieveContext(request, {
    includeTrace: request.includeTrace ?? false
  });
}

return this.flatRetrievalService.retrieveContext(request);
```

- [ ] **Step 4: Re-run the focused test and the full suite**

Run: `corepack pnpm build && node --test tests/e2e/hierarchical-retrieval.test.mjs && corepack pnpm test:e2e`

Expected: PASS with the new strategy available and the flat baseline unchanged.

- [ ] **Step 5: Commit**

```bash
git add packages/application/src/services/hierarchical-retrieval-service.ts packages/application/src/services/retrieve-context-service.ts packages/application/src/services/ranking-fusion-service.ts packages/contracts/src/retrieval/retrieve-context.contract.ts packages/infrastructure/src/transport/request-validation.ts tests/e2e/hierarchical-retrieval.test.mjs package.json
git commit -m "feat: add gated hierarchical retrieval strategy"
```

## Task 7: Add a controlled import pipeline that never writes directly to canonical memory

**Files:**
- Create: `packages/domain/src/imports/import-artifact-state.ts`
- Create: `packages/domain/src/imports/import-job.ts`
- Create: `packages/application/src/ports/import-job-store.ts`
- Create: `packages/application/src/services/import-orchestration-service.ts`
- Create: `packages/infrastructure/src/sqlite/sqlite-import-job-store.ts`
- Create: `packages/contracts/src/maintenance/import-resource.contract.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/infrastructure/src/bootstrap/build-service-container.ts`
- Modify: `apps/brain-cli/src/main.ts`
- Modify: `apps/brain-api/src/server.ts`
- Modify: `apps/brain-mcp/src/tool-definitions.ts`
- Create: `tests/e2e/import-pipeline.test.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write the failing import pipeline test**

```js
test("imports enter the system as imported artifacts and never as canonical notes", async () => {
  const result = await container.services.importOrchestrationService.importResource({
    actor: actor("operator"),
    sourcePath: fixturePath("sample-import.md"),
    importKind: "document"
  });

  assert.equal(result.ok, true);
  assert.equal(result.data.importJob.authorityState, "imported");
  assert.equal(result.data.canonicalOutputs.length, 0);
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `corepack pnpm build && node --test tests/e2e/import-pipeline.test.mjs`

Expected: FAIL because the import domain and service do not exist.

- [ ] **Step 3: Implement import jobs and staged outputs**

```ts
export interface ImportJob {
  importJobId: string;
  authorityState: "imported";
  state: "raw" | "normalized" | "projected" | "drafted" | "failed";
  sourcePath: string;
  normalizedArtifactUri?: string;
  draftNoteIds: string[];
}
```

- [ ] **Step 4: Re-run the focused import test**

Run: `corepack pnpm build && node --test tests/e2e/import-pipeline.test.mjs`

Expected: PASS with imported artifacts visible in namespace state and no direct canonical output.

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/imports packages/application/src/ports/import-job-store.ts packages/application/src/services/import-orchestration-service.ts packages/infrastructure/src/sqlite/sqlite-import-job-store.ts packages/contracts/src/maintenance/import-resource.contract.ts apps/brain-cli/src/main.ts apps/brain-api/src/server.ts apps/brain-mcp/src/tool-definitions.ts tests/e2e/import-pipeline.test.mjs package.json
git commit -m "feat: add controlled import pipeline"
```

## Task 8: Add immutable session archives without extraction drafts

**Files:**
- Create: `packages/domain/src/sessions/session-archive.ts`
- Create: `packages/application/src/ports/session-archive-store.ts`
- Create: `packages/application/src/services/session-archive-service.ts`
- Create: `packages/infrastructure/src/sqlite/sqlite-session-archive-store.ts`
- Create: `packages/contracts/src/history/create-session-archive.contract.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/infrastructure/src/bootstrap/build-service-container.ts`
- Modify: `apps/brain-cli/src/main.ts`
- Modify: `apps/brain-api/src/server.ts`
- Modify: `apps/brain-mcp/src/tool-definitions.ts`
- Create: `tests/e2e/session-archives.test.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write the failing session archive test**

```js
test("session archives are immutable non-authoritative artifacts", async () => {
  const result = await container.services.sessionArchiveService.createArchive({
    actor: actor("operator"),
    sessionId: "session-123",
    messages: [{ role: "user", content: "Summarize writer promotion rules." }]
  });

  assert.equal(result.ok, true);
  assert.equal(result.data.archive.authorityState, "session");
  assert.equal(result.data.archive.promotionStatus, "not_applicable");
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `corepack pnpm build && node --test tests/e2e/session-archives.test.mjs`

Expected: FAIL because no session archive contract or service exists.

- [ ] **Step 3: Implement archive-only session persistence**

```ts
export interface SessionArchive {
  archiveId: string;
  sessionId: string;
  uri: string;
  authorityState: "session";
  promotionStatus: "not_applicable";
  messageCount: number;
  createdAt: string;
}
```

- [ ] **Step 4: Re-run the focused archive test and the full suite**

Run: `corepack pnpm build && node --test tests/e2e/session-archives.test.mjs && corepack pnpm test:e2e`

Expected: PASS with immutable archives stored and discoverable without any extraction draft behavior.

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/sessions packages/application/src/ports/session-archive-store.ts packages/application/src/services/session-archive-service.ts packages/infrastructure/src/sqlite/sqlite-session-archive-store.ts packages/contracts/src/history/create-session-archive.contract.ts apps/brain-cli/src/main.ts apps/brain-api/src/server.ts apps/brain-mcp/src/tool-definitions.ts tests/e2e/session-archives.test.mjs package.json
git commit -m "feat: add immutable session archives"
```

## Task 9: Add rollout gates, packet diff checks, and regression guardrails

**Files:**
- Create: `tests/e2e/retrieval-strategy-diff.test.mjs`
- Modify: `tests/e2e/service-boundaries-and-regression.test.mjs`
- Modify: `documentation/planning/go-live-gates.md`
- Modify: `documentation/planning/current-implementation.md`
- Modify: `documentation/planning/backlog.md`

- [ ] **Step 1: Write the failing strategy-diff test**

```js
test("flat and hierarchical retrieval can be compared side-by-side for the same fixture", async () => {
  const flat = await retrieve({ strategy: "flat", query: "writer promotion policy" });
  const hierarchical = await retrieve({ strategy: "hierarchical", query: "writer promotion policy" });

  assert.equal(flat.ok, true);
  assert.equal(hierarchical.ok, true);
  assert.ok(hierarchical.data.trace);
  assert.ok(Array.isArray(hierarchical.data.trace.events));
});
```

- [ ] **Step 2: Run the focused regression test and verify it fails**

Run: `corepack pnpm build && node --test tests/e2e/retrieval-strategy-diff.test.mjs`

Expected: FAIL because there is no packet diff harness or rollout documentation yet.

- [ ] **Step 3: Add rollout documentation and diff assertions**

```md
- flat retrieval remains the default baseline
- hierarchical retrieval is actor-selectable or transport-selectable
- packet diff tooling is required before default enablement
- rollback is a configuration switch back to `flat`
```

- [ ] **Step 4: Run the full suite and typecheck**

Run: `corepack pnpm build && corepack pnpm test:e2e`

Expected: PASS with strategy diff checks and updated rollout docs.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/retrieval-strategy-diff.test.mjs tests/e2e/service-boundaries-and-regression.test.mjs documentation/planning/go-live-gates.md documentation/planning/current-implementation.md documentation/planning/backlog.md
git commit -m "docs: add read-path rollout gates and retrieval diff checks"
```

## Self-Review

### Spec coverage

- `documentation/planning/read-path-alignment-rfc.md` requires explicit invariants, authority-state schema, namespace semantics, retrieval metrics, rollout criteria, import discipline, and session archive gating.
- Tasks 1 through 3 cover invariants, schema, namespace, and transport exposure.
- Tasks 4 through 6 cover retrieval traces, layered representations, and gated hierarchical retrieval.
- Task 7 covers controlled imports.
- Task 8 covers session archives while explicitly deferring extraction drafts.
- Task 9 covers rollout and rollback criteria plus diff tooling.

### Placeholder scan

- No `TODO` or `TBD` placeholders remain.
- Every task names exact repository targets, focused test commands, and expected outcomes.

### Type consistency

- The plan uses the same authority-state vocabulary throughout: `canonical`, `staging`, `derived`, `imported`, `session`, `extracted`.
- Retrieval strategy naming stays consistent: `flat` and `hierarchical`.
- Session extraction drafts remain intentionally out of scope in every task.

## Execution Handoff

Plan complete and saved to `documentation/superpowers/plans/2026-04-06-read-path-alignment-implementation-plan.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
