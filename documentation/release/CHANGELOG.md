# Changelog

All notable changes to mimir are recorded here.

## 1.0.1 - Release Candidate

Target tag: `v1.0.1`

This release candidate packages the Hermes-derived local-agent improvements
without adopting Hermes' direct memory-write model.

### Added

- Fenced local-agent context assembly with canonical memory and
  non-authoritative session recall.
- Session archive search as recall, not memory authority.
- Local-agent trace storage and diagnostic read surfaces.
- Tool-output spillover storage for oversized local-agent outputs.
- Provider error classification and bounded retry helpers.
- `qwen3-coder` local coding profile metadata and Python bridge environment
  propagation.
- Retrieval quality eval harness with JSONL fixtures.
- Complete first-time operator manual and focused local-agent documentation.
- `.gitattributes` line-ending policy for reproducible checkouts.

### Changed

- Default host state now derives from `MAB_DATA_ROOT`, falling back to
  `%USERPROFILE%\.mimir` on Windows or `$HOME/.mimir`
  elsewhere.
- Auth-control command validation now accepts the current orchestrator command
  surface, including newer session, local-agent, trace, and tool-output commands.
- Agent-context assembly escapes recalled/retrieved text inside XML-like fences
  to prevent prompt-boundary confusion.

### Verification

- `corepack pnpm build`
- `corepack pnpm test:e2e`
- `corepack pnpm test:eval:retrieval`
- Documented transport/auth payload validation pass

### Release Notes

- The existing remote tag `v1.0.0` points at an older commit, so this candidate
  should use `v1.0.1` rather than rewriting `v1.0.0`.
- Node may print an experimental `node:sqlite` warning during verification. That
  warning is expected and is not a test failure.
