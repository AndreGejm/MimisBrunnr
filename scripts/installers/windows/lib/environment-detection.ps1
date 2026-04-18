Set-StrictMode -Version Latest

function Get-InstallerEnvironmentReport {
  [CmdletBinding()]
  param()

  $capabilities = @(
    Get-PowerShellCapability
    Get-ExecutableCapability -Id "node" -DisplayName "Node.js" -Commands @("node")
    Get-ExecutableCapability -Id "git" -DisplayName "Git" -Commands @("git")
    Get-ExecutableCapability -Id "corepack" -DisplayName "Corepack" -Commands @("corepack", "corepack.cmd")
    Get-ExecutableCapability -Id "python" -DisplayName "Python launcher" -Commands @("py", "python")
    Get-ExecutableCapability -Id "docker_cli" -DisplayName "Docker CLI" -Commands @("docker")
    Get-DockerEngineCapability
  )

  return [pscustomobject]@{
    detectedAt   = (Get-Date).ToUniversalTime().ToString("o")
    capabilities = $capabilities
    summary      = [pscustomobject]@{
      readyCount           = @($capabilities | Where-Object { $_.state -eq "Ready" }).Count
      userActionRequiredCount = @($capabilities | Where-Object { $_.state -eq "NeedsUserAction" }).Count
      notDetectedCount     = @($capabilities | Where-Object { $_.state -eq "NotDetected" }).Count
    }
  }
}

function Get-PowerShellCapability {
  [CmdletBinding()]
  param()

  $version = if ($PSVersionTable.PSVersion) {
    $PSVersionTable.PSVersion.ToString()
  } else {
    ""
  }

  return [pscustomobject]@{
    id         = "powershell"
    displayName = "Windows PowerShell"
    state      = "Ready"
    reasonCode = "host_available"
    message    = "Installer host is running in Windows PowerShell."
    details    = [pscustomobject]@{
      version = $version
      edition = $PSVersionTable.PSEdition
    }
  }
}

function Get-ExecutableCapability {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)]
    [string]$Id,

    [Parameter(Mandatory = $true)]
    [string]$DisplayName,

    [Parameter(Mandatory = $true)]
    [string[]]$Commands
  )

  foreach ($commandName in $Commands) {
    $command = Get-Command $commandName -ErrorAction SilentlyContinue
    if ($command) {
      return [pscustomobject]@{
        id         = $Id
        displayName = $DisplayName
        state      = "Ready"
        reasonCode = "command_on_path"
        message    = "$DisplayName is available on PATH."
        details    = [pscustomobject]@{
          command = $commandName
          path    = $command.Source
        }
      }
    }
  }

  return [pscustomobject]@{
    id         = $Id
    displayName = $DisplayName
    state      = "NotDetected"
    reasonCode = "command_missing"
    message    = "$DisplayName was not found on PATH."
    details    = [pscustomobject]@{
      commands = @($Commands)
    }
  }
}

function Get-DockerEngineCapability {
  [CmdletBinding()]
  param()

  $dockerCli = Get-ExecutableCapability -Id "docker_cli" -DisplayName "Docker CLI" -Commands @("docker")
  if ($dockerCli.state -ne "Ready") {
    return [pscustomobject]@{
      id         = "docker_engine"
      displayName = "Docker engine"
      state      = "NotDetected"
      reasonCode = "docker_cli_missing"
      message    = "Docker engine was not checked because the Docker CLI is missing."
      details    = [pscustomobject]@{}
    }
  }

  $namedPipes = @("\\.\pipe\docker_engine", "\\.\pipe\dockerDesktopLinuxEngine")
  $engineReady = $false
  foreach ($pipePath in $namedPipes) {
    if (Test-Path $pipePath) {
      $engineReady = $true
      break
    }
  }

  if ($engineReady) {
    return [pscustomobject]@{
      id         = "docker_engine"
      displayName = "Docker engine"
      state      = "Ready"
      reasonCode = "engine_pipe_available"
      message    = "Docker engine named pipe is available."
      details    = [pscustomobject]@{
        namedPipes = $namedPipes
      }
    }
  }

  return [pscustomobject]@{
    id         = "docker_engine"
    displayName = "Docker engine"
    state      = "NeedsUserAction"
    reasonCode = "engine_not_running"
    message    = "Docker CLI is present, but the Docker engine pipe was not detected."
    details    = [pscustomobject]@{
      namedPipes = $namedPipes
    }
  }
}
