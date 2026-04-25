[CmdletBinding()]
param(
  [ValidateSet("audit-install-surface", "show-state", "detect-environment", "plan-client-access", "apply-client-access", "audit-toolbox-assets", "prepare-toolbox-runtime", "audit-docker-mcp-toolkit", "plan-docker-mcp-toolkit-apply", "prepare-repo-workspace", "audit-toolbox-control-surface", "audit-active-toolbox-session", "audit-toolbox-client-handoff")]
  [string]$Operation = "audit-install-surface",

  [string]$RepoRoot = "",
  [string]$StateRoot = "",
  [string]$ClientName = "codex",
  [string]$ConfigPath = "",
  [string]$WorkspacePath = "",
  [string]$BinDir = "",
  [string]$ManifestPath = "",
  [string]$ToolboxManifestDir = "",
  [string]$ToolboxRuntimePlanPath = "",
  [string]$ServerName = "mimir",
  [switch]$Json
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "lib\result-envelope.ps1")
. (Join-Path $PSScriptRoot "lib\state-store.ps1")
. (Join-Path $PSScriptRoot "lib\environment-detection.ps1")
. (Join-Path $PSScriptRoot "lib\write-plan.ps1")
. (Join-Path $PSScriptRoot "lib\client-access.ps1")
. (Join-Path $PSScriptRoot "lib\toolbox-assets.ps1")
. (Join-Path $PSScriptRoot "lib\toolbox-control.ps1")
. (Join-Path $PSScriptRoot "lib\docker-mcp-toolkit.ps1")
. (Join-Path $PSScriptRoot "lib\repo-bootstrap.ps1")
. (Join-Path $PSScriptRoot "lib\adapters\default-access.ps1")

if (-not $RepoRoot) {
  $RepoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\..\.."))
}
if (-not $StateRoot) {
  $StateRoot = Get-DefaultInstallerStateRoot
}
$client = Get-InstallerClientDefinition -ClientName $ClientName
if (-not $ConfigPath) {
  $ConfigPath = $client.defaultConfigPath
}
if (-not $BinDir) {
  if ($env:APPDATA -and $env:APPDATA.Trim().Length -gt 0) {
    $BinDir = Join-Path $env:APPDATA "npm"
  } else {
    $BinDir = Join-Path $HOME "AppData\Roaming\npm"
  }
}
if (-not $ManifestPath) {
  $ManifestPath = Join-Path $HOME ".mimir\installation.json"
}
if (-not $ToolboxManifestDir) {
  $ToolboxManifestDir = Join-Path $RepoRoot "docker\mcp"
}
if (-not $ToolboxRuntimePlanPath) {
  $ToolboxRuntimePlanPath = Join-Path $StateRoot "toolbox-runtime-plan.json"
}
if (-not $ServerName) {
  $ServerName = $client.defaultServerName
}

$RepoRoot = [System.IO.Path]::GetFullPath($RepoRoot)
$StateRoot = [System.IO.Path]::GetFullPath($StateRoot)
$ConfigPath = [System.IO.Path]::GetFullPath($ConfigPath)
$WorkspacePath = if ($WorkspacePath) {
  [System.IO.Path]::GetFullPath($WorkspacePath)
} else {
  $RepoRoot
}
$BinDir = [System.IO.Path]::GetFullPath($BinDir)
$ManifestPath = [System.IO.Path]::GetFullPath($ManifestPath)
$ToolboxManifestDir = [System.IO.Path]::GetFullPath($ToolboxManifestDir)
$ToolboxRuntimePlanPath = [System.IO.Path]::GetFullPath($ToolboxRuntimePlanPath)

switch ($Operation) {
  "detect-environment" {
    $report = Get-InstallerEnvironmentReport
    $envelope = New-InstallerResultEnvelope `
      -OperationId $Operation `
      -Mode "audit_only" `
      -RepoRoot $RepoRoot `
      -StateRoot $StateRoot `
      -Status "success" `
      -ReasonCode "environment_detected" `
      -Message "Installer environment capabilities were detected." `
      -Details $report `
      -CommandsRun @() `
      -NextActions @()

    $envelope = Write-InstallerOperationState -StateRoot $StateRoot -Envelope $envelope
  }

  "audit-install-surface" {
    $adapter = Invoke-InstallerClientAccessAudit `
      -ClientName $ClientName `
      -RepoRoot $RepoRoot `
      -ConfigPath $ConfigPath `
      -BinDir $BinDir `
      -ManifestPath $ManifestPath `
      -WorkspacePath $WorkspacePath `
      -ServerName $ServerName

    $report = $adapter.report
    $status = if ($report.status -eq "healthy") { "success" } else { "user_action_required" }
    $reasonCode = switch ($report.status) {
      "healthy" { "install_surface_healthy" }
      "unavailable" { "install_surface_unavailable" }
      default { "install_surface_degraded" }
    }
    $message = switch ($report.status) {
      "healthy" { "Installer-facing access surfaces are configured." }
      "unavailable" { "Installer-facing access surfaces are not configured yet." }
      default { "Installer-facing access surfaces are present but need follow-up actions." }
    }

    $envelope = New-InstallerResultEnvelope `
      -OperationId $Operation `
      -Mode "audit_only" `
      -RepoRoot $RepoRoot `
      -StateRoot $StateRoot `
      -Status $status `
      -ReasonCode $reasonCode `
      -Message $message `
      -Details ([pscustomobject]@{
          clientAccess = $adapter.clientAccess
          defaultAccess = [pscustomobject]@{
            report = $report
          }
        }) `
      -CommandsRun @($adapter.command) `
      -NextActions @($report.recommendations)

    $envelope = Write-InstallerOperationState -StateRoot $StateRoot -Envelope $envelope
  }

  "plan-client-access" {
    $adapter = Invoke-InstallerClientAccessPlan `
      -ClientName $ClientName `
      -RepoRoot $RepoRoot `
      -ConfigPath $ConfigPath `
      -BinDir $BinDir `
      -ManifestPath $ManifestPath `
      -WorkspacePath $WorkspacePath `
      -ServerName $ServerName

    $envelope = New-InstallerResultEnvelope `
      -OperationId $Operation `
      -Mode "plan_only" `
      -RepoRoot $RepoRoot `
      -StateRoot $StateRoot `
      -Status "success" `
      -ReasonCode "client_access_plan_ready" `
      -Message "Client access write plan is ready." `
      -Details ([pscustomobject]@{
          clientAccess = $adapter.clientAccess
          writePlan = $adapter.writePlan
        }) `
      -CommandsRun @($adapter.command) `
      -NextActions @(
        "Review the write targets and backup strategy, then run install-default-access.mjs without --dry-run to apply the plan."
      )

    $envelope = Write-InstallerOperationState -StateRoot $StateRoot -Envelope $envelope
  }

  "apply-client-access" {
    $adapter = Invoke-InstallerClientAccessApply `
      -ClientName $ClientName `
      -RepoRoot $RepoRoot `
      -ConfigPath $ConfigPath `
      -BinDir $BinDir `
      -ManifestPath $ManifestPath `
      -ServerName $ServerName

    $report = $adapter.report
    $status = if ($report.status -eq "healthy") { "success" } else { "user_action_required" }
    $reasonCode = if ($report.status -eq "healthy") { "client_access_applied" } else { "client_access_applied_with_follow_up" }
    $message = if ($report.status -eq "healthy") {
      "Client access surfaces were applied successfully."
    } else {
      "Client access helper ran, but the resulting access surfaces still need follow-up actions."
    }

    $envelope = New-InstallerResultEnvelope `
      -OperationId $Operation `
      -Mode "apply" `
      -RepoRoot $RepoRoot `
      -StateRoot $StateRoot `
      -Status $status `
      -ReasonCode $reasonCode `
      -Message $message `
      -Details ([pscustomobject]@{
          clientAccess = $adapter.clientAccess
          defaultAccess = [pscustomobject]@{
            report = $report
          }
          applyResult = $adapter.applyResult
        }) `
      -BackupsCreated @($adapter.backupsCreated) `
      -CommandsRun @($adapter.commands) `
      -NextActions @($report.recommendations)

    $envelope = Write-InstallerOperationState -StateRoot $StateRoot -Envelope $envelope
  }

  "audit-toolbox-assets" {
    $adapter = Invoke-InstallerToolboxAssetAudit `
      -RepoRoot $RepoRoot `
      -ToolboxManifestDir $ToolboxManifestDir

    $report = $adapter.report
    $status = if ($report.status -eq "valid") { "success" } else { "user_action_required" }
    $reasonCode = if ($report.status -eq "valid") { "toolbox_assets_valid" } else { "toolbox_assets_invalid" }
    $message = if ($report.status -eq "valid") {
      "Docker toolbox manifests compiled into a valid runtime plan."
    } else {
      "Docker toolbox manifest audit found invalid or incomplete assets."
    }
    $nextActions = if ($report.status -eq "valid") {
      @(
        "Use scripts\\docker\\sync-mcp-profiles.mjs to inspect or prepare Docker runtime state from this manifest revision."
      )
    } else {
      @(
        "Run corepack pnpm build if the toolbox compiler dist output is missing, then fix the reported docker/mcp manifest errors and rerun audit-toolbox-assets."
      )
    }

    $envelope = New-InstallerResultEnvelope `
      -OperationId $Operation `
      -Mode "audit_only" `
      -RepoRoot $RepoRoot `
      -StateRoot $StateRoot `
      -Status $status `
      -ReasonCode $reasonCode `
      -Message $message `
      -Details ([pscustomobject]@{
          toolboxAssets = $report
        }) `
      -CommandsRun @($adapter.command) `
      -NextActions $nextActions

    $envelope = Write-InstallerOperationState -StateRoot $StateRoot -Envelope $envelope
  }

  "prepare-toolbox-runtime" {
    $adapter = Invoke-InstallerToolboxRuntimePrepare `
      -RepoRoot $RepoRoot `
      -ToolboxManifestDir $ToolboxManifestDir

    $planJson = ConvertTo-InstallerJson -InputObject $adapter.plan
    Write-Utf8NoBomFile -Path $ToolboxRuntimePlanPath -Content $planJson

    $envelope = New-InstallerResultEnvelope `
      -OperationId $Operation `
      -Mode "plan_only" `
      -RepoRoot $RepoRoot `
      -StateRoot $StateRoot `
      -Status "success" `
      -ReasonCode "toolbox_runtime_prepared" `
      -Message "A compiled toolbox runtime plan was written for later Docker apply work." `
      -Details ([pscustomobject]@{
          toolboxRuntime = [pscustomobject]@{
            manifestDir = $ToolboxManifestDir
            outputPath = $ToolboxRuntimePlanPath
            manifestRevision = $adapter.plan.manifestRevision
            generatedAt = $adapter.plan.generatedAt
            profileCount = @($adapter.plan.profiles).Count
            serverCount = @($adapter.plan.servers).Count
            serverIds = @($adapter.plan.servers | ForEach-Object { $_.id })
            profileIds = @($adapter.plan.profiles | ForEach-Object { $_.id })
            dryRun = $true
            dockerApplyImplemented = $false
          }
        }) `
      -ArtifactsWritten @($ToolboxRuntimePlanPath) `
      -CommandsRun @($adapter.command) `
      -NextActions @(
        "Review the prepared toolbox-runtime-plan.json artifact before introducing Docker Desktop profile apply behavior.",
        "Keep Docker apply separate from this prepare step until the repo has a deterministic Docker mutation contract."
      )

    $envelope = Write-InstallerOperationState -StateRoot $StateRoot -Envelope $envelope
  }

  "audit-docker-mcp-toolkit" {
    $adapter = Invoke-InstallerDockerMcpToolkitAudit `
      -RepoRoot $RepoRoot `
      -ToolboxManifestDir $ToolboxManifestDir

    $nextActions = @()
    if ($adapter.report.connectedClientCount -eq 0) {
      $nextActions += "Use docker mcp client connect <client> after the toolbox runtime plan is ready for the target client."
    }
    if ($adapter.report.enabledServerCount -eq 0) {
      $nextActions += "Enable or package the intended Docker MCP servers before relying on Docker Toolkit as a toolbox runtime surface."
    }

    $envelope = New-InstallerResultEnvelope `
      -OperationId $Operation `
      -Mode "audit_only" `
      -RepoRoot $RepoRoot `
      -StateRoot $StateRoot `
      -Status "success" `
      -ReasonCode "docker_mcp_toolkit_audited" `
      -Message "Docker MCP Toolkit state was read successfully." `
      -Details ([pscustomobject]@{
          dockerMcpToolkit = $adapter.report
        }) `
      -CommandsRun @($adapter.commands) `
      -NextActions $nextActions

    $envelope = Write-InstallerOperationState -StateRoot $StateRoot -Envelope $envelope
  }

  "audit-toolbox-control-surface" {
    $adapter = Invoke-InstallerToolboxControlSurfaceAudit `
      -RepoRoot $RepoRoot `
      -ClientName $ClientName
    $report = $adapter.report

    $message = if ($report.status -eq "success") {
      "Toolbox discovery surfaces are available through the real CLI control path."
    } else {
      "Toolbox discovery surfaces returned no available toolboxes."
    }
    $nextActions = if ($report.status -eq "success") {
      @(
        "Use audit-active-toolbox-session to inspect the current bootstrap or activated session shape.",
        "Keep request-toolbox-activation outside the installer; this backend only audits control-surface readiness."
      )
    } else {
      @(
        "Check docker/mcp intent manifests and rebuild the repo before relying on toolbox discovery through the installer."
      )
    }

    $envelope = New-InstallerResultEnvelope `
      -OperationId $Operation `
      -Mode "audit_only" `
      -RepoRoot $RepoRoot `
      -StateRoot $StateRoot `
      -Status $report.status `
      -ReasonCode $report.reasonCode `
      -Message $message `
      -Details ([pscustomobject]@{
          toolboxControlSurface = $report
        }) `
      -CommandsRun @($adapter.commands) `
      -NextActions $nextActions

    $envelope = Write-InstallerOperationState -StateRoot $StateRoot -Envelope $envelope
  }

  "audit-active-toolbox-session" {
    $adapter = Invoke-InstallerActiveToolboxSessionAudit -RepoRoot $RepoRoot
    $report = $adapter.report
    $nextActions = if ($report.workflow.sessionMode -eq "toolbox-bootstrap") {
      @(
        "This client is still in bootstrap mode; request toolbox activation through mimir-control outside the installer when broader capabilities are needed."
      )
    } else {
      @(
        "The current client already reports an activated toolbox profile; verify downgrade and reconnect behavior separately from the installer."
      )
    }

    $envelope = New-InstallerResultEnvelope `
      -OperationId $Operation `
      -Mode "audit_only" `
      -RepoRoot $RepoRoot `
      -StateRoot $StateRoot `
      -Status $report.status `
      -ReasonCode $report.reasonCode `
      -Message "Active toolbox session surfaces were read successfully." `
      -Details ([pscustomobject]@{
          activeToolboxSession = $report
        }) `
      -CommandsRun @($adapter.commands) `
      -NextActions $nextActions

    $envelope = Write-InstallerOperationState -StateRoot $StateRoot -Envelope $envelope
  }

  "audit-toolbox-client-handoff" {
    $adapter = Invoke-InstallerToolboxClientHandoffAudit `
      -ClientName $ClientName `
      -RepoRoot $RepoRoot `
      -ConfigPath $ConfigPath `
      -BinDir $BinDir `
      -ManifestPath $ManifestPath `
      -ServerName $ServerName
    $report = $adapter.report
    $message = if ($report.status -eq "success") {
      "Toolbox reconnect handoff is ready for the selected installer client."
    } else {
      "Toolbox reconnect handoff for the selected installer client still needs follow-up."
    }

    $envelope = New-InstallerResultEnvelope `
      -OperationId $Operation `
      -Mode "audit_only" `
      -RepoRoot $RepoRoot `
      -StateRoot $StateRoot `
      -Status $report.status `
      -ReasonCode $report.reasonCode `
      -Message $message `
      -Details ([pscustomobject]@{
          toolboxClientHandoff = $report
        }) `
      -CommandsRun @($adapter.commands) `
      -NextActions @($report.nextActions)

    $envelope = Write-InstallerOperationState -StateRoot $StateRoot -Envelope $envelope
  }

  "prepare-repo-workspace" {
    $adapter = Invoke-InstallerRepoWorkspacePrepare -RepoRoot $RepoRoot
    $report = $adapter.report
    $message = switch ($report.reasonCode) {
      "repo_workspace_prepared" { "Repo workspace dependencies and build outputs are prepared." }
      "repo_workspace_dirty" { "Repo workspace preparation is blocked because the git worktree is dirty." }
      "repo_workspace_invalid" { "Repo workspace preparation is blocked because the repo root is invalid." }
      "repo_workspace_outputs_missing" { "Repo workspace build ran, but required entrypoints are still missing." }
      default { "Repo workspace preparation completed with follow-up required." }
    }

    $envelope = New-InstallerResultEnvelope `
      -OperationId $Operation `
      -Mode "apply" `
      -RepoRoot $RepoRoot `
      -StateRoot $StateRoot `
      -Status $report.status `
      -ReasonCode $report.reasonCode `
      -Message $message `
      -Details ([pscustomobject]@{
          repoWorkspace = $report
        }) `
      -CommandsRun @($adapter.commands) `
      -NextActions @($report.nextActions)

    $envelope = Write-InstallerOperationState -StateRoot $StateRoot -Envelope $envelope
  }

  "plan-docker-mcp-toolkit-apply" {
    $adapter = Invoke-InstallerDockerMcpToolkitApplyPlan `
      -RepoRoot $RepoRoot `
      -ToolboxManifestDir $ToolboxManifestDir

    $report = $adapter.report
    $message = if ($report.compatibleWithCurrentToolkit) {
      "Docker MCP Toolkit apply plan is ready for reviewed execution."
    } else {
      "Docker MCP Toolkit apply plan is blocked by the current toolkit capability surface."
    }
    $nextActions = if ($report.compatibleWithCurrentToolkit) {
      @(
        "Review the planned Docker MCP profile commands before enabling a real apply operation.",
        "Keep Docker mutation behind a separate reviewed step even when the toolkit is compatible."
      )
    } else {
      @(
        "Upgrade or adapt the Docker MCP Toolkit contract before attempting toolbox runtime apply.",
        "Do not execute the planned Docker commands until the toolkit exposes the required profile surface."
      )
    }

    $envelope = New-InstallerResultEnvelope `
      -OperationId $Operation `
      -Mode "plan_only" `
      -RepoRoot $RepoRoot `
      -StateRoot $StateRoot `
      -Status $report.status `
      -ReasonCode $report.reasonCode `
      -Message $message `
      -Details ([pscustomobject]@{
          dockerMcpToolkitApplyPlan = $report
        }) `
      -CommandsRun @($adapter.commands) `
      -NextActions $nextActions

    $envelope = Write-InstallerOperationState -StateRoot $StateRoot -Envelope $envelope
  }

  "show-state" {
    $state = Read-InstallerState -StateRoot $StateRoot
    if ($null -eq $state.lastReport -or $null -eq $state.sessionState) {
      $envelope = New-InstallerResultEnvelope `
        -OperationId $Operation `
        -Mode "audit_only" `
        -RepoRoot $RepoRoot `
        -StateRoot $StateRoot `
        -Status "user_action_required" `
        -ReasonCode "state_missing" `
        -Message "No installer state has been recorded yet." `
        -Details ([pscustomobject]@{
            lastReport = $state.lastReport
            sessionState = $state.sessionState
          }) `
        -CommandsRun @() `
        -NextActions @("Run audit-install-surface first.")
    } else {
      $envelope = New-InstallerResultEnvelope `
        -OperationId $Operation `
        -Mode "audit_only" `
        -RepoRoot $RepoRoot `
        -StateRoot $StateRoot `
        -Status "success" `
        -ReasonCode "state_loaded" `
        -Message "Installer state loaded." `
        -Details ([pscustomobject]@{
            lastReport = $state.lastReport
            sessionState = $state.sessionState
          }) `
        -CommandsRun @() `
        -NextActions @()
    }

    $envelope = Write-InstallerOperationState -StateRoot $StateRoot -Envelope $envelope
  }
}

$rendered = ConvertTo-InstallerJson -InputObject $envelope
if ($Json) {
  Write-Output $rendered
} else {
  Write-Output $rendered
}
