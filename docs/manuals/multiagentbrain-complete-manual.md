# MultiagentBrain Complete Operator Manual

This manual is the practical operating guide for the current MultiagentBrain
repository. It explains how to run it, how to store and retrieve information,
how to validate and review notes, how the orchestrator routes work, how Docker
Desktop and Docker Model Runner fit in, and how the Hermes-inspired local-agent
features should be used without weakening the governed memory model.

The manual documents implemented behavior in this repository. When a feature is
only a policy, a local Codex workflow, or a planned direction, that is called
out explicitly.

## Start Here If You Are New

If this is your first time using MultiagentBrain, read the manual in this order:

1. Read this start section.
2. Follow section 5 to install and build the workspace.
3. Follow the "first-time safe tour" in section 5.4.
4. Read section 8 so you understand CLI, HTTP, and MCP entrypoints.
5. Read sections 12 through 16 before storing or promoting information.
6. Read sections 17 through 22 before wiring memory into local agents.
7. Read sections 23 through 27 before using Hermes-inspired local-agent flows
   or qwen3-coder.

Do not start by promoting notes. Promotion is the durable write path. A first
run should begin with version checks, auth-status checks, session archive
creation, session archive search, and maybe a staging draft. Only promote after
you understand validation and review.

### What You Need To Know First

MultiagentBrain has two different ideas that are easy to confuse:

- Remembering a session: store a transcript archive for continuity. This is
  useful, searchable, and non-authoritative.
- Creating memory: create a draft, validate it, review it, then promote it.
  This is how durable canonical memory is created.

The safe first-time rule:

```text
session archive = safe continuity
staging draft = reviewable proposal
canonical memory = promoted durable authority
```

If you are unsure which one to use, create a session archive or staging draft.
Do not write directly to canonical memory.

### Command Prefixes Used In This Manual

The verified workspace invocation is:

```powershell
corepack pnpm cli -- <command>
```

If `pnpm` is already active in your shell, this shorter form is equivalent:

```powershell
pnpm cli -- <command>
```

Examples:

```powershell
corepack pnpm cli -- version
corepack pnpm cli -- auth-status
corepack pnpm cli -- search-context --json '{ "query": "example", "corpusIds": ["context_brain"], "budget": { "maxTokens": 1000, "maxSources": 3, "maxRawExcerpts": 1, "maxSummarySentences": 3 } }'
```

The package exposes `brain-cli` as its bin name after package linking, but a
fresh clone does not provide a tracked global `mab` command. This manual uses
`corepack pnpm cli --` so first-time users can run the examples directly from
the workspace root.

### PowerShell JSON Pattern

Small JSON payloads can be passed directly with `--json`, but larger payloads
are easier to read as a PowerShell here-string:

```powershell
$payload = @'
{
  "query": "How should agents store durable memory?",
  "corpusIds": ["context_brain", "general_notes"],
  "budget": {
    "maxTokens": 4000,
    "maxSources": 6,
    "maxRawExcerpts": 3,
    "maxSummarySentences": 6
  }
}
'@

corepack pnpm cli -- search-context --json $payload
```

For repeatable workflows, put the JSON in a file and use `--input`:

```powershell
corepack pnpm cli -- search-context --input .\request.json
```

### What Creates Memory Or Domain State

Some commands only read domain data. Some commands write memory or operational
records. Know the difference. Even a read-oriented command may initialize the
local SQLite database file and tables when the service container starts; the
table below is about meaningful memory/domain writes, not low-level runtime
initialization.

| Command | Writes memory/domain state? | What it changes |
| --- | --- | --- |
| `version` | No | Prints release metadata |
| `auth-status` | No | Prints auth summary |
| `search-context` | Audit only | Reads memory and may record retrieval history |
| `assemble-agent-context` | Audit only | Reads memory/session recall and may record retrieval history |
| `create-session-archive` | Yes | Writes non-authoritative session archive records |
| `draft-note` | Yes | Writes a staging draft and metadata |
| `validate-note` | No | Validates supplied note content |
| `promote-note` | Yes | Writes canonical memory, metadata, indexes, supersession, and audit |
| `execute-coding-task` | Yes | Writes traces, audit, and possibly tool-output spillovers |
| `show-tool-output` | No | Reads stored spillover output |

If you want a no-risk tour, use `version`, `auth-status`, and then create/search
a session archive. A session archive is not canonical memory.

## 1. Mental Model

MultiagentBrain is a local-first memory and agent support system. Its core job
is to keep durable knowledge governed, searchable, bounded, and reviewable so
local agents can use memory without silently corrupting it.

The system has three major responsibilities:

- Governed memory writes: information enters as staging drafts or
  non-authoritative archives before it can become canonical memory.
- Bounded read paths: agents retrieve packets, decision summaries, namespace
  nodes, session recall, and fenced agent-context blocks instead of receiving
  unbounded raw storage.
- Local-agent execution support: coding tasks can run through the vendored
  Python local-experts runtime with memory context, qwen3-coder metadata,
  traces, retry metadata, and bounded tool-output spillover.

The important authority rule is simple:

Canonical memory is only created through the validation and promotion path.
Session archives, local-agent context packets, retrieval traces, Hermes notes,
and tool outputs are useful context, but they are not durable fact authority.

## 2. Repository Scope

The implemented workspace is a TypeScript monorepo with a vendored Python
runtime:

- `apps/brain-cli`: JSON CLI entrypoint available through the root
  `corepack pnpm cli -- <command>` script; the package bin name is
  `brain-cli` when linked.
- `apps/brain-api`: local HTTP API.
- `apps/brain-mcp`: stdio MCP server.
- `packages/domain`: core domain types such as notes, chunks, context packets,
  session archives, traces, and tool-output spillover records.
- `packages/contracts`: transport request/response contracts and MCP tool
  schemas.
- `packages/application`: use-case services for memory, retrieval, packets,
  history, imports, temporal refresh, session archives, and tool-output budgets.
- `packages/orchestration`: actor authorization, routing, model-role registry,
  brain controller, coding controller, and root orchestrator.
- `packages/infrastructure`: filesystem, SQLite, FTS, Qdrant, model-provider,
  auth registry, runtime health, transport validation, and Python bridge
  adapters.
- `runtimes/local_experts`: vendored Python coding runtime used by the Node
  coding controller bridge.
- `docker`: local Docker API profile and Docker MCP session profile.
- `tests`: transport, e2e, retrieval, session archive, local model, MCP, and
  eval coverage.

The repository intentionally does not currently include:

- GitHub Actions or another tracked CI system.
- Kubernetes, Helm, Terraform, or production deployment descriptors.
- A tracked SQLite migration framework.
- A tracked dotenv loader for Node apps.
- An operator GUI for reviewing staged drafts.

## 3. Source-Backed Architecture

The runtime is assembled by `buildServiceContainer()` in
`packages/infrastructure/src/bootstrap/build-service-container.ts`.

The container wires:

- Filesystem canonical note repository.
- Filesystem staging note repository.
- SQLite metadata, audit, issued token, revocation, session archive, import job,
  namespace, representation, local-agent trace, and tool-output stores.
- SQLite FTS lexical index.
- Qdrant vector index.
- Embedding, reasoning, drafting, and reranker providers.
- Brain-domain application services.
- Python coding bridge.
- Actor authorization policy.
- `MultiAgentOrchestrator`.

Runtime flow:

```text
CLI / HTTP / MCP
        |
        v
transport validation + actor context
        |
        v
ActorAuthorizationPolicy
        |
        v
MultiAgentOrchestrator
        |
        +--> BrainDomainController
        |       +--> retrieval
        |       +--> context packets
        |       +--> staging drafts
        |       +--> validation
        |       +--> promotion
        |       +--> refresh drafts
        |       +--> imports
        |       +--> history
        |       +--> session archives
        |
        +--> CodingDomainController
                +--> Node-to-Python bridge
                +--> local_experts runtime
                +--> local-agent trace store
                +--> tool-output spillover store
```

The transport adapters should stay thin. They parse requests, inject or accept
actor context, validate request shape, call the shared orchestrator, and return
JSON. They should not contain business rules that bypass the application or
orchestration layers.

## 4. Authority And State Lifecycle

MultiagentBrain uses separate state categories:

- Canonical memory: promoted Markdown notes in the canonical vault. This is the
  durable fact authority.
- Staging memory: draft Markdown notes in the staging vault. These are proposals
  for operator review.
- Metadata and audit: SQLite records for notes, chunks, promotions, history,
  imports, auth tokens, revocations, session archives, namespace nodes,
  representations, local-agent traces, and tool outputs.
- Lexical retrieval index: SQLite FTS entries derived from promoted chunks.
- Vector retrieval index: Qdrant embeddings derived from promoted chunks.
- Session archives: immutable non-authoritative conversation archives.
- Tool-output spillovers: large local-agent outputs stored outside prompt
  context, referenced by output ID.

The governed write path is:

```text
draft_note
   |
   v
staging draft file + SQLite metadata
   |
   v
validate_note
   |
   v
operator review
   |
   v
promote_note
   |
   v
canonical note write
   |
   v
chunking + SQLite metadata + FTS + optional Qdrant
   |
   v
audit entry + promotion decision
```

The non-authoritative continuity path is:

```text
create_session_archive
   |
   v
SQLite session archive + searchable messages
   |
   v
search_session_archives or assemble_agent_context
```

Session archives are useful for long-running agent continuity. They do not
create facts, supersede facts, or become canonical memory.

## 5. Installation

Required:

- Node `>=22.0.0`.
- `pnpm@10.7.0`.

Optional:

- Python 3 for `runtimes/local_experts`.
- `fastmcp`, `httpx`, and `pytest` for the Python runtime.
- Qdrant for vector retrieval.
- Docker Desktop and Docker Compose for the tracked local container profile.
- Docker Model Runner or another Ollama-compatible endpoint for model-backed
  embeddings, reasoning, drafting, reranking, and coding.

Install JavaScript dependencies:

```powershell
corepack pnpm install
```

Build everything:

```powershell
corepack pnpm build
```

Run the full JavaScript test suite:

```powershell
corepack pnpm test
```

Run typecheck:

```powershell
corepack pnpm typecheck
```

Run retrieval evals:

```powershell
corepack pnpm run test:eval:retrieval
```

Install suggested Python runtime packages:

```powershell
python -m pip install fastmcp httpx pytest
```

The Node apps do not automatically load `.env`. Set environment variables in
the shell, Docker Compose file, process manager, or MCP client configuration.

### 5.1 Choose A First Setup Path

Choose the setup path based on what you want to learn first:

| Path | Best for | What you need | What works |
| --- | --- | --- | --- |
| Minimal local CLI | First-time learning, docs, auth, session archive tests | Node and pnpm | CLI, SQLite state, deterministic fallbacks |
| Local CLI plus Python | Coding runtime smoke tests | Node, pnpm, Python packages | `execute-coding-task` can invoke the Python bridge |
| Docker Desktop API stack | HTTP API plus Qdrant plus model endpoint wiring | Docker Desktop, Docker Compose, optional Model Runner | API, Qdrant, mounted state volumes, model-backed providers |
| Docker MCP session | Agent/MCP client integration | Docker Desktop, MCP client, auth registry | Containerized stdio MCP server with startup validation |
| Full local model-backed flow | Local agents with qwen3-coder and qwen3 retrieval roles | Docker Model Runner or compatible endpoint | Model-backed embeddings, reasoning, drafting, reranking, coding |

For a first-time user, the recommended order is:

1. Minimal local CLI.
2. Docker Desktop API stack.
3. Docker MCP session.
4. qwen3-coder/local model-backed flows.

This order keeps the early steps understandable. You can verify the system
before debugging containers, model endpoints, MCP client configuration, or
Python runtime issues.

### 5.2 Minimal Local CLI Setup

From the repository root:

```powershell
corepack pnpm install
corepack pnpm build
corepack pnpm cli -- version
corepack pnpm cli -- auth-status
```

Expected behavior:

- `corepack pnpm install` installs workspace dependencies.
- `corepack pnpm build` compiles TypeScript into each package/app `dist` directory.
- `corepack pnpm cli -- version` prints JSON with `ok: true` and release metadata.
- `corepack pnpm cli -- auth-status` prints the effective auth mode and actor registry
  summary.

You may see a Node warning that SQLite is experimental. That warning comes from
Node's built-in SQLite support. It is not a MultiagentBrain failure by itself.

Default local storage locations:

| Storage | Default |
| --- | --- |
| Canonical vault on Windows | `F:\Dev\AI Context Brain` |
| Canonical vault on non-Windows | `./vault/canonical` |
| Staging vault | `./vault/staging` |
| SQLite state | `./state/multi-agent-brain.sqlite` |
| Qdrant URL | `http://127.0.0.1:6333` |
| API host/port | `127.0.0.1:8080` |

If you do not want the Windows default canonical vault, set `MAB_VAULT_ROOT`
before running commands:

```powershell
$env:MAB_VAULT_ROOT = "F:\Dev\my-test-brain\canonical"
$env:MAB_STAGING_ROOT = "F:\Dev\my-test-brain\staging"
$env:MAB_SQLITE_PATH = "F:\Dev\my-test-brain\state\multi-agent-brain.sqlite"
corepack pnpm cli -- version
```

Use a test vault while learning if you do not want to touch your real memory
vault.

### 5.3 Minimal HTTP API Setup

Build first, then start the API:

```powershell
corepack pnpm build
corepack pnpm api
```

In another terminal:

```powershell
Invoke-RestMethod -Method Get -Uri http://127.0.0.1:8080/v1/system/version
Invoke-RestMethod -Method Get -Uri http://127.0.0.1:8080/health/live
Invoke-RestMethod -Method Get -Uri http://127.0.0.1:8080/health/ready
```

Expected behavior:

- Version returns release metadata.
- Live health verifies that the server process is responsive.
- Ready health verifies operational readiness. It can fail if configured
  dependencies are unreachable.

When sending JSON to the API from PowerShell:

```powershell
$payload = @{
  query = "paid models out of scope"
  limit = 5
  maxTokens = 2000
} | ConvertTo-Json -Depth 10

Invoke-RestMethod `
  -Method Post `
  -Uri http://127.0.0.1:8080/v1/history/session-archives/search `
  -ContentType "application/json" `
  -Body $payload
```

### 5.4 First-Time Safe Tour

This tour creates only a non-authoritative session archive and then searches it.
It does not promote canonical memory.

Step 1: verify the CLI works.

```powershell
corepack pnpm cli -- version
corepack pnpm cli -- auth-status
```

Step 2: create a session archive.

```powershell
$archive = @'
{
  "sessionId": "first-time-tour",
  "messages": [
    {
      "role": "user",
      "content": "I am learning MultiagentBrain for the first time."
    },
    {
      "role": "assistant",
      "content": "This archive is non-authoritative continuity and should not be treated as canonical memory."
    }
  ]
}
'@

corepack pnpm cli -- create-session-archive --json $archive
```

Step 3: search the session archive.

```powershell
$search = @'
{
  "query": "first time learning non-authoritative continuity",
  "sessionId": "first-time-tour",
  "limit": 5,
  "maxTokens": 2000
}
'@

corepack pnpm cli -- search-session-archives --json $search
```

Step 4: assemble agent context from canonical memory plus session recall.

```powershell
$context = @'
{
  "query": "What does this first-time session say about authority?",
  "corpusIds": ["context_brain", "general_notes"],
  "budget": {
    "maxTokens": 3000,
    "maxSources": 4,
    "maxRawExcerpts": 2,
    "maxSummarySentences": 4
  },
  "includeSessionArchives": true,
  "sessionId": "first-time-tour",
  "includeTrace": true
}
'@

corepack pnpm cli -- assemble-agent-context --json $context
```

Expected result:

- The session archive search should return hits from the archived messages.
- The assembled agent context should label session recall as
  `non_authoritative`.
- If there are no canonical notes yet, canonical retrieval may have no evidence
  or degraded health. That is normal in a new empty vault.

### 5.5 First Staging Draft

After the safe tour, create a staging draft. This writes a proposal, not
canonical memory.

```powershell
$draft = @'
{
  "targetCorpus": "context_brain",
  "noteType": "decision",
  "title": "Session archives are non-authoritative",
  "sourcePrompt": "Record the rule that session archives provide continuity but do not become fact authority.",
  "supportingSources": [
    {
      "notePath": "manual:first-time-tour",
      "headingPath": []
    }
  ],
  "bodyHints": [
    "Context: First-time operator workflow.",
    "Decision: Use session archives for continuity and promotion for durable facts.",
    "Rationale: Avoid silently converting conversation text into canonical memory.",
    "Consequences: Agents can search sessions, but durable facts still require review."
  ]
}
'@

corepack pnpm cli -- draft-note --json $draft
```

Expected result:

- Output includes `draftNoteId`.
- Output includes `draftPath`.
- Output includes generated frontmatter and body.
- The draft is stored under the staging root.
- The draft is not canonical memory.

Do not promote it yet. Read section 13, section 14, and section 15 first.

## 6. Docker Desktop And Docker Model Runner

Docker Desktop is the easiest way to run the local container profile on a
developer workstation. The repository uses ordinary Docker Compose assets, plus
Docker Model Runner's Ollama-compatible endpoint when you want local model
providers.

Official Docker references:

- Docker Desktop: https://docs.docker.com/get-started/introduction/get-docker-desktop/
- Docker Compose: https://docs.docker.com/get-started/docker-concepts/the-basics/what-is-docker-compose/
- Docker Model Runner CLI: https://docs.docker.com/reference/cli/docker/model/
- Docker MCP Toolkit: https://docs.docker.com/ai/mcp-catalog-and-toolkit/toolkit/

The tracked local API stack is `docker/compose.local.yml`.

It runs:

- `brain-api`.
- `qdrant`.
- Named Docker volumes for canonical vault, staging vault, SQLite state, and
  Qdrant storage.
- HTTP API on port `8080`.
- Qdrant on port `6333`.
- Model-backed providers pointing at
  `http://model-runner.docker.internal:12434`.

Start it:

```powershell
docker compose -f docker/compose.local.yml up --build
```

Stop it:

```powershell
docker compose -f docker/compose.local.yml down
```

The local compose profile is more model-backed than generic in-process defaults:

- Generic defaults use hash embeddings and heuristic reasoning unless
  overridden.
- Compose configures Ollama-compatible providers for embedding, reasoning,
  drafting, reranking, and coding.

Typical local model roles:

- `embedding_primary`: `docker.io/ai/qwen3-embedding:0.6B-F16`.
- `brain_primary`: qwen3 reasoning/drafting model.
- `reranker_primary`: qwen3 reranker model.
- `coding_primary`: qwen3-coder.
- `paid_escalation`: disabled unless explicitly configured.

Paid-model escalation is out of scope for the current local-agent direction.
Do not enable `paid_escalation` unless you intentionally want external paid
reasoning.

Useful Docker Model Runner commands:

```powershell
docker model list
docker model run <model-name>
```

Model Runner must expose an Ollama-compatible endpoint reachable from the
runtime. In Docker Desktop based compose profiles, the expected hostname is
usually `model-runner.docker.internal` and the expected port is `12434`.

### 6.1 Docker Desktop First-Run Checklist

Before starting the compose profile, verify Docker works:

```powershell
docker version
docker compose version
```

If Docker Desktop is not running, these commands fail or hang. Start Docker
Desktop first and wait until it reports that the engine is running.

Then build and start the local stack:

```powershell
corepack pnpm run docker:up
```

In another terminal, verify the API:

```powershell
Invoke-RestMethod -Method Get -Uri http://127.0.0.1:8080/v1/system/version
Invoke-RestMethod -Method Get -Uri http://127.0.0.1:8080/health/ready
```

Verify Qdrant is reachable from the host:

```powershell
Invoke-RestMethod -Method Get -Uri http://127.0.0.1:6333
```

Stop the stack and remove named volumes:

```powershell
corepack pnpm run docker:down
```

The repository script removes volumes. That is useful for a clean reset, but it
also deletes the compose-managed local vault/state volumes. Do not run
`docker:down` with `--volumes` semantics if the compose volumes contain data you
intend to keep.

### 6.2 Docker Model Runner First-Run Checklist

Check that Docker Model Runner is available:

```powershell
docker model list
```

If the command is unavailable, update Docker Desktop or enable/install the Model
Runner feature according to Docker's current documentation.

Then check whether your intended models are present:

```powershell
docker model list
```

The compose profile expects an Ollama-compatible endpoint reachable at:

```text
http://model-runner.docker.internal:12434
```

From the host, the corresponding endpoint is usually:

```text
http://127.0.0.1:12434
```

If model-backed calls fail:

1. Confirm Docker Desktop is running.
2. Confirm Model Runner is enabled.
3. Confirm the model exists in `docker model list`.
4. Confirm the endpoint is reachable.
5. Confirm the `MAB_PROVIDER_DOCKER_OLLAMA_BASE_URL` value matches where the
   runtime is executing: host processes usually use `127.0.0.1`, containers
   usually use `model-runner.docker.internal`.
6. Decide whether provider fallbacks should be enabled while learning.

### 6.3 Docker Troubleshooting For First-Time Users

| Symptom | Likely cause | First check |
| --- | --- | --- |
| `docker` command not found | Docker Desktop not installed or not on PATH | Reopen terminal after install |
| Compose build fails at `pnpm install` | Dependency or lockfile issue | Run `pnpm install` on host and inspect error |
| API starts but ready health fails | Qdrant/model endpoint/auth readiness issue | Call `/health/ready` and inspect JSON |
| Retrieval warns vector degraded | Qdrant or embedding path unavailable | Check Qdrant container and embedding provider |
| Coding task fails in container | Python runtime or model endpoint issue | Run Docker MCP validate-only or inspect logs |
| Model calls fail from container | Wrong endpoint hostname | Use `model-runner.docker.internal` inside containers |

Container logs:

```powershell
docker compose -f docker/compose.local.yml logs brain-api
docker compose -f docker/compose.local.yml logs qdrant
```

## 7. Docker MCP Session Container

The Docker MCP session profile is documented in
`docs/operations/docker-mcp-session.md` and configured through:

- `docker/brain-mcp.Dockerfile`.
- `docker/brain-mcp-session-entrypoint.mjs`.
- `docker/brain-mcp-session.env.example`.
- `docker/brain-mcp-session.actor-registry.example.json`.
- `docker/compose.mcp-session.yml`.

This profile is for running the stdio MCP server in a container with startup
checks for:

- Auth configuration.
- Canonical vault mount.
- Staging vault mount.
- SQLite state mount.
- Qdrant reachability.
- Model endpoint reachability.
- Python runtime importability.

The session profile normally uses enforced auth, fixed MCP actor environment
variables, and mounted auth registry files.

Important MCP session variables:

- `MAB_AUTH_MODE=enforced`.
- `MAB_AUTH_ACTOR_REGISTRY_PATH`.
- `MAB_AUTH_ISSUER_SECRET`.
- `MAB_AUTH_REVOKED_ISSUED_TOKEN_IDS_PATH`.
- `MAB_MCP_DEFAULT_ACTOR_ID`.
- `MAB_MCP_DEFAULT_ACTOR_ROLE`.
- `MAB_MCP_DEFAULT_ACTOR_AUTH_TOKEN`.
- `MAB_MCP_DEFAULT_SOURCE`.

The fixed MCP actor is useful because MCP clients do not need to pass actor
metadata on every tool call. The server injects the configured actor and token.

Use the validation-only mode before wiring it to a client:

```powershell
docker compose -f docker/compose.mcp-session.yml run --rm brain-mcp-session --validate-only
```

Then configure your MCP client to launch the containerized command shown in
`docs/operations/docker-mcp-session.md`.

### 7.1 First-Time Docker MCP Session Steps

Use this path after you already know the CLI works.

1. Build the image.

```powershell
corepack pnpm run docker:mcp:build
```

2. Copy the example environment file.

```powershell
Copy-Item docker\brain-mcp-session.env.example docker\brain-mcp-session.env
```

3. Prepare host directories for mounted state.

Example test layout:

```text
F:/Dev/mab-session-test/vault/canonical
F:/Dev/mab-session-test/vault/staging
F:/Dev/mab-session-test/state
F:/Dev/mab-session-test/config/auth
```

4. Copy the example actor registry into the auth config directory and replace
   the example token with your own session token.

5. Edit `docker/brain-mcp-session.env` so it points at those host paths and the
   same actor ID/token as the registry.

6. Validate without starting an MCP session.

```powershell
docker compose -f docker/compose.mcp-session.yml run --rm brain-mcp-session --validate-only
```

7. Only after validation passes, configure your MCP client to run the Docker
   command from `docs/operations/docker-mcp-session.md`.

Expected validation success means:

- Environment variables are explicit.
- Canonical, staging, state, and auth mounts are visible.
- The session actor in env matches the registry.
- Qdrant is reachable.
- The configured model endpoint is reachable.
- The Python coding runtime can start.

If validation fails, fix the failing dependency first. Do not bypass validation
by launching the raw MCP server with missing mounts or permissive auth.

### 7.2 What The MCP Session Is Not

The Docker MCP session profile is not a long-running daemon. It is a
session-scoped tool server launched by an MCP client.

It should not:

- Auto-start for every workspace.
- Keep hidden background memory writers alive.
- Store canonical authority inside an ephemeral container.
- Run with anonymous or ambiguous actor identity.
- Silently downgrade strict model/Qdrant failures in the session profile.

Use the HTTP Docker stack when you want a long-running local service. Use the
MCP session container when an agent client needs an explicitly launched,
validated, bounded tool session.

## 8. Entrypoints

The three user-facing entrypoints share the same service container:

- CLI: `apps/brain-cli/src/main.ts`.
- HTTP: `apps/brain-api/src/server.ts`.
- MCP: `apps/brain-mcp/src/main.ts` and
  `apps/brain-mcp/src/tool-definitions.ts`.

The entrypoint choice depends on the job:

| Need | Preferred entrypoint |
| --- | --- |
| Human local operation | CLI |
| Local service integration | HTTP |
| Agent integration | MCP |
| Docker Desktop API stack | HTTP |
| Docker MCP client session | MCP |
| Scripted repeatable maintenance | CLI or HTTP |

All command payloads are JSON objects. Actor context can be supplied in the
payload, but each transport also has safe defaults.

### CLI Payload Sources

The CLI accepts exactly one payload source for most commands:

```powershell
corepack pnpm cli -- <command> --json '{ "field": "value" }'
corepack pnpm cli -- <command> --input request.json
corepack pnpm cli -- <command> --stdin
```

Output is always JSON.

### HTTP Actor Headers

HTTP accepts actor context through request body or headers:

- `x-brain-actor-id`.
- `x-brain-actor-role`.
- `x-brain-source`.
- `x-request-id`.
- `x-brain-tool-name`.
- `x-brain-actor-token`.

### MCP Protocol

The MCP server supports:

- `initialize`.
- `tools/list`.
- `tools/call`.

It speaks stdio JSON-RPC with `Content-Length` framing.

### 8.1 Reading JSON Responses

Most service responses follow one of these shapes:

Successful service result:

```json
{
  "ok": true,
  "data": {
    "resultField": "value"
  },
  "warnings": ["optional warning"]
}
```

Failed service result:

```json
{
  "ok": false,
  "error": {
    "code": "validation_failed",
    "message": "Human-readable reason.",
    "details": {
      "field": "optional details"
    }
  }
}
```

Some commands use a domain-specific response:

- `validate-note` returns `valid`, `violations`, and `blockedFromPromotion`.
- `execute-coding-task` returns `status`, `reason`, `attempts`,
  `validations`, `localResult`, and `escalationMetadata`.
- `show-tool-output` returns `found: true` with output, or `found: false`.

As a first-time user, check these fields first:

- `ok`.
- `error.code`.
- `error.message`.
- `warnings`.
- `data`.
- `retrievalHealth.status`.
- `memoryContextStatus`.
- `escalationMetadata`.

### 8.2 CLI Basics

Use the root wrapper while developing:

```powershell
corepack pnpm cli -- <command> [options]
```

Common CLI examples:

```powershell
corepack pnpm cli -- version
corepack pnpm cli -- auth-status
corepack pnpm cli -- freshness-status
corepack pnpm cli -- search-session-archives --json '{ "query": "example" }'
```

Use `--pretty` for readable JSON. It is on by default. Use `--no-pretty` for
machine-readable compact output:

```powershell
corepack pnpm cli -- version --no-pretty
```

If a command fails, the CLI exits with a non-zero exit code and prints a JSON
error. This makes it safe to use in scripts.

### 8.3 HTTP Basics

Start the API:

```powershell
corepack pnpm api
```

Then call it from another shell:

```powershell
Invoke-RestMethod -Method Get -Uri http://127.0.0.1:8080/v1/system/version
```

POST requests need a JSON object body:

```powershell
$body = @{
  query = "first-time session"
  limit = 5
  maxTokens = 2000
} | ConvertTo-Json -Depth 10

Invoke-RestMethod `
  -Method Post `
  -Uri http://127.0.0.1:8080/v1/history/session-archives/search `
  -ContentType "application/json" `
  -Body $body
```

In permissive local development, you can omit actor headers and the HTTP adapter
injects defaults. In enforced mode, provide actor headers and a token:

```powershell
Invoke-RestMethod `
  -Method Get `
  -Uri http://127.0.0.1:8080/v1/system/auth `
  -Headers @{
    "x-brain-actor-id" = "operator-local"
    "x-brain-actor-role" = "operator"
    "x-brain-source" = "manual"
    "x-brain-actor-token" = "<token>"
  }
```

### 8.4 MCP Basics

Use MCP when an agent client should call MultiagentBrain tools directly.

Local MCP server command after build:

```powershell
corepack pnpm mcp
```

MCP clients normally launch the server process and call `tools/list` to discover
available tools. If you are using the Docker MCP session container, prefer the
containerized setup from section 7 because it validates mounts, auth, model
endpoint, Qdrant, and Python startup before serving tools.

MCP tool names use snake case:

- CLI: `search-context`.
- MCP: `search_context`.

The tool input shape is the same logical request shape used by CLI and HTTP.
The MCP server wraps the result in MCP `content` and `structuredContent`.

### 8.5 Choosing The Right Surface

Use CLI when:

- You are learning.
- You are debugging locally.
- You want copyable, repeatable commands.
- You are creating or validating notes manually.

Use HTTP when:

- Another local process needs a stable service endpoint.
- You want Docker Desktop API hosting.
- You need health endpoints.

Use MCP when:

- A local agent should retrieve memory or create drafts.
- You want agent tool discovery.
- You are integrating through an MCP-capable client.

Do not use MCP just because it is available. For first-time operation, CLI is
easier to inspect and debug.

## 9. Feature Matrix

| Feature | CLI | HTTP | MCP |
| --- | --- | --- | --- |
| Version | `version` | `GET /v1/system/version` | no direct tool |
| Live health | no direct command | `GET /health/live` | startup process only |
| Ready health | no direct command | `GET /health/ready` | startup process only |
| Auth summary | `auth-status` | `GET /v1/system/auth` | no direct tool |
| Issued token list | `auth-issued-tokens` | `GET /v1/system/auth/issued-tokens` | no direct tool |
| Issue auth token | `issue-auth-token` | `POST /v1/system/auth/issue-token` | no direct tool |
| Inspect auth token | `auth-introspect-token` | `POST /v1/system/auth/introspect-token` | no direct tool |
| Revoke auth token | `revoke-auth-token` | `POST /v1/system/auth/revoke-token` | no direct tool |
| Freshness report | `freshness-status` | `GET /v1/system/freshness` | no direct tool |
| Search canonical context | `search-context` | `POST /v1/context/search` | `search_context` |
| Search session archives | `search-session-archives` | `POST /v1/history/session-archives/search` | `search_session_archives` |
| Assemble agent context | `assemble-agent-context` | `POST /v1/context/agent-context` | `assemble_agent_context` |
| List namespace tree | `list-context-tree` | `POST /v1/context/tree` | `list_context_tree` |
| Read namespace node | `read-context-node` | `POST /v1/context/node` | `read_context_node` |
| Direct context packet | `get-context-packet` | `POST /v1/context/packet` | `get_context_packet` |
| Decision summary | `fetch-decision-summary` | `POST /v1/context/decision-summary` | `fetch_decision_summary` |
| Draft note | `draft-note` | `POST /v1/notes/drafts` | `draft_note` |
| Validate note | `validate-note` | `POST /v1/notes/validate` | `validate_note` |
| Promote note | `promote-note` | `POST /v1/notes/promote` | `promote_note` |
| Create refresh draft | `create-refresh-draft` | `POST /v1/system/freshness/refresh-draft` | `create_refresh_draft` |
| Create refresh drafts | `create-refresh-drafts` | `POST /v1/system/freshness/refresh-drafts` | `create_refresh_drafts` |
| Import resource record | `import-resource` | `POST /v1/maintenance/import-resource` | `import_resource` |
| Query audit history | `query-history` | `POST /v1/history/query` | `query_history` |
| Create session archive | `create-session-archive` | `POST /v1/history/session-archives` | `create_session_archive` |
| Execute coding task | `execute-coding-task` | `POST /v1/coding/execute` | `execute_coding_task` |
| List local-agent traces | `list-agent-traces` | `POST /v1/coding/traces` | `list_agent_traces` |
| Show spilled tool output | `show-tool-output` | `POST /v1/coding/tool-output` | `show_tool_output` |

### 9.1 Code-Checked Minimal Payloads

The payloads in this section mirror the current transport validator in
`packages/infrastructure/src/transport/request-validation.ts`. They are useful
when you want a small request that is syntactically valid even if the runtime
later returns `not_found`, `validation_failed`, or a dependency error because
your local vault does not contain matching state yet.

Search context:

```powershell
corepack pnpm cli -- search-context --json '{
  "query": "memory governance",
  "corpusIds": ["context_brain"],
  "budget": {
    "maxTokens": 2000,
    "maxSources": 4,
    "maxRawExcerpts": 2,
    "maxSummarySentences": 4
  },
  "strategy": "flat",
  "intentHint": "decision_lookup",
  "requireEvidence": true,
  "includeTrace": true
}'
```

Create a session archive:

```powershell
corepack pnpm cli -- create-session-archive --json '{
  "sessionId": "example-session",
  "messages": [
    {
      "role": "user",
      "content": "Session archives are continuity, not canonical memory."
    }
  ]
}'
```

Create a staging draft:

```powershell
corepack pnpm cli -- draft-note --json '{
  "targetCorpus": "context_brain",
  "noteType": "decision",
  "title": "Agents use drafts before memory promotion",
  "sourcePrompt": "Document the write discipline for local agents.",
  "supportingSources": [
    {
      "notePath": "docs/manuals/multiagentbrain-complete-manual.md",
      "headingPath": ["12. Storing Information"]
    }
  ],
  "bodyHints": [
    "Context: Agents may discover durable knowledge during work.",
    "Decision: They should create staging drafts, not canonical writes.",
    "Rationale: Review prevents hidden or low-quality memory writes.",
    "Consequences: Operators validate and promote only useful durable notes."
  ]
}'
```

Validate a note body:

```powershell
corepack pnpm cli -- validate-note --json '{
  "targetCorpus": "context_brain",
  "notePath": "context_brain/agents-use-drafts-before-memory-promotion.md",
  "frontmatter": {
    "noteId": "example-note-id",
    "title": "Agents use drafts before memory promotion",
    "project": "multi-agent-brain",
    "type": "decision",
    "status": "promoted",
    "updated": "2026-04-13",
    "summary": "Agents should create staging drafts for durable knowledge and leave canonical writes to reviewed promotion.",
    "tags": ["project/multi-agent-brain", "domain/agent", "status/current"],
    "scope": "agent memory writes",
    "corpusId": "context_brain",
    "currentState": true,
    "supersedes": []
  },
  "body": "## Context\n\nAgents may discover durable knowledge during local work.\n\n## Decision\n\nAgents create staging drafts before memory promotion.\n\n## Rationale\n\nReview prevents hidden or low-quality memory writes.\n\n## Consequences\n\nOperators validate and promote only useful durable notes.",
  "validationMode": "promotion"
}'
```

Promote a reviewed draft:

```powershell
corepack pnpm cli -- promote-note --json '{
  "draftNoteId": "draft-note-id",
  "targetCorpus": "context_brain",
  "expectedDraftRevision": "draft-revision",
  "promoteAsCurrentState": true
}'
```

List namespace nodes:

```powershell
corepack pnpm cli -- list-context-tree --json '{
  "ownerScope": "context_brain",
  "authorityStates": ["canonical", "staging"]
}'
```

Run a coding task with memory context:

```powershell
corepack pnpm cli -- execute-coding-task --json '{
  "taskType": "review",
  "task": "Review the current change for direct canonical memory writes.",
  "repoRoot": "F:/Dev/scripts/MultiagentBrain",
  "memoryContext": {
    "query": "agents should create staging drafts before promotion",
    "corpusIds": ["context_brain", "general_notes"],
    "budget": {
      "maxTokens": 4000,
      "maxSources": 5,
      "maxRawExcerpts": 2,
      "maxSummarySentences": 5
    },
    "includeSessionArchives": false,
    "includeTrace": true
  }
}'
```

## 10. Orchestrator

`MultiAgentOrchestrator` is the central runtime boundary.

It does four things:

- Authorizes the actor against the command.
- Verifies the command routes to the expected domain.
- Delegates brain commands to `BrainDomainController`.
- Delegates coding commands to `CodingDomainController`.

The task-family router separates the brain domain from the coding domain.

Brain commands:

- `search_context`.
- `search_session_archives`.
- `assemble_agent_context`.
- `get_context_packet`.
- `fetch_decision_summary`.
- `draft_note`.
- `create_session_archive`.
- `create_refresh_draft`.
- `create_refresh_drafts`.
- `import_resource`.
- `validate_note`.
- `promote_note`.
- `query_history`.

Coding commands:

- `execute_coding_task`.
- `list_agent_traces`.
- `show_tool_output`.

The orchestrator also injects memory context into coding requests when
`memoryContext` is provided. It does this by calling `assembleAgentContext`,
then appending the fenced context block to the coding task's `context` field.
If memory context assembly fails, the coding request still runs, but the context
contains a fenced unavailable-context note and `memoryContextStatus` reports the
failure.

## 11. Actor Roles And Authorization

Actor roles:

- `retrieval`.
- `writer`.
- `orchestrator`.
- `system`.
- `operator`.

Authorization modes:

- `permissive`: useful for local development. Unregistered non-internal actors
  may proceed after role checks.
- `enforced`: production-like mode. Non-internal actors must be registered or
  use a valid issued token.

Command role policy:

| Command group | Allowed roles |
| --- | --- |
| Retrieval and context reads | `retrieval`, `operator`, `orchestrator`, `system` |
| Draft creation | `writer`, `operator`, `orchestrator`, `system` |
| Validation, promotion, refresh, history, import | `operator`, `orchestrator`, `system` |
| Coding execution | `operator`, `system` |
| Trace listing | `operator`, `orchestrator`, `system` |
| Tool output reading | `operator`, `system` |

Auth registry entries can restrict:

- Actor ID.
- Actor role.
- Static auth tokens.
- Multiple token credentials.
- Source.
- Enabled/disabled state.
- Allowed transports.
- Allowed commands.
- Allowed administrative actions.
- Validity window.

Issued tokens can restrict:

- Actor ID.
- Actor role.
- Source.
- Allowed transports.
- Allowed commands.
- Allowed admin actions.
- Validity window.
- TTL.

Issued tokens can also carry `allowedCorpora` in the claim payload, but the
current authorization path does not enforce corpus restrictions. Treat
`allowedCorpora` as metadata until enforcement is added in code.

Use issued tokens for short-lived operational access. Revoke them through the
revocation store when no longer needed.

## 12. Storing Information

There are three ways to store information, each with a different authority
level.

Choose the storage path with this rule:

| You have | Use | Why |
| --- | --- | --- |
| A conversation transcript or temporary continuity | `create-session-archive` | Searchable later, but cannot accidentally become authority |
| A candidate fact, decision, runbook, or architecture note | `draft-note` | Creates a reviewable proposal in staging |
| A validated and reviewed draft | `promote-note` | Creates or updates canonical memory |
| A readable external file/source document to process later | `import-resource` | Records source digest and preview without writing memory |
| A huge tool output | Tool-output spillover | Keeps prompts bounded and stores full output separately |

Do not skip from conversation text to canonical memory. The correct path is:

```text
conversation or tool output
   |
   v
operator decides it is durable
   |
   v
draft-note
   |
   v
validate-note + review
   |
   v
promote-note
```

### 12.1 Staging Drafts

Use staging drafts for candidate durable memory.

CLI example:

```powershell
corepack pnpm cli -- draft-note --json '{
  "targetCorpus": "context_brain",
  "noteType": "decision",
  "title": "Use governed memory promotion for agent notes",
  "sourcePrompt": "Agents must not write canonical memory directly.",
  "supportingSources": [
    {
      "notePath": "docs/manuals/multiagentbrain-complete-manual.md",
      "headingPath": ["Start Here If You Are New"]
    }
  ],
  "bodyHints": [
    "Record the authority boundary.",
    "Explain that operator review is required before promotion."
  ]
}'
```

The draft service:

- Checks actor role.
- Enforces corpus boundary rules.
- Builds frontmatter.
- Optionally asks the configured drafting provider to create a structured body.
- Falls back to deterministic required sections if the drafting provider is not
  available or fails.
- Runs deterministic draft validation.
- Writes to staging.
- Upserts metadata into SQLite.

Drafts are proposals. They are not canonical memory.

Draft request fields explained:

| Field | Required | Meaning |
| --- | --- | --- |
| `targetCorpus` | Yes | `context_brain` for governed project memory, `general_notes` for non-current general notes |
| `noteType` | Yes | One of the note schema types such as `decision`, `runbook`, `architecture`, `investigation`, or `policy` |
| `title` | Yes | Human-readable note title |
| `sourcePrompt` | Yes | Why this draft exists |
| `supportingSources` | Yes | Evidence/source references; each item requires `notePath` and `headingPath`, with optional `noteId`, `chunkId`, and `excerpt` |
| `frontmatterOverrides` | No | Explicit frontmatter values when the defaults are not enough |
| `bodyHints` | No | Bullets that help the deterministic or model-backed drafter fill sections |

For first-time use, provide `bodyHints` that match the required sections for
the `noteType`. For a `decision`, include hints for Context, Decision,
Rationale, and Consequences. This reduces validation failures and makes review
easier.

After creating a draft, write down these output fields:

- `draftNoteId`: needed for promotion.
- `draftPath`: where the staging file was written.
- `frontmatter`: what validation will check.
- `body`: what the operator should read and review.
- `warnings`: provider fallback or validation warnings.

### 12.2 Session Archives

Use session archives for continuity across long conversations.

CLI example:

```powershell
corepack pnpm cli -- create-session-archive --json '{
  "sessionId": "operator-session-2026-04-13",
  "messages": [
    { "role": "user", "content": "We decided to keep paid models out of scope." },
    { "role": "assistant", "content": "Recorded as session continuity, not canonical memory." }
  ]
}'
```

Session archives:

- Require a non-empty `sessionId`.
- Require at least one message.
- Accept `system`, `user`, `assistant`, and `tool` roles.
- Are immutable after creation.
- Are searchable through session archive search.
- Are non-authoritative.

Use session archives for continuity, not truth.

Session archive request fields:

| Field | Required | Meaning |
| --- | --- | --- |
| `sessionId` | Yes | Stable name for the conversation/session |
| `messages` | Yes | Non-empty list of transcript messages |
| `messages[].role` | Yes | `system`, `user`, `assistant`, or `tool` |
| `messages[].content` | Yes | Non-empty message text |

Good session archive names are specific:

- `codex-hermes-gap-bridge-2026-04-13`.
- `operator-docker-mcp-setup-first-run`.
- `memory-review-session-qwen3-coder`.

Poor session archive names are vague:

- `test`.
- `notes`.
- `chat`.

The session ID is searchable and filterable, so use names you can recognize
later.

### 12.3 Import Job Records

Use import-resource to record a readable source file that should be processed
later. The service reads the file, stores its digest, size, and preview, and
records an import job. It does not import directories directly.

```powershell
corepack pnpm cli -- import-resource --json '{
  "sourcePath": "docs/planning/hermes-vs-multi-agent-brain-gap-analysis.md",
  "importKind": "reference_repo"
}'
```

Import jobs do not write canonical memory. They are controlled maintenance
records over source files.

Use import jobs when you want to remember that a resource must be processed, but
you do not yet know what durable knowledge should be extracted from it. For an
external repository such as Hermes, import a specific source file or analysis
document, perform the review, then create specific staging drafts for the
lessons that survive review.

## 13. Validating Notes

Validation is deterministic and does not mutate state.

CLI example:

```powershell
corepack pnpm cli -- validate-note --input candidate-note.json
```

The request must include:

- `targetCorpus`.
- `notePath`.
- `frontmatter`.
- `body`.
- `validationMode`: `draft` or `promotion`.

Validation checks:

- Required frontmatter strings.
- Date format.
- Controlled tags.
- Path containment under the target corpus.
- `.md` extension.
- Required body sections by note type.
- Corpus policy, including general-notes restrictions.
- Temporal validity windows.
- Supersession consistency.
- Lifecycle mode.

Required sections by note type:

| Note type | Required sections |
| --- | --- |
| `decision` | Context, Decision, Rationale, Consequences |
| `constraint` | Constraint, Scope, Rationale, Implications |
| `bug` | Summary, Symptoms, Reproduction, Impact, Status |
| `investigation` | Question, Findings, Evidence, Next Steps |
| `runbook` | Purpose, Preconditions, Procedure, Verification |
| `architecture` | Context, Components, Data Flow, Constraints |
| `glossary` | Term, Definition, Related Terms |
| `handoff` | Context, Current State, Open Questions, Next Steps |
| `reference` | Summary, Details, Sources |
| `policy` | Policy, Scope, Rules, Exceptions |

If validation returns `blockedFromPromotion: true`, do not promote the note.
Fix the draft or reject it.

### 13.1 Concrete Validation Example

Validation accepts note content as JSON. It does not automatically load a file
from `notePath`; the caller supplies frontmatter and body.

```powershell
$candidate = @'
{
  "targetCorpus": "context_brain",
  "notePath": "context_brain/session-archives-are-non-authoritative.md",
  "frontmatter": {
    "noteId": "example-note-id",
    "title": "Session archives are non-authoritative",
    "project": "multi-agent-brain",
    "type": "decision",
    "status": "promoted",
    "updated": "2026-04-13",
    "summary": "Session archives provide continuity but do not create canonical fact authority.",
    "tags": ["project/multi-agent-brain", "domain/retrieval", "status/current"],
    "scope": "memory governance",
    "corpusId": "context_brain",
    "currentState": true,
    "supersedes": []
  },
  "body": "## Context\n\nAgents need continuity across sessions.\n\n## Decision\n\nUse session archives for continuity and promotion for durable memory.\n\n## Rationale\n\nConversation text can be incomplete or wrong, so it must not become authority automatically.\n\n## Consequences\n\nAgents may search session recall, but durable memory still requires review and promotion.",
  "validationMode": "promotion"
}
'@

corepack pnpm cli -- validate-note --json $candidate
```

Read the response like this:

- `valid: true`: deterministic checks passed.
- `valid: false`: do not promote.
- `violations`: fix every error before promotion.
- `blockedFromPromotion: true`: promotion should be blocked even if there are
  warnings you are tempted to ignore.

### 13.2 Common Validation Failures

| Failure | Cause | Fix |
| --- | --- | --- |
| Missing required section | Body lacks a required heading for the note type | Add the exact required heading |
| Unknown tag | Tag is not in the controlled vocabulary | Use an allowed tag or update the policy in code |
| Wrong corpus path | `notePath` does not start with the target corpus | Move path under `context_brain/` or `general_notes/` |
| General note marked current | `general_notes` cannot be current-state authority | Use `context_brain` or set `currentState: false` |
| Date format invalid | Date is not `YYYY-MM-DD` | Normalize the date |
| Superseded state inconsistent | Superseded note lacks `supersededBy` or current note has it | Fix supersession fields |

Warnings still deserve review. A warning is not always a blocker, but it is
operator-visible risk.

## 14. Reviewing Drafts

There is no tracked review GUI. Review is currently operator-driven through
files, CLI, HTTP, MCP, and history queries.

Recommended review checklist:

1. Read the staging draft body and frontmatter.
2. Confirm the note is useful, specific, and sourced.
3. Confirm it does not duplicate existing canonical memory.
4. Confirm it does not smuggle session-only or tool-output text into canonical
   authority.
5. Run `validate-note` in promotion mode.
6. Decide whether to promote, rewrite, leave staged, or reject outside the
   current service surface.

When using Codex with the companion Superpowers workflows:

- `multiagentbrain-note-capture` helps decide whether information should be
  rejected, session-only, merged, rewritten, escalated, or turned into a staged
  draft.
- `multiagentbrain-note-review` applies adversarial review before staging or
  promotion.
- `multiagentbrain-memory-protocol` reminds the operator to checkpoint durable
  knowledge at the end of meaningful work.

Those are local operator workflows, not replacement authority paths. They
should still respect `draft-note`, validation, and promotion.

### 14.1 First-Time Review Workflow

When `draft-note` returns a draft:

1. Open the file under the staging root, or inspect the returned `body`.
2. Confirm the title says exactly what the note is about.
3. Confirm the summary is short and factual.
4. Confirm the body contains the required sections for its note type.
5. Confirm every important claim has a source or clear provenance.
6. Confirm the note is not just a transcript. Rewrite it into a durable fact,
   decision, runbook, or policy.
7. Search existing memory for duplicates.
8. Run `validate-note` with `validationMode: "promotion"`.
9. Promote only when the content is still correct after review.

Review questions:

- Is this information still true today?
- Is it specific enough to help a future agent?
- Is it scoped to the right project or subsystem?
- Does it conflict with existing canonical memory?
- Does it contain secrets, tokens, or private incidental content?
- Is this a durable fact, or only session continuity?
- Should it supersede an older current-state note?

If you cannot answer those questions, leave it staged or archive it as
session-only. Do not promote it.

## 15. Promoting Notes

Promotion is the only implemented path from staging draft to canonical memory.

CLI example:

```powershell
corepack pnpm cli -- promote-note --json '{
  "draftNoteId": "draft-note-id",
  "targetCorpus": "context_brain",
  "expectedDraftRevision": "known-draft-revision",
  "promoteAsCurrentState": true
}'
```

Promotion does the following:

- Checks actor role.
- Loads the staging draft.
- Verifies the expected draft revision when provided.
- Builds promoted canonical frontmatter.
- Runs promotion validation.
- Detects exact duplicates using content hash.
- Builds a semantic signature from title, summary, and scope.
- If `promoteAsCurrentState` is true, finds older current-state notes that
  match type/project/title or scope and supersedes them.
- Optionally prepares a current-state snapshot note.
- Enqueues a promotion outbox entry.
- Processes canonical writes.
- Chunks the canonical note.
- Syncs SQLite metadata.
- Syncs SQLite FTS.
- Syncs Qdrant if a vector index and embedding provider are available.
- Regenerates context representations when configured.
- Updates the staging draft lifecycle.
- Records promotion history.

Promotion can fail with:

- `forbidden`.
- `not_found`.
- `revision_conflict`.
- `validation_failed`.
- `duplicate_detected`.
- `write_failed`.

Use `expectedDraftRevision` when promoting manually. It protects against
promoting a draft that changed between review and promotion.

### 15.1 Promotion Result Fields

Successful promotion returns:

- `promotedNoteId`: new canonical note ID.
- `canonicalPath`: canonical file path written under the target corpus.
- `supersededNoteIds`: older current-state notes replaced by this promotion.
- `chunkCount`: number of chunks created for retrieval.
- `auditEntryId`: audit record ID when audit write succeeds.
- `warnings`: non-blocking audit or sync warnings.

After promotion, immediately verify:

```powershell
$verify = @'
{
  "query": "Session archives are non-authoritative",
  "corpusIds": ["context_brain"],
  "budget": {
    "maxTokens": 2000,
    "maxSources": 5,
    "maxRawExcerpts": 2,
    "maxSummarySentences": 4
  },
  "requireEvidence": true,
  "includeTrace": true
}
'@

corepack pnpm cli -- search-context --json $verify
```

You are checking that:

- The promoted note appears as evidence.
- The context packet summary is correct.
- `retrievalHealth.status` is not `unhealthy`.
- Any vector degradation warning is understood.

### 15.2 When To Use `promoteAsCurrentState`

Use `promoteAsCurrentState: true` when the note states the current truth for a
topic, policy, architecture, or runbook.

Use `promoteAsCurrentState: false` when the note is historical, reference-only,
or should not supersede older current-state notes.

Examples:

| Note | `promoteAsCurrentState` |
| --- | --- |
| Current policy: agents must not write canonical memory directly | `true` |
| Historical investigation from last month | `false` |
| Current Docker MCP session runbook | `true` |
| Imported reference notes from Hermes analysis | Usually `false` unless converted into a current MAB policy |

Current-state promotion can supersede older notes. That is useful, but it is
also the reason promotion should be reviewed carefully.

## 16. Freshness And Refresh Drafts

Freshness surfaces track temporal validity on notes.

CLI report:

```powershell
corepack pnpm cli -- freshness-status --json '{
  "expiringWithinDays": 14,
  "corpusId": "context_brain",
  "limitPerCategory": 10
}'
```

HTTP:

```text
GET /v1/system/freshness?expiringWithinDays=14&corpusId=context_brain&limitPerCategory=10
```

Refresh one note:

```powershell
corepack pnpm cli -- create-refresh-draft --json '{
  "noteId": "canonical-note-id",
  "expiringWithinDays": 14,
  "bodyHints": ["Check whether this note is still accurate."]
}'
```

Refresh a bounded batch:

```powershell
corepack pnpm cli -- create-refresh-drafts --json '{
  "corpusId": "context_brain",
  "expiringWithinDays": 14,
  "maxDrafts": 5,
  "sourceStates": ["expired", "expiring_soon"]
}'
```

Refresh drafts are governed staging drafts. They are not direct canonical
writes.

## 17. Retrieval

Retrieval combines:

- Query intent classification.
- SQLite FTS lexical candidates.
- Qdrant vector candidates when available.
- Ranking fusion.
- Optional reranking.
- Answerability assessment.
- Bounded context packet assembly.
- Freshness warnings.
- Retrieval health reporting.
- Optional retrieval trace.
- Audit history.

Search canonical context:

```powershell
corepack pnpm cli -- search-context --json '{
  "query": "How should agents store durable memory?",
  "corpusIds": ["context_brain", "general_notes"],
  "budget": {
    "maxTokens": 4000,
    "maxSources": 6,
    "maxRawExcerpts": 3,
    "maxSummarySentences": 6
  },
  "requireEvidence": true,
  "includeTrace": true
}'
```

Important request fields:

- `query`: required search text.
- `corpusIds`: one or more of `context_brain`, `general_notes`.
- `budget`: token/source/excerpt/summary bounds.
- `intentHint`: optional intent override hint.
- `noteTypePriority`: optional type preference.
- `tagFilters`: optional controlled tags.
- `includeSuperseded`: include superseded notes when supported by lower layers.
- `requireEvidence`: include raw excerpts in the packet where budget allows.
- `includeTrace`: include retrieval trace.
- `strategy`: use `hierarchical` when you want scope-diverse candidate
  selection.

The response includes:

- `packet`.
- `candidateCounts`.
- `provenance`.
- `retrievalHealth`.
- Optional `trace`.
- Optional warnings.

Retrieval health values:

- `healthy`: delivered evidence and vector path is not degraded.
- `degraded`: delivered evidence, but vector retrieval is degraded or empty.
- `unhealthy`: no delivered candidates.

If vector retrieval is degraded, lexical retrieval remains active. Do not treat
degraded vector retrieval as total memory failure, but do surface it to the
operator because recall quality may be weaker.

## 18. Context Packets

Context packets are bounded read-side products for agents and tools.

Direct packet assembly:

```powershell
corepack pnpm cli -- get-context-packet --json '{
  "intent": "architecture_recall",
  "budget": {
    "maxTokens": 2000,
    "maxSources": 3,
    "maxRawExcerpts": 1,
    "maxSummarySentences": 4
  },
  "includeRawExcerpts": true,
  "candidates": [
    {
      "noteType": "architecture",
      "score": 0.91,
      "summary": "The orchestrator gates transport requests before domain execution.",
      "scope": "orchestration",
      "qualifiers": [],
      "tags": ["domain/orchestration"],
      "stalenessClass": "current",
      "provenance": {
        "noteId": "example",
        "notePath": "context_brain/example.md",
        "headingPath": ["Architecture"]
      }
    }
  ]
}'
```

Direct context packet assembly is useful for tests, adapters, and future
read-side services. Most operators should use `search-context` or
`assemble-agent-context` instead.

## 19. Decision Summaries

Decision summaries are retrieval products focused on decisions around a topic.

```powershell
corepack pnpm cli -- fetch-decision-summary --json '{
  "topic": "canonical memory promotion",
  "budget": {
    "maxTokens": 2000,
    "maxSources": 5,
    "maxRawExcerpts": 2,
    "maxSummarySentences": 5
  }
}'
```

Use decision summaries when an agent needs to understand prior design choices
without reading unrelated implementation notes.

## 20. Namespace Tree And Nodes

Namespace services expose context nodes without mutating authority state.

List tree:

```powershell
corepack pnpm cli -- list-context-tree --json '{
  "ownerScope": "context_brain",
  "authorityStates": ["canonical", "session"]
}'
```

Read node:

```powershell
corepack pnpm cli -- read-context-node --json '{
  "uri": "mab://context_brain/note/<noteId>"
}'
```

Use namespace reads when an agent needs structured browsing rather than ranked
search.

The implemented owner scopes are:

- `context_brain`.
- `general_notes`.
- `imports`.
- `sessions`.
- `system`.

For note nodes, the current URI shape is:

```text
mab://<ownerScope>/note/<noteId>
```

The namespace service reads nodes that already exist in SQLite metadata. If you
use a placeholder URI, the response should be `ok: false` with `not_found`.

## 21. Session Recall

Search session archives:

```powershell
corepack pnpm cli -- search-session-archives --json '{
  "query": "paid models out of scope",
  "sessionId": "operator-session-2026-04-13",
  "limit": 5,
  "maxTokens": 2000
}'
```

The search clamps:

- Limit to a maximum of 20.
- Token budget to a maximum of 12000.

Session recall is intentionally labeled non-authoritative when injected into
agent context. It helps an agent remember conversation continuity, but the agent
must not treat it as promoted fact.

## 22. Agent Context Assembly

Agent context assembly creates a fenced block designed to be safe to append to
local-agent prompts.

```powershell
corepack pnpm cli -- assemble-agent-context --json '{
  "query": "How should a local agent update durable memory?",
  "corpusIds": ["context_brain", "general_notes"],
  "budget": {
    "maxTokens": 6000,
    "maxSources": 6,
    "maxRawExcerpts": 3,
    "maxSummarySentences": 6
  },
  "includeSessionArchives": true,
  "sessionId": "operator-session-2026-04-13",
  "includeTrace": true
}'
```

The result contains:

- `contextBlock`: fenced XML-like context block.
- `tokenEstimate`.
- `truncated`.
- `sourceSummary`.
- `retrievalHealth`.
- Optional retrieval `trace`.

The block starts with:

```xml
<agent-context source="multi-agent-brain" authority="retrieved">
```

It contains:

- A system note explaining authority boundaries.
- `<canonical-memory>` with canonical retrieval.
- Optional `<session-recall authority="non_authoritative">`.

Agent context assembly applies a hard maximum context budget. If the block is
too large, it is truncated and marked.

## 23. Hermes-Inspired Local-Agent Improvements

Hermes was used as architectural inspiration, not as a drop-in replacement.

Useful ideas adapted into MultiagentBrain:

- Session continuity as a separate read-side feature.
- Layered context assembly for local agents.
- Local coder model specialization with qwen3-coder metadata.
- Agent execution traces.
- Retry/error metadata around local model/provider failures.
- Tool-output budgeting so large outputs do not flood prompts.

Important things intentionally not copied from Hermes:

- `MEMORY.md` or `USER.md` as durable authority.
- Autonomous background writes to shared memory.
- Provider sprawl or paid-model assumptions.
- Lossy context compression as canonical memory.
- Broad messaging/gateway complexity.
- Skill self-patching without review.

The MultiagentBrain policy is stricter:

- Hermes-like working memory can inform retrieval and session continuity.
- It must not bypass staging, validation, promotion, audit, or operator review.
- Background agents may create drafts or quarantine proposals, but they should
  not write canonical memory directly.

## 24. Qwen3-Coder And Local Model Usage

The local coding role defaults to qwen3-coder-style metadata:

- Role: `coding_primary`.
- Provider: Docker/Ollama-compatible endpoint.
- Default model ID: `qwen3-coder`.
- Default temperature: `0`.
- Default seed: `42`.
- Default timeout: `120000` ms.
- Default max input chars: `30000`.
- Default max output tokens: `4000`.

The model-role registry lets each role be configured independently:

- `MAB_ROLE_CODING_PRIMARY_PROVIDER`.
- `MAB_ROLE_CODING_PRIMARY_MODEL`.
- `MAB_ROLE_CODING_PRIMARY_TEMPERATURE`.
- `MAB_ROLE_CODING_PRIMARY_SEED`.
- `MAB_ROLE_CODING_PRIMARY_TIMEOUT_MS`.
- `MAB_ROLE_CODING_PRIMARY_MAX_INPUT_CHARS`.
- `MAB_ROLE_CODING_PRIMARY_MAX_OUTPUT_TOKENS`.

Use qwen3-coder for coding-domain tasks. Do not use it as the authority for
canonical memory writes. It can propose, summarize, diagnose, and generate
patches through the coding runtime, but memory updates still go through
governed note workflows.

## 25. Coding Runtime

The coding runtime is invoked through:

- `execute-coding-task`.
- `POST /v1/coding/execute`.
- MCP tool `execute_coding_task`.

Supported task types:

- `triage`.
- `review`.
- `draft_patch`.
- `generate_tests`.
- `summarize_diff`.
- `propose_fix`.

Basic CLI example:

```powershell
corepack pnpm cli -- execute-coding-task --json '{
  "taskType": "review",
  "task": "Review the staged changes for memory-governance regressions.",
  "repoRoot": "F:/Dev/scripts/MultiagentBrain",
  "context": "Focus on direct canonical writes and auth bypasses."
}'
```

With memory context:

```powershell
corepack pnpm cli -- execute-coding-task --json '{
  "taskType": "triage",
  "task": "Find why vector retrieval is degraded.",
  "repoRoot": "F:/Dev/scripts/MultiagentBrain",
  "memoryContext": {
    "query": "vector retrieval degraded lexical retrieval active qdrant health",
    "corpusIds": ["context_brain", "general_notes"],
    "budget": {
      "maxTokens": 5000,
      "maxSources": 6,
      "maxRawExcerpts": 3,
      "maxSummarySentences": 6
    },
    "includeSessionArchives": true,
    "includeTrace": true
  }
}'
```

The orchestrator assembles memory context before calling the Python bridge.
The coding response and audit entry report whether memory context was requested
and included.

The local Python runtime lives in `runtimes/local_experts`. It is invoked as a
bounded worker, not as the application host.

## 26. Local-Agent Traces

Local-agent traces are compact records stored in SQLite.

They capture:

- Trace ID.
- Request ID.
- Actor ID.
- Task type.
- Model role.
- Model ID.
- Whether memory context was included.
- Whether retrieval trace was included.
- Status.
- Reason.
- Tool used.
- Provider error kind.
- Retry count.
- Whether a seed was applied.
- Creation timestamp.

List traces:

```powershell
corepack pnpm cli -- list-agent-traces --json '{
  "requestId": "request-id-from-actor-context"
}'
```

Use traces to answer:

- Did the local agent receive memory context?
- Which model role/model ID was used?
- Did it retry?
- Did provider failure classification trigger?
- Did the task succeed, fail, or escalate?

## 27. Tool-Output Spillover

Large local-agent outputs are stored outside prompt context.

The budget service:

- Keeps outputs up to 64 KiB inline by default.
- Caps custom inline budgets at 256 KiB.
- Stores larger outputs in the tool-output store.
- Replaces inline text with a `<tool-output-spillover>` preview.
- Records spillover IDs in escalation metadata.

Retrieve full output:

```powershell
corepack pnpm cli -- show-tool-output --json '{
  "outputId": "tool-output-id"
}'
```

Use tool-output spillover when:

- A command prints long logs.
- A patch generator returns a large body.
- A validation run produces long stdout/stderr.
- An agent needs the full output only after deciding it matters.

Do not copy huge tool output into canonical notes. Summarize the relevant fact
and preserve the output ID or provenance if needed.

## 28. Audit History

History is stored in SQLite audit records.

Query history:

```powershell
corepack pnpm cli -- query-history --json '{
  "limit": 20,
  "noteId": "optional-note-id"
}'
```

History records are produced for:

- Retrieval.
- Promotion.
- Coding task execution.
- Other application actions where the service records audit entries.

Use history to inspect:

- Which actor did what.
- Which note IDs were affected.
- Which chunks were affected.
- Whether the outcome was accepted, rejected, or partial.
- Details such as retrieval candidate counts, promotion outbox ID, memory
  context status, or coding task metadata.

## 29. Environment Variables

The complete reference is `docs/reference/env-vars.md`.

Important runtime variables:

- `MAB_NODE_ENV`.
- `MAB_RELEASE_VERSION`.
- `MAB_RELEASE_COMMIT`.
- `MAB_RELEASE_BUILT_AT`.
- `MAB_VAULT_ROOT`.
- `MAB_STAGING_ROOT`.
- `MAB_SQLITE_PATH`.
- `MAB_QDRANT_URL`.
- `MAB_QDRANT_COLLECTION`.
- `MAB_QDRANT_SOFT_FAIL`.
- `MAB_API_HOST`.
- `MAB_API_PORT`.
- `MAB_LOG_LEVEL`.

Provider selector variables:

- `MAB_EMBEDDING_PROVIDER`.
- `MAB_REASONING_PROVIDER`.
- `MAB_DRAFTING_PROVIDER`.
- `MAB_RERANKER_PROVIDER`.
- `MAB_DISABLE_PROVIDER_FALLBACKS`.

Provider endpoint/model variables:

- `MAB_OLLAMA_BASE_URL`.
- `MAB_PROVIDER_DOCKER_OLLAMA_BASE_URL`.
- `MAB_PROVIDER_PAID_ESCALATION_BASE_URL`.
- `MAB_PROVIDER_PAID_ESCALATION_API_KEY`.
- `MAB_OLLAMA_EMBEDDING_MODEL`.
- `MAB_OLLAMA_REASONING_MODEL`.
- `MAB_OLLAMA_DRAFTING_MODEL`.

Role binding override pattern:

```text
MAB_ROLE_<ROLE>_PROVIDER
MAB_ROLE_<ROLE>_MODEL
MAB_ROLE_<ROLE>_TEMPERATURE
MAB_ROLE_<ROLE>_SEED
MAB_ROLE_<ROLE>_TIMEOUT_MS
MAB_ROLE_<ROLE>_MAX_INPUT_CHARS
MAB_ROLE_<ROLE>_MAX_OUTPUT_TOKENS
```

Roles:

- `CODING_PRIMARY`.
- `BRAIN_PRIMARY`.
- `EMBEDDING_PRIMARY`.
- `RERANKER_PRIMARY`.
- `PAID_ESCALATION`.

Coding runtime variables:

- `MAB_CODING_RUNTIME_PYTHON_EXECUTABLE`.
- `MAB_CODING_RUNTIME_PYTHONPATH`.
- `MAB_CODING_RUNTIME_MODULE`.
- `MAB_CODING_RUNTIME_TIMEOUT_MS`.

Auth variables:

- `MAB_AUTH_MODE`.
- `MAB_AUTH_ALLOW_ANONYMOUS_INTERNAL`.
- `MAB_AUTH_ACTOR_REGISTRY_PATH`.
- `MAB_AUTH_ACTOR_REGISTRY_JSON`.
- `MAB_AUTH_ISSUER_SECRET`.
- `MAB_AUTH_ISSUED_TOKEN_REQUIRE_REGISTRY_MATCH`.
- `MAB_AUTH_REVOKED_ISSUED_TOKEN_IDS_PATH`.
- `MAB_AUTH_REVOKED_ISSUED_TOKEN_IDS_JSON`.

MCP session defaults:

- `MAB_MCP_DEFAULT_ACTOR_ID`.
- `MAB_MCP_DEFAULT_ACTOR_ROLE`.
- `MAB_MCP_DEFAULT_ACTOR_AUTH_TOKEN`.
- `MAB_MCP_DEFAULT_SOURCE`.

## 30. Auth Operations

Check auth state:

```powershell
corepack pnpm cli -- auth-status
```

Issue a token:

```powershell
corepack pnpm cli -- issue-auth-token --json '{
  "actorId": "operator-local",
  "actorRole": "operator",
  "source": "manual",
  "allowedTransports": ["cli", "http", "mcp"],
  "allowedCommands": ["search_context", "promote_note"],
  "ttlMinutes": 60
}'
```

The current token-issue validator accepts only the command names listed in
`packages/infrastructure/src/transport/auth-control-validation.ts`. That list
currently includes core commands such as `search_context`, `draft_note`,
`validate_note`, `promote_note`, `execute_coding_task`, and `query_history`.
For newer commands such as `create_session_archive`, `assemble_agent_context`,
`import_resource`, `list_agent_traces`, or `show_tool_output`, omit
`allowedCommands` until the validator allow-list is widened.

Inspect a token:

```powershell
corepack pnpm cli -- auth-introspect-token --json '{
  "token": "issued-token",
  "expectedTransport": "mcp",
  "expectedCommand": "search_context"
}'
```

List issued tokens:

```powershell
corepack pnpm cli -- auth-issued-tokens --json '{
  "includeRevoked": true,
  "limit": 20
}'
```

Revoke a token:

```powershell
corepack pnpm cli -- revoke-auth-token --json '{
  "tokenId": "issued-token-id",
  "reason": "operator cleanup"
}'
```

Auth-control HTTP endpoints require an operator or system actor.

## 31. Health And Diagnostics

HTTP health endpoints:

```text
GET /health/live
GET /health/ready
```

`live` is for process liveness.

`ready` is for operational readiness and includes checks such as temporal
validity and vector health where available.

Useful diagnostics:

```powershell
corepack pnpm cli -- version
corepack pnpm cli -- auth-status
corepack pnpm cli -- freshness-status
corepack pnpm cli -- search-context --json '{ ... "includeTrace": true }'
corepack pnpm cli -- list-agent-traces --json '{ "requestId": "..." }'
corepack pnpm cli -- show-tool-output --json '{ "outputId": "..." }'
corepack pnpm run test:eval:retrieval
```

Common states:

- Qdrant unreachable with soft fail enabled: vector retrieval degrades, lexical
  retrieval remains active.
- Qdrant unreachable with hard fail behavior: readiness may fail and retrieval
  may error depending on configuration.
- Model Runner unreachable with fallbacks enabled: deterministic or heuristic
  providers may be used.
- Model Runner unreachable with fallbacks disabled: model-backed calls may fail.
- Enforced auth without a valid registry/token: non-internal actors are denied.
- Missing Python runtime dependencies: coding tasks fail or escalate.

## 32. Testing And Evaluation

Primary verification commands:

```powershell
corepack pnpm typecheck
corepack pnpm test
corepack pnpm run test:transport
corepack pnpm run test:e2e
corepack pnpm run test:eval:retrieval
```

Docker operations:

```powershell
corepack pnpm run docker:up
corepack pnpm run docker:down
corepack pnpm run docker:mcp:build
```

Important test areas:

- Transport adapters.
- MCP adapter.
- Docker MCP startup.
- Context authority contracts.
- Context namespace.
- Context representations.
- Hierarchical retrieval.
- Retrieval strategy diff.
- Retrieval traces.
- Session archives.
- Local model providers.
- Hermes bridge runtime.
- Service boundaries and regression.
- Retrieval eval fixtures.

There is currently no tracked `pnpm run lint` script.

## 33. Practical Operator Workflows

### Store A New Durable Fact

1. Decide whether the information deserves durable memory.
2. If it is only session continuity, create a session archive instead.
3. If it is durable, create a staging draft with `draft-note`.
4. Review the draft.
5. Validate in promotion mode.
6. Promote with `promote-note`.
7. Search for the fact to confirm retrieval.

### Store Conversation Continuity

1. Create a session archive with `create-session-archive`.
2. Search it with `search-session-archives`.
3. Include it in `assemble-agent-context` only when continuity matters.
4. Do not promote session recall directly.

### Give A Local Agent Memory

1. Call `assemble-agent-context` for explicit prompt assembly, or provide
   `memoryContext` to `execute-coding-task`.
2. Include session archives only when the session history matters.
3. Include traces when debugging retrieval quality.
4. Inspect `memoryContextStatus` and local-agent traces after execution.

### Review Local-Agent Work

1. Run `execute-coding-task`.
2. Inspect the returned status, reason, validations, and escalation metadata.
3. Use `list-agent-traces` for the request ID.
4. Use `show-tool-output` for spillover IDs.
5. Validate any generated note or patch through the normal workflow.

### Fix Retrieval Degradation

1. Check `search-context` response `retrievalHealth`.
2. Check Qdrant reachability.
3. Check `MAB_QDRANT_URL`.
4. Confirm embeddings are configured.
5. Confirm promoted notes have chunks.
6. Run `corepack pnpm run test:eval:retrieval`.
7. Re-promote or repair indexes only after identifying the failed layer.

### Refresh Stale Memory

1. Run `freshness-status`.
2. Create refresh drafts for expired or expiring notes.
3. Review and validate the drafts.
4. Promote only after confirming current facts.

## 34. What Not To Do

Do not:

- Edit canonical memory directly as an agent shortcut.
- Treat session archives as canonical memory.
- Treat retrieval traces as durable facts.
- Treat tool-output spillover as memory.
- Promote a note that failed validation.
- Disable auth in a shared or production-like environment.
- Enable paid-model escalation casually.
- Let a background agent write canonical memory.
- Use Hermes `MEMORY.md` or `USER.md` patterns as authority.
- Hide vector retrieval degradation from operators.
- Store secrets in notes, drafts, session archives, traces, or tool outputs.

## 35. Troubleshooting

### CLI Says A Payload Is Missing

Most CLI commands require exactly one of:

- `--json`.
- `--input`.
- `--stdin`.

Commands that do not require payloads include:

- `version`.
- `auth-status`.

Some commands accept optional payloads:

- `freshness-status`.
- `auth-issued-tokens`.
- `create-refresh-drafts`.

### HTTP Returns 405

The route exists, but the HTTP method is wrong. Most application routes are
`POST`. Health/version/auth summary/freshness list endpoints are `GET`.

### HTTP Body Rejected

The HTTP server accepts JSON object bodies and has a 1 MB safety limit.

### MCP Tool Fails Validation

Run `tools/list` or inspect `apps/brain-mcp/src/tool-definitions.ts` for the
schema. MCP tool names use snake case, while CLI commands use kebab case.

### Promotion Fails With Duplicate

An identical non-superseded canonical note already exists. Search canonical
memory, decide whether to supersede, merge, or reject the staged draft.

### Promotion Fails With Revision Conflict

The draft changed after the revision you reviewed. Re-read it, re-validate it,
and promote with the new revision only if it still passes review.

### Coding Task Fails

Check:

- Python executable.
- `MAB_CODING_RUNTIME_PYTHONPATH`.
- `MAB_CODING_RUNTIME_MODULE`.
- Python dependencies.
- Docker Model Runner endpoint.
- qwen3-coder model availability.
- Local-agent traces.
- Spillover outputs.

### Retrieval Has No Results

Check:

- Canonical notes exist.
- Notes were promoted, not only drafted.
- Chunks exist in SQLite metadata.
- FTS index was updated.
- Qdrant is reachable if vector search is expected.
- Query budget is not too small.
- Corpus IDs are correct.
- Tag filters are not too restrictive.

## 36. Glossary

Canonical memory: promoted durable note state used as authority.

Staging draft: candidate note awaiting review and promotion.

Promotion: deterministic workflow that moves a validated draft into canonical
memory and synchronizes indexes.

Session archive: immutable non-authoritative transcript storage for continuity.

Context packet: bounded retrieval product with summary, evidence, constraints,
uncertainties, and answerability.

Agent context: fenced prompt block assembled from canonical retrieval and
optional non-authoritative session recall.

Retrieval health: read-side status showing whether retrieval is healthy,
degraded, or unhealthy.

Vector degradation: condition where vector retrieval is missing or degraded but
lexical retrieval may still serve results.

Tool-output spillover: full output stored outside prompt context, with a small
preview and output ID returned inline.

Local-agent trace: compact operational record for a local coding-agent request.

Current-state note: canonical note marked as current for a topic/scope.

Supersession: state where a new current canonical note replaces an older one.

Refresh draft: governed staged proposal to update expired or expiring memory.

Actor registry: configured list of actors, roles, credentials, transport
permissions, command permissions, and validity windows.

Issued token: short-lived centrally issued actor token that can be inspected and
revoked.

## 37. Reference Map

Use these files when you need source details:

- `README.md`: current repository overview.
- `docs/setup/installation.md`: installation paths.
- `docs/setup/configuration.md`: configuration guidance.
- `docs/setup/development-workflow.md`: development workflow.
- `docs/reference/interfaces.md`: HTTP, CLI, MCP, and internal interfaces.
- `docs/reference/env-vars.md`: environment variables.
- `docs/reference/glossary.md`: terminology.
- `docs/reference/repo-map.md`: repository map.
- `docs/architecture/overview.md`: package-level architecture.
- `docs/architecture/runtime-flow.md`: request and promotion flows.
- `docs/architecture/invariants-and-boundaries.md`: safety boundaries.
- `docs/operations/running.md`: running commands.
- `docs/operations/troubleshooting.md`: troubleshooting.
- `docs/operations/docker-mcp-session.md`: containerized MCP session.
- `docs/local-agent-context.md`: local-agent context assembly.
- `docs/qwen3-coder-local-profile.md`: qwen3-coder local role profile.
- `docs/planning/hermes-vs-multi-agent-brain-gap-analysis.md`: Hermes gap
  analysis.
- `docs/superpowers/plans/2026-04-13-hermes-gap-bridge-implementation-plan.md`:
  implementation plan behind the Hermes bridge work.
- `tests/README.md`: test guide.

## 38. Final Operating Rule

Use MultiagentBrain as a governed memory and context system, not as an
unbounded note dump.

The strongest local-agent pattern is:

```text
retrieve bounded context
   |
   v
agent performs useful local work
   |
   v
agent outputs proposals, traces, and evidence
   |
   v
operator validates and reviews
   |
   v
governed promotion updates canonical memory
```

That is the main lesson from the Hermes comparison: borrow better read-side and
agent-continuity ideas, but keep MultiagentBrain's stronger write discipline.
