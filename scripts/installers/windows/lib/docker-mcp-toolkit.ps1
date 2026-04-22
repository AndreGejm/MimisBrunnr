Set-StrictMode -Version Latest

. (Join-Path $PSScriptRoot "adapters\process-capture.ps1")

function Invoke-InstallerDockerMcpToolkitAudit {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)]
    [string]$RepoRoot
  )

  $versionResult = Invoke-ProcessCaptureAdapter `
    -ExecutableName "docker" `
    -Arguments @("mcp", "version") `
    -WorkingDirectory $RepoRoot

  $serversResult = Invoke-ProcessCaptureAdapter `
    -ExecutableName "docker" `
    -Arguments @("mcp", "server", "ls", "--json") `
    -WorkingDirectory $RepoRoot

  $clientsResult = Invoke-ProcessCaptureAdapter `
    -ExecutableName "docker" `
    -Arguments @("mcp", "client", "ls", "--json") `
    -WorkingDirectory $RepoRoot

  $configResult = Invoke-ProcessCaptureAdapter `
    -ExecutableName "docker" `
    -Arguments @("mcp", "config", "read") `
    -WorkingDirectory $RepoRoot

  $featureResult = Invoke-ProcessCaptureAdapter `
    -ExecutableName "docker" `
    -Arguments @("mcp", "feature", "ls") `
    -WorkingDirectory $RepoRoot

  $decodedServers = $serversResult.stdout | ConvertFrom-Json
  $servers = @(
    foreach ($server in $decodedServers) {
      [pscustomobject]@{
        name = $server.name
        description = $server.description
        secrets = $server.secrets
        config = $server.config
        oauth = $server.oauth
      }
    }
  )
  $clientMap = $clientsResult.stdout | ConvertFrom-Json
  $clients = @(
    foreach ($property in $clientMap.PSObject.Properties) {
      $client = $property.Value
      [pscustomobject]@{
        name = $property.Name
        displayName = $client.displayName
        isConfigured = [bool]$client.isConfigured
        dockerMCPCatalogConnected = [bool]$client.dockerMCPCatalogConnected
        profile = $client.profile
        error = $client.error
      }
    }
  )

  return [pscustomobject]@{
    commands = @(
      $versionResult.command,
      $serversResult.command,
      $clientsResult.command,
      $configResult.command,
      $featureResult.command
    )
    report = [pscustomobject]@{
      available = $true
      version = $versionResult.stdout.Trim()
      enabledServerCount = @($servers).Count
      configuredClientCount = @($clients | Where-Object { $_.isConfigured }).Count
      connectedClientCount = @($clients | Where-Object { $_.dockerMCPCatalogConnected }).Count
      servers = @($servers)
      clients = @($clients | Sort-Object name)
      configText = $configResult.stdout
      featureText = $featureResult.stdout
    }
  }
}

function Test-InstallerDockerMcpProfileSupport {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)]
    [string]$RepoRoot
  )

  $probeResult = Invoke-ProcessCaptureAdapter `
    -ExecutableName "docker" `
    -Arguments @("mcp", "profile", "--help") `
    -WorkingDirectory $RepoRoot `
    -IgnoreExitCode

  $probeOutput = $probeResult.stdout.Trim()
  $hasProfileUsage = $probeOutput -match "(?m)^Usage:\s+docker mcp profile(\s|$)"
  $hasProfileCommand = $probeOutput -match "(?m)^\s*profile\s+"

  return [pscustomobject]@{
    command = $probeResult.command
    available = ($probeResult.command.exitCode -eq 0) -and ($hasProfileUsage -or $hasProfileCommand)
    outputText = $probeOutput
  }
}

function Invoke-InstallerDockerMcpToolkitApplyPlan {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)]
    [string]$RepoRoot,

    [Parameter(Mandatory = $true)]
    [string]$ToolboxManifestDir
  )

  $runtimePrepare = Invoke-InstallerToolboxRuntimePrepare `
    -RepoRoot $RepoRoot `
    -ToolboxManifestDir $ToolboxManifestDir

  $toolkitAudit = Invoke-InstallerDockerMcpToolkitAudit -RepoRoot $RepoRoot
  $profileSupport = Test-InstallerDockerMcpProfileSupport -RepoRoot $RepoRoot

  $payload = $runtimePrepare.payload
  $plan = $runtimePrepare.plan
  $apply = if ($payload.PSObject.Properties.Name -contains "apply") { $payload.apply } else { $null }
  $applyCommands = if ($null -ne $apply -and $apply.PSObject.Properties.Name -contains "commands") {
    @($apply.commands)
  } else {
    @()
  }
  $gatewayRunCommands = if ($null -ne $apply -and $apply.PSObject.Properties.Name -contains "gatewayRunCommands") {
    @($apply.gatewayRunCommands)
  } else {
    @()
  }
  $requiresDockerProfile = @(
    $applyCommands | Where-Object {
      $argv = @($_.argv)
      $argv.Count -ge 2 -and $argv[0] -eq "mcp" -and $argv[1] -eq "profile"
    }
  ).Count -gt 0

  $blockedReasons = @()
  if ($applyCommands.Count -eq 0) {
    $blockedReasons += "The compiled toolbox runtime plan did not emit any Docker MCP apply commands."
  }
  if ($requiresDockerProfile -and -not $profileSupport.available) {
    $blockedReasons += "The prepared toolbox runtime apply commands target docker mcp profile create, but this Docker MCP Toolkit exposes no profile subcommand."
  }

  $compatibleWithCurrentToolkit = ($blockedReasons.Count -eq 0)
  $status = if ($compatibleWithCurrentToolkit) { "success" } else { "user_action_required" }
  $reasonCode = if ($compatibleWithCurrentToolkit) {
    "docker_mcp_toolkit_apply_plan_ready"
  } else {
    "docker_mcp_toolkit_apply_plan_blocked"
  }
  $message = if ($compatibleWithCurrentToolkit) {
    "Docker MCP Toolkit apply plan is ready for reviewed execution."
  } else {
    "Docker MCP Toolkit apply plan was prepared, but the current toolkit cannot execute it safely."
  }

  $compactCommands = @(
    foreach ($entry in $applyCommands) {
      [pscustomobject]@{
        description = $entry.description
        profileId = $entry.profileId
        argv = @($entry.argv)
      }
    }
  )
  $compactGatewayRunCommands = @(
    foreach ($entry in $gatewayRunCommands) {
      $omittedServers = if ($entry.PSObject.Properties.Name -contains "omittedServers" -and $null -ne $entry.omittedServers) {
        @($entry.omittedServers)
      } else {
        @()
      }
      [pscustomobject]@{
        description = $entry.description
        profileId = $entry.profileId
        argv = @($entry.argv)
        serverNames = @($entry.serverNames)
        omittedServers = @($omittedServers)
      }
    }
  )

  return [pscustomobject]@{
    commands = @($runtimePrepare.command) + @($toolkitAudit.commands) + @($profileSupport.command)
    report = [pscustomobject]@{
      status = $status
      reasonCode = $reasonCode
      mutationAllowed = $false
      reviewRequired = $true
      manifestDir = $ToolboxManifestDir
      manifestRevision = $plan.manifestRevision
      generatedAt = $plan.generatedAt
      profileCount = @($plan.profiles).Count
      serverCount = @($plan.servers).Count
      applyStatus = if ($null -ne $apply -and $apply.PSObject.Properties.Name -contains "status") { $apply.status } else { "unknown" }
      applyAttempted = if ($null -ne $apply -and $apply.PSObject.Properties.Name -contains "attempted") { [bool]$apply.attempted } else { $false }
      applyCommandCount = $applyCommands.Count
      commands = @($compactCommands)
      fallbackGatewayCommandCount = $gatewayRunCommands.Count
      fallbackGatewayCommands = @($compactGatewayRunCommands)
      dockerProfileSubcommandAvailable = [bool]$profileSupport.available
      compatibleWithCurrentToolkit = [bool]$compatibleWithCurrentToolkit
      blockedReasons = @($blockedReasons)
      toolkit = $toolkitAudit.report
    }
  }
}
