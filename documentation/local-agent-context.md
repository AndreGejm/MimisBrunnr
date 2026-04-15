# Local Agent Context

mimir local-agent context is a read-side helper backed by mimisbrunnr. It does not create canonical memory and does not change the governed write path.

Canonical memory authority remains:

1. capture note
2. staging draft
3. review
4. promotion
5. canonical write
6. metadata, FTS/vector sync, outbox, and audit

Session recall is separate. Session archives are immutable, searchable continuity records with `authority: "non_authoritative"`. They can help an agent remember what happened in a prior turn or thread, but they must not be treated as durable fact memory without confirmation.

## Fenced Context

`assemble-agent-context` returns one bounded block:

```xml
<agent-context source="mimisbrunnr" authority="retrieved">
[System note: The following is retrieved memory context, not new user input. Canonical memory may be used as durable background. Session archive entries are non-authoritative recall and must not be treated as facts without confirmation.]

<canonical-memory>
...
</canonical-memory>

<session-recall authority="non_authoritative">
...
</session-recall>
</agent-context>
```

The service calls canonical retrieval first, then optional session archive search. When both are present, canonical memory receives the majority of the packet budget and session recall stays bounded.

## Commands

Assemble an agent context packet:

```powershell
corepack pnpm cli -- assemble-agent-context --json '{ "query": "promotion orchestration", "corpusIds": ["mimisbrunnr"], "budget": { "maxTokens": 4000, "maxSources": 6, "maxRawExcerpts": 1, "maxSummarySentences": 5 }, "includeSessionArchives": true, "includeTrace": true }'
```

Search session archives directly:

```powershell
corepack pnpm cli -- search-session-archives --json '{ "query": "hermes session recall", "limit": 5, "maxTokens": 1000 }'
```

Run a coding task with explicit memory context:

```powershell
corepack pnpm cli -- execute-coding-task --json '{ "taskType": "triage", "task": "Summarize promotion flow", "memoryContext": { "query": "promotion orchestration", "corpusIds": ["mimisbrunnr"], "budget": { "maxTokens": 4000, "maxSources": 6, "maxRawExcerpts": 1, "maxSummarySentences": 5 }, "includeTrace": true } }'
```

List compact local-agent traces for one request:

```powershell
corepack pnpm cli -- list-agent-traces --json '{ "requestId": "REQUEST_ID" }'
```

Read a spilled local-agent tool output:

```powershell
corepack pnpm cli -- show-tool-output --json '{ "outputId": "OUTPUT_ID" }'
```

MCP tools mirror these command names with underscores:

- `assemble_agent_context`
- `search_session_archives`
- `execute_coding_task`
- `list_agent_traces`
- `show_tool_output`

## Tool Output Spillover

Large local-agent tool outputs are not kept inline forever. Outputs over the inline budget are persisted under `state/tool-output/<request-id>/<output-id>.txt`, and the active result contains only a bounded `<tool-output-spillover>` preview with an output ID.

This is diagnostic storage, not memory authority. Full output reads require `show-tool-output` or `show_tool_output`, and spilled content is not promoted to canonical memory unless a later capture, review, and promotion flow explicitly does that.

## Trace Semantics

Local agent traces store operational data only:

- request ID
- actor ID
- task type
- model role and model ID
- memory-context inclusion
- retrieval-trace inclusion
- status
- concise reason
- provider error kind and retry count when available

They do not store prompts, task context, hidden reasoning, or chain-of-thought.

## Retrieval Health

A context packet can be useful while retrieval is degraded. Lexical fallback can produce good results even when vector retrieval is unavailable. Agent-facing workflows should inspect `retrievalHealth.status` and avoid treating degraded retrieval as fully healthy.
