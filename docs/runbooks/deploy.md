# Runbook: Deploy und Rollback

## Normaler Ablauf

1. PR mergen → CI auf `main` läuft.
2. Workflow **Deploy** startet automatisch nach grüner CI: baut `api`, `web`, `broker`, `backup` und `simulator`, scannt sie mit Trivy und pusht `ghcr.io/tkosiol/smart-home-<image>:<sha>`.
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

## Neues GHCR-Paket: Simulator

Der erste Deploy-Lauf auf `main`, der das Image `smart-home-simulator` baut, legt das GHCR-Paket neu an, und neue Pakete sind **privat**. Staging lädt es erst, wenn dessen `.env` das Profil `simulator` enthält (Schritt 3); bis dahin schadet das private Paket nicht. Einmalig, in dieser Reihenfolge (Till):

1. Nach dem ersten erfolgreichen Deploy-Lauf auf `main` auf GitHub das Paket `smart-home-simulator` öffnen → „Package settings“ → „Change visibility“ → **Public**.
2. `SMART_VPS=<DEPLOY_USER>@<VPS_HOST> infra/deploy/provision.sh staging --force` (ergänzt `COMPOSE_PROFILES=simulator`, `MQTT_SIMULATOR_PASSWORD` und `MQTT_SIMULATOR_GATEWAY_ID`; die Fragen nach Resend-Schlüssel und Freigabeliste neu beantworten, siehe `docs/runbooks/provisioning.md`).
3. Den Staging-Deploy erneut starten: GitHub → Actions → Deploy → „Run workflow“, `environment` = `staging`, `sha` = der Commit auf `main`. Danach läuft der Simulator; seine Gateway-ID steht in der `.env` von Staging, registriert wird er nach `docs/runbooks/gateway.md`.

Ein Fehler `pull access denied` für `smart-home-simulator` heißt, dass Schritt 1 fehlt.

## Umstieg auf Etappe 5a (einmalig, Till)

Etappe 5a bringt Broker-TLS, Gateways und den Simulator. Die bestehenden Umgebungen kennen die neuen `.env`-Werte noch nicht; ohne diese Schritte scheitert der erste Deploy oder bleibt ohne Wirkung. Reihenfolge einhalten:

1. **Vor dem ersten Produktions-Deploy:** `SMART_VPS=<DEPLOY_USER>@<VPS_HOST> infra/deploy/provision.sh production --force` (schreibt `MQTT_TLS=off` und `MQTT_PUBLIC_PORT=8883` und legt `certs/` an; vorhandene Passwörter bleiben). Ohne `MQTT_PUBLIC_PORT` veröffentlicht Produktion den Broker-Port nicht, der Deploy läuft aber durch. Danach die Freigabe für Produktion erteilen.
2. Nach dem ersten erfolgreichen Deploy-Lauf auf `main` das GHCR-Paket `smart-home-simulator` auf **Public** stellen (Abschnitt „Neues GHCR-Paket: Simulator“, Schritt 1).
3. `provision.sh staging --force` (ergänzt Simulator-Profil, `MQTT_SIMULATOR_*` und `certs/`), danach den Staging-Deploy erneut starten (Abschnitt „Neues GHCR-Paket: Simulator“, Schritt 2 und 3).
4. PKI auf deinem Rechner anlegen (`pki.sh init-ca`, `pki.sh issue-server`), falls noch nicht geschehen: `docs/runbooks/gateway.md`, Abschnitt 2. Der CA-Schlüssel verlässt deinen Rechner nie.
5. Zertifikate auf den VPS bringen: `infra/deploy/broker-certs.sh staging`, dann `infra/deploy/broker-certs.sh production` (Abschnitt 4 des Gateway-Runbooks). Das Skript schaltet `MQTT_TLS` auf `on` und startet den Broker neu.
6. UFW und Fail2ban für Port 8883 einrichten (Abschnitt 5 des Gateway-Runbooks).
7. Den Simulator auf Staging in der App registrieren (Abschnitt 7 des Gateway-Runbooks).

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
