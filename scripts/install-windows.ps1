param(
  [ValidateSet("stable", "canary", "ptb")]
  [string]$Branch = "stable",

  [ValidateSet("preserve-existing", "direct-discord")]
  [string]$InstallMode = $env:DMI_INSTALL_MODE,

  [switch]$NonInteractive
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($InstallMode)) {
  $InstallMode = "direct-discord"
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $scriptDir "..")
$previousLocation = Get-Location

try {
  Set-Location $repoRoot

  if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw "Node.js was not found in PATH. Install Node.js, then run this script again."
  }

  if (-not (Test-Path (Join-Path $repoRoot "node_modules"))) {
    if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
      throw "npm was not found in PATH. Install Node.js with npm, then run this script again."
    }

    npm install
  }

  $nodeArgs = @("src/cli.mjs", "install", "--branch", $Branch, "--force-close", "--install-mode", $InstallMode)
  if (-not $NonInteractive -and $env:DMI_NONINTERACTIVE -ne "1") {
    $nodeArgs += "--interactive"
  }

  node @nodeArgs
} finally {
  Set-Location $previousLocation
}
