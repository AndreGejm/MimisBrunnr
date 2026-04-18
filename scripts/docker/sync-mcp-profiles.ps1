$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $scriptDir "..\..")

node (Join-Path $repoRoot "scripts\docker\sync-mcp-profiles.mjs") @Args
