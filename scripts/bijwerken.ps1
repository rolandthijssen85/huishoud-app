# Werkt de app bij naar de nieuwste versie op GitHub en bouwt hem opnieuw op.
# Start via bijwerken.cmd (dubbelklik). Laat docker-compose.yml (met het echte
# wachtwoord), data\, data-backup* en .env altijd ongemoeid.
# Alleen ASCII in dit bestand: Windows PowerShell 5.1 leest het anders verkeerd.
param(
  [string]$Branch = "main",
  [int]$Bewaren = 5
)

$ErrorActionPreference = "Stop"
$Repo = "rolandthijssen85/huishoud-app"
$App = Split-Path -Parent $PSScriptRoot

function Stop-Met($tekst) {
  Write-Host ""
  Write-Host "MISLUKT: $tekst" -ForegroundColor Red
  exit 1
}

function Overslaan($pad) {
  $eerste = ($pad -split '[\\/]')[0]
  return ($pad -eq "docker-compose.yml") -or ($eerste -eq "data") -or
    ($eerste -like "data-backup*") -or ($eerste -eq "node_modules") -or ($eerste -eq ".github") -or
    ($eerste -like "*.env") -or ($eerste -eq ".env")
}

Set-Location $App
Write-Host "Huishoud-app bijwerken in $App" -ForegroundColor Cyan

cmd /c "docker info >nul 2>&1"
if ($LASTEXITCODE -ne 0) { Stop-Met "Docker draait niet. Start Docker Desktop en probeer het opnieuw." }

# 1. Nieuwste versie downloaden
$tmp = Join-Path $env:TEMP ("huishoud-app-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $tmp | Out-Null
try {
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  $zip = Join-Path $tmp "app.zip"
  Write-Host "Downloaden van GitHub ($Branch)..."
  try {
    Invoke-WebRequest -UseBasicParsing -Uri "https://github.com/$Repo/archive/refs/heads/$Branch.zip" -OutFile $zip
  } catch {
    Stop-Met "Downloaden lukte niet: $($_.Exception.Message)"
  }
  Expand-Archive -Path $zip -DestinationPath (Join-Path $tmp "uit")
  $bron = (Get-ChildItem (Join-Path $tmp "uit") -Directory | Select-Object -First 1).FullName

  # 2. Gewijzigde bestanden kopieren
  $gewijzigd = @()
  foreach ($f in Get-ChildItem $bron -Recurse -File -Force) {
    $rel = $f.FullName.Substring($bron.Length + 1)
    if (Overslaan $rel) { continue }
    $doel = Join-Path $App $rel
    if ((Test-Path $doel) -and ((Get-FileHash $doel).Hash -eq (Get-FileHash $f.FullName).Hash)) { continue }
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $doel) | Out-Null
    Copy-Item $f.FullName $doel -Force
    $gewijzigd += $rel
  }

  # docker-compose.yml nooit overschrijven, wel melden als de opzet is veranderd
  $zonderGeheim = { param($p) Get-Content $p | Where-Object { $_ -notmatch 'FAMILY_PASSWORD|VAPID_SUBJECT' } | ForEach-Object { $_.TrimEnd() } }
  $nieuweCompose = Join-Path $bron "docker-compose.yml"
  $composeAnders = (Test-Path $nieuweCompose) -and
    ((& $zonderGeheim $nieuweCompose) -join "`n") -ne ((& $zonderGeheim (Join-Path $App "docker-compose.yml")) -join "`n")
  if ($composeAnders) {
    Copy-Item $nieuweCompose (Join-Path $App "docker-compose.nieuw.yml") -Force
  }
} finally {
  Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

if ($gewijzigd.Count -eq 0) {
  Write-Host "De app is al up-to-date. Er is niets veranderd." -ForegroundColor Green
  exit 0
}
Write-Host "Bijgewerkte bestanden:"
$gewijzigd | ForEach-Object { Write-Host "  $_" }

# 3. Bouwen terwijl de oude versie nog draait (--pull haalt ook de nieuwste Node-basis op)
Write-Host "Nieuwe versie bouwen..."
docker compose build --pull
if ($LASTEXITCODE -ne 0) { Stop-Met "Bouwen mislukt. De oude versie draait gewoon door." }

# 4. Stoppen, database kopieren, opnieuw starten
docker compose stop
$backup = "data-backup-auto-" + (Get-Date -Format "yyyy-MM-dd-HHmm")
if (Test-Path "data") {
  Copy-Item "data" $backup -Recurse
  Write-Host "Kopie van de database: $backup"
  Get-ChildItem -Directory -Filter "data-backup-auto-*" | Sort-Object Name -Descending |
    Select-Object -Skip $Bewaren | Remove-Item -Recurse -Force
}
docker compose up -d
if ($LASTEXITCODE -ne 0) { Stop-Met "Starten mislukt. Kijk in Docker Desktop wat er mis is." }

# 5. Controleren of de app reageert
$ok = $false
for ($i = 0; $i -lt 30 -and -not $ok; $i++) {
  Start-Sleep -Seconds 1
  try { Invoke-WebRequest -UseBasicParsing -Uri "http://localhost:3000/" -TimeoutSec 2 | Out-Null; $ok = $true } catch {}
}
if (-not $ok) { Stop-Met "De app reageert niet op http://localhost:3000. Kijk in Docker Desktop naar de logs." }

Write-Host ""
Write-Host "Klaar: de app is bijgewerkt en draait weer." -ForegroundColor Green
if ($composeAnders) {
  Write-Host "Let op: docker-compose.yml is op GitHub veranderd. Jouw versie is niet aangeraakt;" -ForegroundColor Yellow
  Write-Host "vergelijk hem met docker-compose.nieuw.yml en neem de wijziging zelf over." -ForegroundColor Yellow
}
