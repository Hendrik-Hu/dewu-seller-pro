$nodeUrl = "https://nodejs.org/dist/v20.11.0/node-v20.11.0-win-x64.zip"
$destPath = "..\node-v20.11.0-win-x64.zip"
$extractPath = ".."

Write-Host "Downloading Node.js..."
try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -Uri $nodeUrl -OutFile $destPath -UseBasicParsing
} catch {
    Write-Error "Download failed: $_"
    exit 1
}

Write-Host "Extracting..."
if (Test-Path $destPath) {
    Expand-Archive -Path $destPath -DestinationPath $extractPath -Force
    Write-Host "Done."
} else {
    Write-Error "File not found: $destPath"
}
