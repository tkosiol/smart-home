# ADR-0008: Server-Sessions mit `__Host-`-Cookie

- Status: angenommen
- Datum: 2026-10-11

## Kontext

Login-Zustand muss widerrufbar und vor JavaScript-Zugriff geschützt sein.

## Entscheidung

Opake Session-Token, gehasht in Postgres, im `__Host-session`-Cookie (`HttpOnly`, `Secure`, `SameSite=Lax`).

## Konsequenzen

Jede Session einzeln widerrufbar; CSRF-Schutz über `SameSite` + `Origin`-Prüfung nötig.

Details: Spec, Abschnitt 7.3.
