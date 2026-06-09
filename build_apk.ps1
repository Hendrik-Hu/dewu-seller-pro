Write-Host "Starting APK build..."
Write-Host "--------------------------------"

$localNode = Join-Path $PSScriptRoot "node-v20.11.0-win-x64"
if (Test-Path $localNode) {
    $env:Path = "$localNode;" + $env:Path
}
$nodeExe = if (Test-Path (Join-Path $localNode "node.exe")) {
    Join-Path $localNode "node.exe"
} else {
    "node"
}

Write-Host "Step 1/3: Building React frontend..."
cmd /c "npm run build"

if ($LASTEXITCODE -ne 0) {
    Write-Host "React build failed." -ForegroundColor Red
    exit 1
}

Write-Host "Step 2/3: Syncing with Android project..."
& $nodeExe ".\node_modules\@capacitor\cli\bin\capacitor" "sync" "android"

if ($LASTEXITCODE -ne 0) {
    Write-Host "Capacitor sync failed." -ForegroundColor Red
    exit 1
}

Write-Host "Step 3/3: Compiling Android APK (this may take a few minutes)..."
Set-Location android

$preferredJdkPaths = @(
    "C:\Program Files\Android\Android Studio\jbr",
    "C:\Program Files\Java\jdk-17"
)

$resolvedJdkPath = $preferredJdkPaths | Where-Object { Test-Path $_ } | Select-Object -First 1
if ($resolvedJdkPath) {
    $env:JAVA_HOME = $resolvedJdkPath
    Write-Host "Set JAVA_HOME to $resolvedJdkPath" -ForegroundColor Cyan
} else {
    Write-Host "A compatible JDK was not found in the expected locations. Using system default..." -ForegroundColor Yellow
}

$preferredSdkPaths = @(
    "$env:LOCALAPPDATA\\Android\\Sdk",
    "C:\\Users\\admin\\AppData\\Local\\Android\\Sdk"
)

$resolvedSdkPath = $preferredSdkPaths | Where-Object { Test-Path $_ } | Select-Object -First 1
if ($resolvedSdkPath) {
    $env:ANDROID_HOME = $resolvedSdkPath
    $env:ANDROID_SDK_ROOT = $resolvedSdkPath
    Write-Host "Set ANDROID_HOME to $resolvedSdkPath" -ForegroundColor Cyan
} else {
    Write-Host "Android SDK was not found in the expected locations. Using system default..." -ForegroundColor Yellow
}

if (-not (Test-Path "gradlew.bat")) {
    Write-Host "gradlew.bat not found in android directory." -ForegroundColor Red
    Set-Location ..
    exit 1
}

try {
    cmd /c "gradlew.bat assembleDebug"
} catch {
    Write-Host "Gradle build error: $_" -ForegroundColor Red
    Set-Location ..
    exit 1
}

if ($LASTEXITCODE -ne 0) {
    Write-Host "APK compilation failed. Please ensure JDK 17+ and Android SDK are installed." -ForegroundColor Red
    Set-Location ..
    exit 1
}

$apkPath = "app\build\outputs\apk\debug\app-debug.apk"
if (Test-Path $apkPath) {
    $fullPath = Resolve-Path $apkPath
    Write-Host "--------------------------------"
    Write-Host "APK build succeeded!" -ForegroundColor Green
    Write-Host "File: $fullPath"

    explorer.exe /select,$fullPath
} else {
    Write-Host "Build finished but APK was not found at expected path." -ForegroundColor Yellow
}

Set-Location ..
