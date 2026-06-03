param(
  [string]$Branch = $env:DMI_BRANCH,
  [string]$Ref = $env:DMI_REF
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($Branch)) {
  $Branch = "stable"
}

if (@("stable", "canary", "ptb") -notcontains $Branch) {
  throw "Invalid branch '$Branch'. Use stable, canary, or ptb."
}

if ([string]::IsNullOrWhiteSpace($Ref)) {
  $Ref = "main"
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Node.js was not found in PATH. Install Node.js, then run this script again."
}

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  throw "npm was not found in PATH. Install Node.js with npm, then run this script again."
}

$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("discord-mobile-identify-patcher-" + [guid]::NewGuid().ToString())
$archivePath = Join-Path $tempRoot "source.zip"
$extractPath = Join-Path $tempRoot "source"
$archiveUrl = "https://github.com/uta-a/discord-mobile-identify-patcher/archive/refs/heads/$Ref.zip"

try {
  New-Item -ItemType Directory -Path $tempRoot | Out-Null
  Invoke-WebRequest -Uri $archiveUrl -OutFile $archivePath -UseBasicParsing
  Expand-Archive -LiteralPath $archivePath -DestinationPath $extractPath

  $repoRoot = Get-ChildItem -LiteralPath $extractPath -Directory | Select-Object -First 1
  if (-not $repoRoot) {
    throw "Downloaded archive did not contain a project directory."
  }

  & (Join-Path $repoRoot.FullName "scripts\install-windows.ps1") -Branch $Branch
} finally {
  if (Test-Path -LiteralPath $tempRoot) {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force
  }
}
