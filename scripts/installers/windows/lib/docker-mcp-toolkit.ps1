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

  $serverList = Invoke-InstallerDockerMcpLiveServerList -RepoRoot $RepoRoot

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

  $servers = @($serverList.servers)
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
    commands =
      @($versionResult.command) +
      @($serverList.commands) +
      @($clientsResult.command) +
      @($configResult.command) +
      @($featureResult.command) +
      @($governanceCommands)
    report = [pscustomobject]@{
      available = $true
      version = $versionResult.stdout.Trim()
      liveServerListSource = $serverList.source
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

function Invoke-InstallerDockerMcpLiveServerList {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)]
    [string]$RepoRoot
  )

  $probeSpecs = @(
    [pscustomobject]@{
      source = "profile-server-list"
      arguments = @("mcp", "profile", "server", "ls", "--format", "json")
    },
    [pscustomobject]@{
      source = "legacy-server-list"
      arguments = @("mcp", "server", "ls", "--json")
    }
  )

  $commands = @()
  $failures = @()
  foreach ($probeSpec in $probeSpecs) {
    $result = Invoke-ProcessCaptureAdapter `
      -ExecutableName "docker" `
      -Arguments @($probeSpec.arguments) `
      -WorkingDirectory $RepoRoot `
      -IgnoreExitCode
    $commands += $result.command

    if ($result.command.exitCode -ne 0) {
      $reason = if (-not [string]::IsNullOrWhiteSpace($result.stderr)) {
        $result.stderr.Trim()
      } elseif (-not [string]::IsNullOrWhiteSpace($result.stdout)) {
        $result.stdout.Trim()
      } else {
        "docker exited with status $($result.command.exitCode)"
      }
      $failures += "$($probeSpec.source): $reason"
      continue
    }

    try {
      $decodedServers = $result.stdout | ConvertFrom-Json
      $servers = ConvertTo-InstallerDockerMcpLiveServers -DecodedServers $decodedServers
      return [pscustomobject]@{
        source = $probeSpec.source
        commands = @($commands)
        servers = @($servers)
      }
    } catch {
      $failures += "$($probeSpec.source): $($_.Exception.Message)"
      continue
    }
  }

  throw "Docker MCP server list was unavailable. $($failures -join ' | ')".Trim()
}

function ConvertTo-InstallerDockerMcpLiveServers {
  [CmdletBinding()]
  param(
    [AllowNull()]
    [object]$DecodedServers
  )

  if ($null -eq $DecodedServers) {
    return @()
  }

  $servers = [System.Collections.ArrayList]::new()
  $sawServerList = Add-InstallerDockerMcpLiveServerEntries `
    -DecodedServers $DecodedServers `
    -Servers $servers

  if (-not $sawServerList) {
    throw "Docker MCP server list did not return an array."
  }

  return @($servers)
}

function Add-InstallerDockerMcpLiveServerEntries {
  [CmdletBinding()]
  param(
    [AllowNull()]
    [object]$DecodedServers,

    [AllowNull()]
    [string]$InheritedProfileName = $null,

    [Parameter(Mandatory = $true)]
    [AllowEmptyCollection()]
    [System.Collections.ArrayList]$Servers
  )

  if ($null -eq $DecodedServers) {
    return $false
  }

  if ($DecodedServers -is [array]) {
    foreach ($item in @($DecodedServers)) {
      $itemHadNestedList = Add-InstallerDockerMcpLiveServerEntries `
        -DecodedServers $item `
        -InheritedProfileName $InheritedProfileName `
        -Servers $Servers
      if (-not $itemHadNestedList) {
        Add-InstallerDockerMcpLiveServer `
          -Server $item `
          -InheritedProfileName $InheritedProfileName `
          -Servers $Servers
      }
    }
    return $true
  }

  $propertyNames = @($DecodedServers.PSObject.Properties.Name)
  $sawServerList = $false

  if ($propertyNames -contains "profiles" -and $null -ne $DecodedServers.profiles) {
    $sawServerList = $true
    foreach ($profile in @($DecodedServers.profiles)) {
      [void](Add-InstallerDockerMcpLiveServerEntries `
        -DecodedServers $profile `
        -InheritedProfileName $InheritedProfileName `
        -Servers $Servers)
    }
  }

  if ($propertyNames -contains "servers" -and $null -ne $DecodedServers.servers) {
    $sawServerList = $true
    $profileName = Get-InstallerDockerMcpStringProperty `
      -InputObject $DecodedServers `
      -PropertyNames @("profileName", "profile", "name", "id")
    if ([string]::IsNullOrWhiteSpace($profileName)) {
      $profileName = $InheritedProfileName
    }
    foreach ($server in @($DecodedServers.servers)) {
      Add-InstallerDockerMcpLiveServer `
        -Server $server `
        -InheritedProfileName $profileName `
        -Servers $Servers
    }
  }

  if ($propertyNames -contains "items" -and $null -ne $DecodedServers.items) {
    $sawServerList = $true
    foreach ($item in @($DecodedServers.items)) {
      $itemHadNestedList = Add-InstallerDockerMcpLiveServerEntries `
        -DecodedServers $item `
        -InheritedProfileName $InheritedProfileName `
        -Servers $Servers
      if (-not $itemHadNestedList) {
        Add-InstallerDockerMcpLiveServer `
          -Server $item `
          -InheritedProfileName $InheritedProfileName `
          -Servers $Servers
      }
    }
  }

  return $sawServerList
}

function Add-InstallerDockerMcpLiveServer {
  [CmdletBinding()]
  param(
    [AllowNull()]
    [object]$Server,

    [AllowNull()]
    [string]$InheritedProfileName = $null,

    [Parameter(Mandatory = $true)]
    [AllowEmptyCollection()]
    [System.Collections.ArrayList]$Servers
  )

  if ($null -eq $Server) {
    return
  }

  $propertyNames = @($Server.PSObject.Properties.Name)
  $name = Get-InstallerDockerMcpStringProperty `
    -InputObject $Server `
    -PropertyNames @("name", "id")
  if ([string]::IsNullOrWhiteSpace($name)) {
    return
  }

  $profileName = Get-InstallerDockerMcpStringProperty `
    -InputObject $Server `
    -PropertyNames @("profileName", "profile")
  if ([string]::IsNullOrWhiteSpace($profileName)) {
    $profileName = $InheritedProfileName
  }

  [void]$Servers.Add([pscustomobject]@{
    name = $name.Trim()
    description = if ($propertyNames -contains "description") { $Server.description } else { $null }
    secrets = if ($propertyNames -contains "secrets") { $Server.secrets } else { $null }
    config = if ($propertyNames -contains "config") { $Server.config } else { $null }
    oauth = if ($propertyNames -contains "oauth") { $Server.oauth } else { $null }
    profileName = $profileName
  })
}

function Get-InstallerDockerMcpStringProperty {
  [CmdletBinding()]
  param(
    [AllowNull()]
    [object]$InputObject,

    [Parameter(Mandatory = $true)]
    [string[]]$PropertyNames
  )

  if ($null -eq $InputObject) {
    return $null
  }

  $inputPropertyNames = @($InputObject.PSObject.Properties.Name)
  foreach ($propertyName in $PropertyNames) {
    if ($inputPropertyNames -contains $propertyName) {
      $value = [string]$InputObject.$propertyName
      if (-not [string]::IsNullOrWhiteSpace($value)) {
        return $value.Trim()
      }
    }
  }

  return $null
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

  $runtimePrepare = $null

  try {
    $runtimePrepare = Invoke-InstallerToolboxRuntimePrepare `
      -RepoRoot $RepoRoot `
      -ToolboxManifestDir $ToolboxManifestDir

    $plan = $runtimePrepare.plan
    $policyServers = @($plan.servers)
    $governedByLiveName = @{}
    $unsafeByLiveName = @{}

    foreach ($server in $policyServers) {
      $serverPropertyNames = @($server.PSObject.Properties.Name)
      $hasDockerServerName = $serverPropertyNames -contains "dockerServerName"
      $hasDockerApplyMode = $serverPropertyNames -contains "dockerApplyMode"
      $hasCatalogServerId = $serverPropertyNames -contains "catalogServerId"

      if ($server.source -eq "owned") {
        $name = if ($hasDockerServerName) { [string]$server.dockerServerName } else { "" }
        if ($name) {
          $governedByLiveName[$name] = [pscustomobject]@{
            name = $name
            policyServerId = [string]$server.id
            matchType = "owned-dockerServerName"
          }
        }
      } elseif ($hasDockerApplyMode -and $server.dockerApplyMode -eq "catalog" -and $hasCatalogServerId) {
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
    $commands = if ($null -ne $runtimePrepare -and $null -ne $runtimePrepare.command) {
      @($runtimePrepare.command)
    } else {
      @()
    }

    return [pscustomobject]@{
      commands = $commands
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

  $descriptorOnlyBlockedById = @{}
  foreach ($entry in $applyCommands) {
    $profileId = [string]$entry.profileId
    $entryBlockedServers = if ($entry.PSObject.Properties.Name -contains "blockedServers" -and $null -ne $entry.blockedServers) {
      @($entry.blockedServers)
    } else {
      @()
    }

    foreach ($server in $entryBlockedServers) {
      $id = [string]$server.id
      $blockedReason = [string]$server.blockedReason
      if (-not $id -or $blockedReason -notmatch "descriptor-only") {
        continue
      }

      if (-not $descriptorOnlyBlockedById.ContainsKey($id)) {
        $descriptorOnlyBlockedById[$id] = [pscustomobject]@{
          id = $id
          blockedReason = $blockedReason
          profileIds = @()
        }
      }

      if ($profileId -and @($descriptorOnlyBlockedById[$id].profileIds) -notcontains $profileId) {
        $descriptorOnlyBlockedById[$id].profileIds = @($descriptorOnlyBlockedById[$id].profileIds) + @($profileId)
      }
    }
  }
  $descriptorOnlyBlockedServers = @(
    $descriptorOnlyBlockedById.Values | Sort-Object id | ForEach-Object {
      [pscustomobject]@{
        id = $_.id
        blockedReason = $_.blockedReason
        profileIds = @($_.profileIds | Sort-Object)
      }
    }
  )

  $blockedReasons = @()
  if ($applyCommands.Count -eq 0) {
    $blockedReasons += "The compiled toolbox runtime plan did not emit any Docker MCP apply commands."
  }
  if ($requiresDockerProfile -and -not $profileSupport.available) {
    $blockedReasons += "The prepared toolbox runtime apply commands target docker mcp profile create, but this Docker MCP Toolkit exposes no profile subcommand."
  }
  if ($descriptorOnlyBlockedServers.Count -gt 0) {
    $blockedReasons += "The compiled toolbox runtime apply plan is blocked because selected Docker profiles contain descriptor-only peer servers with no safe Docker MCP catalog apply target."
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
      $entryBlockedServers = if ($entry.PSObject.Properties.Name -contains "blockedServers" -and $null -ne $entry.blockedServers) {
        @(
          $entry.blockedServers | ForEach-Object {
            [pscustomobject]@{
              id = $_.id
              blockedReason = $_.blockedReason
            }
          }
        )
      } else {
        @()
      }
      [pscustomobject]@{
        description = $entry.description
        profileId = $entry.profileId
        argv = @($entry.argv)
        blockedServers = @($entryBlockedServers)
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
      blockedServers = @($descriptorOnlyBlockedServers)
      descriptorOnlyBlockedServers = @($descriptorOnlyBlockedServers)
      toolkit = $toolkitAudit.report
    }
  }
}
