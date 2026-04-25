# Coding Advisory VoltAgent Profile Design

> Scope: `coding_advisory` only. This design intentionally does not widen `paid_escalation`.

## Goal

Make `coding_advisory` a first-class VoltAgent harness path with role-specific hooks, middleware, and guardrails while keeping Mimir as the system of record for orchestration, audit, trace, and fallback semantics.

## Constraints

- `coding_advisory` remains post-local-escalation only.
- Advisory failure must not mutate the original local escalation result.
- No new VoltAgent-specific types may leak into Mimir contracts or orchestration surfaces.
- The implementation should create reusable harness extension points, but only `coding_advisory` consumes them in this sprint.

## Design

### Role-specific profile

Add an infrastructure-owned role profile builder for VoltAgent harness roles:

- `packages/infrastructure/src/providers/voltagent-role-profile.ts`

For this sprint, it will export a `buildCodingAdvisoryVoltAgentProfile(...)` helper that returns:

- advisory-specific hooks
- advisory-specific input middleware
- advisory-specific output middleware
- advisory-specific input guardrails
- advisory-specific output guardrails

### Hooks

Hooks should enrich telemetry state without making VoltAgent the audit owner.

For `coding_advisory`, capture:

- start
- retry
- fallback
- guardrail block
- provider error
- completion

The runtime still emits Mimir-owned `PaidExecutionTelemetry`; the profile adds advisory-specific metadata fields in memory for the adapter to read and map into the final telemetry object.

### Input middleware

Input middleware should normalize advisory input before model execution:

- bound oversized validation output
- ensure a deterministic prompt section order
- strip empty optional fields
- preserve the distinction between task, local result, escalation metadata, and requested next decision

### Output middleware

Output middleware should normalize advisory output before contract mapping:

- trim summary text
- deduplicate and bound `suggestedChecks`
- normalize recommendation casing when needed

### Guardrails

Input guardrails:

- reject advisory invocation unless local response status is `escalate`
- reject missing task text
- reject empty escalation reason

Output guardrails:

- reject missing recommendation
- reject invalid recommendation enum
- reject empty summary
- reject oversized checklist payloads

### Failure policy

- Guardrail or provider failure records advisory telemetry.
- Advisory failure still returns the original local escalation result.
- No fallback to a different orchestration path is introduced.

## Testing

Add focused tests for:

- advisory input normalization
- advisory output normalization
- advisory input guardrail rejection
- advisory output guardrail rejection
- advisory hook telemetry enrichment
- adapter behavior under success and blocked outputs

## Non-goals

- No `paid_escalation` migration in this sprint.
- No VoltAgent workflows or multi-agent orchestration in this sprint.
