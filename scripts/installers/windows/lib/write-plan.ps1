Set-StrictMode -Version Latest

function Get-InstallerTimestampedBackupPathPattern {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path
  )

  return "$Path.<timestamp>.bak"
}

function Get-InstallerTimestampedBackupFiles {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path
  )

  $directory = Split-Path -Parent $Path
  if (-not $directory -or -not (Test-Path $directory)) {
    return @()
  }

  $leaf = Split-Path -Leaf $Path
  return @(
    Get-ChildItem -File -Path $directory |
      Where-Object { $_.Name -like "$leaf.*.bak" } |
      Select-Object -ExpandProperty FullName
  )
}

function New-InstallerWriteTarget {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)]
    [string]$Id,

    [Parameter(Mandatory = $true)]
    [string]$Path,

    [Parameter(Mandatory = $true)]
    [string]$MutationKind,

    [bool]$Exists = $false,
    [string]$Kind = "file",
    [string]$BackupStrategy = "none",
    [AllowNull()]
    [object]$BackupPathPattern = $null
  )

  return [pscustomobject]@{
    id                = $Id
    kind              = $Kind
    path              = $Path
    exists            = $Exists
    mutationKind      = $MutationKind
    backupStrategy    = $BackupStrategy
    backupPathPattern = $BackupPathPattern
  }
}
