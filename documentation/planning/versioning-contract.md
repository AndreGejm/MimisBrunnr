# Versioning Contract

This document defines the Git-centric release contract for Multi Agent Brain.

## Purpose

The runtime must always expose enough release metadata to answer:

- what version is running
- which Git tag the release came from
- which commit produced the build
- whether the runtime is a local workspace build or a tagged release

## Source Of Truth

The contract has two layers:

1. Git tags and commit SHAs are the release authority for deployable builds.
2. The workspace `package.json` version is the fallback identity for local and untagged runs.

## Runtime Metadata Fields

The runtime release metadata contains:

- `applicationName`
- `version`
- `gitTag`
- `gitCommit`
- `releaseChannel`
- `source`

## Resolution Order

The runtime resolves release metadata in this order:

1. `MAB_RELEASE_VERSION`
2. workspace `package.json` version

Additional Git-centric fields are supplied independently:

- `MAB_GIT_TAG`
- `MAB_GIT_COMMIT`
- `MAB_RELEASE_CHANNEL`

If `MAB_RELEASE_CHANNEL` is not provided, the runtime defaults to:

- `tagged` when `MAB_GIT_TAG` is set
- `workspace` otherwise

## Required Release Rules

For a tagged release:

- the Git tag must use `vX.Y.Z`
- `MAB_RELEASE_VERSION` must match the tag version without the leading `v`
- `MAB_GIT_TAG` must be the exact release tag
- `MAB_GIT_COMMIT` must be the exact commit SHA deployed
- release builds should use `MAB_RELEASE_CHANNEL=tagged`

For local development:

- `package.json` may provide the visible version
- `gitTag` may be omitted
- `gitCommit` may be omitted
- the runtime defaults to `releaseChannel=workspace`

## Runtime Surfaces

Release metadata is exposed through these surfaces:

- CLI: `brain-cli version` or `brain-cli --version`
- HTTP: `GET /v1/system/version`
- HTTP health: `GET /health/live` and `GET /health/ready` include `release`
- MCP: `initialize` returns `serverInfo.version` from the shared release metadata

## Release Workflow

The minimum release flow is:

1. update the intended release version
2. create the release tag `vX.Y.Z`
3. build and deploy with:
   - `MAB_RELEASE_VERSION=X.Y.Z`
   - `MAB_GIT_TAG=vX.Y.Z`
   - `MAB_GIT_COMMIT=<full sha>`
   - `MAB_RELEASE_CHANNEL=tagged`
4. verify the deployed runtime reports the same values through CLI or HTTP

## Rollback Workflow

Rollback must use a previously known-good Git tag and commit pair.

The runtime metadata must change with the rollback so operators can confirm:

- the rollback target tag
- the rollback commit
- the active release channel

## Why This Contract Exists

This keeps release identity outside ad-hoc notes and log messages.

The shared brain needs deterministic memory governance, but operators also need deterministic deployment governance. Tagged releases and explicit commit metadata make runtime behavior traceable across MCP, CLI, HTTP, and audit review.
