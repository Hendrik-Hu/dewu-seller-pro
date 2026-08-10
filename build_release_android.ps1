$ErrorActionPreference = "Stop"

$localEnv = Join-Path $PSScriptRoot '.env.local'
if (Test-Path $localEnv) {
  Get-Content $localEnv | ForEach-Object {
    if ($_ -match '^\s*VITE_PUBLIC_SITE_URL\s*=\s*(.+?)\s*$' -and -not $env:VITE_PUBLIC_SITE_URL) {
      $env:VITE_PUBLIC_SITE_URL = $matches[1].Trim('"', "'")
    }
  }
}

function Require-Env([string]$Name) {
  $value = [Environment]::GetEnvironmentVariable($Name)
  if ([string]::IsNullOrWhiteSpace($value)) { throw "Missing required release environment variable: $Name" }
  return $value
}

$publicSite = Require-Env "VITE_PUBLIC_SITE_URL"
if ($publicSite -notmatch '^https://[^/]+') { throw "VITE_PUBLIC_SITE_URL must be a verified HTTPS origin." }
$publicSite = $publicSite.TrimEnd('/')
$env:SELLER_INVENTORY_RECOVERY_HOST = ([Uri]$publicSite).Host
foreach ($policyPage in @(
  @{ Path = 'privacy.html'; RequiredLink = '/account-deletion.html' },
  @{ Path = 'account-deletion.html'; RequiredLink = '/privacy.html' }
)) {
  $page = $policyPage.Path
  $response = Invoke-WebRequest -UseBasicParsing -Uri "$publicSite/$page" -Method Get -MaximumRedirection 3 -TimeoutSec 20
  if ($response.StatusCode -ne 200 -or $response.Content -notmatch [Regex]::Escape($policyPage.RequiredLink)) {
    throw "Public policy page failed verification: $publicSite/$page"
  }
}
$assetLinks = Invoke-WebRequest -UseBasicParsing -Uri "$publicSite/.well-known/assetlinks.json" -Method Get -MaximumRedirection 0 -TimeoutSec 20
if ($assetLinks.StatusCode -ne 200 -or $assetLinks.Headers.'Content-Type' -notmatch '^application/json(?:;|$)') {
  throw "Android App Link association failed verification."
}
$assetLinksJson = $assetLinks.Content | ConvertFrom-Json
$keystore = [IO.Path]::GetFullPath((Require-Env "SELLER_INVENTORY_KEYSTORE"))
$workspace = [IO.Path]::GetFullPath($PSScriptRoot).TrimEnd('\') + '\'
if ($keystore.StartsWith($workspace, [StringComparison]::OrdinalIgnoreCase)) { throw "Release keystore must be stored outside the repository." }
if (-not (Test-Path -LiteralPath $keystore -PathType Leaf)) { throw "Release keystore does not exist." }
[void](Require-Env "SELLER_INVENTORY_STORE_PASSWORD")
[void](Require-Env "SELLER_INVENTORY_KEY_ALIAS")
[void](Require-Env "SELLER_INVENTORY_KEY_PASSWORD")

$nodeExe = Join-Path $PSScriptRoot "node-v20.11.0-win-x64\node.exe"
if (-not (Test-Path $nodeExe)) { $nodeExe = (Get-Command node -ErrorAction Stop).Source }
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME

Write-Host "1/4 Building production web assets..."
& $nodeExe "$PSScriptRoot\node_modules\vite\bin\vite.js" build
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Host "2/4 Syncing Android project..."
& $nodeExe "$PSScriptRoot\node_modules\@capacitor\cli\bin\capacitor" sync android
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Host "3/4 Building signed Release APK and AAB..."
Push-Location "$PSScriptRoot\android"
try {
  & .\gradlew.bat clean assembleRelease bundleRelease
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally { Pop-Location }

$apk = Join-Path $PSScriptRoot "android\app\build\outputs\apk\release\app-release.apk"
$aab = Join-Path $PSScriptRoot "android\app\build\outputs\bundle\release\app-release.aab"
if (-not (Test-Path $apk) -or -not (Test-Path $aab)) { throw "Release APK or AAB was not produced." }
$apksigner = Get-ChildItem "$env:ANDROID_HOME\build-tools" -Directory | Sort-Object Name -Descending | ForEach-Object { Join-Path $_.FullName "apksigner.bat" } | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $apksigner) { throw "Android apksigner was not found." }
$signature = & $apksigner verify --print-certs $apk 2>&1
if ($LASTEXITCODE -ne 0 -or ($signature -join "`n") -notmatch 'Signer #1 certificate SHA-256 digest') { throw "Release APK signature verification failed." }
$certificateDigest = (($signature | Where-Object { $_ -match 'Signer #1 certificate SHA-256 digest' } | Select-Object -First 1) -split ':', 2)[1].Trim().Replace(':', '').ToUpperInvariant()
$declaredDigests = @($assetLinksJson | Where-Object { $_.target.namespace -eq 'android_app' -and $_.target.package_name -eq 'com.hendrikhu.sellerinventory' } | ForEach-Object { $_.target.sha256_cert_fingerprints } | ForEach-Object { ([string]$_).Replace(':', '').ToUpperInvariant() })
if ($declaredDigests -notcontains $certificateDigest) { throw "The signed APK certificate is not declared by assetlinks.json." }

Write-Host "4/4 Release verification complete." -ForegroundColor Green
Write-Host "APK: $apk"
Write-Host "APK SHA-256: $((Get-FileHash -Algorithm SHA256 $apk).Hash)"
Write-Host "AAB: $aab"
Write-Host "AAB SHA-256: $((Get-FileHash -Algorithm SHA256 $aab).Hash)"
Write-Host "APK certificate SHA-256: $certificateDigest"
