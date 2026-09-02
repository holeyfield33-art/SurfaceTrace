param(
    [string]$Script = "dev:all"
)

$toolchain = Get-ChildItem -Path "$env:USERPROFILE\.toolchains" -Directory -Filter "node-v22*" -ErrorAction SilentlyContinue |
    Sort-Object Name -Descending |
    Select-Object -First 1

if (-not $toolchain) {
    Write-Error @"
No Node 22 toolchain found under $env:USERPROFILE\.toolchains\node-v22*.
Select Node 22 with your own Node manager, then run: npm run $Script
See README.md under Quick Start for details.
"@
    exit 1
}

$toolchainPath = $toolchain.FullName
if (($env:PATH -split ";") -notcontains $toolchainPath) {
    $env:PATH = "$toolchainPath;$env:PATH"
}

npm run $Script
exit $LASTEXITCODE
