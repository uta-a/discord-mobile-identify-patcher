param(
  [ValidateSet("stable", "canary", "ptb")]
  [string]$Branch = "stable",

  [ValidateSet("self", "vencord-layer")]
  [string]$Target = $env:DMI_UNINSTALL_TARGET
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($Target)) {
  $Target = "self"
}

$command = switch ($Target) {
  "self" { "uninstall-self" }
  "vencord-layer" { "uninstall-vencord-layer" }
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

  node src/cli.mjs $command --branch $Branch --force-close
} finally {
  Set-Location $previousLocation
}
