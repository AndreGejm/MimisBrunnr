Set-StrictMode -Version Latest

function Invoke-NodeJsonScriptAdapter {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)]
    [string]$RepoRoot,

    [Parameter(Mandatory = $true)]
    [string]$ScriptRelativePath,

    [Parameter(Mandatory = $true)]
    [string[]]$ScriptArguments
  )

  $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
  if (-not $nodeCommand) {
    throw "Node executable 'node' was not found on PATH."
  }

  $scriptPath = Join-Path $RepoRoot $ScriptRelativePath
  if (-not (Test-Path $scriptPath)) {
    throw "Node helper script not found at '$scriptPath'."
  }

  $arguments = @($scriptPath) + @($ScriptArguments)
  $stdoutPath = Join-Path ([System.IO.Path]::GetTempPath()) "mimir-installer-$([guid]::NewGuid())-stdout.txt"
  $stderrPath = Join-Path ([System.IO.Path]::GetTempPath()) "mimir-installer-$([guid]::NewGuid())-stderr.txt"

  try {
    $process = Start-Process `
      -FilePath $nodeCommand.Source `
      -ArgumentList $arguments `
      -WorkingDirectory $RepoRoot `
      -Wait `
      -PassThru `
      -NoNewWindow `
      -RedirectStandardOutput $stdoutPath `
      -RedirectStandardError $stderrPath

    $stdout = if (Test-Path $stdoutPath) { Get-Content -Raw -Path $stdoutPath } else { "" }
    $stderr = if (Test-Path $stderrPath) { Get-Content -Raw -Path $stderrPath } else { "" }

    if ($process.ExitCode -ne 0) {
      throw "$ScriptRelativePath failed with exit code $($process.ExitCode). $stderr".Trim()
    }

    return [pscustomobject]@{
      command = [pscustomobject]@{
        command  = $nodeCommand.Source
        args     = $arguments
        exitCode = $process.ExitCode
      }
      payload = ($stdout | ConvertFrom-Json)
    }
  } finally {
    if (Test-Path $stdoutPath) {
      Remove-Item -Force $stdoutPath
    }
    if (Test-Path $stderrPath) {
      Remove-Item -Force $stderrPath
    }
  }
}
