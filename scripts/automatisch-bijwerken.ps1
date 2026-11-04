# Wordt elk kwartier door een geplande taak gestart (zie automatisch-aanzetten.ps1).
# Kijkt op GitHub of er een nieuwe commit op main staat. Alleen dan draait het
# bijwerken.ps1, dat docker-compose.yml, data\ en .env altijd ongemoeid laat.
# Alles wat er gebeurt komt in bijwerken-log.txt in de app-map.
# Alleen ASCII in dit bestand: Windows PowerShell 5.1 leest het anders verkeerd.
param(
  [string]$Branch = "main",
  [int]$MaxPogingen = 3
)

$ErrorActionPreference = "Stop"
$Repo = "rolandthijssen85/huishoud-app"
$App = Split-Path -Parent $PSScriptRoot
$Log = Join-Path $App "bijwerken-log.txt"
$ShaBestand = Join-Path $App ".bijwerken-sha"
$MisluktBestand = Join-Path $App ".bijwerken-mislukt"
$Onvoltooid = Join-Path $App ".bijwerken-onvoltooid"

function Schrijf-Log($tekst) {
  $regel = (Get-Date -Format "yyyy-MM-dd HH:mm:ss") + "  " + $tekst
  Add-Content -Path $Log -Value $regel -Encoding UTF8
}

function Lees($pad) {
  if (Test-Path $pad) { return ((Get-Content $pad -Raw) -as [string]).Trim() } else { return "" }
}

# Log niet eindeloos laten groeien
if ((Test-Path $Log) -and (Get-Item $Log).Length -gt 500KB) {
  $staart = Get-Content $Log -Tail 2000
  Set-Content -Path $Log -Value $staart -Encoding UTF8
}

# 1. Welke commit staat er nu op GitHub?
try {
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  $antwoord = Invoke-WebRequest -UseBasicParsing -TimeoutSec 30 `
    -Uri "https://api.github.com/repos/$Repo/commits/$Branch" `
    -Headers @{ Accept = "application/vnd.github.sha" }
  $nieuw = [Text.Encoding]::ASCII.GetString($antwoord.RawContentStream.ToArray()).Trim()
} catch {
  # Geen internet of GitHub even weg: volgende keer gewoon opnieuw, zonder het log vol te schrijven.
  exit 0
}
if ($nieuw -notmatch '^[0-9a-f]{40}$') { Schrijf-Log "Onverwacht antwoord van GitHub, overgeslagen."; exit 0 }

$huidig = Lees $ShaBestand
if ($nieuw -eq $huidig -and -not (Test-Path $Onvoltooid)) { exit 0 }

# 2. Niet eindeloos opnieuw proberen als dezelfde versie steeds mislukt
$mislukt = (Lees $MisluktBestand) -split '\s+'
$pogingen = 0
if ($mislukt.Count -eq 2 -and $mislukt[0] -eq $nieuw) { $pogingen = [int]$mislukt[1] }
if ($pogingen -ge $MaxPogingen) { exit 0 }

# 3. Docker moet draaien; zo niet, dan straks opnieuw proberen
cmd /c "docker info >nul 2>&1"
if ($LASTEXITCODE -ne 0) { exit 0 }

$kort = $nieuw.Substring(0, 7)
Schrijf-Log "Nieuwe versie op GitHub ($kort), bijwerken..."
$script = Join-Path $PSScriptRoot "bijwerken.ps1"
# Docker schrijft voortgang naar stderr; met "Stop" zou PowerShell dat als fout zien.
$ErrorActionPreference = "Continue"
$uitvoer = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $script -Branch $Branch 2>&1 |
  ForEach-Object { "$_" } | Out-String
$code = $LASTEXITCODE
$ErrorActionPreference = "Stop"
# Docker-bouwstappen ("#3 ...") laten we weg, die maken het log onleesbaar.
foreach ($r in ($uitvoer -split "`r?`n")) { if ($r.Trim() -and $r -notmatch '^\s*#\d+ ') { Schrijf-Log ("    " + $r.TrimEnd()) } }

if ($code -eq 0) {
  Set-Content -Path $ShaBestand -Value $nieuw -Encoding ASCII
  if (Test-Path $MisluktBestand) { Remove-Item $MisluktBestand -Force }
  Schrijf-Log "Klaar: versie $kort staat erop."
} else {
  $pogingen++
  Set-Content -Path $MisluktBestand -Value "$nieuw $pogingen" -Encoding ASCII
  if ($pogingen -ge $MaxPogingen) {
    Schrijf-Log "MISLUKT ($pogingen keer) voor versie $kort. Ik probeer het pas weer bij een nieuwe versie, of als je bijwerken.cmd zelf draait."
  } else {
    Schrijf-Log "MISLUKT (poging $pogingen van $MaxPogingen) voor versie $kort. Over een kwartier opnieuw."
  }
}
exit $code
