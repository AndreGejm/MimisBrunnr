$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$sourcePath = Join-Path $repoRoot "skills"
$codexHome = Join-Path $env:USERPROFILE ".codex"
$skillsRoot = Join-Path $codexHome "skills"
$targetPath = Join-Path $skillsRoot "voltagent-default"

if (-not (Test-Path $sourcePath)) {
  throw "Expected skills directory at '$sourcePath'."
}

New-Item -ItemType Directory -Force -Path $skillsRoot | Out-Null

if (Test-Path $targetPath) {
  Remove-Item -LiteralPath $targetPath -Recurse -Force
}

cmd /c mklink /J "$targetPath" "$sourcePath" | Out-Null

Write-Output "Installed VoltAgent Default Codex skills:"
Write-Output "  $targetPath -> $sourcePath"
Write-Output "Restart Codex to pick up the new skills."
