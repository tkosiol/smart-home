# Runbook: Deploy und Rollback

## Normaler Ablauf

1. PR mergen → CI auf `main` läuft.
2. Workflow **Deploy** startet automatisch nach grüner CI: baut `api`, `web`, `broker`, `backup`, scannt sie mit Trivy und pusht `ghcr.io/tkosiol/smart-home-<image>:<sha>`.
3. **Staging** wird deployt und über `https://staging.smart.tillkosiol.de/api/health/ready` geprüft.
4. **Produktion** wartet auf Freigabe: GitHub → Actions → Deploy → „Review deployments“ → `production` → Approve.

## Was auf dem VPS passiert

`smart-deploy <environment>` (Forced Command) prüft, dass der Commit auf `main` liegt, lädt `infra/deploy/deploy.sh` und `infra/compose/compose.yaml` genau dieses Commits und ruft `deploy.sh` auf. Die laufende Version ist durch `compose.yaml` + `deploy.env` beschrieben; die neue wird als `compose.next.yaml` + `deploy.env.next` vorbereitet:

1. `docker compose pull`
2. `db` und `broker` der neuen Version starten – scheitert das, Rollback auf die laufende Version
3. Migrationen (`node dist/migrate.js`) – scheitert das, laufen `api` und `web` unverändert weiter
4. neue Version starten (`up -d --wait`) – sonst Rollback
5. `/api/health/ready` bis zu 12 × im Abstand von 5 s prüfen – sonst Rollback
6. erst dann `compose.next.yaml` → `compose.yaml` und `deploy.env.next` → `deploy.env`

Ein Rollback startet immer die vorherige `compose.yaml` mit der vorherigen `deploy.env`. Beim allerersten Deploy gibt es keine vorherige Version; dann bleibt die Umgebung bis zum nächsten erfolgreichen Deploy ohne laufende Version.

## Rollback

GitHub → Actions → Deploy → „Run workflow“: `environment` wählen, `sha` = vollständiger SHA eines früheren Commits auf `main`, für den der Build-Job erfolgreich war (nur dann existieren Images). Produktion verlangt wieder die Freigabe. Pro Umgebung läuft immer nur ein Deploy; ein neuer wartender Lauf ersetzt einen älteren wartenden – nach einem Rollback-Auftrag daher prüfen, dass er tatsächlich gelaufen ist.

Voraussetzung: Migrationen sind rückwärtskompatibel (erst Neues hinzufügen, Altes erst in einem späteren Release entfernen).

## Fehlerbilder

| Symptom                                  | Ursache / Abhilfe                                                                                                                                  |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `commit … is not on main`                | SHA stammt aus einem Branch oder Fork – nur gemergte Commits sind deploybar                                                                        |
| `missing …/.env`                         | Umgebung nicht provisioniert → `docs/runbooks/provisioning.md`                                                                                     |
| `pull access denied`                     | GHCR-Paket ist privat → Paket-Einstellungen auf GitHub: Visibility „Public“                                                                        |
| `migrations failed`                      | im Stack-Verzeichnis: `docker compose -f compose.next.yaml --env-file .env --env-file deploy.env.next run --rm --no-deps api node dist/migrate.js` |
| Smoke-Test schlägt fehl, Deploy war grün | Reverse-Proxy-Eintrag oder DNS prüfen (`docs/runbooks/provisioning.md`)                                                                            |

## Wrapper aktualisieren

Änderungen an `infra/deploy/smart-deploy` wirken erst nach erneutem Kopieren auf den VPS:

```bash
scp infra/deploy/smart-deploy <DEPLOY_USER>@<VPS_HOST>:bin/smart-deploy
ssh <DEPLOY_USER>@<VPS_HOST> chmod 755 bin/smart-deploy
```
