# brain-cli

Thin local CLI adapter over the existing application services.

## Commands

- `version`
- `execute-coding-task`
- `search-context`
- `get-context-packet`
- `fetch-decision-summary`
- `draft-note`
- `validate-note`
- `promote-note`
- `query-history`

## Usage

```bash
pnpm cli -- version
pnpm cli -- execute-coding-task --json "{\"taskType\":\"triage\",\"task\":\"Find the regression\",\"repoRoot\":\".\"}"
pnpm cli -- search-context --input ./request.json
pnpm cli -- get-context-packet --stdin < ./request.json
pnpm cli -- fetch-decision-summary --stdin < ./request.json
pnpm cli -- validate-note --stdin < ./request.json
pnpm cli -- draft-note --json "{\"targetCorpus\":\"context_brain\", ... }"
```

## Input Shape

Each command accepts a JSON object shaped like the existing service contracts in `packages/contracts/src/**`.

The CLI injects a default actor context when the input omits `actor`, so the wrapper stays thin and transport-agnostic. `execute-coding-task` also defaults `repoRoot` to the current working directory when it is omitted. `version` and `--version` do not require an input payload.

## Output Shape

The CLI prints JSON only:

- service results are returned unchanged for command handlers backed by `ServiceResult`
- validation responses are returned directly

This keeps the CLI aligned with future HTTP and MCP adapters.
