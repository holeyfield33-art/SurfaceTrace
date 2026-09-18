param(
    [string]$Script = "dev:all",
    [switch]$Install,
    [switch]$UseOnly
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
$toolchainPath = $null
if ($nodeCommand -and (& $nodeCommand.Source --version) -match '^v22\.') {
    $toolchainPath = Split-Path -Parent $nodeCommand.Source
}

if (-not $toolchainPath) {
    $toolchain = Get-ChildItem -Path "$env:USERPROFILE\.toolchains" -Directory -Filter "node-v22.*-win-*" -ErrorAction SilentlyContinue |
        Sort-Object { [version]($_.Name -replace '^node-v|\-win-.*$', '') } -Descending |
        Where-Object { (Test-Path -LiteralPath (Join-Path $_.FullName 'node.exe')) -and (Test-Path -LiteralPath (Join-Path $_.FullName 'npm.cmd')) } |
        Select-Object -First 1
    if ($toolchain) { $toolchainPath = $toolchain.FullName }
}

if (-not $toolchainPath) {
    throw @"
No Node 22 toolchain found under $env:USERPROFILE\.toolchains\node-v22*.
Select Node 22 with your own Node manager, then run: npm run $Script
See README.md under Quick Start for details.
"@
}

# Move Node 22 to the front even if it was already present after another Node.
$remainingPath = ($env:PATH -split ';' | Where-Object { $_ -and $_ -ne $toolchainPath }) -join ';'
$env:PATH = "$toolchainPath;$remainingPath"
$selectedNode = Join-Path $toolchainPath 'node.exe'
$selectedNpm = Join-Path $toolchainPath 'npm.cmd'
if ((& $selectedNode --version) -notmatch '^v22\.' -or -not (Test-Path -LiteralPath $selectedNpm)) {
    throw "The selected toolchain must contain Node 22 and npm.cmd: $toolchainPath"
}
Write-Host "SurfaceTrace is using $(& $selectedNode --version) from $toolchainPath"

Push-Location $repoRoot
try {
    if ($Install) {
        & $selectedNpm ci
        if ($LASTEXITCODE -ne 0) { throw "Dependency installation failed (exit $LASTEXITCODE)." }
    }
    if ($UseOnly) {
        Write-Host 'Node 22 is selected for this PowerShell session. Run npm run dev:all when Docker is stopped.'
        return
    }
    & $selectedNpm run $Script
    if ($LASTEXITCODE -ne 0) { throw "npm run $Script failed (exit $LASTEXITCODE)." }
} finally {
    Pop-Location
}
