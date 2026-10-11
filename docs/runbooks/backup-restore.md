# Runbook: Backup und Restore

## Überblick

Der Container `backup` im Stack `smart-prod` (Profil `backup`) läuft mit supercronic:

| Zeit (UTC)          | Aufgabe                                                                                                                          |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| täglich 03:15       | `backup.sh`: DB-Dump + Stack-Verzeichnis → restic (B2, EU), Aufbewahrung 7 täglich / 4 wöchentlich / 6 monatlich, `restic check` |
| 1. des Monats 04:45 | `restore-test.sh`: letzter Dump → Datenbank `restore_check`, Prüfung, Löschen                                                    |

Beide melden Start/Erfolg/Fehler an healthchecks.io.

## Manuell auslösen

Im Stack-Verzeichnis `~/docker/apps/smart-prod`:

```bash
docker compose --env-file .env --env-file deploy.env exec -T backup backup.sh
docker compose --env-file .env --env-file deploy.env exec -T backup restore-test.sh
docker compose --env-file .env --env-file deploy.env exec -T backup restic snapshots
```

## Vollständige Wiederherstellung (VPS verloren)

1. Neuen VPS mit Docker vorbereiten, Umgebung provisionieren (`provisioning.md`) – beim `.env` die Werte aus dem Backup verwenden:
   ```bash
   docker run --rm -e RESTIC_REPOSITORY=s3:https://<B2_S3_ENDPOINT>/<B2_BUCKET> -e RESTIC_PASSWORD -e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY \
     -v "$PWD/restore:/restore" restic/restic:0.19.1 restore latest --tag config --target /restore
   ```
   (`RESTIC_PASSWORD`, B2-Keys aus dem Passwortmanager als Umgebungsvariablen setzen.)
2. Wiederhergestellte `.env` nach `~/docker/apps/smart-prod/.env` kopieren (Rechte 600).
3. Letzten erfolgreichen Commit über den Deploy-Workflow manuell deployen.
4. Datenbank wiederherstellen (Stack läuft, API kurz stoppen):
   ```bash
   docker compose --env-file .env --env-file deploy.env stop api
   docker compose --env-file .env --env-file deploy.env exec -T backup sh -c 'restic dump --tag db latest smart.dump > /tmp/smart.dump'
   docker compose --env-file .env --env-file deploy.env exec -T backup sh -c \
     'psql -d postgres -c "DROP DATABASE smart" -c "CREATE DATABASE smart" && psql -d smart -c "CREATE EXTENSION IF NOT EXISTS timescaledb" -c "SELECT timescaledb_pre_restore()" && (pg_restore --no-owner -d smart /tmp/smart.dump || true) && psql -d smart -c "SELECT timescaledb_post_restore()"'
   docker compose --env-file .env --env-file deploy.env start api
   ```
5. `/api/health/ready` prüfen.

Pi-Backups folgen in Etappe 5.
