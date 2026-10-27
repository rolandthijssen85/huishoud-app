# Huishouden

Webapp voor het gezin om klusjes thuis bij te houden. Zie `../requirements.md` voor wat de app moet kunnen.

- **Vandaag**: wat er vandaag moet gebeuren, plus wat is blijven liggen. Afvinken legt vast wie het deed.
- **Week**: de komende zeven dagen.
- **Lijsten**: gedeelde lijsten zoals boodschappen of verlanglijstjes. Items met eventueel een notitie, afstrepen, verslepen aan het ≡-handvat, en *Lijst leegmaken* haalt de afgestreepte items weg. Tijdens het typen stelt de app eerder gebruikte items voor.
- **Taken**: taken toevoegen, wijzigen, verwijderen. Herhalen elke N dagen of eenmalig. Iedereen mag dit.
- **Statistiek**: wie heeft deze maand wat gedaan.
- **Meer**: meldingen aanzetten, de agenda koppelen, wisselen van gezinslid, gezinsleden beheren, uitloggen.
- **Agenda**: de gedeelde Outlook-agenda (alleen lezen) via de ICS-publicatielink. Afspraken van vandaag staan op Vandaag, de week op Week. De app haalt de agenda elke 15 minuten op.
- **Agendaregels** (onder Meer): staat een woord in de titel van een afspraak (bijv. "verjaardag"), dan maakt de app automatisch een taak ("cadeau kopen", x dagen van tevoren), een nieuwe lijst, of items op een bestaande lijst. Wordt de afspraak verplaatst, dan schuift de taak mee; verwijderd of voorbij, dan verdwijnt een taak die nog open staat. Lijsten blijven staan.
- Elke ochtend om 8:00 (Nederlandse tijd) een pushmelding met de afspraken en klusjes van vandaag. Op een lege dag geen melding.

Een herhalende taak schuift mee: wordt "planten water geven (elke 3 dagen)" pas op donderdag gedaan in plaats van dinsdag, dan staat hij daarna weer op zondag.

## Techniek

- Node.js 22.5 of nieuwer, zonder framework. Database: SQLite (ingebouwd in Node), bestand `data/huishouden.db`.
- Eén extra pakket: `web-push` voor de meldingen. De sleutels daarvoor maakt de app zelf bij de eerste start.
- Eén gezinswachtwoord (`FAMILY_PASSWORD`). Na inloggen kiest ieder op de eigen telefoon één keer wie die is.
- Bescherming tegen wachtwoorden raden: na 5 foute pogingen moet dat adres een kwartier wachten, en voor iedereen samen zijn er hooguit 50 foute pogingen per uur. Wie al ingelogd is, merkt daar niets van. Kies toch een lang wachtwoord als de app op internet staat.

## Starten op je eigen server (Docker)

1. Pas in `docker-compose.yml` het wachtwoord (`FAMILY_PASSWORD`) en je e-mailadres (`VAPID_SUBJECT`) aan.
2. `docker compose up -d --build`
3. De app draait op poort 3000. De database staat in de map `data/` naast `docker-compose.yml`; maak daar af en toe een kopie van.

Zonder Docker: `npm ci` en dan `FAMILY_PASSWORD=geheim npm start`.

## HTTPS is nodig voor meldingen

Telefoons staan pushmeldingen en "op beginscherm zetten" alleen toe via **https**. Zet de app daarom achter een reverse proxy met een certificaat, bijvoorbeeld:

- **Caddy** (regelt het certificaat zelf): `huishouden.jouwdomein.nl { reverse_proxy localhost:3000 }`
- of **Cloudflare Tunnel** / **Tailscale Funnel** als je geen poorten wilt openzetten.

Liever geen eigen server? Elke host die een Docker-container met een blijvende schijf kan draaien werkt ook (bijvoorbeeld Fly.io met een volume op `/data`).

## Bijwerken op de pc

Dubbelklik op `bijwerken.cmd` in de app-map. Het script haalt de nieuwste versie van `main` op GitHub, kopieert alleen wat veranderd is, bouwt de app opnieuw op en start hem weer. Het maakt eerst een kopie van de database in `data-backup-auto-<datum>` (de laatste 5 blijven bewaard).

`docker-compose.yml` (met het echte wachtwoord), `data/`, `data-backup*` en `.env` raakt het nooit aan. Is `docker-compose.yml` op GitHub veranderd, dan zet het script die versie als `docker-compose.nieuw.yml` ernaast, zodat je de wijziging zelf kunt overnemen.

Updates van pakketten en van de Node-basis komen als pull request van Dependabot binnen (zie `.github/dependabot.yml`). Na het samenvoegen staat de nieuwe versie pas op de pc als je `bijwerken.cmd` draait.

## Telefoons instellen

- **iPhone (iOS 16.4 of nieuwer)**: open de app in Safari, tik op het deel-icoon en kies *Zet op beginscherm*. Open de app daarna vanaf het beginscherm, log in, kies je naam en zet onder *Meer* de meldingen aan.
- **Android**: open de app in Chrome, log in, kies je naam en zet onder *Meer* de meldingen aan. Via het menu kun je hem ook op het beginscherm zetten.

Met *Stuur testmelding* onder *Meer* controleer je of het werkt.

## Agenda koppelen

1. Ga op een computer naar outlook.live.com en log in als eigenaar van de gedeelde agenda.
2. Instellingen (tandwiel) → Agenda → Gedeelde agenda's → *Een agenda publiceren*.
3. Kies de gedeelde agenda en *Kan alle details weergeven* (anders staan er alleen "Bezet"-blokken in), en klik op *Publiceren*.
4. Kopieer de ICS-link en plak die in de app onder *Meer → Agenda*.

Iedereen met de link kan de agenda inzien. De link staat alleen in de database op de server.

## Ontwikkelen

- `npm test` draait de tests van de takenlogica, de lijsten, het agendabestand (`ics.js`) en de agendaregels (`calendar.js`).
- `node scripts/make-icons.js` maakt de app-iconen opnieuw.
