$zipPath = ".\node-v20.11.0-win-x64.zip"
$destPath = "."

Write-Host "Unzipping $zipPath to $destPath..."
if (Test-Path $zipPath) {
    try {
        Expand-Archive -Path $zipPath -DestinationPath $destPath -Force
        Write-Host "Done."
    } catch {
        Write-Error "Unzip failed: $_"
        exit 1
    }
} else {
    Write-Error "Zip file not found: $zipPath"
    exit 1
}