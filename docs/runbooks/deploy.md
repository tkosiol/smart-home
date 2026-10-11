# Runbook: Deploy und Rollback

## Normaler Ablauf

1. PR mergen → CI auf `main` läuft.
2. Workflow **Deploy** startet automatisch nach grüner CI: baut `api`, `web`, `broker`, `backup`, scannt sie mit Trivy und pusht `ghcr.io/tkosiol/smart-home-<image>:<sha>`.
3. **Staging** wird deployt und über `https://staging.smart.tillkosiol.de/api/health/ready` geprüft.
4. **Produktion** wartet auf Freigabe: GitHub → Actions → Deploy → „Review deployments“ → `production` → Approve.

## Was auf dem VPS passiert

`smart-deploy <environment>` (Forced Command) prüft, dass der Commit auf `main` liegt, lädt `infra/deploy/deploy.sh` und `infra/compose/compose.yaml` genau dieses Commits und ruft `deploy.sh` auf:

1. `docker compose pull`
2. `db` und `broker` starten
3. Migrationen (`node dist/migrate.js`) – schlägt das fehl, bleibt die laufende Version unangetastet
4. neue Version starten (`up -d --wait`) und `/api/health/ready` prüfen – sonst automatischer Rollback auf die Version aus `deploy.env`
5. `deploy.env` auf den neuen Commit setzen

## Rollback

GitHub → Actions → Deploy → „Run workflow“: `environment` wählen, `sha` = vollständiger SHA eines früheren Commits auf `main` (Images existieren für jeden gemergten Commit). Produktion verlangt wieder die Freigabe.

Voraussetzung: Migrationen sind rückwärtskompatibel (erst Neues hinzufügen, Altes erst in einem späteren Release entfernen).

## Fehlerbilder

| Symptom                                  | Ursache / Abhilfe                                                                                                                  |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `commit … is not on main`                | SHA stammt aus einem Branch oder Fork – nur gemergte Commits sind deploybar                                                        |
| `missing …/.env`                         | Umgebung nicht provisioniert → `docs/runbooks/provisioning.md`                                                                     |
| `pull access denied`                     | GHCR-Paket ist privat → Paket-Einstellungen auf GitHub: Visibility „Public“                                                        |
| `migrations failed`                      | Logs: `docker compose --env-file .env --env-file deploy.env.next run --rm --no-deps api node dist/migrate.js` im Stack-Verzeichnis |
| Smoke-Test schlägt fehl, Deploy war grün | Reverse-Proxy-Eintrag oder DNS prüfen (`docs/runbooks/provisioning.md`)                                                            |

## Wrapper aktualisieren

Änderungen an `infra/deploy/smart-deploy` wirken erst nach erneutem Kopieren auf den VPS:

```bash
scp infra/deploy/smart-deploy <DEPLOY_USER>@<VPS_HOST>:bin/smart-deploy
ssh <DEPLOY_USER>@<VPS_HOST> chmod 755 bin/smart-deploy
```
