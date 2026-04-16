# Obsidian Gatekeeper Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the lowest-risk code foundation for a future Obsidian plugin that lets local AI read personal notes only through explicit Mimir/Mimisbrunnr access policy.

**Architecture:** Add a generic external-source contract and a read-only Obsidian vault source adapter. The adapter lists and reads markdown notes inside a registered vault root, enforces allow/deny globs, blocks `.obsidian` internals by default, rejects path traversal, and returns parsed frontmatter/link metadata without creating Mimisbrunnr memory or editing notes.

**Tech Stack:** TypeScript, Node fs/path APIs, existing `@mimir/contracts` and `@mimir/infrastructure` package exports, Node E2E tests.

---

### Task 1: Contracts For Governed External Sources

**Files:**
- Create: `packages/contracts/src/external-sources/external-source.contract.ts`
- Modify: `packages/contracts/src/index.ts`
- Test: `tests/e2e/external-source-policy.test.mjs`

- [ ] **Step 1: Write failing tests for the intended public shape**

Add a test that imports `ObsidianVaultSource` from infrastructure after build and expects a future Obsidian vault source to list allowed markdown documents, hide `.obsidian/**`, hide denied folders, and expose source metadata without any write method.

- [ ] **Step 2: Verify the test fails**

Run: `corepack pnpm build; if ($LASTEXITCODE -eq 0) { node --test tests/e2e/external-source-policy.test.mjs }`
Expected: FAIL because `ObsidianVaultSource` is not exported.

- [ ] **Step 3: Add contract types**

Create `ExternalSourceRegistration`, `ExternalSourceAccessPolicy`, `ExternalSourceDocumentRef`, and `ExternalSourceDocumentContent`. Keep them transport-neutral and read/proposal oriented. Do not add canonical-memory fields or direct write operations.

- [ ] **Step 4: Export contracts**

Add `export * from "./external-sources/external-source.contract.js";` to `packages/contracts/src/index.ts`.

### Task 2: Read-Only Obsidian Vault Source Adapter

**Files:**
- Create: `packages/infrastructure/src/external-sources/obsidian-vault-source.ts`
- Modify: `packages/infrastructure/src/index.ts`
- Test: `tests/e2e/external-source-policy.test.mjs`

- [ ] **Step 1: Implement path and policy validation**

The adapter must normalize all relative note paths to POSIX separators, reject absolute paths, reject `..` traversal, block `.obsidian/**` by default, and apply explicit `allowedReadGlobs` and `deniedReadGlobs`.

- [ ] **Step 2: Implement markdown listing**

`listDocuments()` should recursively walk the vault root, include only `.md` files that pass policy, and return sorted document refs with `sourceId`, `sourceType`, `path`, `title`, and `contentType: "text/markdown"`.

- [ ] **Step 3: Implement markdown reading**

`readDocument(path)` should read a single allowed markdown file and return content plus metadata: frontmatter key/value strings, wiki links, markdown links, and a content hash.

- [ ] **Step 4: Export infrastructure**

Add `export * from "./external-sources/obsidian-vault-source.js";` to `packages/infrastructure/src/index.ts`.

### Task 3: Documentation And Verification

**Files:**
- Modify: `documentation/reference/repo-map.md`
- Modify: `documentation/architecture/invariants-and-boundaries.md`
- Test: focused and full verification commands

- [ ] **Step 1: Document the boundary**

State that Obsidian/personal notes are external sources. The current adapter is read-only and policy-enforced. Personal notes are not canonical Mimisbrunnr memory unless a later governed import/review flow accepts them.

- [ ] **Step 2: Run focused verification**

Run: `corepack pnpm build; if ($LASTEXITCODE -eq 0) { node --test tests/e2e/external-source-policy.test.mjs }`
Expected: PASS.

- [ ] **Step 3: Run full verification**

Run: `corepack pnpm typecheck; if ($LASTEXITCODE -eq 0) { corepack pnpm test }; if ($LASTEXITCODE -eq 0) { git diff --check }`
Expected: PASS.