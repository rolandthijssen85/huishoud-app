# Zet automatisch bijwerken aan (of uit met -Uit).
# Maakt een geplande taak voor de huidige gebruiker, geen beheerdersrechten nodig.
# De taak kijkt elk kwartier (en kort na het inloggen) of er een nieuwe versie op GitHub staat.
# Alleen ASCII in dit bestand: Windows PowerShell 5.1 leest het anders verkeerd.
param(
  [switch]$Uit,
  [int]$Minuten = 15
)

$ErrorActionPreference = "Stop"
$Naam = "Huishoud-app automatisch bijwerken"

if ($Uit) {
  if (Get-ScheduledTask -TaskName $Naam -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $Naam -Confirm:$false
    Write-Host "Automatisch bijwerken staat uit." -ForegroundColor Green
  } else {
    Write-Host "Automatisch bijwerken stond al uit."
  }
  exit 0
}

$vbs = Join-Path $PSScriptRoot "automatisch-bijwerken.vbs"
$gebruiker = "$env:USERDOMAIN\$env:USERNAME"

$actie = New-ScheduledTaskAction -Execute "wscript.exe" -Argument "`"$vbs`"" -WorkingDirectory (Split-Path -Parent $PSScriptRoot)
$elkKwartier = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes $Minuten)
$naInloggen = New-ScheduledTaskTrigger -AtLogOn -User $gebruiker
$naInloggen.Delay = "PT3M"  # Docker Desktop even de tijd geven om op te starten
$wie = New-ScheduledTaskPrincipal -UserId $gebruiker -LogonType Interactive -RunLevel Limited
$opties = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 1)

Register-ScheduledTask -TaskName $Naam -Action $actie -Trigger @($elkKwartier, $naInloggen) -Principal $wie -Settings $opties `
  -Description "Werkt de huishoud-app bij zodra er een nieuwe versie op GitHub (main) staat. Log: bijwerken-log.txt" -Force | Out-Null

Write-Host "Automatisch bijwerken staat aan: elk $Minuten minuten wordt gekeken of er een nieuwe versie is." -ForegroundColor Green
Write-Host "Wat er gebeurt staat in bijwerken-log.txt. Uitzetten: automatisch-uitzetten.cmd"
