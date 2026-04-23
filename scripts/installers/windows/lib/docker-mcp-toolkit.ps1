Set-StrictMode -Version Latest

. (Join-Path $PSScriptRoot "adapters\process-capture.ps1")

function Invoke-InstallerDockerMcpToolkitAudit {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)]
    [string]$RepoRoot,

    [string]$ToolboxManifestDir = ""
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

  $governanceCommands = @()
  $governanceReport = Get-InstallerDockerMcpGovernanceDriftReport `
    -RepoRoot $RepoRoot `
    -ToolboxManifestDir $ToolboxManifestDir `
    -EnabledServers $servers
  $governanceCommands = @($governanceReport.commands)
  $governance = $governanceReport.report

  return [pscustomobject]@{
    commands = @(
      $versionResult.command,
      $serversResult.command,
      $clientsResult.command,
      $configResult.command,
      $featureResult.command
    ) + @($governanceCommands)
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
      governanceStatus = $governance.governanceStatus
      governanceSummaryCounts = $governance.governanceSummaryCounts
      governedEnabledServers = @($governance.governedEnabledServers)
      unsafeEnabledServers = @($governance.unsafeEnabledServers)
      unmanagedEnabledServers = @($governance.unmanagedEnabledServers)
      governanceUnavailableReason = $governance.governanceUnavailableReason
    }
  }
}

function Get-InstallerDockerMcpGovernanceDriftReport {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)]
    [string]$RepoRoot,

    [string]$ToolboxManifestDir = "",

    [Parameter(Mandatory = $true)]
    [object[]]$EnabledServers
  )

  if (-not $ToolboxManifestDir) {
    $ToolboxManifestDir = Join-Path $RepoRoot "docker\mcp"
  }

  try {
    $runtimePrepare = Invoke-InstallerToolboxRuntimePrepare `
      -RepoRoot $RepoRoot `
      -ToolboxManifestDir $ToolboxManifestDir

    $plan = $runtimePrepare.plan
    $policyServers = @($plan.servers)
    $governedByLiveName = @{}
    $unsafeByLiveName = @{}

    foreach ($server in $policyServers) {
      if ($server.source -eq "owned") {
        $name = [string]$server.dockerServerName
        if ($name) {
          $governedByLiveName[$name] = [pscustomobject]@{
            name = $name
            policyServerId = [string]$server.id
            matchType = "owned-dockerServerName"
          }
        }
      } elseif ($server.dockerApplyMode -eq "catalog" -and $server.PSObject.Properties.Name -contains "catalogServerId") {
        $name = [string]$server.catalogServerId
        if ($name) {
          $governedByLiveName[$name] = [pscustomobject]@{
            name = $name
            policyServerId = [string]$server.id
            matchType = "catalogServerId"
          }
        }
      }

      if ($server.PSObject.Properties.Name -contains "unsafeCatalogServerIds" -and $null -ne $server.unsafeCatalogServerIds) {
        foreach ($unsafeCatalogServerId in @($server.unsafeCatalogServerIds)) {
          $name = [string]$unsafeCatalogServerId
          if (-not $name) {
            continue
          }
          if (-not $unsafeByLiveName.ContainsKey($name)) {
            $unsafeByLiveName[$name] = @()
          }
          $unsafeByLiveName[$name] = @($unsafeByLiveName[$name]) + @([pscustomobject]@{
              name = $name
              policyServerId = [string]$server.id
              blockedReason = [string]$server.blockedReason
            })
        }
      }
    }

    $governed = @()
    $unsafe = @()
    $unmanaged = @()

    foreach ($liveServer in @($EnabledServers | Sort-Object name)) {
      $name = [string]$liveServer.name
      if ($governedByLiveName.ContainsKey($name)) {
        $governed += $governedByLiveName[$name]
      } elseif ($unsafeByLiveName.ContainsKey($name)) {
        $matches = @($unsafeByLiveName[$name] | Sort-Object policyServerId)
        $unsafe += [pscustomobject]@{
          name = $name
          policyServerId = [string]$matches[0].policyServerId
          policyServerIds = @($matches | ForEach-Object { $_.policyServerId })
          policyMatches = @(
            $matches | ForEach-Object {
              [pscustomobject]@{
                policyServerId = [string]$_.policyServerId
                blockedReason = [string]$_.blockedReason
              }
            }
          )
        }
      } else {
        $unmanaged += [pscustomobject]@{
          name = $name
        }
      }
    }

    $governanceStatus = if ($unsafe.Count -gt 0 -or $unmanaged.Count -gt 0) {
      "drift_detected"
    } else {
      "clean"
    }

    return [pscustomobject]@{
      commands = @($runtimePrepare.command)
      report = [pscustomobject]@{
        governanceStatus = $governanceStatus
        governanceSummaryCounts = [pscustomobject]@{
          governedEnabledServerCount = $governed.Count
          unsafeEnabledServerCount = $unsafe.Count
          unmanagedEnabledServerCount = $unmanaged.Count
        }
        governedEnabledServers = @($governed | Sort-Object name, policyServerId)
        unsafeEnabledServers = @($unsafe | Sort-Object name)
        unmanagedEnabledServers = @($unmanaged | Sort-Object name)
        governanceUnavailableReason = $null
      }
    }
  } catch {
    return [pscustomobject]@{
      commands = @()
      report = [pscustomobject]@{
        governanceStatus = "unavailable"
        governanceSummaryCounts = [pscustomobject]@{
          governedEnabledServerCount = 0
          unsafeEnabledServerCount = 0
          unmanagedEnabledServerCount = 0
        }
        governedEnabledServers = @()
        unsafeEnabledServers = @()
        unmanagedEnabledServers = @()
        governanceUnavailableReason = $_.Exception.Message
      }
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

  $toolkitAudit = Invoke-InstallerDockerMcpToolkitAudit `
    -RepoRoot $RepoRoot `
    -ToolboxManifestDir $ToolboxManifestDir
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
