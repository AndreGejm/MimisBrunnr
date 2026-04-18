Set-StrictMode -Version Latest

. (Join-Path $PSScriptRoot "result-envelope.ps1")

function Get-DefaultInstallerStateRoot {
  [CmdletBinding()]
  param()

  if ($env:LOCALAPPDATA -and $env:LOCALAPPDATA.Trim().Length -gt 0) {
    return (Join-Path $env:LOCALAPPDATA "Mimir\installer")
  }

  return (Join-Path $HOME "AppData\Local\Mimir\installer")
}

function Get-InstallerStatePaths {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)]
    [string]$StateRoot,

    [string]$OperationId = "",
    [string]$RecordedAt = ""
  )

  $historyDirectory = Join-Path $StateRoot "history"
  $paths = [ordered]@{
    StateRoot      = $StateRoot
    SessionPath    = Join-Path $StateRoot "install-session.json"
    LastReportPath = Join-Path $StateRoot "last-report.json"
    HistoryDir     = $historyDirectory
  }

  if ($OperationId -and $RecordedAt) {
    $safeStamp = $RecordedAt.Replace(":", "-")
    $paths.HistoryPath = Join-Path $historyDirectory "$safeStamp-$OperationId.json"
  }

  return [pscustomobject]$paths
}

function Write-InstallerOperationState {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)]
    [string]$StateRoot,

    [Parameter(Mandatory = $true)]
    [object]$Envelope
  )

  $paths = Get-InstallerStatePaths -StateRoot $StateRoot -OperationId $Envelope.operationId -RecordedAt $Envelope.recordedAt
  $null = New-Item -ItemType Directory -Force -Path $paths.HistoryDir

  $operationSummary = [pscustomobject]@{
    operationId = $Envelope.operationId
    recordedAt  = $Envelope.recordedAt
    status      = $Envelope.status
    reasonCode  = $Envelope.reasonCode
    message     = $Envelope.message
  }

  $sessionState = if (Test-Path $paths.SessionPath) {
    ConvertTo-InstallerSessionState `
      -ExistingState (Get-InstallerPersistedState -Path $paths.SessionPath) `
      -Envelope $Envelope `
      -StateRoot $StateRoot
  } else {
    ConvertTo-InstallerSessionState -ExistingState $null -Envelope $Envelope -StateRoot $StateRoot
  }

  $sessionOperations = @($sessionState.operations)
  $sessionOperations += $operationSummary
  $sessionState.updatedAt = $Envelope.recordedAt
  $sessionState.repoRoot = $Envelope.repoRoot
  $sessionState.stateRoot = $StateRoot
  $sessionState.lastOperationId = $Envelope.operationId
  $sessionState.lastStatus = $Envelope.status
  $sessionState.lastReasonCode = $Envelope.reasonCode
  $sessionState.operations = $sessionOperations

  $artifactPaths = @(
    $paths.LastReportPath,
    $paths.SessionPath,
    $paths.HistoryPath
  )
  $Envelope.artifactsWritten = @(
    @($Envelope.artifactsWritten) +
    $artifactPaths
  ) | Select-Object -Unique

  $envelopeJson = ConvertTo-InstallerJson -InputObject $Envelope
  $sessionJson = ConvertTo-InstallerJson -InputObject $sessionState

  Write-Utf8NoBomFile -Path $paths.LastReportPath -Content $envelopeJson
  Write-Utf8NoBomFile -Path $paths.SessionPath -Content $sessionJson
  Write-Utf8NoBomFile -Path $paths.HistoryPath -Content $envelopeJson

  return $Envelope
}

function Get-InstallerPersistedState {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path
  )

  if (-not (Test-Path $Path)) {
    return $null
  }

  return (Get-Content -Raw -Path $Path | ConvertFrom-Json)
}

function Read-InstallerState {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)]
    [string]$StateRoot
  )

  $paths = Get-InstallerStatePaths -StateRoot $StateRoot
  return [pscustomobject]@{
    paths        = $paths
    lastReport   = Get-InstallerPersistedState -Path $paths.LastReportPath
    sessionState = Get-InstallerPersistedState -Path $paths.SessionPath
  }
}

function ConvertTo-InstallerSessionState {
  [CmdletBinding()]
  param(
    [AllowNull()]
    [object]$ExistingState,

    [Parameter(Mandatory = $true)]
    [object]$Envelope,

    [Parameter(Mandatory = $true)]
    [string]$StateRoot
  )

  $operations = @()
  if ($null -ne $ExistingState -and $null -ne $ExistingState.operations) {
    $operations = @($ExistingState.operations)
  }

  return [pscustomobject]@{
    schemaVersion   = 1
    updatedAt       = if ($null -ne $ExistingState -and $ExistingState.PSObject.Properties.Name -contains "updatedAt") { $ExistingState.updatedAt } else { $Envelope.recordedAt }
    repoRoot        = if ($null -ne $ExistingState -and $ExistingState.PSObject.Properties.Name -contains "repoRoot") { $ExistingState.repoRoot } else { $Envelope.repoRoot }
    stateRoot       = if ($null -ne $ExistingState -and $ExistingState.PSObject.Properties.Name -contains "stateRoot") { $ExistingState.stateRoot } else { $StateRoot }
    lastOperationId = if ($null -ne $ExistingState -and $ExistingState.PSObject.Properties.Name -contains "lastOperationId") { $ExistingState.lastOperationId } else { "" }
    lastStatus      = if ($null -ne $ExistingState -and $ExistingState.PSObject.Properties.Name -contains "lastStatus") { $ExistingState.lastStatus } else { "" }
    lastReasonCode  = if ($null -ne $ExistingState -and $ExistingState.PSObject.Properties.Name -contains "lastReasonCode") { $ExistingState.lastReasonCode } else { "" }
    operations      = $operations
  }
}
