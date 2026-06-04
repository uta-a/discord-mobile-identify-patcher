param(
  [string]$Branch = $env:DMI_BRANCH,

  [switch]$NonInteractive
)

$ErrorActionPreference = "Stop"

if (-not [string]::IsNullOrWhiteSpace($Branch) -and @("stable", "canary", "ptb") -notcontains $Branch) {
  throw "Invalid branch '$Branch'. Use stable, canary, or ptb."
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

  $nodeArgs = @("src/cli.mjs", "install", "--force-close")
  if (-not [string]::IsNullOrWhiteSpace($Branch)) {
    $nodeArgs += @("--branch", $Branch)
  }

  if (-not $NonInteractive -and $env:DMI_NONINTERACTIVE -ne "1") {
    $nodeArgs += "--interactive"
  }

  node @nodeArgs
} finally {
  Set-Location $previousLocation
}
