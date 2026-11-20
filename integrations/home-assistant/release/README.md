# Smart Home für Home Assistant

Diese Integration verbindet Home Assistant mit der Smart-Home-App: Geräte und Messwerte aus Home Assistant erscheinen in der App. Sie benötigt Home Assistant 2026.10.0 oder neuer.

## Installation über HACS

1. In HACS das Menü oben rechts öffnen, **Benutzerdefinierte Repositories** wählen.
2. Dieses Repository eintragen (`https://github.com/tkosiol/smart-home-hacs`), Kategorie **Integration**, und hinzufügen.
3. **Smart Home** in HACS suchen, herunterladen und Home Assistant neu starten.
4. Unter **Einstellungen → Geräte & Dienste → Integration hinzufügen** die Integration **Smart Home** wählen.
5. Die Adresse der App eintragen (zum Beispiel `https://smart.example.org`) und den Kopplungscode aus der App eingeben.

Den Code erzeugt der Haushalts-Eigentümer in der App unter **Gateways → „Home Assistant koppeln“**. Er gilt 15 Minuten und lässt sich nur einmal einlösen.

Das Projekt selbst: [tkosiol/smart-home](https://github.com/tkosiol/smart-home). Dieses Repository ist ein automatisch erzeugter Spiegel; Änderungen bitte dort einreichen.

## English

This integration connects Home Assistant to the Smart Home app. It requires Home Assistant 2026.10.0 or newer.

1. In HACS, open the top-right menu and choose **Custom repositories**.
2. Add `https://github.com/tkosiol/smart-home-hacs` with category **Integration**.
3. Find **Smart Home** in HACS, download it and restart Home Assistant.
4. Go to **Settings → Devices & services → Add integration** and pick **Smart Home**.
5. Enter the address of the app (for example `https://smart.example.org`) and the pairing code from the app (**Gateways → "Home Assistant koppeln"**, valid for 15 minutes, single use).

This repository is an automatically generated mirror of [tkosiol/smart-home](https://github.com/tkosiol/smart-home); please send changes there.
