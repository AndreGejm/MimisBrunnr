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

function Get-CodexVoltAgentWorkspaceConfigPath {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)]
    [string]$WorkspacePath
  )

  return Join-Path $WorkspacePath "client-config.json"
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
    workspaceConfigPath = Get-CodexVoltAgentWorkspaceConfigPath -WorkspacePath $resolvedWorkspacePath
    nativeSkillPath = Get-CodexVoltAgentNativeSkillPath -HomeRoot $HomeRoot
  }
}
