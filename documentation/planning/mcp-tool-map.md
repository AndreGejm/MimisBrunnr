# MCP Tool Map

This document reserves the future MCP-facing tool surface over the current service layer.

The goal is to keep MCP transport as a thin adapter that converts tool inputs into existing service contracts and returns bounded, summary-first outputs.

## Tool Mapping

| Future MCP Tool | Primary Service | Contract | Output Discipline |
| --- | --- | --- | --- |
| `search_context` | `retrieveContextService.retrieveContext(...)` | `SearchContextToolRequest`, `SearchContextToolResponse` | returns a bounded context packet with provenance and candidate counts; stage-1 retrieval candidates never leave the service |
| `get_context_packet` | `contextPacketService.assemblePacket(...)` once exposed as a standalone app service | `GetContextPacketToolRequest`, `GetContextPacketToolResponse` | packet only; no unbounded raw chunk dumps |
| `draft_note` | `stagingDraftService.createDraft(...)` | `DraftNoteToolRequest`, `DraftNoteToolResponse` | returns staged draft metadata and path, not full vault dumps |
| `validate_note` | `noteValidationService.validate(...)` | `ValidateNoteToolRequest`, `ValidateNoteToolResponse` | returns deterministic violations and status only |
| `promote_note` | `promotionOrchestratorService.promoteDraft(...)` | `PromoteNoteToolRequest`, `PromoteNoteToolResponse` | returns promotion decision, affected note IDs, and bounded warnings |
| `query_history` | `auditHistoryService.query(...)` | `QueryHistoryToolRequest`, `QueryHistoryToolResponse` | paged, bounded audit history only |
| `fetch_decision_summary` | future decision-summary application service over retrieval | `FetchDecisionSummaryToolRequest`, `FetchDecisionSummaryToolResponse` | decision packet only, sized by request budget |
| `inspect_gap` | future gap-inspection application service over retrieval/history | `InspectGapToolRequest`, `InspectGapToolResponse` | bounded gap packet with severity, type, and related note paths |

## Adapter Rules

- MCP tools must call application services or service-shaped contracts only.
- MCP adapters must not perform retrieval fusion, validation, promotion policy, or direct vault mutation on their own.
- MCP adapters must pass actor metadata through to audit-capable services.
- MCP adapters must respect the same trust boundaries as the local runtime:
  - retrieval tools are read-only
  - writer tools write to staging only
  - orchestrator tools alone can promote

## Bounded Output Rules

- `search_context` must return the final bounded packet, not lexical/vector candidate lists.
- `get_context_packet` must default to summaries plus provenance, and include raw excerpts only when explicitly requested or required by policy.
- `query_history` must remain paged and filtered.
- `inspect_gap` and `fetch_decision_summary` must be budgeted packet responses, not note dumps.

## Implementation Notes

- The current codebase already has stable contracts for retrieval, drafting, validation, promotion, and history.
- The `packages/contracts/src/mcp` folder now reserves the future MCP tool schema layer as thin aliases or narrow wrappers over those existing contracts.
- When `apps/brain-mcp` is implemented later, each tool handler should do little more than:
  - validate incoming tool arguments
  - map them onto these contracts
  - call the corresponding service
  - return the bounded response
# Status note

This file contains planning material. The tracked MCP implementation lives in `apps/brain-mcp`, and the current tool surface is documented in `documentation/reference/interfaces.md`.
