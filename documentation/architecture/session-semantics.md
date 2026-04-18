# Session Semantics

Docker toolbox v1 uses profile-bound sessions only.

## Session modes

- `legacy-direct`
- `toolbox-bootstrap`
- `toolbox-activated`

These modes must remain explicit in diagnostics and audit data so policy behavior is explainable.

## Activation flow

1. Client starts in `bootstrap`
2. Client calls `list_toolboxes` and `describe_toolbox`
3. Client calls `request_toolbox_activation`
4. Resolver returns an approved profile plus a signed session lease
5. Client reconnects or forks into the approved profile
6. Client keeps `mimir-control` visible and uses `list_active_tools` to inspect the live tool surface

## Non-goals for v1

- no in-session tool hot-add
- no arbitrary additive multi-toolbox composition
- no silent downgrade
- no requirement that Mimir sits in-path to peer servers

## Enforcement model

- Docker profile selection limits the peer server surface
- client overlays can only suppress or reduce capabilities
- Mimir validates the lease on each scoped internal request
- manifest and profile revisions are bound into the lease
- expired or revoked leases are rejected even if the client still holds the token
