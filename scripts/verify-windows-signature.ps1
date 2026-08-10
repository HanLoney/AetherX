param(
    [Parameter(Mandatory = $true, ValueFromRemainingArguments = $true)]
    [string[]] $Path
)

$ErrorActionPreference = "Stop"
$files = @()
foreach ($candidate in $Path) {
    $files += Get-Item -Path $candidate -ErrorAction Stop | Where-Object { -not $_.PSIsContainer }
}
if ($files.Count -eq 0) {
    throw "No Windows release files were found."
}

foreach ($file in $files) {
    $signature = Get-AuthenticodeSignature -LiteralPath $file.FullName
    if ($signature.Status -ne "Valid") {
        throw "Invalid signature: $($file.FullName) ($($signature.Status): $($signature.StatusMessage))"
    }
    if (-not $signature.SignerCertificate) {
        throw "Missing signer certificate: $($file.FullName)"
    }
    Write-Host "Signature valid: $($file.Name) [$($signature.SignerCertificate.Subject)]"
}
