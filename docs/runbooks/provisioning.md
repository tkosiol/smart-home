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

Produktion fragt B2-Zugang, restic-Passwort und healthchecks.io-URLs ab (vorher im Passwortmanager bereitlegen). DB- und MQTT-Passwörter werden generiert; sie liegen verschlüsselt im Backup. `--force` schreibt die Datei neu, behält aber die vorhandenen DB- und MQTT-Passwörter (die Datenvolumes hängen daran). Staging bekommt zusätzlich `SMART_INSTANCE_APPEARANCE_EDITOR=true`, sofern die Datei noch keine solche Zeile hat; vorhandene `SMART_*`-Zeilen übernimmt `--force` unverändert. Für Produktion schreibt das Skript außerdem `BACKUP_UID`/`BACKUP_GID` des Deploy-Users, damit der Backup-Container das Stack-Verzeichnis (Rechte 700) lesen kann.

## 5. Reverse Proxy (Nginx Proxy Manager)

Proxy Host pro Umgebung: Domain → `http://smart-prod-web:8080` bzw. `http://smart-staging-web:8080`, „Block Common Exploits“ an; SSL: neues Let's-Encrypt-Zertifikat, „Force SSL“, „HTTP/2“, „HSTS“.

## 6. Prüfen

```bash
ssh -i <tmp-key> <DEPLOY_USER>@<VPS_HOST> "deploy 0000000000000000000000000000000000000000"   # → not on main
ssh -i <tmp-key> <DEPLOY_USER>@<VPS_HOST> "ls"                                                # → usage
```

## Laufzeitkonfiguration der Web-App

Der `web`-Container schreibt beim Start `/config.json` aus zwei Umgebungsvariablen (`apps/frontend/nginx/40-smart-config.sh`). Änderungen wirken nach einem Neustart des Containers, ohne Neubau.

| Variable                           | Wirkung                                                                                                                                                                                                                                                                                                                                                              |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SMART_INSTANCE_APPEARANCE_EDITOR` | `true` zeigt „Einstellungen → Erscheinungsbild der Installation“ (bis Etappe 4 ohne Admin-Rolle). Staging `true`, Produktion nicht setzen.                                                                                                                                                                                                                           |
| `SMART_INSTANCE_APPEARANCE`        | Optional: Standard-Theme der Installation als JSON (`instanceAppearanceSchema` in `packages/contracts`). Gültiges JSON mit ungültigem Inhalt: die App nutzt den Build-Standard. Syntaktisch kaputtes JSON macht die gesamte `config.json` unbrauchbar, dann fällt auch `SMART_INSTANCE_APPEARANCE_EDITOR` auf „aus“ zurück (die App startet mit den Standardwerten). |

Vorrang des Instanz-Themes: im Browser gespeicherte Instanz (nur solange der Editor aktiv ist) vor `SMART_INSTANCE_APPEARANCE` vor dem Build-Standard.
