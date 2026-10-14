# Runbook: Umgebungen provisionieren

Einmalig pro Umgebung (`staging`, `production`). Konkrete Werte für `<…>` stehen in `.local/`.

## 1. Deploy-Wrapper auf dem VPS

```bash
ssh <DEPLOY_USER>@<VPS_HOST> mkdir -p bin docker/apps
scp infra/deploy/smart-deploy <DEPLOY_USER>@<VPS_HOST>:bin/smart-deploy
ssh <DEPLOY_USER>@<VPS_HOST> chmod 755 bin/smart-deploy
```

## 2. Deploy-Key pro Umgebung

```bash
ssh-keygen -t ed25519 -N '' -C smart-home-deploy-<environment> -f <tmp>/deploy-<environment>
```

Öffentlichen Schlüssel auf dem VPS an `~/.ssh/authorized_keys` anhängen:

```
command="/home/<DEPLOY_USER>/bin/smart-deploy <environment>",restrict ssh-ed25519 AAAA… smart-home-deploy-<environment>
```

Privaten Schlüssel als Environment-Secret hinterlegen und lokal löschen:

```bash
gh secret set DEPLOY_SSH_KEY --env <environment> < <tmp>/deploy-<environment>
gh secret set DEPLOY_HOST --env <environment> --body '<VPS_HOST>'
gh secret set DEPLOY_USER --env <environment> --body '<DEPLOY_USER>'
ssh-keyscan -t ed25519 <VPS_HOST> | gh secret set DEPLOY_KNOWN_HOSTS --env <environment>
rm <tmp>/deploy-<environment> <tmp>/deploy-<environment>.pub
```

## 3. GitHub Environments

`staging`: nur `main` darf deployen. `production`: zusätzlich Freigabe durch Till.

## 4. `.env` der Umgebung (Till, im eigenen Terminal)

```bash
SMART_VPS=<DEPLOY_USER>@<VPS_HOST> infra/deploy/provision.sh staging
SMART_VPS=<DEPLOY_USER>@<VPS_HOST> infra/deploy/provision.sh production
```

Beide Umgebungen fragen zuerst die Mail-Angaben ab (siehe Abschnitt „Mail“): Resend-Schlüssel (verdeckt), Absender und, nur für Staging, die Freigabeliste. Produktion fragt danach B2-Zugang, restic-Passwort und healthchecks.io-URLs ab (vorher im Passwortmanager bereitlegen). DB- und MQTT-Passwörter werden generiert; sie liegen verschlüsselt im Backup. `--force` schreibt die Datei neu, behält aber die vorhandenen DB- und MQTT-Passwörter (die Datenvolumes hängen daran) sowie die vorhandenen Mail- und Backup-Angaben (eine Frage mit Enter beantworten, dann bleibt der gespeicherte Wert). Vorhandene `SMART_*`-Zeilen übernimmt `--force` unverändert (eine alte Zeile `SMART_INSTANCE_APPEARANCE_EDITOR` stört nicht, sie wird ignoriert). Das Skript schreibt für beide Umgebungen `APP_ORIGIN` (`https://` plus Domain der Umgebung) und `TRUSTED_PROXY_HOPS=2` (Web-nginx und Nginx Proxy Manager sind der API vorgeschaltet; ein vorhandener Wert bleibt bei `--force` stehen). Ohne `APP_ORIGIN` startet der Stack nicht. Außerdem legt das Skript `<Stack>/certs/public/` (Rechte 755; CA, Server-Zertifikat und CRL, API und Broker lesen sie) und `<Stack>/certs/private/` (Rechte 700; nur der Server-Schlüssel, nur der Broker bindet ihn ein) an und schreibt `MQTT_TLS=off`; erst `infra/deploy/broker-certs.sh` kopiert die Zertifikate und schaltet auf `on` (`--force` behält den Wert). Staging bekommt zusätzlich den Gateway-Simulator: `COMPOSE_PROFILES` enthält `simulator` (vorhandene Profile bleiben), dazu `MQTT_SIMULATOR_PASSWORD` (generiert) und `MQTT_SIMULATOR_GATEWAY_ID` (generiert, `gw-` plus 8 Zeichen aus `[a-z0-9]`); `--force` behält beide Werte. Der Dienst `simulator` (Image `smart-home-simulator`, gleiche Commit-Tags wie die anderen Images) verbindet sich als Broker-Benutzer `smart-simulator`, der nur unter `gw/<ID>/…` schreiben darf; das Intervall steht mit `SIMULATOR_INTERVAL_SECONDS` (Standard 300) in der `.env`. Eine bereits bestehende Staging-`.env` bekommt den Simulator erst mit `provision.sh staging --force`. Produktion bekommt nie einen Simulator. Produktion veröffentlicht den Broker-Port mit `MQTT_PUBLIC_PORT=8883`, Staging bindet ihn nur an `127.0.0.1:18883`. Für Produktion schreibt das Skript außerdem `BACKUP_UID`/`BACKUP_GID` des Deploy-Users, damit der Backup-Container das Stack-Verzeichnis (Rechte 700) lesen kann.

Gateways, PKI und Broker-Zertifikate (`broker-certs.sh`, `MQTT_TLS`, Registrierung des Simulators) beschreibt `docs/runbooks/gateway.md`. Reihenfolge einer neuen Umgebung: erst `provision.sh`, dann PKI und `broker-certs.sh`, dann Gateways ausstellen und in der App registrieren. Die Variablen dieses Abschnitts (`MQTT_TLS`, `MQTT_PUBLIC_PORT`, `MQTT_SIMULATOR_PASSWORD`, `MQTT_SIMULATOR_GATEWAY_ID`, `SIMULATOR_INTERVAL_SECONDS`, `COMPOSE_PROFILES`) setzt das Skript; von Hand ändert man sie nicht (Ausnahme: das Intervall). Das GHCR-Paket des Simulators ist nach dem ersten Push privat (`docs/runbooks/deploy.md`).

## 5. Reverse Proxy (Nginx Proxy Manager)

Hinweis: Die API liest die Client-IP (Rate-Limits) aus `X-Forwarded-For`. `TRUSTED_PROXY_HOPS` in der `.env` der Umgebung muss der Zahl der vorgeschalteten Proxys entsprechen: 1 (Standard) nur mit dem Web-nginx, auf dem VPS 2, weil Nginx Proxy Manager davorsteht (`provision.sh` schreibt 2). `APP_ORIGIN` muss genau der Adresse entsprechen, unter der der Browser die App öffnet (`https://<Domain>`, ohne Pfad und ohne abschließenden Schrägstrich): Die API weist ändernde Anfragen mit anderem `Origin` ab, und die Anmeldung scheitert dann mit 403. Der Web-nginx reicht Cookies und `Origin` unverändert an die API durch; Nginx Proxy Manager braucht dafür keine eigene Einstellung.

Proxy Host pro Umgebung: Domain → `http://smart-prod-web:8080` bzw. `http://smart-staging-web:8080`, „Block Common Exploits“ an; SSL: neues Let's-Encrypt-Zertifikat, „Force SSL“, „HTTP/2“, „HSTS“.

## 6. Prüfen

```bash
ssh -i <tmp-key> <DEPLOY_USER>@<VPS_HOST> "deploy 0000000000000000000000000000000000000000"   # → not on main
ssh -i <tmp-key> <DEPLOY_USER>@<VPS_HOST> "ls"                                                # → usage
```

## Mail (Resend per SMTP)

Die Anmeldung per E-Mail-Code verschickt ihre Codes über Resend, angebunden per SMTP (`smtps://resend:<Schlüssel>@smtp.resend.com:465`). Voraussetzungen: Absender-Domain bei Resend verifiziert (SPF/DKIM), ein API-Schlüssel mit Sendeberechtigung.

`provision.sh` fragt ab und schreibt in die `.env` der Umgebung:

| Eingabe                 | `.env`-Variable  | Hinweis                                                                                                                                                                    |
| ----------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Resend-Schlüssel        | `SMTP_URL`       | Wird verdeckt gelesen (`re_…`), nie angezeigt oder protokolliert; das Skript baut daraus die SMTP-Adresse. Ein falsch geformter Wert wird abgewiesen, ohne ihn auszugeben. |
| Absender                | `MAIL_FROM`      | z. B. `Smart Home <noreply@<verifizierte-Domain>>`; Pflicht, sobald `SMTP_URL` gesetzt ist.                                                                                |
| Freigabeliste (Staging) | `MAIL_ALLOWLIST` | Kommagetrennte Empfänger; nur diese erhalten Mail, alle anderen werden verworfen (und maskiert geloggt). Produktion schreibt keine Freigabeliste.                          |

Ohne `SMTP_URL` ist der E-Mail-Code abgeschaltet: Die Anmelden-Seite weist darauf hin, die API antwortet mit `503` (`auth.mailDisabled`). Das gilt auch für Self-Hosting ohne Mail; `provision.sh` selbst verlangt den Schlüssel.

Bestehende Umgebungen nachrüsten (vor dem ersten Deploy mit der Anmeldung):

```bash
SMART_VPS=<DEPLOY_USER>@<VPS_HOST> infra/deploy/provision.sh staging --force
SMART_VPS=<DEPLOY_USER>@<VPS_HOST> infra/deploy/provision.sh production --force
```

Der Resend-Schlüssel und die Freigabeliste sind dabei neu einzugeben; Passwörter, `SMART_*`-Zeilen und Backup-Angaben bleiben, die Backup-Angaben der Produktion fragt das Skript erneut ab.

Lokal und im Stack-Test fängt Mailpit die Mails ab (lokal `http://127.0.0.1:8026`, im Stack-Test `http://127.0.0.1:18025`); der Stack-Test liest die Codes über dessen API.

## Ersten Admin anlegen

Nach dem ersten Deploy gibt es noch keinen Benutzer, also auch keine Anmeldung. Till legt sich im eigenen Terminal selbst als Plattform-Admin an (E-Mail-Code-Anmeldung danach wie gewohnt):

```bash
SMART_VPS=<DEPLOY_USER>@<VPS_HOST> infra/deploy/admin.sh staging create-admin --email <E-MAIL> --name "<Name>"
SMART_VPS=<DEPLOY_USER>@<VPS_HOST> infra/deploy/admin.sh production create-admin --email <E-MAIL> --name "<Name>"
```

Auf Staging muss die Adresse des Admins in `MAIL_ALLOWLIST` stehen, sonst kommt kein Code an. Die Anmeldung danach: `/anmelden`, Adresse eingeben, Code aus der Mail eintragen. Der erste Admin hat noch keinen Haushalt: Die App führt ihn nach der Anmeldung zu `/einrichten`, wo er Namen und Zeitzone des ersten Haushalts festlegt (er wird dessen Eigentümer). Weitere Personen lädt er danach unter „Mehr → Mitglieder“ per E-Mail ein; den Einladungslink sieht er dort auch, falls keine Mail ankommt. Weil auch der Einladende den Link kennt, beendet die erste Anmeldung der eingeladenen Person per E-Mail-Code alle Sitzungen ihres Kontos, die über den Einladungslink entstanden sind (Sitzungen aus früheren Code-Anmeldungen bleiben).

`admin.sh` führt `node dist/cli.js create-admin …` im laufenden `api`-Container des Stacks aus (`docker compose … exec -T api`). Erlaubt sind nur `create-admin` und `revoke-sessions`; jedes Argument wird einzeln gequotet und kommt auf dem VPS als genau ein Wort an. Die E-Mail wird normalisiert (Kleinbuchstaben). Der Befehl ist idempotent: existiert der Benutzer schon, setzt er nur `is_platform_admin` und lässt Name und Sprache unverändert. Ausgabe: Ergebnis mit maskierter Adresse, keine Geheimnisse. Exit-Code 1 bei ungültiger E-Mail oder fehlendem `--name`, 2 bei falschem Aufruf.

### Sessions eines Benutzers widerrufen

Notbremse, solange die App keine eigene Sicherheitsseite (Geräte und Sitzungen) hat. Ist ein Gerät verloren oder eine Sitzung nicht mehr vertrauenswürdig, widerruft Till alle offenen Sessions des Benutzers; danach muss sich dieser überall neu anmelden:

```bash
SMART_VPS=<DEPLOY_USER>@<VPS_HOST> infra/deploy/admin.sh production revoke-sessions --email <E-MAIL>
```

Ausgabe: `revoked <n> sessions: <maskierte Adresse>` (gezählt werden nur Sessions, die noch offen waren). Exit-Code 1 bei unbekannter oder ungültiger E-Mail (`no such user`, die Adresse wird nicht wiederholt), 2 bei falschem Aufruf. Der Befehl ändert sonst nichts am Benutzer.

## Laufzeitkonfiguration der Web-App

Der `web`-Container schreibt beim Start `/config.json` aus der Umgebungsvariable `SMART_INSTANCE_APPEARANCE` (`apps/frontend/nginx/40-smart-config.sh`). Änderungen wirken nach einem Neustart des Containers, ohne Neubau.

| Variable                    | Wirkung                                                                                                                                                                                                                                                                                         |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SMART_INSTANCE_APPEARANCE` | Optional: Standard-Theme der Installation als JSON (`instanceAppearanceSchema` in `packages/contracts`). Gültiges JSON mit ungültigem Inhalt: die App nutzt den Build-Standard. Syntaktisch kaputtes JSON macht die gesamte `config.json` unbrauchbar (die App startet mit den Standardwerten). |

Das Instanz-Theme bearbeitet der Plattform-Admin in der App (kein Editor-Schalter in der Umgebung nötig). Vorrang: der Wert der Installation auf dem Server (den der Plattform-Admin unter „Einstellungen → Erscheinungsbild der Installation“ setzt; der Browser hält davon eine Kopie für den Start ohne Netz) vor `SMART_INSTANCE_APPEARANCE` vor dem Build-Standard. „Auf Standard zurücksetzen“ löscht den Wert auf dem Server. Den früheren Schalter `SMART_INSTANCE_APPEARANCE_EDITOR` gibt es nicht mehr; eine vorhandene Zeile in der `.env` wird ignoriert.

Der Service Worker cached `config.json` mit Frische-Strategie: Netz zuerst, nach 2 s oder offline die zuletzt geladene Kopie. Eine geänderte Variable wirkt also beim nächsten Laden, sobald das Netz antwortet.

## Manifest und Service Worker

- **Manifest-Farbe:** `theme_color` (`#00687a`) und `background_color` (`#f5fafc`) in `apps/frontend/public/manifest.webmanifest` sowie `<meta name="theme-color">` in `index.html` sind Build-Standards. `SMART_INSTANCE_APPEARANCE` ändert sie nicht; eine andere Manifest-Farbe braucht einen neuen Build.
- **Update:** Ein neues Deploy lädt der Service Worker im Hintergrund. Ist es fertig, erscheint in der App das Banner „Neue Version verfügbar“ mit „Neu laden“. Bis dahin läuft die alte Version weiter; ein Deploy aktualisiert installierte Apps nicht ohne Zutun des Nutzers.
- **Nginx:** Der Service Worker prüft `index.html` byte für byte. Der `web`-Container darf die Datei nicht umschreiben (kein `sub_filter`, kein Nonce pro Antwort), sonst schlägt die Installation fehl.
