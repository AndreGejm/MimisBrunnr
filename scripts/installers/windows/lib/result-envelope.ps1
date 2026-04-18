Set-StrictMode -Version Latest

function New-InstallerResultEnvelope {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)]
    [string]$OperationId,

    [Parameter(Mandatory = $true)]
    [string]$Status,

    [Parameter(Mandatory = $true)]
    [string]$ReasonCode,

    [Parameter(Mandatory = $true)]
    [string]$Message,

    [string]$Mode = "audit_only",
    [string]$RepoRoot = "",
    [string]$StateRoot = "",
    [object]$Details = $null,
    [string[]]$ArtifactsWritten = @(),
    [string[]]$BackupsCreated = @(),
    [object[]]$CommandsRun = @(),
    [string[]]$NextActions = @()
  )

  if ($null -eq $Details) {
    $Details = [pscustomobject]@{}
  }

  return [pscustomobject]@{
    schemaVersion   = 1
    operationId     = $OperationId
    mode            = $Mode
    recordedAt      = (Get-Date).ToUniversalTime().ToString("o")
    repoRoot        = $RepoRoot
    stateRoot       = $StateRoot
    status          = $Status
    reasonCode      = $ReasonCode
    message         = $Message
    details         = $Details
    artifactsWritten = @($ArtifactsWritten)
    backupsCreated  = @($BackupsCreated)
    commandsRun     = @($CommandsRun)
    nextActions     = @($NextActions)
  }
}

function ConvertTo-InstallerJson {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true, ValueFromPipeline = $true)]
    [object]$InputObject
  )

  process {
    return ($InputObject | ConvertTo-Json -Depth 32)
  }
}

function Write-Utf8NoBomFile {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path,

    [Parameter(Mandatory = $true)]
    [string]$Content
  )

  $directory = Split-Path -Parent $Path
  if ($directory) {
    $null = New-Item -ItemType Directory -Force -Path $directory
  }

  $encoding = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Content, $encoding)
}
