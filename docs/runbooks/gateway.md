# Runbook: Gateways, PKI und Broker

Dieses Runbook beschreibt, wie Gateways (der Raspberry Pi in Produktion, der Simulator auf Staging) an den Broker des VPS angebunden werden: die private Zertifizierungsstelle (CA), die Zertifikate auf dem VPS, Registrierung in der App, Sperren, Erneuern und die Prüfung nach der Inbetriebnahme. Konkrete Werte für `<…>` stehen in `.local/`. Die Architektur steht in `docs/superpowers/specs/2026-10-11-smart-home-architecture-design.md` (Abschnitt 4), die Entscheidungen in ADR-0002 und ADR-0020.

Alle Schritte mit Schlüsseln führt Till selbst im eigenen Terminal aus. Schlüssel, Passphrasen und Passwörter gehen nie durch den Chat, nie in das Repository und nie in ein Ticket. Der Pi selbst (Ordner `gateway/`, `provision-gateway.sh`, `pnpm gateway:deploy`, Umzug, Pi-Backups) folgt mit Etappe 5b und wird hier ergänzt.

## Überblick

| Was                     | Wo                                                      | Zweck                                                                                    |
| ----------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| CA (`ca.key`, `ca.crt`) | `~/.smart-pki/` auf dem Mac                             | stellt alle Zertifikate aus; `ca.key` ist mit einer Passphrase verschlüsselt             |
| Server-Zertifikat       | `~/.smart-pki/server.crt`, `server.key`                 | der Broker weist sich damit gegenüber den Gateways aus (Host `mqtt.smart.tillkosiol.de`) |
| Gateway-Zertifikat      | `~/.smart-pki/gateways/<id>.crt`, `<id>.key`            | CN = Gateway-ID (`gw-` plus 8 Zeichen `a-z0-9`), zugleich Benutzername am Broker         |
| CRL (`crl.pem`)         | `~/.smart-pki/`, auf dem VPS in `<Stack>/certs/public/` | Sperrliste; der Broker lädt sie beim Start                                               |
| Gateway in der App      | „Mehr → Gateways“                                       | Plattform-Admin registriert ein Gateway mit seinem öffentlichen Zertifikat               |

Befehle von `infra/pki/pki.sh`: `init-ca`, `issue-server <host>`, `issue-gateway [<id>]`, `revoke <id>`, `crl`, `status` (Einzelheiten in `infra/pki/README.md`). Der CA-Schlüssel verlässt den Mac nie. Auf den VPS gehen nur `ca.crt`, `server.crt`, `server.key` und die CRL (`infra/deploy/broker-certs.sh`); die API sieht dort nur die öffentlichen Dateien, nie `server.key`.

## 1. Voraussetzungen

- OpenSSL 3 oder neuer. macOS liefert LibreSSL mit; `pki.sh` bricht dann ab. `brew install openssl@3` genügt, das Skript findet die Homebrew-Installation selbst; sonst `SMART_OPENSSL=/pfad/zu/openssl`.
- Die Umgebung ist provisioniert (`docs/runbooks/provisioning.md`): `provision.sh` hat `<Stack>/certs/public/` und `<Stack>/certs/private/` angelegt und `MQTT_TLS=off` geschrieben.
- Ein Passwortmanager für die CA-Passphrase.

## 2. PKI einrichten (einmalig)

```bash
infra/pki/pki.sh init-ca
```

Das Skript fragt die Passphrase zweimal ab (mindestens 8 Zeichen, besser ein langer Zufallswert). **Die Passphrase sofort im Passwortmanager ablegen**: ohne sie lässt sich nie wieder ein Zertifikat ausstellen oder sperren. `init-ca` bricht ab, wenn schon eine CA existiert. Die CA gilt 10 Jahre (Erneuerung siehe Abschnitt 9).

Danach das Server-Zertifikat für den Broker (Host = Name, unter dem die Gateways den Broker erreichen):

```bash
infra/pki/pki.sh issue-server mqtt.smart.tillkosiol.de
infra/pki/pki.sh status
```

`status` zeigt für CA, Server und jedes Gateway das Ablaufdatum (Tage übrig oder `EXPIRED`), den Sperrstatus und die nächste Aktualisierung der CRL. Das Server-Zertifikat gilt 2 Jahre. Die App überwacht es nicht (nur Gateway-Zertifikate und die CRL): Kalendereintrag für `pki.sh status` in 22 Monaten anlegen.

Staging und Produktion nutzen dieselbe CA und dasselbe Server-Zertifikat; Staging veröffentlicht den Port nicht (nur `127.0.0.1:18883`), braucht die Dateien aber, weil die API die CA zum Prüfen der Registrierung liest.

## 3. Sicherung von `~/.smart-pki`

Das Verzeichnis enthält neben dem verschlüsselten `ca.key` auch `server.key` und alle Gateway-Schlüssel **unverschlüsselt**. Es gehört nie in ein unverschlüsseltes Backup, nie in die Cloud und nie in ein Repository.

1. Verschlüsseltes Disk-Image anlegen (fragt ein Passwort; auch dieses in den Passwortmanager):

   ```bash
   hdiutil create -encryption AES-256 -fs APFS -volname smart-pki -srcfolder ~/.smart-pki ~/smart-pki-backup.dmg
   ```

2. Das Image an **zwei** getrennten Orten ablegen (z. B. externe Platte und ein zweiter Datenträger an einem anderen Ort).
3. **Nach jeder Änderung neu sichern**: nach jedem `issue-server`, `issue-gateway`, `revoke` und `crl`. Die CA-Datenbank (`index.txt`, `serial`, `crlnumber`) gehört dazu; ein altes Backup verliert Sperrungen und Seriennummern.
4. Einmal im Jahr (beim Erneuern der CRL) das Backup öffnen und `ca.key` samt Passphrase prüfen.

## 4. Zertifikate auf den VPS bringen

```bash
SMART_VPS=<DEPLOY_USER>@<VPS_HOST> infra/deploy/broker-certs.sh staging
SMART_VPS=<DEPLOY_USER>@<VPS_HOST> infra/deploy/broker-certs.sh production
```

Das Skript kopiert `ca.crt`, `server.crt`, `crl.pem` und `crl-next-update` nach `<Stack>/certs/public/` und `server.key` nach `<Stack>/certs/private/` (Rechte 700/600), setzt `MQTT_TLS=on` in der `.env` und startet den Broker neu. Alles geht in einer SSH-Sitzung; eine CRL, die in weniger als 7 Tagen abläuft, überträgt es nicht. Beim Neustart trennt der Broker kurz alle Verbindungen; Gateways verbinden sich von selbst neu, der Pi puffert solange.

Prüfen (auf dem VPS im Stack-Verzeichnis):

```bash
docker compose -f compose.yaml --env-file .env --env-file deploy.env logs --tail 30 broker
```

Zu sehen sein muss `Opening ipv4 listen socket on port 8883`. Fehlt die Zeile, ist `MQTT_TLS` nicht `on` oder eine Datei fehlt; der Broker bleibt dann bewusst beim internen Listener. Danach nimmt die API Registrierungen an (Abschnitt 6).

Vom Mac prüfen, ob Produktion das Server-Zertifikat der CA vorzeigt und ohne Client-Zertifikat abweist:

```bash
openssl s_client -connect mqtt.smart.tillkosiol.de:8883 -CAfile ~/.smart-pki/ca.crt </dev/null
```

`Verify return code: 0 (ok)` bedeutet: Kette stimmt. Dass der Broker danach die Verbindung ohne Client-Zertifikat beendet („alert bad certificate“ in der Ausgabe), ist richtig (mit macOS-LibreSSL den Pfad von `openssl@3` verwenden).

## 5. Port 8883: UFW, Docker und Fail2ban (Till, Root auf dem VPS)

Claude hat auf dem VPS kein Root; diese Schritte macht Till.

**UFW:** Eine Regel für den Port dokumentiert die Absicht:

```bash
sudo ufw allow 8883/tcp comment 'smart-home broker (mTLS)'
```

**Wichtig:** Docker veröffentlicht Ports über eigene iptables-Regeln, die vor UFW greifen. Der Port 8883 ist daher **unabhängig von UFW** aus dem Internet erreichbar, sobald Produktion ihn veröffentlicht (`MQTT_PUBLIC_PORT=8883`); eine UFW-Regel „deny“ würde daran nichts ändern. Der Schutz des Ports ist deshalb nicht die Firewall, sondern: ohne gültiges Client-Zertifikat der eigenen CA scheitert der TLS-Handshake, bevor Mosquitto MQTT-Pakete liest, und `max_connections 20` begrenzt gleichzeitige Verbindungen. Deshalb veröffentlicht der Stack ausschließlich diesen einen Port.

Optional (Tills Entscheidung, nicht nötig für den Betrieb): eine Regel in der Kette `DOCKER-USER` begrenzt zusätzlich gleichzeitige Verbindungen je Absender. Sie greift nach der Adressumsetzung, also auf den Container-Port 8883; vor dem Dauerbetrieb von Hand testen und persistent machen (z. B. `iptables-persistent`):

```bash
sudo iptables -I DOCKER-USER -p tcp --dport 8883 -m connlimit --connlimit-above 10 --connlimit-mask 32 -j DROP
```

**Fail2ban:** Mosquitto protokolliert jeden fehlgeschlagenen Handshake mit der Absenderadresse, z. B.:

```
1791994764: Client 203.0.113.7 [203.0.113.7:55096] disconnected: Protocol error.
```

Filter `/etc/fail2ban/filter.d/smart-mosquitto-tls.conf`:

```ini
[Definition]
failregex = Client <HOST> \[\S+\] disconnected: Protocol error\.
```

Jail `/etc/fail2ban/jail.d/smart-mosquitto-tls.local`:

```ini
[smart-mosquitto-tls]
enabled  = true
filter   = smart-mosquitto-tls
port     = 8883
# Docker schreibt das Log des Brokers als JSON; der Container wird bei Deploys neu erzeugt, daher das Muster.
logpath  = /var/lib/docker/containers/*/*-json.log
# Veröffentlichte Docker-Ports erreicht nur die Kette DOCKER-USER, nicht INPUT.
chain    = DOCKER-USER
maxretry = 5
findtime = 10m
bantime  = 1h
```

Die Dateien sind **auf dem VPS ungetestet**; vor dem Aktivieren mit der echten Logdatei prüfen (zeigt die Treffer und die erkannte Zeit; steht die Zeit falsch, den `datepattern` des Jails an das Docker-Format `"time":"…Z"` anpassen):

```bash
sudo fail2ban-regex /var/lib/docker/containers/<Container-ID>/<Container-ID>-json.log /etc/fail2ban/filter.d/smart-mosquitto-tls.conf
sudo systemctl reload fail2ban
sudo fail2ban-client status smart-mosquitto-tls
```

Ein Gateway mit abgelaufenem oder gesperrtem Zertifikat versucht immer wieder, sich zu verbinden, und wird nach 5 Versuchen gesperrt. Ist das Heimnetz irrtümlich gesperrt: `sudo fail2ban-client set smart-mosquitto-tls unbanip <Adresse>`.

## 6. Gateway ausstellen und registrieren

1. Zertifikat ausstellen (ohne Angabe erzeugt das Skript die ID `gw-xxxxxxxx`; sie ist Zertifikats-CN, Benutzername am Broker und Teil aller Topics `gw/<id>/…`):

   ```bash
   infra/pki/pki.sh issue-gateway
   ```

   Ausgabe: die ID und die Dateien `~/.smart-pki/gateways/<id>.crt` und `<id>.key`. Der Schlüssel (`.key`) kommt nur auf das Gateway selbst (für den Pi über `provision-gateway.sh`, Etappe 5b) und sonst nirgendwohin.

2. Backup von `~/.smart-pki` erneuern (Abschnitt 3).
3. In der App als Plattform-Admin anmelden, den Haushalt wählen, dem das Gateway gehört (Till muss dort Eigentümer sein), „Mehr → Gateways“ öffnen. Unter „Gateway registrieren“ einen Namen eingeben und den **Text des Zertifikats** (`cat ~/.smart-pki/gateways/<id>.crt`, einschließlich der Zeilen mit `BEGIN` und `END`) einfügen. **Niemals den privaten Schlüssel einfügen.**
4. Die App prüft, dass das Zertifikat von der CA dieser Instanz stammt, ein Client-Zertifikat mit gültiger ID ist und noch gilt; ID, Ablaufdatum und Fingerabdruck liest sie daraus. Nach „Gateway registrieren“ erscheint das Gateway mit Status. Meldet es sich schon am Broker, steht dort „Bridge: Online“ (aus der retained Nachricht `gw/<id>/bridge/connection`), sonst „Unbekannt“ oder „Offline“, bis es sich verbindet. „Zigbee2MQTT: Online“ kommt aus `gw/<id>/z2m/bridge/state`.
5. Nur Eigentümer des Haushalts sehen „Mehr → Gateways“ (Mitglieder und Betrachter nicht); registrieren und sperren dürfen nur Plattform-Admins.

Fehlermeldungen der App stehen unter „Fehlerbilder“.

## 7. Simulator auf Staging registrieren

Staging hat anstelle eines echten Gateways den Simulator (`provision.sh staging` schreibt Profil `simulator`, `MQTT_SIMULATOR_PASSWORD` und `MQTT_SIMULATOR_GATEWAY_ID`; GHCR-Paket siehe `docs/runbooks/deploy.md`). Er verbindet sich über den internen Listener 1883 mit Passwort, nicht mit einem Zertifikat. Die App registriert Gateways aber nur mit Zertifikat; daher wird für seine ID eines ausgestellt (es wird nur registriert, nie vom Simulator benutzt):

```bash
ssh <DEPLOY_USER>@<VPS_HOST> grep '^MQTT_SIMULATOR_GATEWAY_ID=' docker/apps/smart-staging/.env
infra/pki/pki.sh issue-gateway <die ID aus der Zeile>
```

Danach wie in Abschnitt 6 in der Staging-App registrieren (Name z. B. „Simulator“). Erwartet: „Bridge: Online“ und „Zigbee2MQTT: Online“, die Zeit der letzten Nachricht wandert mit dem Intervall (`SIMULATOR_INTERVAL_SECONDS`, Standard 300 s). Auf Produktion gibt es keinen Simulator.

## 8. Sperren

Ein Gateway ist verloren, gestohlen oder wird nicht mehr gebraucht:

1. In der App unter „Mehr → Gateways“ beim Gateway „Sperren“ drücken und mit „Wirklich sperren?“ bestätigen. Die App weist das Gateway danach ab, **der Broker aber noch nicht**; das erledigt die CRL.
2. Zertifikat sperren und die CRL neu erzeugen:

   ```bash
   infra/pki/pki.sh revoke <id>
   ```

3. Backup von `~/.smart-pki` erneuern (Abschnitt 3).
4. CRL verteilen; der Neustart des Brokers lädt sie:

   ```bash
   SMART_VPS=<DEPLOY_USER>@<VPS_HOST> infra/deploy/broker-certs.sh production
   ```

Erst danach weist der Broker das Zertifikat ab (`pki.sh status` zeigt „revoked“). Bei Staging genauso mit `staging`, wenn dort ein Zertifikat betroffen ist.

## 9. Erneuern

| Was                | Laufzeit | Warnung                                 | Erneuern            |
| ------------------ | -------- | --------------------------------------- | ------------------- |
| Gateway-Zertifikat | 2 Jahre  | App und Backend-Log, 30 Tage vorher     | Abschnitt „Gateway“ |
| Server-Zertifikat  | 2 Jahre  | keine; Kalendereintrag, `pki.sh status` | Abschnitt „Server“  |
| CRL                | 1 Jahr   | App und Backend-Log, 30 Tage vorher     | Abschnitt „CRL“     |
| CA                 | 10 Jahre | keine; Kalendereintrag in Jahr 9        | neue CA, alle neu   |

**CRL (jährlich, Kalendereintrag):** Eine abgelaufene CRL macht jedes Client-Zertifikat ungültig, sperrt also **alle Gateways aus**. Deshalb vor dem Ablauf (die App warnt 30 Tage vorher, `broker-certs.sh` überträgt keine CRL mit weniger als 7 Tagen Restlaufzeit):

```bash
infra/pki/pki.sh crl
SMART_VPS=<DEPLOY_USER>@<VPS_HOST> infra/deploy/broker-certs.sh staging
SMART_VPS=<DEPLOY_USER>@<VPS_HOST> infra/deploy/broker-certs.sh production
```

Backup erneuern (Abschnitt 3).

**Server-Zertifikat:** `pki.sh issue-server` überschreibt nie ein bestehendes Zertifikat. Zum Erneuern zuerst die alten Dateien beiseitelegen (Ablaufdatum prüfen, nicht löschen), dann neu ausstellen und verteilen:

```bash
mv ~/.smart-pki/server.crt ~/.smart-pki/server.crt.alt
mv ~/.smart-pki/server.key ~/.smart-pki/server.key.alt
infra/pki/pki.sh issue-server mqtt.smart.tillkosiol.de
SMART_VPS=<DEPLOY_USER>@<VPS_HOST> infra/deploy/broker-certs.sh staging
SMART_VPS=<DEPLOY_USER>@<VPS_HOST> infra/deploy/broker-certs.sh production
```

Die Gateways vertrauen der CA, nicht dem einzelnen Server-Zertifikat; auf dem Pi ändert sich nichts. Backup erneuern.

**Gateway-Zertifikat:** `issue-gateway <id>` verweigert eine ID, die schon ein Zertifikat hat. Zum Erneuern mit derselben ID (die Topics bleiben gleich) die alten Dateien beiseitelegen und neu ausstellen; war der alte Schlüssel in falschen Händen, **vorher** mit `pki.sh revoke <id>` sperren (siehe Abschnitt 8):

```bash
mv ~/.smart-pki/gateways/<id>.crt ~/.smart-pki/gateways/<id>.crt.alt
mv ~/.smart-pki/gateways/<id>.key ~/.smart-pki/gateways/<id>.key.alt
infra/pki/pki.sh issue-gateway <id>
```

Das neue Zertifikat samt Schlüssel kommt auf das Gateway (Pi: `provision-gateway.sh`, Etappe 5b). Bekannte Lücke: Die App kennt noch keine Erneuerung. Das Gateway läuft mit dem neuen Zertifikat normal weiter (der Broker prüft nur die CA und die CRL), aber „Zertifikat gültig bis“ und die Ablaufwarnung zeigen weiter das Datum des alten Zertifikats, und eine zweite Registrierung derselben ID antwortet mit „schon registriert“. Die Warnung ist dann falsch, bis die App die Erneuerung kennt (offen, Nachfolge in Etappe 5b/6).

**CA (nach 10 Jahren):** Eine neue CA macht alle Zertifikate ungültig (neu ausstellen, verteilen, auf allen Gateways ersetzen). Rechtzeitig als eigene Aufgabe planen.

## 10. Prüfung nach der Inbetriebnahme (Schreib-/Lesetest der ACL)

Der Broker verwirft unerlaubte Nachrichten **still**: ein verbotenes Schreiben meldet keinen Fehler. Die Prüfung läuft deshalb über das Ausbleiben der Nachricht. Nach jeder Inbetriebnahme eines Gateways (Produktion, Gateway `<id>` mit Zertifikat in `~/.smart-pki`):

Mit dem Zertifikat des Gateways schreiben, vom Mac aus über Docker (kein Mosquitto auf dem Mac nötig; `<id>` und eine fremde Beispiel-ID `gw-zzzzzzzz`):

```bash
mqtt() { docker run --rm -v ~/.smart-pki:/pki:ro eclipse-mosquitto:2.1.2-alpine "$@" \
  -h mqtt.smart.tillkosiol.de -p 8883 --cafile /pki/ca.crt \
  --cert /pki/gateways/<id>.crt --key /pki/gateways/<id>.key; }
mqtt mosquitto_pub -q 1 -r -t gw/<id>/z2m/acl-test -m erlaubt
mqtt mosquitto_pub -q 1 -r -t gw/gw-zzzzzzzz/z2m/acl-test -m verboten
```

Lesen als Backend (`smart-api`) im Stack-Verzeichnis auf dem VPS:

```bash
read_topic() { docker compose -f compose.yaml --env-file .env --env-file deploy.env exec -T broker sh -c \
  'mosquitto_sub -h localhost -u smart-api -P "$MQTT_PASSWORD" -t "$0" -F "%r %p" -C 1 -W 5' "$1"; }
read_topic gw/<id>/z2m/acl-test            # erwartet: "1 erlaubt"
read_topic gw/gw-zzzzzzzz/z2m/acl-test     # erwartet: nichts (nach 5 s Ende ohne Ausgabe)
```

Weitere Erwartungen: Ein Befehl des Backends (`mosquitto_pub … -t gw/<id>/z2m/lampe/set`) erreicht das Gateway (`mqtt mosquitto_sub -t 'gw/<id>/z2m/+/set' -C 1 -W 20`), ein Abonnement des Gateways auf `gw/gw-zzzzzzzz/z2m/#` liefert nichts, und eine Verbindung ohne Client-Zertifikat scheitert (`mosquitto_pub` ohne `--cert`/`--key`: „Protocol error“; im Broker-Log erscheint die Zeile für Fail2ban). Zum Schluss die Testnachrichten löschen:

```bash
mqtt mosquitto_pub -q 1 -r -n -t gw/<id>/z2m/acl-test
```

(`gw/gw-zzzzzzzz/z2m/acl-test` wurde nie gespeichert, die ACL hat es verworfen.) In der App zeigt das Gateway „Bridge: Online“.

## Fehlerbilder

| Symptom                                                                                   | Ursache / Abhilfe                                                                                                                                                                                                                      |
| ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pki.sh`: „OpenSSL 3 or newer is required“                                                | macOS-LibreSSL: `brew install openssl@3` oder `SMART_OPENSSL=…`                                                                                                                                                                        |
| `pki.sh`: „accessible to other users“                                                     | `chmod 700 ~/.smart-pki`; das Skript ändert vorhandene Rechte nie selbst                                                                                                                                                               |
| `pki.sh`: „already exists“ bei `issue-server` / `issue-gateway`                           | Absicht: nie überschreiben; zum Erneuern alte Dateien beiseitelegen (Abschnitt 9)                                                                                                                                                      |
| `broker-certs.sh`: „the CRL expires … run pki.sh crl first“                               | `pki.sh crl`, dann erneut ausführen                                                                                                                                                                                                    |
| `broker-certs.sh`: „.env does not exist“                                                  | Umgebung nicht provisioniert (`docs/runbooks/provisioning.md`)                                                                                                                                                                         |
| App: „Das Zertifikat ist ungültig, abgelaufen oder nicht von dieser Instanz ausgestellt.“ | falsche CA (die Umgebung hat eine andere `ca.crt`; `broker-certs.sh` für diese Umgebung ausführen), abgelaufen, kein Client-Zertifikat (z. B. das Server-Zertifikat eingefügt) oder die ID passt nicht zum Muster `gw-` plus 8 Zeichen |
| App: „Auf dieser Instanz ist keine Zertifizierungsstelle eingerichtet.“                   | `broker-certs.sh` für diese Umgebung noch nicht ausgeführt (die API liest `ca.crt` aus `certs/public/`)                                                                                                                                |
| App: „Dieses Gateway ist schon registriert.“                                              | die ID ist vergeben (auch in einem anderen Haushalt); ein gesperrtes Gateway bleibt in der Liste                                                                                                                                       |
| Gateway „Offline“ oder „Unbekannt“                                                        | Broker-Log prüfen (Abschnitt 4); Zertifikat abgelaufen oder gesperrt, CRL abgelaufen (Abschnitt 9), Uhr des Gateways falsch (der Pi hat keine RTC), von Fail2ban gesperrt (Abschnitt 5), Port nicht erreichbar                         |
| Alle Gateways „Offline“, Broker-Log voller `Protocol error`                               | CRL abgelaufen: `pki.sh crl` und `broker-certs.sh`                                                                                                                                                                                     |
| Simulator „Unbekannt“ auf Staging                                                         | Dienst `simulator` läuft nicht (Profil, GHCR-Paket öffentlich? `docs/runbooks/deploy.md`) oder die registrierte ID ist nicht die aus der `.env`                                                                                        |
