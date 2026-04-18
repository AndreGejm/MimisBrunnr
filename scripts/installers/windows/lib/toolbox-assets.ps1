Set-StrictMode -Version Latest

. (Join-Path $PSScriptRoot "adapters\node-json-script.ps1")

function Invoke-InstallerToolboxAssetAudit {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)]
    [string]$RepoRoot,

    [Parameter(Mandatory = $true)]
    [string]$ToolboxManifestDir
  )

  $adapter = Invoke-NodeJsonScriptAdapter `
    -RepoRoot $RepoRoot `
    -ScriptRelativePath "scripts\docker\audit-toolbox-assets.mjs" `
    -ScriptArguments @("--source", $ToolboxManifestDir, "--json")

  return [pscustomobject]@{
    command = $adapter.command
    report = $adapter.payload
  }
}

function Invoke-InstallerToolboxRuntimePrepare {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)]
    [string]$RepoRoot,

    [Parameter(Mandatory = $true)]
    [string]$ToolboxManifestDir
  )

  $adapter = Invoke-NodeJsonScriptAdapter `
    -RepoRoot $RepoRoot `
    -ScriptRelativePath "scripts\docker\sync-mcp-profiles.mjs" `
    -ScriptArguments @("--source", $ToolboxManifestDir, "--json")

  $payload = $adapter.payload
  $plan = if ($payload.PSObject.Properties.Name -contains "plan") { $payload.plan } else { $payload }

  return [pscustomobject]@{
    command = $adapter.command
    payload = $payload
    plan = $plan
  }
}
