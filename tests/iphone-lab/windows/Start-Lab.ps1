param(
    [string]$LanIp = '',
    [ValidateRange(1024,65535)][int]$LabPort = 3443
)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Install Node.js 22, then reopen PowerShell.' }
$nodeVersion = (& node --version).Trim()
if ($nodeVersion -notmatch '^v22\.') { throw "This kit is verified with Node.js 22. Current version: $nodeVersion" }
if (-not (Get-Command mkcert -ErrorAction SilentlyContinue)) { throw 'Install mkcert: winget install --id FiloSottile.mkcert -e ; then reopen PowerShell.' }
if (-not $LanIp) {
    $addresses = @(Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq 'Up' } | ForEach-Object { $_.IPv4Address.IPAddress } | Where-Object { $_ -and $_ -notmatch '^(127\.|169\.254\.)' } | Select-Object -Unique)
    if ($addresses.Count -ne 1) { throw ('Specify your Wi-Fi/LAN IPv4 with -LanIp. Candidates: ' + ($addresses -join ', ')) }
    $LanIp = $addresses[0]
}
$parsedIp = [System.Net.IPAddress]::Parse($LanIp)
if ($parsedIp.AddressFamily -ne [System.Net.Sockets.AddressFamily]::InterNetwork) { throw 'Use the Windows computer LAN IPv4 address.' }
$certDirectory = Join-Path $PSScriptRoot 'certs'
New-Item -ItemType Directory -Force -Path $certDirectory | Out-Null
Write-Host 'Installing a LOCAL test CA into Windows trust. An OS confirmation may appear.'
& mkcert -install
if ($LASTEXITCODE -ne 0) { throw 'Local test CA installation failed. Server was not started.' }
$certificate = Join-Path $certDirectory 'iphone-lab.pem'
$privateKey = Join-Path $certDirectory 'iphone-lab-key.pem'
& mkcert -cert-file $certificate -key-file $privateKey localhost 127.0.0.1 $LanIp
if ($LASTEXITCODE -ne 0) { throw 'Test HTTPS certificate generation failed.' }
$caDirectory = (& mkcert -CAROOT).Trim()
$publicPem = Get-Content -LiteralPath (Join-Path $caDirectory 'rootCA.pem') -Raw
$publicDer = [Convert]::FromBase64String(($publicPem -replace '-----BEGIN CERTIFICATE-----','' -replace '-----END CERTIFICATE-----','' -replace '\s',''))
$phoneCertificate = Join-Path $certDirectory 'iphone-lab-rootCA.cer'
[IO.File]::WriteAllBytes($phoneCertificate, $publicDer)
Write-Host ''
Write-Host 'Synthetic accounts / MemoryDB ONLY. No Firebase login or deployment.'
Write-Host ('Windows: https://localhost:' + $LabPort + '/')
Write-Host ('iPhone (same Wi-Fi): https://' + $LanIp + ':' + $LabPort + '/')
Write-Host ('Transfer ONLY this PUBLIC certificate to iPhone: ' + $phoneCertificate)
Write-Host 'Never transfer rootCA-key.pem or iphone-lab-key.pem.'
Write-Host 'Install and trust that local CA on iPhone before testing PWA. See WINDOWS-README.md.'
Write-Host 'Allow Node.js on PRIVATE networks only if Windows Firewall asks. Keep this window open.'
& node (Join-Path $PSScriptRoot 'scripts\iphone-lab.cjs') --listen 0.0.0.0 --port $LabPort --phaser (Join-Path $PSScriptRoot 'vendor\phaser.min.js') --tls-cert $certificate --tls-key $privateKey
exit $LASTEXITCODE
