<#
.SYNOPSIS
Runs mimisbrunnr cleanup through mimir.

.DESCRIPTION
This script is a thin operator wrapper over the governed memory librarian. It
does not move, edit, delete, accept, reject, or promote notes directly.

By default it scans both canonical corpora and applies only safe actions that
the orchestrator policy allows. Use -DryRun to report findings without applying
safe archive actions.
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
      -Activity "mimisbrunnr cleanup" `
      -Status $Status `
      -PercentComplete $PercentComplete
  }
}

function Complete-CleanupProgress {
  if (-not $Json) {
    Write-Progress -Activity "mimisbrunnr cleanup" -Completed
  }
}

function Invoke-Mimir {
  param(
    [Parameter(Mandatory = $true)]
    [string] $Command,

    [Parameter(Mandatory = $true)]
    [hashtable] $Payload,

    [ValidateSet("heuristic", "model", "auto")]
    [string] $ProviderModeOverride = $ProviderMode,

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
  $previousMimisbrunnrProvider = $env:MAB_ROLE_MIMISBRUNNR_PRIMARY_PROVIDER
  $env:NODE_NO_WARNINGS = "1"
  $env:MAB_DATA_ROOT = $DataRoot
  $env:MAB_VAULT_ROOT = $VaultRoot
  $env:MAB_STAGING_ROOT = $StagingRoot
  $env:MAB_SQLITE_PATH = $SqlitePath
  switch ($ProviderModeOverride) {
    "heuristic" {
      $env:MAB_ROLE_MIMISBRUNNR_PRIMARY_PROVIDER = "internal_heuristic"
    }
    "model" {
      $env:MAB_ROLE_MIMISBRUNNR_PRIMARY_PROVIDER = "docker_ollama"
    }
  }
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
    $env:MAB_ROLE_MIMISBRUNNR_PRIMARY_PROVIDER = $previousMimisbrunnrProvider
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

$corpora = if ($Corpus -eq "all") {
  @("general_notes", "mimisbrunnr")
} else {
  @($Corpus)
}

$cleanupPhases = @()
switch ($ReviewDepth) {
  "fast" {
    $cleanupPhases += [pscustomobject] @{
      label = "fast"
      providerMode = $ProviderMode
      maxNotes = $MaxNotes
      applySafeActions = -not $DryRun
      timeoutSeconds = $CommandTimeoutSeconds
    }
  }
  "balanced" {
    $cleanupPhases += [pscustomobject] @{
      label = "heuristic"
      providerMode = $ProviderMode
      maxNotes = $MaxNotes
      applySafeActions = -not $DryRun
      timeoutSeconds = $CommandTimeoutSeconds
    }
    $cleanupPhases += [pscustomobject] @{
      label = "model-sample"
      providerMode = "model"
      maxNotes = $ModelSampleNotes
      applySafeActions = (-not $DryRun) -and [bool] $ApplyModelSafeActions
      timeoutSeconds = $ModelCommandTimeoutSeconds
    }
  }
  "model" {
    $cleanupPhases += [pscustomobject] @{
      label = "model"
      providerMode = "model"
      maxNotes = $MaxNotes
      applySafeActions = -not $DryRun
      timeoutSeconds = $ModelCommandTimeoutSeconds
    }
  }
}

Write-CleanupStatus "Loading mimisbrunnr cleanup runner."
Write-CleanupStatus "mimisbrunnr data root: $DataRoot"
Write-CleanupStatus "Memory vault: $VaultRoot"
Write-CleanupStatus "Runtime repo: $RuntimeRepoRoot"
Write-CleanupStatus "Target corpora: $($corpora -join ', ')"
Write-CleanupStatus "Mode: $(if ($DryRun) { "dry run; no safe actions will be applied" } else { "apply safe librarian actions" })"
Write-CleanupStatus "Review depth: $ReviewDepth"
Write-CleanupStatus "Provider mode: $ProviderMode$(if ($ProviderMode -eq "heuristic") { " (fast deterministic provider)" } elseif ($ProviderMode -eq "model") { " (local model provider)" } else { " (environment/runtime default)" })"
Write-CleanupStatus "Heartbeat: every $StatusIntervalSeconds seconds$(if ($CommandTimeoutSeconds -gt 0) { "; command timeout: $CommandTimeoutSeconds seconds" } else { "; command timeout: none" })"
if ($ReviewDepth -in @("balanced", "model")) {
  Write-CleanupStatus "Model timeout: $(if ($ModelCommandTimeoutSeconds -gt 0) { "$ModelCommandTimeoutSeconds seconds" } else { "none" })"
}
if ($ReviewDepth -eq "balanced") {
  Write-CleanupStatus "Model sample: $ModelSampleNotes notes per corpus; safe actions $(if ((-not $DryRun) -and $ApplyModelSafeActions) { "enabled" } else { "disabled/report-only" })"
}
Write-CleanupStatus "Detailed run read: $(if ($Detailed) { "enabled" } else { "skipped for faster frequent runs" })"

$runs = @()
$stepsPerCorpus = if ($Detailed) { 2 } else { 1 }
$totalSteps = [Math]::Max($corpora.Count * $cleanupPhases.Count * $stepsPerCorpus, 1)
$step = 0

try {
  foreach ($phase in $cleanupPhases) {
    foreach ($corpusId in $corpora) {
      $step += 1
      Write-CleanupStatus "[$($phase.label)/$corpusId] Running memory librarian ($step/$totalSteps)."
      Write-CleanupProgress `
        -Status "Running $($phase.label) cleanup for $corpusId" `
        -PercentComplete ([int] ((($step - 1) * 100) / $totalSteps))

      $run = Invoke-Mimir "run-memory-librarian" @{
        corpusId = $corpusId
        maxNotes = [int] $phase.maxNotes
        applySafeActions = [bool] $phase.applySafeActions
      } `
        -ProviderModeOverride $phase.providerMode `
        -TimeoutSeconds $phase.timeoutSeconds

      if (-not $run.ok) {
          throw "run-memory-librarian failed for '$corpusId': $($run.error.message)"
      }

      $recordData = $run.data
      if ($Detailed) {
        $step += 1
        Write-CleanupStatus "[$($phase.label)/$corpusId] Reading persisted run record $($run.data.runId) ($step/$totalSteps)."
        Write-CleanupProgress `
          -Status "Reading persisted run record for $corpusId" `
          -PercentComplete ([int] ((($step - 1) * 100) / $totalSteps))

        $record = Invoke-Mimir "read-memory-librarian-run" @{
          runId = $run.data.runId
        } `
          -ProviderModeOverride $phase.providerMode `
          -TimeoutSeconds $phase.timeoutSeconds

        if (-not $record.ok) {
          throw "read-memory-librarian-run failed for '$($run.data.runId)': $($record.error.message)"
        }

        $recordData = $record.data
      } else {
        Write-CleanupStatus "[$($phase.label)/$corpusId] Skipping persisted run detail read; use -Detailed to load the stored run record."
      }

      $runSummary = [pscustomobject] @{
        phase = $phase.label
        corpusId = $corpusId
        runId = $run.data.runId
        mode = $run.data.mode
        providerMode = $phase.providerMode
        dryRun = [bool] $DryRun
        applySafeActions = [bool] $phase.applySafeActions
        maxNotes = [int] $phase.maxNotes
        scannedCount = $run.data.scannedCount
        findingCount = $run.data.findingCount
        appliedCount = $run.data.appliedCount
        warningCount = @($run.data.warnings).Count
        startedAt = $run.data.startedAt
        completedAt = $run.data.completedAt
        findings = $recordData.findings
        appliedActions = $recordData.appliedActions
        warnings = $recordData.warnings
      }

      $runs += $runSummary
      Write-CleanupStatus "[$($phase.label)/$corpusId] Complete: scanned $($runSummary.scannedCount), findings $($runSummary.findingCount), applied $($runSummary.appliedCount), warnings $($runSummary.warningCount)."
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
  totalScanned = ($runs | Measure-Object -Property scannedCount -Sum).Sum
  totalFindings = ($runs | Measure-Object -Property findingCount -Sum).Sum
  totalApplied = ($runs | Measure-Object -Property appliedCount -Sum).Sum
  totalWarnings = ($runs | Measure-Object -Property warningCount -Sum).Sum
  runs = @($runs)
}

if ($Json) {
  $summary | ConvertTo-Json -Depth 64
  exit 0
}

Write-Host "mimisbrunnr cleanup complete"
Write-Host "mimisbrunnr data root: $DataRoot"
Write-Host "Memory vault: $VaultRoot"
Write-Host "Runtime repo: $RuntimeRepoRoot"
Write-Host "Mode: $(if ($DryRun) { "dry run" } else { "apply safe actions" })"
Write-Host "Review depth: $ReviewDepth"
Write-Host "Max notes per corpus: $MaxNotes"
Write-Host "Provider mode: $ProviderMode"
if ($ReviewDepth -eq "balanced") {
  Write-Host "Model sample notes per corpus: $ModelSampleNotes"
  Write-Host "Model sample safe actions: $(if ((-not $DryRun) -and $ApplyModelSafeActions) { "enabled" } else { "disabled/report-only" })"
}
if ($ReviewDepth -in @("balanced", "model")) {
  Write-Host "Model command timeout: $(if ($ModelCommandTimeoutSeconds -gt 0) { "$ModelCommandTimeoutSeconds seconds" } else { "none" })"
}
Write-Host "Heartbeat interval: $StatusIntervalSeconds seconds"
Write-Host "Command timeout: $(if ($CommandTimeoutSeconds -gt 0) { "$CommandTimeoutSeconds seconds" } else { "none" })"
Write-Host "Detailed run read: $([bool] $Detailed)"
Write-Host ""

foreach ($run in $runs) {
  Write-Host "[$($run.phase)/$($run.corpusId)] run $($run.runId)"
  Write-Host "  provider: $($run.providerMode)"
  Write-Host "  maxNotes: $($run.maxNotes)"
  Write-Host "  applySafeActions: $($run.applySafeActions)"
  Write-Host "  scanned:  $($run.scannedCount)"
  Write-Host "  findings: $($run.findingCount)"
  Write-Host "  applied:  $($run.appliedCount)"
  Write-Host "  warnings: $($run.warningCount)"

  foreach ($action in @($run.appliedActions)) {
    Write-Host "  applied action: $($action.action) $($action.notePath)"
    Write-Host "    $($action.message)"
  }

  foreach ($warning in @($run.warnings)) {
    Write-Host "  warning:  $warning"
  }
}
