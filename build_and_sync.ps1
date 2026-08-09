$nodeExe = Join-Path $PSScriptRoot "node-v20.11.0-win-x64\node.exe"
if (-not (Test-Path $nodeExe)) { $nodeExe = (Get-Command node -ErrorAction Stop).Source }
& $nodeExe "$PSScriptRoot\node_modules\vite\bin\vite.js" build
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& $nodeExe "$PSScriptRoot\node_modules\@capacitor\cli\bin\capacitor" sync android
exit $LASTEXITCODE
