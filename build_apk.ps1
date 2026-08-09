Write-Warning "This command builds a DEBUG test APK only. It is not a release artifact."
& (Join-Path $PSScriptRoot "build_debug_apk.ps1")
exit $LASTEXITCODE
