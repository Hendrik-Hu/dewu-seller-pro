Write-Host "🚀 Starting APK Build Process..."
Write-Host "--------------------------------"

# 1. Build React App
Write-Host "📦 Step 1/3: Building React frontend..."
# Add node to path just in case
$env:Path = "C:\Program Files\nodejs;" + $env:Path 

# Run npm build
cmd /c "npm run build"

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ React build failed." -ForegroundColor Red
    exit 1
}

# 2. Sync with Capacitor
Write-Host "🔄 Step 2/3: Syncing with Android project..."
cmd /c "npx cap sync android"

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Capacitor sync failed." -ForegroundColor Red
    exit 1
}

# 3. Build Android APK
Write-Host "🤖 Step 3/3: Compiling Android APK (this may take a few minutes)..."
Set-Location android

# Force set JAVA_HOME to JDK 17
$jdk17Path = "C:\Program Files\Java\jdk-17"
if (Test-Path $jdk17Path) {
    $env:JAVA_HOME = $jdk17Path
    Write-Host "ℹ️ Set JAVA_HOME to $jdk17Path" -ForegroundColor Cyan
} else {
    Write-Host "⚠️ JDK 17 not found at standard path. Using system default..." -ForegroundColor Yellow
}

# Check for Gradle wrapper
if (-not (Test-Path "gradlew.bat")) {
    Write-Host "❌ gradlew.bat not found in android directory." -ForegroundColor Red
    Set-Location ..
    exit 1
}

try {
    # Use cmd /c to run the batch file to avoid powershell execution policy or path issues
    cmd /c "gradlew.bat assembleDebug"
} catch {
    Write-Host "❌ Gradle build error: $_" -ForegroundColor Red
    Set-Location ..
    exit 1
}

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ APK Compilation failed. Please ensure JDK 17+ and Android SDK are installed." -ForegroundColor Red
    Set-Location ..
    exit 1
}

# 4. Locate and Open
$apkPath = "app\build\outputs\apk\debug\app-debug.apk"
if (Test-Path $apkPath) {
    $fullPath = Resolve-Path $apkPath
    Write-Host "--------------------------------"
    Write-Host "✅ APK Build Success!" -ForegroundColor Green
    Write-Host "📂 File: $fullPath"
    
    # Open explorer with file selected
    explorer.exe /select,$fullPath
} else {
    Write-Host "⚠️ Build finished but APK not found at expected path." -ForegroundColor Yellow
}

Set-Location ..
