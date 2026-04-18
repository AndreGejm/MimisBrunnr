Set-StrictMode -Version Latest

. (Join-Path $PSScriptRoot "node-json-script.ps1")

function Invoke-DefaultAccessDoctorAdapter {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)]
    [string]$RepoRoot,

    [Parameter(Mandatory = $true)]
    [string]$ConfigPath,

    [Parameter(Mandatory = $true)]
    [string]$BinDir,

    [Parameter(Mandatory = $true)]
    [string]$ManifestPath,

    [Parameter(Mandatory = $true)]
    [string]$ServerName
  )

  $arguments = @(
    "--json",
    "--repo-root",
    $RepoRoot,
    "--config",
    $ConfigPath,
    "--bin-dir",
    $BinDir,
    "--manifest",
    $ManifestPath,
    "--server-name",
    $ServerName
  )

  $adapter = Invoke-NodeJsonScriptAdapter `
    -RepoRoot $RepoRoot `
    -ScriptRelativePath "scripts\doctor-default-access.mjs" `
    -ScriptArguments $arguments

  return [pscustomobject]@{
    command = $adapter.command
    report  = $adapter.payload
  }
}

function Invoke-DefaultAccessPlanAdapter {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)]
    [string]$RepoRoot,

    [Parameter(Mandatory = $true)]
    [string]$ConfigPath,

    [Parameter(Mandatory = $true)]
    [string]$BinDir,

    [Parameter(Mandatory = $true)]
    [string]$ManifestPath,

    [Parameter(Mandatory = $true)]
    [string]$ServerName
  )

  $scriptRelativePath = "scripts\install-default-access.mjs"
  $dryRunArguments = @(
    "--dry-run",
    "--repo-root",
    $RepoRoot,
    "--config",
    $ConfigPath,
    "--bin-dir",
    $BinDir,
    "--manifest",
    $ManifestPath,
    "--server-name",
    $ServerName
  )

  $adapter = Invoke-NodeJsonScriptAdapter `
    -RepoRoot $RepoRoot `
    -ScriptRelativePath $scriptRelativePath `
    -ScriptArguments $dryRunArguments

  $scriptPath = Join-Path $RepoRoot $scriptRelativePath
  $applyArguments = @(
    $scriptPath,
    "--repo-root",
    $RepoRoot,
    "--config",
    $ConfigPath,
    "--bin-dir",
    $BinDir,
    "--manifest",
    $ManifestPath,
    "--server-name",
    $ServerName
  )

  return [pscustomobject]@{
    command = $adapter.command
    applyCommand = [pscustomobject]@{
      command = $adapter.command.command
      args = $applyArguments
    }
    plan = $adapter.payload
  }
}

function Invoke-DefaultAccessApplyAdapter {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)]
    [string]$RepoRoot,

    [Parameter(Mandatory = $true)]
    [string]$ConfigPath,

    [Parameter(Mandatory = $true)]
    [string]$BinDir,

    [Parameter(Mandatory = $true)]
    [string]$ManifestPath,

    [Parameter(Mandatory = $true)]
    [string]$ServerName
  )

  $arguments = @(
    "--repo-root",
    $RepoRoot,
    "--config",
    $ConfigPath,
    "--bin-dir",
    $BinDir,
    "--manifest",
    $ManifestPath,
    "--server-name",
    $ServerName
  )

  $adapter = Invoke-NodeJsonScriptAdapter `
    -RepoRoot $RepoRoot `
    -ScriptRelativePath "scripts\install-default-access.mjs" `
    -ScriptArguments $arguments

  return [pscustomobject]@{
    command = $adapter.command
    report = $adapter.payload
  }
}
