param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("Install", "Uninstall")]
  [string]$Action,

  [string]$ProgramPath = "",

  [switch]$Elevated
)

$ErrorActionPreference = "Stop"
$ruleName = "AetherX Hub (Private LAN)"
$logDirectory = Join-Path $env:ProgramData "AetherX"
$logPath = Join-Path $logDirectory "installer-firewall.log"

function Test-IsAdministrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Write-FirewallLog([string]$Message) {
  New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
  Add-Content -Path $logPath -Value "$(Get-Date -Format o) $Message" -Encoding UTF8
}

if (-not (Test-IsAdministrator)) {
  if ($Elevated) {
    exit 5
  }

  $arguments = @(
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy", "Bypass",
    "-File", "`"$PSCommandPath`"",
    "-Action", $Action,
    "-ProgramPath", "`"$ProgramPath`"",
    "-Elevated"
  )

  try {
    $process = Start-Process -FilePath "powershell.exe" -Verb RunAs -ArgumentList $arguments -Wait -PassThru
    exit $process.ExitCode
  } catch {
    exit 1223
  }
}

Write-FirewallLog "Starting $Action for $ProgramPath"

Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue |
  Remove-NetFirewallRule -ErrorAction Stop

if ($Action -eq "Uninstall") {
  if (Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue) {
    throw "Failed to remove the AetherX private LAN firewall rule."
  }
  Write-FirewallLog "Uninstall completed"
  exit 0
}

if (-not $ProgramPath) {
  throw "ProgramPath is required when installing the firewall rule."
}

New-NetFirewallRule `
  -DisplayName $ruleName `
  -Direction Inbound `
  -Action Allow `
  -Enabled True `
  -Profile Private `
  -Protocol TCP `
  -LocalPort 4318 `
  -RemoteAddress LocalSubnet `
  -Program $ProgramPath | Out-Null

$rule = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction Stop
$port = $rule | Get-NetFirewallPortFilter
$address = $rule | Get-NetFirewallAddressFilter
$application = $rule | Get-NetFirewallApplicationFilter
$valid = @($rule).Count -eq 1 -and
  $rule.Direction.ToString() -eq "Inbound" -and
  $rule.Action.ToString() -eq "Allow" -and
  $rule.Enabled.ToString() -eq "True" -and
  $rule.Profile.ToString() -eq "Private" -and
  $port.Protocol.ToString() -eq "TCP" -and
  $port.LocalPort.ToString() -eq "4318" -and
  $address.RemoteAddress.ToString() -eq "LocalSubnet" -and
  $application.Program -ieq $ProgramPath

if (-not $valid) {
  throw "The AetherX private LAN firewall rule failed validation."
}

Write-FirewallLog "Install completed and validated"
