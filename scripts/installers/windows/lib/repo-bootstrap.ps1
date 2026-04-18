Set-StrictMode -Version Latest

. (Join-Path $PSScriptRoot "adapters\process-capture.ps1")
. (Join-Path $PSScriptRoot "adapters\package-scripts.ps1")

function Get-InstallerRepoWorkspaceRequiredOutputs {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)]
    [string]$RepoRoot
  )

  return @(
    [pscustomobject]@{
      relativePath = "apps/mimir-api/dist/main.js"
      path = Join-Path $RepoRoot "apps/mimir-api/dist/main.js"
    },
    [pscustomobject]@{
      relativePath = "apps/mimir-cli/dist/main.js"
      path = Join-Path $RepoRoot "apps/mimir-cli/dist/main.js"
    },
    [pscustomobject]@{
      relativePath = "apps/mimir-mcp/dist/main.js"
      path = Join-Path $RepoRoot "apps/mimir-mcp/dist/main.js"
    }
  )
}

function Invoke-InstallerRepoWorkspacePrepare {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)]
    [string]$RepoRoot
  )

  $packageJsonPath = Join-Path $RepoRoot "package.json"
  $workspacePath = Join-Path $RepoRoot "pnpm-workspace.yaml"
  $lockfilePath = Join-Path $RepoRoot "pnpm-lock.yaml"
  $commands = @()
  $blockedReasons = @()

  if (-not (Test-Path $packageJsonPath)) {
    $blockedReasons += "Repo root is missing package.json."
  }
  if (-not (Test-Path $workspacePath)) {
    $blockedReasons += "Repo root is missing pnpm-workspace.yaml."
  }
  if (-not (Test-Path $lockfilePath)) {
    $blockedReasons += "Repo root is missing pnpm-lock.yaml."
  }

  $packageJson = $null
  if ($blockedReasons.Count -eq 0) {
    $packageJson = Get-Content -Raw -Path $packageJsonPath | ConvertFrom-Json
    if ($packageJson.name -ne "@mimir/workspace") {
      $blockedReasons += "Repo root does not look like the tracked @mimir/workspace checkout."
    }
  }

  if ($blockedReasons.Count -gt 0) {
    return [pscustomobject]@{
      commands = @()
      report = [pscustomobject]@{
        status = "user_action_required"
        reasonCode = "repo_workspace_invalid"
        repoRoot = $RepoRoot
        packageManager = if ($null -ne $packageJson) { $packageJson.packageManager } else { $null }
        nodeRequirement = if ($null -ne $packageJson -and $null -ne $packageJson.engines) { $packageJson.engines.node } else { $null }
        gitTopLevel = $null
        isDirty = $null
        installAttempted = $false
        buildAttempted = $false
        outputsVerified = $false
        verifiedOutputs = @()
        blockedReasons = @($blockedReasons)
        nextActions = @(
          "Point RepoRoot at a valid mimir checkout with package.json, pnpm-workspace.yaml, and pnpm-lock.yaml."
        )
      }
    }
  }

  $gitTopLevelResult = Invoke-ProcessCaptureAdapter `
    -ExecutableName "git" `
    -Arguments @("rev-parse", "--show-toplevel") `
    -WorkingDirectory $RepoRoot
  $commands += $gitTopLevelResult.command

  $gitTopLevel = $gitTopLevelResult.stdout.Trim()
  if ([System.IO.Path]::GetFullPath($gitTopLevel) -ne [System.IO.Path]::GetFullPath($RepoRoot)) {
    $blockedReasons += "RepoRoot does not match the resolved git toplevel."
  }

  $gitStatusResult = Invoke-ProcessCaptureAdapter `
    -ExecutableName "git" `
    -Arguments @("status", "--porcelain") `
    -WorkingDirectory $RepoRoot
  $commands += $gitStatusResult.command
  $isDirty = $gitStatusResult.stdout.Trim().Length -gt 0

  if ($isDirty) {
    $blockedReasons += "Installer-managed repo preparation currently requires a clean git worktree."
  }

  if ($blockedReasons.Count -gt 0) {
    return [pscustomobject]@{
      commands = @($commands)
      report = [pscustomobject]@{
        status = "user_action_required"
        reasonCode = if ($isDirty) { "repo_workspace_dirty" } else { "repo_workspace_invalid" }
        repoRoot = $RepoRoot
        packageManager = $packageJson.packageManager
        nodeRequirement = if ($null -ne $packageJson.engines) { $packageJson.engines.node } else { $null }
        gitTopLevel = $gitTopLevel
        isDirty = $isDirty
        installAttempted = $false
        buildAttempted = $false
        outputsVerified = $false
        verifiedOutputs = @()
        blockedReasons = @($blockedReasons)
        nextActions = if ($isDirty) {
          @("Use a clean or committed repo before running installer-managed prepare.")
        } else {
          @("Repair the repo path or checkout before running installer-managed prepare.")
        }
      }
    }
  }

  $installResult = Invoke-InstallerCorepackPnpmCommand `
    -RepoRoot $RepoRoot `
    -PnpmArguments @("install", "--frozen-lockfile")
  $commands += $installResult.command

  $buildResult = Invoke-InstallerCorepackPnpmCommand `
    -RepoRoot $RepoRoot `
    -PnpmArguments @("build")
  $commands += $buildResult.command

  $verifiedOutputs = @(
    foreach ($output in Get-InstallerRepoWorkspaceRequiredOutputs -RepoRoot $RepoRoot) {
      [pscustomobject]@{
        relativePath = $output.relativePath
        path = $output.path
        exists = (Test-Path $output.path)
      }
    }
  )
  $outputsVerified = @($verifiedOutputs | Where-Object { -not $_.exists }).Count -eq 0

  return [pscustomobject]@{
    commands = @($commands)
    report = [pscustomobject]@{
      status = if ($outputsVerified) { "success" } else { "retryable_failure" }
      reasonCode = if ($outputsVerified) { "repo_workspace_prepared" } else { "repo_workspace_outputs_missing" }
      repoRoot = $RepoRoot
      packageManager = $packageJson.packageManager
      nodeRequirement = if ($null -ne $packageJson.engines) { $packageJson.engines.node } else { $null }
      gitTopLevel = $gitTopLevel
      isDirty = $false
      installAttempted = $true
      buildAttempted = $true
      outputsVerified = $outputsVerified
      verifiedOutputs = @($verifiedOutputs)
      blockedReasons = @()
      nextActions = if ($outputsVerified) {
        @(
          "Continue with client access setup or toolbox preparation."
        )
      } else {
        @(
          "Inspect the build output and confirm the required dist entrypoints were produced."
        )
      }
    }
  }
}
