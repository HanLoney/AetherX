param(
    [string] $SigningConfig = (Join-Path $env:USERPROFILE ".aetherx\signing\android-signing.json")
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$configPath = (Resolve-Path -LiteralPath $SigningConfig).Path
$config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json

function Unprotect-Value([string] $value) {
    $secure = ConvertTo-SecureString $value
    return (New-Object System.Management.Automation.PSCredential("aetherx", $secure)).GetNetworkCredential().Password
}

$env:AETHERX_REQUIRE_SIGNING = "true"
$env:AETHERX_ANDROID_KEYSTORE = $config.keystorePath
$env:AETHERX_ANDROID_KEYSTORE_PASSWORD = Unprotect-Value $config.keystorePassword
$env:AETHERX_ANDROID_KEY_ALIAS = $config.keyAlias
$env:AETHERX_ANDROID_KEY_PASSWORD = Unprotect-Value $config.keyPassword

try {
    Push-Location (Join-Path $root "frontend\mobile")
    npm run android:sync
    if ($LASTEXITCODE -ne 0) { throw "Capacitor sync failed." }
    Push-Location android
    & .\gradlew.bat testDebugUnitTest assembleRelease assembleLanRelease bundleRelease
    if ($LASTEXITCODE -ne 0) { throw "Signed Android build failed." }
    Pop-Location
    node (Join-Path $root "scripts\verify-android-signature.js") `
        (Join-Path $root "frontend\mobile\android\app\build\outputs\apk\release\app-release.apk")
    if ($LASTEXITCODE -ne 0) { throw "APK signature verification failed." }
    node (Join-Path $root "scripts\verify-android-signature.js") `
        (Join-Path $root "frontend\mobile\android\app\build\outputs\apk\lanRelease\app-lanRelease.apk")
    if ($LASTEXITCODE -ne 0) { throw "LAN APK signature verification failed." }
    node (Join-Path $root "scripts\verify-android-bundle.js") `
        (Join-Path $root "frontend\mobile\android\app\build\outputs\bundle\release\app-release.aab")
    if ($LASTEXITCODE -ne 0) { throw "AAB signature verification failed." }
    Write-Host "Signed Android release build passed."
} finally {
    while ((Get-Location).Path -ne $root -and (Get-Location).Path.StartsWith($root)) { Pop-Location }
    Remove-Item Env:AETHERX_REQUIRE_SIGNING -ErrorAction SilentlyContinue
    Remove-Item Env:AETHERX_ANDROID_KEYSTORE -ErrorAction SilentlyContinue
    Remove-Item Env:AETHERX_ANDROID_KEYSTORE_PASSWORD -ErrorAction SilentlyContinue
    Remove-Item Env:AETHERX_ANDROID_KEY_ALIAS -ErrorAction SilentlyContinue
    Remove-Item Env:AETHERX_ANDROID_KEY_PASSWORD -ErrorAction SilentlyContinue
}
