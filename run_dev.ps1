$nodeExe = Join-Path $PSScriptRoot "node-v20.11.0-win-x64\node.exe"
if (-not (Test-Path $nodeExe)) { $nodeExe = (Get-Command node -ErrorAction Stop).Source }
& $nodeExe "$PSScriptRoot\node_modules\vite\bin\vite.js" --host 0.0.0.0 --port 3000
