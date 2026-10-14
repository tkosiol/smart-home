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

Beide Umgebungen fragen zuerst die Mail-Angaben ab (siehe Abschnitt „Mail“): Resend-Schlüssel (verdeckt), Absender und, nur für Staging, die Freigabeliste. Produktion fragt danach B2-Zugang, restic-Passwort und healthchecks.io-URLs ab (vorher im Passwortmanager bereitlegen). DB- und MQTT-Passwörter werden generiert; sie liegen verschlüsselt im Backup. `--force` schreibt die Datei neu, behält aber die vorhandenen DB- und MQTT-Passwörter (die Datenvolumes hängen daran) und die vorhandenen Mail-Angaben (eine Mail-Frage mit Enter beantworten, dann bleibt der gespeicherte Wert). Staging bekommt zusätzlich `SMART_INSTANCE_APPEARANCE_EDITOR=true`, sofern die Datei noch keine solche Zeile hat; vorhandene `SMART_*`-Zeilen übernimmt `--force` unverändert. Das Skript schreibt für beide Umgebungen `APP_ORIGIN` (`https://` plus Domain der Umgebung) und `TRUSTED_PROXY_HOPS=2` (Web-nginx und Nginx Proxy Manager sind der API vorgeschaltet; ein vorhandener Wert bleibt bei `--force` stehen). Ohne `APP_ORIGIN` startet der Stack nicht. Für Produktion schreibt das Skript außerdem `BACKUP_UID`/`BACKUP_GID` des Deploy-Users, damit der Backup-Container das Stack-Verzeichnis (Rechte 700) lesen kann.

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

Auf Staging muss die Adresse des Admins in `MAIL_ALLOWLIST` stehen, sonst kommt kein Code an. Die Anmeldung danach: `/anmelden`, Adresse eingeben, Code aus der Mail eintragen.

`admin.sh` führt `node dist/cli.js create-admin …` im laufenden `api`-Container des Stacks aus (`docker compose … exec -T api`). Erlaubt ist nur `create-admin`; jedes Argument wird einzeln gequotet und kommt auf dem VPS als genau ein Wort an. Die E-Mail wird normalisiert (Kleinbuchstaben). Der Befehl ist idempotent: existiert der Benutzer schon, setzt er nur `is_platform_admin` und lässt Name und Sprache unverändert. Ausgabe: Ergebnis mit maskierter Adresse, keine Geheimnisse. Exit-Code 1 bei ungültiger E-Mail oder fehlendem `--name`, 2 bei falschem Aufruf.

## Laufzeitkonfiguration der Web-App

Der `web`-Container schreibt beim Start `/config.json` aus zwei Umgebungsvariablen (`apps/frontend/nginx/40-smart-config.sh`). Änderungen wirken nach einem Neustart des Containers, ohne Neubau.

| Variable                           | Wirkung                                                                                                                                                                                                                                                                                                                                                              |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SMART_INSTANCE_APPEARANCE_EDITOR` | `true` zeigt „Einstellungen → Erscheinungsbild der Installation“ (bis Etappe 4 ohne Admin-Rolle). Staging `true`, Produktion nicht setzen.                                                                                                                                                                                                                           |
| `SMART_INSTANCE_APPEARANCE`        | Optional: Standard-Theme der Installation als JSON (`instanceAppearanceSchema` in `packages/contracts`). Gültiges JSON mit ungültigem Inhalt: die App nutzt den Build-Standard. Syntaktisch kaputtes JSON macht die gesamte `config.json` unbrauchbar, dann fällt auch `SMART_INSTANCE_APPEARANCE_EDITOR` auf „aus“ zurück (die App startet mit den Standardwerten). |

Vorrang des Instanz-Themes: im Browser gespeicherte Instanz (nur solange der Editor aktiv ist) vor `SMART_INSTANCE_APPEARANCE` vor dem Build-Standard.

Der Service Worker cached `config.json` mit Frische-Strategie: Netz zuerst, nach 2 s oder offline die zuletzt geladene Kopie. Eine geänderte Variable wirkt also beim nächsten Laden, sobald das Netz antwortet.

## Manifest und Service Worker

- **Manifest-Farbe:** `theme_color` (`#00687a`) und `background_color` (`#f5fafc`) in `apps/frontend/public/manifest.webmanifest` sowie `<meta name="theme-color">` in `index.html` sind Build-Standards. `SMART_INSTANCE_APPEARANCE` ändert sie nicht; eine andere Manifest-Farbe braucht einen neuen Build.
- **Update:** Ein neues Deploy lädt der Service Worker im Hintergrund. Ist es fertig, erscheint in der App das Banner „Neue Version verfügbar“ mit „Neu laden“. Bis dahin läuft die alte Version weiter; ein Deploy aktualisiert installierte Apps nicht ohne Zutun des Nutzers.
- **Nginx:** Der Service Worker prüft `index.html` byte für byte. Der `web`-Container darf die Datei nicht umschreiben (kein `sub_filter`, kein Nonce pro Antwort), sonst schlägt die Installation fehl.
