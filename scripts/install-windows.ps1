param(
  [ValidateSet("stable", "canary", "ptb")]
  [string]$Branch = "stable",

  [switch]$NonInteractive
)

$ErrorActionPreference = "Stop"

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

  $nodeArgs = @("src/cli.mjs", "install", "--branch", $Branch, "--force-close")
  if (-not $NonInteractive -and $env:DMI_NONINTERACTIVE -ne "1") {
    $nodeArgs += "--interactive"
  }

  node @nodeArgs
} finally {
  Set-Location $previousLocation
}
