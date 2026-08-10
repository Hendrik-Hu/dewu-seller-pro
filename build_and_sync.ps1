$nodeExe = Join-Path $PSScriptRoot "node-v20.11.0-win-x64\node.exe"
if (-not (Test-Path $nodeExe)) { $nodeExe = (Get-Command node -ErrorAction Stop).Source }
& $nodeExe "$PSScriptRoot\scripts\build-target.mjs" android
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& $nodeExe "$PSScriptRoot\node_modules\@capacitor\cli\bin\capacitor" sync android
exit $LASTEXITCODE
