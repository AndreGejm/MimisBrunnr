Set-StrictMode -Version Latest

function Invoke-ProcessCaptureAdapter {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)]
    [string]$ExecutableName,

    [Parameter(Mandatory = $true)]
    [string[]]$Arguments,

    [string]$WorkingDirectory = "",

    [switch]$IgnoreExitCode
  )

  $command = Get-Command $ExecutableName -ErrorAction SilentlyContinue
  if (-not $command) {
    throw "Executable '$ExecutableName' was not found on PATH."
  }

  $resolvedWorkingDirectory = if ($WorkingDirectory) { $WorkingDirectory } else { (Get-Location).Path }
  Push-Location $resolvedWorkingDirectory
  $previousErrorActionPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = "Continue"
    $captured = & $command.Source @Arguments 2>&1
    $exitCode = if ($null -ne $LASTEXITCODE) { $LASTEXITCODE } else { 0 }
    $output = if ($null -eq $captured) { "" } else { ($captured | Out-String) }

    if (-not $IgnoreExitCode -and $exitCode -ne 0) {
      throw "$ExecutableName $($Arguments -join ' ') failed with exit code $exitCode. $output".Trim()
    }

    return [pscustomobject]@{
      command = [pscustomobject]@{
        command = $command.Source
        args = @($Arguments)
        exitCode = $exitCode
      }
      stdout = $output
      stderr = ""
    }
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
    Pop-Location
  }
}
