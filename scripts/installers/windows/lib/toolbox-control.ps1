Set-StrictMode -Version Latest

. (Join-Path $PSScriptRoot "adapters\package-scripts.ps1")
. (Join-Path $PSScriptRoot "client-access.ps1")

$InstallerToolboxRequiredEnvironmentFields = @(
  "MAB_TOOLBOX_ACTIVE_PROFILE",
  "MAB_TOOLBOX_CLIENT_ID",
  "MAB_TOOLBOX_SESSION_MODE"
)
$InstallerToolboxOptionalEnvironmentFields = @(
  "MAB_TOOLBOX_SESSION_POLICY_TOKEN"
)

function Resolve-InstallerToolboxJsonPayloadText {
  [CmdletBinding()]
  param(
    [AllowNull()]
    [string]$RawText
  )

  if ([string]::IsNullOrWhiteSpace($RawText)) {
    return $RawText
  }

  $trimmed = $RawText.Trim()
  if ($trimmed.StartsWith("{") -or $trimmed.StartsWith("[")) {
    return $trimmed
  }

  $lines = $trimmed -split "\r?\n"
  for ($index = 0; $index -lt $lines.Length; $index += 1) {
    $candidate = $lines[$index].TrimStart()
    if ($candidate.StartsWith("{") -or $candidate.StartsWith("[")) {
      return (($lines[$index..($lines.Length - 1)]) -join [Environment]::NewLine).Trim()
    }
  }

  return $trimmed
}

function Invoke-InstallerToolboxCliJsonCommand {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)]
    [string]$RepoRoot,

    [Parameter(Mandatory = $true)]
    [string]$CommandName,

    [AllowNull()]
    [object]$Payload = $null
  )

  $pnpmArguments = @("cli", "--", $CommandName)
  $payloadPath = $null

  if ($null -ne $Payload) {
    $payloadJson = $Payload | ConvertTo-Json -Depth 100 -Compress
    $payloadPath = Join-Path ([System.IO.Path]::GetTempPath()) ("mimir-installer-toolbox-" + [System.Guid]::NewGuid().ToString() + ".json")
    [System.IO.File]::WriteAllText($payloadPath, $payloadJson, [System.Text.UTF8Encoding]::new($false))
    $pnpmArguments += @("--input", $payloadPath)
  }

  try {
    $result = Invoke-InstallerCorepackPnpmCommand `
      -RepoRoot $RepoRoot `
      -PnpmArguments $pnpmArguments

    $payloadText = Resolve-InstallerToolboxJsonPayloadText -RawText $result.stdout
    try {
      $payloadObject = $payloadText | ConvertFrom-Json
    } catch {
      throw "Installer toolbox control command '$CommandName' did not return valid JSON. $($result.stdout)".Trim()
    }
  } finally {
    if ($payloadPath -and (Test-Path $payloadPath)) {
      Remove-Item -LiteralPath $payloadPath -Force -ErrorAction SilentlyContinue
    }
  }

  return [pscustomobject]@{
    command = $result.command
    payload = $payloadObject
  }
}

function Invoke-InstallerToolboxControlSurfaceAudit {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)]
    [string]$RepoRoot,

    [Parameter(Mandatory = $true)]
    [string]$ClientName
  )

  $catalog = Invoke-InstallerToolboxCliJsonCommand `
    -RepoRoot $RepoRoot `
    -CommandName "list-toolboxes" `
    -Payload @{}

  $toolboxes = @($catalog.payload.toolboxes)
  if ($toolboxes.Count -eq 0) {
    return [pscustomobject]@{
      commands = @($catalog.command)
      report = [pscustomobject]@{
        status = "user_action_required"
        reasonCode = "toolbox_control_surface_empty"
        clientId = $ClientName
        toolboxCount = 0
        approvalRequiredToolboxCount = 0
        toolboxIds = @()
        describedToolboxId = $null
        describedToolbox = $null
      }
    }
  }

  $describedToolboxId = $toolboxes[0].id
  $description = Invoke-InstallerToolboxCliJsonCommand `
    -RepoRoot $RepoRoot `
    -CommandName "describe-toolbox" `
    -Payload @{ toolboxId = $describedToolboxId }

  $describedToolbox = $description.payload.toolbox

  return [pscustomobject]@{
    commands = @($catalog.command, $description.command)
    report = [pscustomobject]@{
      status = "success"
      reasonCode = "toolbox_control_surface_audited"
      clientId = $ClientName
      toolboxCount = $toolboxes.Count
      approvalRequiredToolboxCount = @($toolboxes | Where-Object { $_.requiresApproval }).Count
      toolboxIds = @($toolboxes | ForEach-Object { $_.id })
      toolboxes = @($toolboxes)
      describedToolboxId = $describedToolboxId
      describedToolbox = [pscustomobject]@{
        id = $describedToolbox.id
        displayName = $describedToolbox.displayName
        summary = $describedToolbox.summary
        exampleTasks = @($describedToolbox.exampleTasks)
        workflow = $describedToolbox.workflow
        profile = $describedToolbox.profile
        toolCount = @($describedToolbox.tools).Count
        antiUseCaseCount = @($describedToolbox.antiUseCases).Count
      }
    }
  }
}

function Invoke-InstallerActiveToolboxSessionAudit {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)]
    [string]$RepoRoot
  )

  $activeToolbox = Invoke-InstallerToolboxCliJsonCommand `
    -RepoRoot $RepoRoot `
    -CommandName "list-active-toolbox" `
    -Payload @{}
  $activeTools = Invoke-InstallerToolboxCliJsonCommand `
    -RepoRoot $RepoRoot `
    -CommandName "list-active-tools" `
    -Payload @{}

  return [pscustomobject]@{
    commands = @($activeToolbox.command, $activeTools.command)
    report = [pscustomobject]@{
      status = "success"
      reasonCode = "toolbox_active_session_audited"
      workflow = $activeToolbox.payload.workflow
      profile = $activeToolbox.payload.profile
      client = $activeToolbox.payload.client
      declaredToolCount = @($activeTools.payload.declaredTools).Count
      activeToolCount = @($activeTools.payload.activeTools).Count
      suppressedToolCount = @($activeTools.payload.suppressedTools).Count
      declaredTools = @($activeTools.payload.declaredTools)
      activeTools = @($activeTools.payload.activeTools)
      suppressedTools = @($activeTools.payload.suppressedTools)
    }
  }
}

function Invoke-InstallerToolboxClientHandoffAudit {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)]
    [string]$ClientName,

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

  $accessAudit = Invoke-InstallerClientAccessAudit `
    -ClientName $ClientName `
    -RepoRoot $RepoRoot `
    -ConfigPath $ConfigPath `
    -BinDir $BinDir `
    -ManifestPath $ManifestPath `
    -ServerName $ServerName
  $activeSession = Invoke-InstallerToolboxCliJsonCommand `
    -RepoRoot $RepoRoot `
    -CommandName "list-active-toolbox" `
    -Payload @{}

  $runtimeClient = $activeSession.payload.client
  $clientMatchesRuntime = $runtimeClient.id -eq $ClientName
  $accessConfigured = [bool]$accessAudit.clientAccess.configured
  $handoffStrategyDetected = -not [string]::IsNullOrWhiteSpace($runtimeClient.handoffStrategy)
  $handoffPresetRequired = $runtimeClient.handoffStrategy -eq "manual-env-reconnect"
  $handoffPresetAvailable = -not $handoffPresetRequired -or -not [string]::IsNullOrWhiteSpace($runtimeClient.handoffPresetRef)

  $ready = $accessConfigured -and $clientMatchesRuntime -and $handoffStrategyDetected -and $handoffPresetAvailable
  $nextActions = @()
  if (-not $accessConfigured) {
    $nextActions += "Run apply-client-access before relying on toolbox reconnect handoff."
  }
  if (-not $clientMatchesRuntime) {
    $nextActions += "Align the selected installer client with the active toolbox runtime client before using reconnect handoff."
  }
  if (-not $handoffStrategyDetected) {
    $nextActions += "Add handoffStrategy metadata for the selected client in docker/mcp/clients."
  }
  if (-not $handoffPresetAvailable) {
    $nextActions += "Add a handoffPresetRef for manual reconnect clients before relying on installer-guided toolbox handoff."
  }

  return [pscustomobject]@{
    commands = @($accessAudit.command, $activeSession.command)
    report = [pscustomobject]@{
      status = if ($ready) { "success" } else { "user_action_required" }
      reasonCode = if ($ready) { "toolbox_client_handoff_ready" } else { "toolbox_client_handoff_follow_up" }
      clientAccess = $accessAudit.clientAccess
      runtimeClient = $runtimeClient
      workflow = $activeSession.payload.workflow
      profile = $activeSession.payload.profile
      handoffContract = [pscustomobject]@{
        mode = "reconnect"
        requiredEnvironmentFields = @($InstallerToolboxRequiredEnvironmentFields)
        optionalEnvironmentFields = @($InstallerToolboxOptionalEnvironmentFields)
        clearEnvironmentFields = @($InstallerToolboxOptionalEnvironmentFields)
        sessionPolicyTokenEnvVar = "MAB_TOOLBOX_SESSION_POLICY_TOKEN"
      }
      readiness = [pscustomobject]@{
        accessConfigured = $accessConfigured
        clientMatchesRuntime = $clientMatchesRuntime
        handoffStrategyDetected = $handoffStrategyDetected
        handoffPresetRequired = $handoffPresetRequired
        handoffPresetAvailable = $handoffPresetAvailable
      }
      nextActions = @($nextActions)
    }
  }
}

function Invoke-InstallerToolboxRolloutReadinessAudit {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)]
    [string]$ClientName,

    [Parameter(Mandatory = $true)]
    [string]$RepoRoot,

    [Parameter(Mandatory = $true)]
    [string]$ConfigPath,

    [Parameter(Mandatory = $true)]
    [string]$BinDir,

    [Parameter(Mandatory = $true)]
    [string]$ManifestPath,

    [Parameter(Mandatory = $true)]
    [string]$ServerName,

    [Parameter(Mandatory = $true)]
    [string]$ToolboxManifestDir
  )

  $controlSurface = Invoke-InstallerToolboxControlSurfaceAudit `
    -RepoRoot $RepoRoot `
    -ClientName $ClientName
  $activeSession = Invoke-InstallerActiveToolboxSessionAudit -RepoRoot $RepoRoot
  $clientHandoff = Invoke-InstallerToolboxClientHandoffAudit `
    -ClientName $ClientName `
    -RepoRoot $RepoRoot `
    -ConfigPath $ConfigPath `
    -BinDir $BinDir `
    -ManifestPath $ManifestPath `
    -ServerName $ServerName
  $applyPlan = Invoke-InstallerDockerMcpToolkitApplyPlan `
    -RepoRoot $RepoRoot `
    -ToolboxManifestDir $ToolboxManifestDir

  $toolkit = $applyPlan.report.toolkit
  $blockedAreas = @()
  if ($controlSurface.report.status -ne "success") {
    $blockedAreas += "toolbox_control_surface"
  }
  if ($clientHandoff.report.status -ne "success") {
    $blockedAreas += "client_handoff"
  }

  $governanceStatus = [string]$toolkit.governanceStatus
  if ($governanceStatus -eq "unavailable") {
    $blockedAreas += "docker_mcp_governance_unavailable"
  } elseif ($governanceStatus -ne "clean") {
    $blockedAreas += "docker_mcp_governance_drift"
  }

  if (-not [bool]$applyPlan.report.compatibleWithCurrentToolkit) {
    $blockedAreas += "docker_mcp_apply_blocked"
  }

  $nextActions = @()
  foreach ($action in @($clientHandoff.report.nextActions)) {
    if (-not [string]::IsNullOrWhiteSpace($action) -and @($nextActions) -notcontains $action) {
      $nextActions += $action
    }
  }
  if ($activeSession.report.workflow.sessionMode -eq "toolbox-bootstrap") {
    $action = "This client is still in bootstrap mode; request toolbox activation through mimir-control outside the installer when broader capabilities are needed."
    if (@($nextActions) -notcontains $action) {
      $nextActions += $action
    }
  }
  if ($governanceStatus -eq "drift_detected") {
    $action = "Align enabled Docker MCP servers with the repo-governed toolbox runtime before relying on rollout readiness."
    if (@($nextActions) -notcontains $action) {
      $nextActions += $action
    }
  } elseif ($governanceStatus -eq "unavailable") {
    $action = "Fix Docker MCP governance drift evaluation before relying on rollout readiness."
    if (@($nextActions) -notcontains $action) {
      $nextActions += $action
    }
  }
  if (-not [bool]$applyPlan.report.compatibleWithCurrentToolkit) {
    $action = "Upgrade or adapt the Docker MCP Toolkit contract before attempting toolbox runtime apply."
    if (@($nextActions) -notcontains $action) {
      $nextActions += $action
    }
  }
  foreach ($blockedReason in @($applyPlan.report.blockedReasons)) {
    if (-not [string]::IsNullOrWhiteSpace($blockedReason) -and @($nextActions) -notcontains $blockedReason) {
      $nextActions += $blockedReason
    }
  }

  $ready = $blockedAreas.Count -eq 0

  return [pscustomobject]@{
    commands = @($controlSurface.commands) + @($activeSession.commands) + @($clientHandoff.commands) + @($applyPlan.commands)
    report = [pscustomobject]@{
      status = if ($ready) { "success" } else { "user_action_required" }
      reasonCode = if ($ready) { "toolbox_rollout_ready" } else { "toolbox_rollout_follow_up" }
      clientId = $ClientName
      summary = [pscustomobject]@{
        controlSurfaceReady = ($controlSurface.report.status -eq "success")
        activeSessionAudited = ($activeSession.report.status -eq "success")
        sessionMode = $activeSession.report.workflow.sessionMode
        bootstrapSession = ($activeSession.report.workflow.sessionMode -eq "toolbox-bootstrap")
        clientHandoffReady = ($clientHandoff.report.status -eq "success")
        runtimeClientMatchesSelectedClient = [bool]$clientHandoff.report.readiness.clientMatchesRuntime
        dockerGovernanceStatus = $governanceStatus
        dockerGovernanceClean = ($governanceStatus -eq "clean")
        dockerApplyCompatible = [bool]$applyPlan.report.compatibleWithCurrentToolkit
        blockedAreas = @($blockedAreas)
      }
      toolboxControlSurface = $controlSurface.report
      activeToolboxSession = $activeSession.report
      toolboxClientHandoff = $clientHandoff.report
      dockerMcpToolkit = $toolkit
      dockerMcpToolkitApplyPlan = $applyPlan.report
      nextActions = @($nextActions)
    }
  }
}
