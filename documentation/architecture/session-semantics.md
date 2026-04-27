# Session Semantics

The repo currently supports three distinct session shapes:

- direct command-catalog MCP through `apps/mimir-mcp`
- toolbox compatibility sessions through `mimir-control`
- toolbox broker sessions through `apps/mimir-toolbox-mcp`

They share one runtime, but they do not share the same tool-surface semantics.

## Toolbox entry modes

These values are part of the current actor and diagnostic contract:

- `legacy-direct`
- `toolbox-bootstrap`
- `toolbox-activated`

How they are used today:

- `legacy-direct`: direct `mimir-mcp` usage without toolbox profile env
- `toolbox-bootstrap`: bootstrap toolbox profile is active
- `toolbox-activated`: any non-bootstrap toolbox profile is active

The active toolbox path also carries:

- `toolboxClientId`
- `toolboxProfileId`
- optional `sessionPolicyToken`

## Current runtime paths

### Direct command-catalog path

`apps/mimir-mcp` exposes the stable runtime command catalog directly.

Characteristics:

- no same-session tool-surface mutation
- no toolbox discovery or approval flow
- no band activation state
- actor context falls back to `legacy-direct` unless toolbox env vars are set

Use this path when a client wants the full stable Mimir command catalog and does
not want toolbox mediation.

### Compatibility reconnect path

`apps/mimir-control-mcp` and the matching CLI commands are the compatibility
control surface.

Flow:

1. start in `bootstrap`
2. call `list_toolboxes` and `describe_toolbox`
3. call `request_toolbox_activation`
4. receive an approval or denial response with diagnostics
5. if approved, reconnect using the returned handoff metadata

The current reconnect handoff contract can set:

- `MAB_TOOLBOX_ACTIVE_PROFILE`
- `MAB_TOOLBOX_CLIENT_ID`
- `MAB_TOOLBOX_SESSION_MODE`
- `MAB_TOOLBOX_SESSION_POLICY_TOKEN` when a lease was issued

Operational constraints:

- lease issuance depends on `MAB_TOOLBOX_LEASE_ISSUER_SECRET`
- `sync-toolbox-runtime --apply` and `sync-toolbox-client --apply` only write
  client artifacts; they do not mutate Docker
- Codex client materialization only emits local-stdio peers marked
  `configTarget: codex-mcp-json`

### Broker-dynamic path

`apps/mimir-toolbox-mcp` keeps one stable MCP endpoint and mutates the visible
tool set inside that session.

Current broker session state includes:

- `sessionId`
- `clientId`
- `runtimeMode: "broker-dynamic"`
- `activeProfileId`
- `activeBands`
- `activeToolboxId`
- `activationCause`
- `leaseToken`
- `leaseExpiresAt`
- `activatedAt`
- `lastToolActivityAt`

Current activation causes:

- `bootstrap`
- `explicit_request`
- `policy_auto`
- `deactivation`
- `idle_timeout`
- `lease_expired`

## Current broker behavior

The broker currently:

- starts in the compiled `bootstrap` profile
- keeps the six control tools stable
- recomputes visible tools from the active compiled profile
- emits `notifications/tools/list_changed` after activation, deactivation, or
  contraction
- touches `lastToolActivityAt` after successful non-control tool calls
- returns current broker session state in structured tool results

The active tool list is filtered by:

- compiled band/profile membership
- client overlay suppression
- runtime binding availability
- peer backend health and discovery success

## Contraction rules

Contraction is live code, not a plan item.

Current contraction sources:

- explicit `deactivate_toolbox`
- idle timeout
- lease expiry

Current implementation details:

- fallback target comes from the active compiled profile's `fallbackProfile`,
  defaulting to `bootstrap`
- idle timeout uses the smallest `idleTimeoutSeconds` value across the active
  bands that declare task-aware contraction
- lease-expiry contraction only happens when an active band sets
  `contraction.onLeaseExpiry: true`

Current checked-in idle timeouts:

- `core-dev`: 1800 seconds
- `docs-research`: 1200 seconds
- `runtime-observe`: 900 seconds
- `runtime-admin`: 600 seconds
- `delivery-admin`: 600 seconds
- `security-audit`: 1200 seconds
- `heavy-rag`: 900 seconds
- `full`: 300 seconds
- `voltagent-docs`: 1200 seconds

## Peer routing semantics

The broker does not treat all peer server classes the same.

Current behavior by runtime binding:

- owned servers: handled in process
- `local-stdio`: routable through a process-backed adapter
- `docker-catalog`: routable only when
  `MAB_TOOLBOX_ENABLE_DOCKER_GATEWAY_ADAPTER` is enabled and the Docker gateway
  process can be started
- `descriptor-only`: never routable in the broker; these remain diagnostic or
  compatibility-only surfaces until safe catalog entries exist

This means the compiled policy can describe more servers than the broker can
actually route in one session today.

## Current client overlays

Client overlays can only reduce the visible surface.

Current checked-in clients:

- `codex`: `env-reconnect`, suppresses `github.search` and
  `github.pull-request.read`
- `claude`: `env-reconnect`, no current suppressions
- `antigravity`: `manual-env-reconnect`, no current suppressions

The Codex overlay is why `describe_toolbox` can show `github-read` in a profile
while still returning those GitHub read descriptors under `suppressedTools`.
