# ADR-0016: Deploy per Forced-Command-SSH-Key

- Status: angenommen
- Datum: 2026-10-11

## Kontext

GitHub Actions braucht Zugriff auf den VPS, das Repo ist öffentlich.

## Entscheidung

SSH-Key pro Environment, in `authorized_keys` auf `command="…/smart-deploy <environment>",restrict` beschränkt. Der Wrapper akzeptiert nur `deploy <sha>`, prüft per GitHub-API, dass der Commit auf `main` liegt, lädt `infra/deploy/deploy.sh` und `infra/compose/compose.yaml` genau dieses Commits und führt sie aus.

## Konsequenzen

Ein gestohlener Deploy-Key kann nur bereits auf `main` vorhandene Commits in seine eigene Umgebung deployen. Änderungen am Wrapper selbst müssen manuell auf den VPS kopiert werden (Runbook).

Details: Spec, Abschnitt 6.2.
