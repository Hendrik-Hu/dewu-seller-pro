$localNode = Join-Path $PSScriptRoot "node-v20.11.0-win-x64"
if (Test-Path $localNode) {
    $env:Path = "$localNode;" + $env:Path
}

npm run dev
