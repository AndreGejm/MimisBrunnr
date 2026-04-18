[CmdletBinding()]
param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$Arguments
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$cliPath = Join-Path $PSScriptRoot "cli.ps1"
& $cliPath @Arguments
