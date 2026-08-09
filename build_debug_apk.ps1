$ErrorActionPreference = "Stop"

$nodeExe = Join-Path $PSScriptRoot "node-v20.11.0-win-x64\node.exe"
if (-not (Test-Path $nodeExe)) { $nodeExe = (Get-Command node -ErrorAction Stop).Source }

Write-Host "Building DEBUG test APK (not for release)..." -ForegroundColor Yellow
& $nodeExe "$PSScriptRoot\node_modules\vite\bin\vite.js" build
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& $nodeExe "$PSScriptRoot\node_modules\@capacitor\cli\bin\capacitor" sync android
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
Push-Location "$PSScriptRoot\android"
try {
  & .\gradlew.bat assembleDebug
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally { Pop-Location }

$apk = Join-Path $PSScriptRoot "android\app\build\outputs\apk\debug\app-debug.apk"
if (-not (Test-Path $apk)) { throw "Debug APK was not produced." }
Write-Host "DEBUG APK: $apk" -ForegroundColor Green
