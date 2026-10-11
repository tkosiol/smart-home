# ADR-0016: Deploy per Forced-Command-SSH-Key

- Status: angenommen
- Datum: 2026-10-11

## Kontext

GitHub Actions braucht Zugriff auf den VPS, das Repo ist öffentlich.

## Entscheidung

SSH-Key pro Environment, beschränkt auf einen Forced Command `smart-deploy <env> <sha>`.

## Konsequenzen

Ein gestohlener Deploy-Key kann nur Deploys bekannter Commits auslösen.

Details: Spec, Abschnitt 6.2.
