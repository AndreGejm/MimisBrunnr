Set-StrictMode -Version Latest

. (Join-Path $PSScriptRoot "process-capture.ps1")

function Invoke-InstallerCorepackPnpmCommand {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)]
    [string]$RepoRoot,

    [Parameter(Mandatory = $true)]
    [string[]]$PnpmArguments
  )

  return Invoke-ProcessCaptureAdapter `
    -ExecutableName "corepack" `
    -Arguments (@("pnpm") + @($PnpmArguments)) `
    -WorkingDirectory $RepoRoot
}
