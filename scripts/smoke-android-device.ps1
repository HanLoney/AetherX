param(
    [Parameter(Mandatory = $true)]
    [string] $Apk,
    [string] $PreviousApk = ""
)

$ErrorActionPreference = "Stop"
$packageName = "com.xuanxiaotech.aetherx.mobile"
$activityName = "$packageName/.MainActivity"
$resolvedApk = (Resolve-Path -LiteralPath $Apk).Path
$resolvedPreviousApk = if ($PreviousApk) { (Resolve-Path -LiteralPath $PreviousApk).Path } else { "" }
$adbCommand = Get-Command adb -ErrorAction SilentlyContinue
if ($adbCommand) {
    $adb = $adbCommand.Source
} else {
    $adb = Join-Path $env:LOCALAPPDATA "Android\Sdk\platform-tools\adb.exe"
    if (-not (Test-Path -LiteralPath $adb)) { throw "adb was not found in PATH or the default Android SDK." }
}
$devices = @(& $adb devices | Select-Object -Skip 1 | Where-Object { $_ -match "\tdevice$" })

if ($devices.Count -ne 1) {
    throw "Android smoke test requires exactly one authorized device; found $($devices.Count)."
}

if ($resolvedPreviousApk) {
    & $adb install -r $resolvedPreviousApk | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "Previous APK installation failed; use a clean release-test device." }
    $previousInfo = & $adb shell dumpsys package $packageName
    $previousVersion = ($previousInfo | Select-String -Pattern "versionName=").Line.Trim()
    Write-Host "Previous release installed: $previousVersion"
}

& $adb install -r $resolvedApk | Out-Host
if ($LASTEXITCODE -ne 0) { throw "Current APK installation or upgrade failed." }

& $adb shell am force-stop $packageName | Out-Null
& $adb shell monkey -p $packageName -c android.intent.category.LAUNCHER 1 | Out-Host
if ($LASTEXITCODE -ne 0) { throw "Application launch failed." }
Start-Sleep -Seconds 4

$appPid = (& $adb shell pidof $packageName).Trim()
if (-not $appPid) { throw "AetherX process is not running after launch." }

$packageInfo = & $adb shell dumpsys package $packageName
$versionName = ($packageInfo | Select-String -Pattern "versionName=").Line.Trim()
$versionCode = ($packageInfo | Select-String -Pattern "versionCode=").Line.Trim()
$fatal = & $adb logcat -d -t 300 AndroidRuntime:E *:S | Select-String -Pattern $packageName
if ($fatal) { throw "AndroidRuntime crash found in startup log:`n$($fatal -join "`n")" }

Write-Host "Android device smoke passed: pid=$appPid, $versionName, $versionCode"
