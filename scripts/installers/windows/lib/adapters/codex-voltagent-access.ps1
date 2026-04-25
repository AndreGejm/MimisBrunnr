Set-StrictMode -Version Latest

. (Join-Path $PSScriptRoot "node-json-script.ps1")

function Get-CodexVoltAgentClientRoot {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)]
    [string]$RepoRoot
  )

  return Join-Path $RepoRoot "vendor\codex-claude-voltagent-client"
}

function Get-CodexVoltAgentWorkspacePath {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)]
    [string]$RepoRoot,

    [string]$WorkspacePath = ""
  )

  if ($WorkspacePath -and $WorkspacePath.Trim().Length -gt 0) {
    return [System.IO.Path]::GetFullPath($WorkspacePath)
  }

  return [System.IO.Path]::GetFullPath($RepoRoot)
}

function Get-CodexVoltAgentHomeConfigPath {
  [CmdletBinding()]
  param(
    [string]$HomeRoot = $HOME
  )

  return Join-Path $HomeRoot ".codex\voltagent\client-config.json"
}

function Get-CodexVoltAgentNativeSkillPath {
  [CmdletBinding()]
  param(
    [string]$HomeRoot = $HOME
  )

  return Join-Path $HomeRoot ".codex\skills\voltagent-default"
}

function Get-CodexVoltAgentPlanMetadata {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)]
    [string]$RepoRoot,

    [string]$WorkspacePath = "",

    [string]$HomeRoot = $HOME
  )

  $resolvedWorkspacePath = Get-CodexVoltAgentWorkspacePath `
    -RepoRoot $RepoRoot `
    -WorkspacePath $WorkspacePath

  return [pscustomobject]@{
    vendoredClientRoot = Get-CodexVoltAgentClientRoot -RepoRoot $RepoRoot
    workspacePath = $resolvedWorkspacePath
    configPath = Get-CodexVoltAgentHomeConfigPath -HomeRoot $HomeRoot
    workspaceConfigPath = Get-CodexVoltAgentHomeConfigPath -HomeRoot $HomeRoot
    nativeSkillPath = Get-CodexVoltAgentNativeSkillPath -HomeRoot $HomeRoot
  }
}

function Invoke-CodexVoltAgentOnboardAdapter {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)]
    [string]$RepoRoot,

    [Parameter(Mandatory = $true)]
    [string]$WorkspacePath,

    [Parameter(Mandatory = $true)]
    [string]$HomeRoot
  )

  $mcpWrapperPath = Join-Path $RepoRoot "scripts\launch-mimir-mcp.mjs"
  $configPath = Get-CodexVoltAgentHomeConfigPath -HomeRoot $HomeRoot
  $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
  if (-not $nodeCommand) {
    throw "Node executable 'node' was not found on PATH."
  }
  $arguments = @(
    "--home-root",
    $HomeRoot,
    "--workspace",
    $WorkspacePath,
    "--config",
    $configPath,
    "--mimir-command",
    $nodeCommand.Source,
    "--mimir-arg",
    $mcpWrapperPath,
    "--force"
  )

  $adapter = Invoke-NodeJsonScriptAdapter `
    -RepoRoot $RepoRoot `
    -ScriptRelativePath "vendor\codex-claude-voltagent-client\scripts\codex-onboard.mjs" `
    -ScriptArguments $arguments

  return [pscustomobject]@{
    command = $adapter.command
    report = $adapter.payload
  }
}

function Invoke-CodexVoltAgentDoctorAdapter {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)]
    [string]$RepoRoot,

    [Parameter(Mandatory = $true)]
    [string]$WorkspacePath,

    [Parameter(Mandatory = $true)]
    [string]$HomeRoot
  )

  $configPath = Get-CodexVoltAgentHomeConfigPath -HomeRoot $HomeRoot
  $arguments = @(
    "--home-root",
    $HomeRoot,
    "--workspace",
    $WorkspacePath,
    "--config",
    $configPath
  )

  $adapter = Invoke-NodeJsonScriptAdapter `
    -RepoRoot $RepoRoot `
    -ScriptRelativePath "vendor\codex-claude-voltagent-client\scripts\codex-doctor.mjs" `
    -ScriptArguments $arguments

  return [pscustomobject]@{
    command = $adapter.command
    report = $adapter.payload
  }
}
