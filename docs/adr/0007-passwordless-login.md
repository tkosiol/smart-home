# ADR-0007: Passwortloser Login: Passkeys + E-Mail-Code

- Status: angenommen
- Datum: 2026-10-11

## Kontext

Passwörter sind ein Risiko; Recovery-Codes sind unbequem.

## Entscheidung

Passkeys als Hauptweg, E-Mail-Code (Resend) als Alternative, CLI-Recovery-Link als Notfall; keine Passwörter.

## Konsequenzen

Das E-Mail-Konto wird zum Generalschlüssel und braucht 2FA; Mailversand ist Pflichtinfrastruktur.

Details: Spec, Abschnitt 7.2.
