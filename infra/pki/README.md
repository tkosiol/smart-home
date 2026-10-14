# Gateway-PKI

`pki.sh` verwaltet die private CA für den MQTT-Broker: ein Serverzertifikat für den Broker und ein Clientzertifikat je Gateway. Das Skript führt Till selbst im Terminal aus; der CA-Schlüssel verlässt den Rechner nie.

Voraussetzung: OpenSSL 3 oder neuer. macOS liefert LibreSSL mit, das Skript bricht dann ab. Abhilfe: `brew install openssl@3` (wird automatisch gefunden) oder `SMART_OPENSSL=/pfad/zu/openssl`.

## Befehle

```sh
infra/pki/pki.sh init-ca                       # CA anlegen (10 Jahre), fragt eine Passphrase
infra/pki/pki.sh issue-server <host>           # Serverzertifikat (2 Jahre, SAN = <host>)
infra/pki/pki.sh issue-gateway [<id>]          # Gateway-Zertifikat (2 Jahre); ohne ID wird gw-xxxxxxxx erzeugt
infra/pki/pki.sh revoke <id>                   # Gateway sperren und CRL neu erzeugen
infra/pki/pki.sh crl                           # CRL neu erzeugen (365 Tage Laufzeit)
infra/pki/pki.sh status                        # Ablaufdaten (Tage übrig, EXPIRED), Sperrstatus, CRL
```

Gateway-IDs haben die Form `gw-` plus 8 Zeichen `a-z0-9`. Die ID ist der CN des Zertifikats und der Benutzername am Broker; Namen wie `smart-api` lassen sich so nie ausstellen.

## Dateien

Alles liegt in `SMART_PKI_DIR` (Standard `~/.smart-pki`, Rechte `700`, Dateien `600`): `ca.key` (verschlüsselt) und `ca.crt`, `server.key` und `server.crt`, `gateways/<id>.key` und `<id>.crt`, `crl.pem`, `crl-next-update` (Ablauf der CRL, ISO 8601 UTC) sowie die `openssl ca`-Datenbank (`index.txt`, `serial`, `crlnumber`, `newcerts/`).

Ein bestehendes `SMART_PKI_DIR` mit Gruppen- oder Weltzugriff wird abgelehnt (`chmod 700`), das Skript ändert die Rechte eines vorhandenen Verzeichnisses nie.

`ca.key` und die Passphrase gehören in den Passwortmanager und ins Backup. Für Tests und den Stack-Test liest `SMART_PKI_PASSPHRASE_FILE` die Passphrase aus einer Datei.

## Auf den VPS bringen

```sh
SMART_VPS=<user@host> infra/deploy/broker-certs.sh <staging|production>
```

Das Skript kopiert `ca.crt`, `server.crt`, `server.key`, `crl.pem` und `crl-next-update` nach `<stack>/certs/`, setzt `MQTT_TLS=on` in der `.env` und startet den Broker neu. Alles geht in einer einzigen SSH-Sitzung (tar-Strom über stdin); eine CRL, die abgelaufen ist oder in weniger als 7 Tagen abläuft, wird nicht übertragen. Nach jeder Sperrung und vor Ablauf der Zertifikate erneut ausführen.

## Tests

```sh
bash infra/pki/test/run-tests.sh
```
