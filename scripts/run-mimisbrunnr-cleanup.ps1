<#
.SYNOPSIS
Runs governed mimisbrunnr maintenance through supported mimir commands.

.DESCRIPTION
This script is a thin operator wrapper over the current mimir maintenance
surfaces. It does not edit vault files directly.

Current supported behavior:
- inspect the staged review queue per corpus
- inspect freshness status per corpus
- optionally create refresh drafts for stale current-state mimisbrunnr notes

The legacy memory-librarian command family is not exposed by this checkout, so
this script intentionally stays within the supported CLI contract.
#>
[CmdletBinding()]
param(
  [ValidateSet("all", "general_notes", "mimisbrunnr")]
  [string] $Corpus = "all",

  [ValidateRange(1, 10000)]
  [int] $MaxNotes = 25,

  [ValidateSet("heuristic", "model", "auto")]
  [string] $ProviderMode = "heuristic",

  [ValidateSet("fast", "balanced", "model")]
  [string] $ReviewDepth = "fast",

  [ValidateRange(1, 1000)]
  [int] $ModelSampleNotes = 5,

  [ValidateRange(0, 86400)]
  [int] $ModelCommandTimeoutSeconds = 180,

  [ValidateRange(1, 3600)]
  [int] $StatusIntervalSeconds = 10,

  [ValidateRange(0, 86400)]
  [int] $CommandTimeoutSeconds = 300,

  [switch] $ApplyModelSafeActions,

  [switch] $Detailed,

  [switch] $DryRun,

  [switch] $Json
)

$ErrorActionPreference = "Stop"

$RuntimeRepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$DefaultWindowsDataRoot = "F:\Dev\Mimisbrunnr"
$DefaultDataRoot = if ([System.Environment]::OSVersion.Platform -eq [System.PlatformID]::Win32NT) {
  $DefaultWindowsDataRoot
} elseif (-not [string]::IsNullOrWhiteSpace($env:HOME)) {
  Join-Path $env:HOME ".mimir"
} else {
  Join-Path $RuntimeRepoRoot ".mimir"
}
$DataRoot = if ([string]::IsNullOrWhiteSpace($env:MAB_DATA_ROOT)) {
  $DefaultDataRoot
} else {
  $env:MAB_DATA_ROOT
}
$DefaultCanonicalVaultRoot = Join-Path $DataRoot "vault\canonical"
$DefaultStagingRoot = Join-Path $DataRoot "vault\staging"
$DefaultSqlitePath = Join-Path $DataRoot "state\mimisbrunnr.sqlite"
$VaultRoot = if ([string]::IsNullOrWhiteSpace($env:MAB_VAULT_ROOT)) {
  $DefaultCanonicalVaultRoot
} else {
  $env:MAB_VAULT_ROOT
}
$StagingRoot = if ([string]::IsNullOrWhiteSpace($env:MAB_STAGING_ROOT)) {
  $DefaultStagingRoot
} else {
  $env:MAB_STAGING_ROOT
}
$SqlitePath = if ([string]::IsNullOrWhiteSpace($env:MAB_SQLITE_PATH)) {
  $DefaultSqlitePath
} else {
  $env:MAB_SQLITE_PATH
}
$CliExecutable = (Get-Command "node" -ErrorAction Stop).Source
$CliPrefixArgs = @(Join-Path $RuntimeRepoRoot "scripts\launch-mimir-cli.mjs")

function Write-CleanupStatus {
  param(
    [Parameter(Mandatory = $true)]
    [string] $Message
  )

  if (-not $Json) {
    Write-Host ("[{0}] {1}" -f (Get-Date -Format "HH:mm:ss"), $Message)
  }
}

function Write-CleanupProgress {
  param(
    [Parameter(Mandatory = $true)]
    [string] $Status,

    [Parameter(Mandatory = $true)]
    [int] $PercentComplete
  )

  if (-not $Json) {
    Write-Progress `
      -Activity "mimisbrunnr maintenance" `
      -Status $Status `
      -PercentComplete $PercentComplete
  }
}

function Complete-CleanupProgress {
  if (-not $Json) {
    Write-Progress -Activity "mimisbrunnr maintenance" -Completed
  }
}

function Invoke-Mimir {
  param(
    [Parameter(Mandatory = $true)]
    [string] $Command,

    [hashtable] $Payload = @{},

    [ValidateRange(0, 86400)]
    [int] $TimeoutSeconds = $CommandTimeoutSeconds
  )

  $payloadJson = $Payload | ConvertTo-Json -Depth 32 -Compress
  $inputPath = [System.IO.Path]::GetTempFileName()
  $stdoutPath = [System.IO.Path]::GetTempFileName()
  $stderrPath = [System.IO.Path]::GetTempFileName()
  [System.IO.File]::WriteAllText(
    $inputPath,
    $payloadJson,
    [System.Text.UTF8Encoding]::new($false)
  )
  $arguments = @($CliPrefixArgs + @($Command, "--input", $inputPath))
  $previousNodeNoWarnings = $env:NODE_NO_WARNINGS
  $previousDataRoot = $env:MAB_DATA_ROOT
  $previousVaultRoot = $env:MAB_VAULT_ROOT
  $previousStagingRoot = $env:MAB_STAGING_ROOT
  $previousSqlitePath = $env:MAB_SQLITE_PATH
  $env:NODE_NO_WARNINGS = "1"
  $env:MAB_DATA_ROOT = $DataRoot
  $env:MAB_VAULT_ROOT = $VaultRoot
  $env:MAB_STAGING_ROOT = $StagingRoot
  $env:MAB_SQLITE_PATH = $SqlitePath
  $startedAt = Get-Date
  $lastStatusAt = $startedAt
  try {
    $process = Start-Process `
      -FilePath $CliExecutable `
      -ArgumentList $arguments `
      -NoNewWindow `
      -PassThru `
      -RedirectStandardOutput $stdoutPath `
      -RedirectStandardError $stderrPath

    while (-not $process.WaitForExit(1000)) {
      $now = Get-Date
      $elapsedSeconds = [int] ($now - $startedAt).TotalSeconds

      if (
        $TimeoutSeconds -gt 0 -and
        $elapsedSeconds -ge $TimeoutSeconds
      ) {
        $process.Kill()
        throw "mimir command '$Command' timed out after $TimeoutSeconds seconds."
      }

      if (($now - $lastStatusAt).TotalSeconds -ge $StatusIntervalSeconds) {
        Write-CleanupStatus "[$Command] still running after $elapsedSeconds seconds."
        $lastStatusAt = $now
      }
    }

    $process.WaitForExit()
    $process.Refresh()
    $exitCode = if ($null -eq $process.ExitCode) { 0 } else { $process.ExitCode }
    $stdout = [System.IO.File]::ReadAllText($stdoutPath)
    $stderr = [System.IO.File]::ReadAllText($stderrPath)
  } finally {
    $env:NODE_NO_WARNINGS = $previousNodeNoWarnings
    $env:MAB_DATA_ROOT = $previousDataRoot
    $env:MAB_VAULT_ROOT = $previousVaultRoot
    $env:MAB_STAGING_ROOT = $previousStagingRoot
    $env:MAB_SQLITE_PATH = $previousSqlitePath
    [System.IO.File]::Delete($inputPath)
    [System.IO.File]::Delete($stdoutPath)
    [System.IO.File]::Delete($stderrPath)
  }

  if ($exitCode -ne 0) {
    throw "mimir command '$Command' failed with exit code $exitCode.`n$stdout`n$stderr"
  }

  try {
    return $stdout | ConvertFrom-Json
  } catch {
    throw "mimir command '$Command' did not return JSON.`n$stdout`n$stderr"
  }
}

function New-CorpusSummary {
  param(
    [string] $CorpusId
  )

  return [ordered]@{
    corpusId = $CorpusId
    reviewQueueCount = 0
    freshness = $null
    refreshDrafts = $null
    items = @()
  }
}

$corpora = if ($Corpus -eq "all") {
  @("general_notes", "mimisbrunnr")
} else {
  @($Corpus)
}

Write-CleanupStatus "Loading mimisbrunnr maintenance runner."
Write-CleanupStatus "mimisbrunnr data root: $DataRoot"
Write-CleanupStatus "Memory vault: $VaultRoot"
Write-CleanupStatus "Staging root: $StagingRoot"
Write-CleanupStatus "Runtime repo: $RuntimeRepoRoot"
Write-CleanupStatus "Target corpora: $($corpora -join ', ')"
Write-CleanupStatus "Mode: $(if ($DryRun) { "report only" } else { "report plus supported safe actions" })"
Write-CleanupStatus "Review depth compatibility flag: $ReviewDepth"
Write-CleanupStatus "Provider mode compatibility flag: $ProviderMode"
Write-CleanupStatus "Detailed output: $([bool] $Detailed)"
Write-CleanupStatus "Heartbeat: every $StatusIntervalSeconds seconds$(if ($CommandTimeoutSeconds -gt 0) { "; command timeout: $CommandTimeoutSeconds seconds" } else { "; command timeout: none" })"
if ($ApplyModelSafeActions -or $ReviewDepth -ne "fast" -or $ProviderMode -ne "heuristic") {
  Write-CleanupStatus "Compatibility note: current maintenance uses supported CLI surfaces only; provider/model compatibility flags are informational in this checkout."
}

$results = @()
$totalSteps = ($corpora.Count * 2) + $(if ((-not $DryRun) -and ($corpora -contains "mimisbrunnr")) { 1 } else { 0 })
$totalSteps = [Math]::Max($totalSteps, 1)
$step = 0

try {
  foreach ($corpusId in $corpora) {
    $summary = New-CorpusSummary -CorpusId $corpusId

    $step += 1
    Write-CleanupStatus "[$corpusId] Reading review queue ($step/$totalSteps)."
    Write-CleanupProgress `
      -Status "Reading review queue for $corpusId" `
      -PercentComplete ([int] ((($step - 1) * 100) / $totalSteps))
    $queue = Invoke-Mimir "list-review-queue" @{
      targetCorpus = $corpusId
    }
    if (-not $queue.ok) {
      throw "list-review-queue failed for '$corpusId': $($queue.error.message)"
    }
    $summary.reviewQueueCount = @($queue.data.items).Count
    if ($Detailed) {
      $summary.items = @($queue.data.items)
    }

    $step += 1
    Write-CleanupStatus "[$corpusId] Reading freshness status ($step/$totalSteps)."
    Write-CleanupProgress `
      -Status "Reading freshness status for $corpusId" `
      -PercentComplete ([int] ((($step - 1) * 100) / $totalSteps))
    $freshness = Invoke-Mimir "freshness-status" @{
      corpusId = $corpusId
      limitPerCategory = $MaxNotes
    }
    if (-not $freshness.ok) {
      throw "freshness-status failed for '$corpusId': $($freshness.error.message)"
    }
    $summary.freshness = $freshness.freshness

    $results += [pscustomobject] $summary
    Write-CleanupStatus "[$corpusId] Review queue: $($summary.reviewQueueCount); expired: $($summary.freshness.expiredCurrentStateNotes); expiring soon: $($summary.freshness.expiringSoonCurrentStateNotes); future-dated: $($summary.freshness.futureDatedCurrentStateNotes)."
  }

  if ((-not $DryRun) -and ($corpora -contains "mimisbrunnr")) {
    $step += 1
    Write-CleanupStatus "[mimisbrunnr] Creating refresh drafts for stale current-state notes ($step/$totalSteps)."
    Write-CleanupProgress `
      -Status "Creating refresh drafts for mimisbrunnr" `
      -PercentComplete ([int] ((($step - 1) * 100) / $totalSteps))
    $refresh = Invoke-Mimir "create-refresh-drafts" @{
      corpusId = "mimisbrunnr"
      limitPerCategory = $MaxNotes
      maxDrafts = $MaxNotes
    } `
      -TimeoutSeconds $(if ($ModelCommandTimeoutSeconds -gt 0) { $ModelCommandTimeoutSeconds } else { $CommandTimeoutSeconds })

    $mimisbrunnrResult = $results | Where-Object { $_.corpusId -eq "mimisbrunnr" } | Select-Object -First 1
    if ($refresh.ok) {
      $mimisbrunnrResult.refreshDrafts = $refresh.data
      Write-CleanupStatus "[mimisbrunnr] Created $(@($refresh.data.drafts).Count) refresh drafts."
    } elseif ($refresh.error.code -eq "validation_failed") {
      $mimisbrunnrResult.refreshDrafts = [pscustomobject] @{
        drafts = @()
        skipped = $true
        reason = $refresh.error.message
      }
      Write-CleanupStatus "[mimisbrunnr] No refresh drafts created: $($refresh.error.message)"
    } else {
      throw "create-refresh-drafts failed for 'mimisbrunnr': $($refresh.error.message)"
    }
  }
} finally {
  Complete-CleanupProgress
}

$summary = [pscustomobject] @{
  ok = $true
  dataRoot = $DataRoot
  vaultRoot = $VaultRoot
  stagingRoot = $StagingRoot
  sqlitePath = $SqlitePath
  runtimeRepoRoot = $RuntimeRepoRoot
  applySafeActions = -not $DryRun
  maxNotes = $MaxNotes
  reviewDepth = $ReviewDepth
  providerMode = $ProviderMode
  modelSampleNotes = $ModelSampleNotes
  modelCommandTimeoutSeconds = $ModelCommandTimeoutSeconds
  applyModelSafeActions = [bool] $ApplyModelSafeActions
  statusIntervalSeconds = $StatusIntervalSeconds
  commandTimeoutSeconds = $CommandTimeoutSeconds
  detailed = [bool] $Detailed
  corpora = $corpora
  corpusSummaries = @($results)
}

if ($Json) {
  $summary | ConvertTo-Json -Depth 64
  exit 0
}

Write-Host "mimisbrunnr maintenance complete"
Write-Host "mimisbrunnr data root: $DataRoot"
Write-Host "Memory vault: $VaultRoot"
Write-Host "Staging root: $StagingRoot"
Write-Host "Runtime repo: $RuntimeRepoRoot"
Write-Host "Mode: $(if ($DryRun) { "report only" } else { "report plus supported safe actions" })"
Write-Host "Review depth compatibility flag: $ReviewDepth"
Write-Host "Provider mode compatibility flag: $ProviderMode"
Write-Host "Heartbeat interval: $StatusIntervalSeconds seconds"
Write-Host "Command timeout: $(if ($CommandTimeoutSeconds -gt 0) { "$CommandTimeoutSeconds seconds" } else { "none" })"
Write-Host ""

foreach ($result in $results) {
  Write-Host "[$($result.corpusId)]"
  Write-Host "  review queue: $($result.reviewQueueCount)"
  Write-Host "  expired current-state: $($result.freshness.expiredCurrentStateNotes)"
  Write-Host "  expiring soon: $($result.freshness.expiringSoonCurrentStateNotes)"
  Write-Host "  future-dated current-state: $($result.freshness.futureDatedCurrentStateNotes)"

  if ($null -ne $result.refreshDrafts) {
    if ($result.refreshDrafts.skipped) {
      Write-Host "  refresh drafts: skipped"
      Write-Host "    $($result.refreshDrafts.reason)"
    } else {
      Write-Host "  refresh drafts created: $(@($result.refreshDrafts.drafts).Count)"
    }
  }

  if ($Detailed) {
    foreach ($item in @($result.items)) {
      Write-Host "  draft: $($item.draftNoteId) [$($item.targetCorpus)] $($item.title)"
    }
  }
}
