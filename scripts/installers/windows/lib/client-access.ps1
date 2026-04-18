Set-StrictMode -Version Latest

. (Join-Path $PSScriptRoot "write-plan.ps1")
. (Join-Path $PSScriptRoot "adapters\default-access.ps1")

function Get-SupportedInstallerClients {
  [CmdletBinding()]
  param()

  return @(
    [pscustomobject]@{
      clientName        = "codex"
      displayName       = "Codex"
      accessKind        = "mcp_stdio"
      defaultConfigPath = (Join-Path $HOME ".codex\config.toml")
      defaultServerName = "mimir"
      adapterId         = "default-access"
    }
  )
}

function Get-InstallerClientDefinition {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)]
    [string]$ClientName
  )

  $client = Get-SupportedInstallerClients | Where-Object { $_.clientName -eq $ClientName } | Select-Object -First 1
  if (-not $client) {
    throw "Unsupported installer client '$ClientName'."
  }

  return $client
}

function Invoke-InstallerClientAccessAudit {
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

  $client = Get-InstallerClientDefinition -ClientName $ClientName

  switch ($client.adapterId) {
    "default-access" {
      $adapter = Invoke-DefaultAccessDoctorAdapter `
        -RepoRoot $RepoRoot `
        -ConfigPath $ConfigPath `
        -BinDir $BinDir `
        -ManifestPath $ManifestPath `
        -ServerName $ServerName

      return [pscustomobject]@{
        client = $client
        command = $adapter.command
        report = $adapter.report
        clientAccess = [pscustomobject]@{
          clientName = $client.clientName
          displayName = $client.displayName
          accessKind = $client.accessKind
          serverName = $ServerName
          configPath = $ConfigPath
          configured = $adapter.report.codexMcp.configured
        }
      }
    }

    default {
      throw "No installer access adapter is registered for client '$ClientName'."
    }
  }
}

function Invoke-InstallerClientAccessPlan {
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

  $client = Get-InstallerClientDefinition -ClientName $ClientName

  switch ($client.adapterId) {
    "default-access" {
      $adapter = Invoke-DefaultAccessPlanAdapter `
        -RepoRoot $RepoRoot `
        -ConfigPath $ConfigPath `
        -BinDir $BinDir `
        -ManifestPath $ManifestPath `
        -ServerName $ServerName

      $configExists = Test-Path $ConfigPath
      $manifestExists = Test-Path $ManifestPath
      $writeTargets = @(
        (New-InstallerWriteTarget `
          -Id "client-config" `
          -Path $ConfigPath `
          -Exists $configExists `
          -MutationKind "upsert_file" `
          -BackupStrategy $(if ($configExists) { "timestamped_copy" } else { "none" }) `
          -BackupPathPattern $(if ($configExists) { Get-InstallerTimestampedBackupPathPattern -Path $ConfigPath } else { $null })),
        (New-InstallerWriteTarget `
          -Id "installation-manifest" `
          -Path $ManifestPath `
          -Exists $manifestExists `
          -MutationKind "replace_file" `
          -BackupStrategy $(if ($manifestExists) { "timestamped_copy" } else { "none" }) `
          -BackupPathPattern $(if ($manifestExists) { Get-InstallerTimestampedBackupPathPattern -Path $ManifestPath } else { $null }))
      )

      foreach ($launcherFile in @($adapter.plan.launcherFiles)) {
        $launcherPath = Join-Path $BinDir $launcherFile
        $writeTargets += New-InstallerWriteTarget `
          -Id "launcher:$($launcherFile -replace '\.cmd$','')" `
          -Path $launcherPath `
          -Exists (Test-Path $launcherPath) `
          -MutationKind "replace_file"
      }

      return [pscustomobject]@{
        client = $client
        command = $adapter.command
        clientAccess = [pscustomobject]@{
          clientName = $client.clientName
          displayName = $client.displayName
          accessKind = $client.accessKind
          serverName = $ServerName
          configPath = $ConfigPath
        }
        writePlan = [pscustomobject]@{
          applyCommand = [pscustomobject]@{
            command = $adapter.applyCommand.command
            args = @($adapter.applyCommand.args)
            workingDirectory = $RepoRoot
            repoRoot = $RepoRoot
            serverName = $ServerName
          }
          launcherBinDir = $BinDir
          manifestPath = $ManifestPath
          launcherFiles = @($adapter.plan.launcherFiles)
          manifest = $adapter.plan.manifest
          writeTargets = @($writeTargets)
        }
      }
    }

    default {
      throw "No installer plan adapter is registered for client '$ClientName'."
    }
  }
}

function Invoke-InstallerClientAccessApply {
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

  $plan = Invoke-InstallerClientAccessPlan `
    -ClientName $ClientName `
    -RepoRoot $RepoRoot `
    -ConfigPath $ConfigPath `
    -BinDir $BinDir `
    -ManifestPath $ManifestPath `
    -ServerName $ServerName

  $backupCandidates = @($plan.writePlan.writeTargets | Where-Object { $_.backupStrategy -eq "timestamped_copy" })
  $backupsBefore = @{}
  foreach ($target in $backupCandidates) {
    $backupsBefore[$target.path] = @(Get-InstallerTimestampedBackupFiles -Path $target.path)
  }

  $apply = Invoke-DefaultAccessApplyAdapter `
    -RepoRoot $RepoRoot `
    -ConfigPath $ConfigPath `
    -BinDir $BinDir `
    -ManifestPath $ManifestPath `
    -ServerName $ServerName

  $backupsCreated = @()
  foreach ($target in $backupCandidates) {
    $before = @()
    if ($backupsBefore.Contains($target.path)) {
      $before = @($backupsBefore[$target.path])
    }

    $after = @(Get-InstallerTimestampedBackupFiles -Path $target.path)
    $newBackups = @($after | Where-Object { $before -notcontains $_ })
    if ($newBackups.Count -gt 0) {
      $backupsCreated += $newBackups
    }
  }

  $appliedWriteTargets = @(
    foreach ($target in @($plan.writePlan.writeTargets)) {
      [pscustomobject]@{
        id                = $target.id
        kind              = $target.kind
        path              = $target.path
        exists            = (Test-Path $target.path)
        mutationKind      = $target.mutationKind
        backupStrategy    = $target.backupStrategy
        backupPathPattern = $target.backupPathPattern
      }
    }
  )

  return [pscustomobject]@{
    client = $plan.client
    commands = @($plan.command, $apply.command)
    backupsCreated = @($backupsCreated)
    report = $apply.report
    clientAccess = [pscustomobject]@{
      clientName = $plan.clientAccess.clientName
      displayName = $plan.clientAccess.displayName
      accessKind = $plan.clientAccess.accessKind
      serverName = $ServerName
      configPath = $ConfigPath
      configured = $apply.report.codexMcp.configured
    }
    applyResult = [pscustomobject]@{
      writeTargets = $appliedWriteTargets
      launcherBinDir = $BinDir
      manifestPath = $ManifestPath
      launcherFiles = @($plan.writePlan.launcherFiles)
    }
  }
}
