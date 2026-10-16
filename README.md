# Fokus — Marios Task-Tracker

Ein persönlicher Workspace mit ruhigem Dark Mode, Themen für Kunden und Projekte, Aufgaben und Unteraufgaben. React, TypeScript, Express; lokal SQLite, auf Vercel eine eigene Neon-Free-Datenbank.

## Funktionen

- Themen anlegen, bearbeiten und entfernen; Aufgaben auch ohne Thema.
- Aufgaben mit Notizen, Status, Priorität, Datum, Uhrzeit, Dauer und Unteraufgaben.
- Heute mit überfälligen Aufgaben, Eingang, Planung, Erledigtes und themenbezogene Ansichten.
- Liste, Kanban mit Drag-and-drop und Monatskalender; responsive Mobilansicht.
- Suche und Filter; Dark Mode als Standard, gespeicherter Light/Dark-Wechsel.
- Schreiben oder Diktieren mit bearbeitbarer Vorschau und vorsichtiger Fülllautbereinigung. Erkannte Termine und Themen bleiben prüfbar.
- Google-Kalender-Verbindung mit Auswahl des Zielkalenders. Synchronisierung pro Aufgabe standardmäßig aktiv, einzeln abwählbar.
- Import mit Vorschau und Auswahl aus Excel, CSV/TSV, JSON, ICS und dem Google-Kalender.
- Zeiterfassung je Aufgabe und Unteraufgabe: manuelle Einträge, parallele Start/Stopp-Timer, nachträgliche Korrektur und Löschung; Auswertung nach Tag, Woche, Monat, Jahr und Zeitraum mit CSV-, Excel- und JSON-Export.
- JSON-Export, Passwortschutz im produktiven Betrieb, keine Analytics oder Tracker.

## Lokal starten

Node.js **24** verwenden (mindestens 22.13; `node:sqlite` wird benötigt).

```sh
npm ci
npm run dev
```

App unter `http://localhost:3000`. Die lokale Datenbank liegt in `data/fokus.sqlite` und ist aus Git ausgeschlossen. Der Workspace startet leer; Beispielaufgaben können ausdrücklich über „Mit Beispielen starten“ geladen werden. Diese Beispiele sind vom Kalender-Sync ausgenommen.

Optionale Konfiguration: `.env.example` nach `.env` kopieren und benötigte Werte setzen. Ohne Google-Zugangsdaten bleibt die App vollständig für lokale Aufgaben verwendbar.

```sh
npm test
npm run build
```

## Vercel und kostenlose Datenbank

Vercel baut die statische React-Oberfläche und betreibt `/api/*` als Node-Funktion. Eine eigene **Neon Free**-Datenbank verwenden; keine vorhandene Datenbank anderer Projekte verbinden. `DATABASE_URL` nur serverseitig in **Production** hinterlegen. Für Preview/Development separate Datenbanken verwenden oder die Variablen dort nicht setzen.

Erforderliche Vercel-Variablen:

| Variable | Bedeutung |
| --- | --- |
| `DATABASE_URL` | Verbindung zur eigenen Neon-Free-Datenbank |
| `APP_URL` | `https://mario-task-tracker.vercel.app` |
| `APP_SECRET` | Zufälliges, dauerhaftes Geheimnis, mindestens 32 Zeichen |
| `APP_PASSWORD` | Workspace-Passwort, mindestens 16 Zeichen |
| `GOOGLE_CLIENT_ID` | OAuth-Webclient |
| `GOOGLE_CLIENT_SECRET` | Google-Clientschlüssel |
| `APP_TIMEZONE` | `Europe/Paris` |
| `TRUST_PROXY` | `1` hinter Vercels Proxy |

Keine `VITE_`-Präfixe für Secrets verwenden. Keine Schlüssel, `.env`-Dateien oder Datenbanken committen. `APP_SECRET` verschlüsselt die Google-Tokens; bei einem Wechsel muss der Kalender erneut verbunden werden. Der Produktionsserver verweigert den Start ohne HTTPS-Adresse und ausreichende Secrets.

### Schonende Datenbanknutzung

Der persönliche Workspace wird als begrenztes, versioniertes Dokument in Postgres gespeichert. Pro angemeldetem API-Aufruf wird dieses Dokument einmal gelesen. Eine Änderung schreibt es einmal atomar mit Versionsprüfung; konkurrierende Änderungen werden mit einem verständlichen Konfliktfehler abgelehnt, statt neuere Daten zu überschreiben. Die requestbezogene SQLite-Arbeitskopie ist ausschließlich temporär; Postgres bleibt der dauerhafte Speicher. Kein Speichern im Vercel-Dateisystem.

Die App hat **kein Polling**, keine Keepalive-Abfragen und keine regelmäßigen Cronjobs. Sie lädt beim Öffnen, nach Änderungen und beim Zurückkehren in ein sichtbares Fenster (höchstens einmal pro Minute). Unangemeldete Besucher sowie Healthchecks erzeugen keine Datenbankabfragen. Kalenderjobs werden bei Änderungen, manuellem Sync und beim nächsten Öffnen verarbeitet. Neon kann bei Inaktivität schlafen. Es werden keine dauerhaft offenen Datenbankverbindungen gehalten.

Diese Architektur ist für einen persönlichen Workspace ausgelegt, mit einem 5-MB-Limit für das gesamte Arbeitsdokument. Bei wesentlich größeren Datenmengen sollte die Speicherung auf einzelne Postgres-Zeilen umgestellt werden. Die Free-Tarife begrenzen Nutzung; Limits und die bestehende Vercel-Abrechnung im jeweiligen Dashboard prüfen. Es gibt keine automatische Tarifumstellung durch die App.

## Google-Kalender einrichten

1. In einem eigenen Google-Cloud-Projekt ausschließlich die **Google Calendar API** aktivieren. Ein Abrechnungskonto ist dafür nicht vorgesehen.
2. OAuth-App für externe Nutzer konfigurieren. Für persönliche Nutzung kann die App ohne Verifizierung verwendet werden; Google kann beim Verbinden einen Warnhinweis anzeigen. Im Status „Testing“ sind explizite Testnutzer nötig und Refresh-Tokens für Kalenderzugriff nach sieben Tagen abgelaufen. Für den persönlichen laufenden Betrieb den Veröffentlichungsstatus entsprechend auf Produktion setzen.
3. OAuth-Client vom Typ **Webanwendung** erstellen. Exakt diese Weiterleitung autorisieren:

   ```text
   https://mario-task-tracker.vercel.app/api/calendar/callback
   ```

4. `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `APP_SECRET` und `APP_URL` geschützt in Vercel hinterlegen und neu deployen.
5. Mario öffnet **Einstellungen → Google Kalender → Mit Google verbinden**, meldet sich selbst an und wählt einen eigenen Zielkalender.

Fokus verlangt Konto-E-Mail, die Liste eigener Kalender und Ereigniszugriff auf eigene Kalender. OAuth verwendet State und PKCE; Refresh-Tokens werden AES-256-GCM-verschlüsselt gespeichert und niemals an den Browser zurückgegeben. Zugang zur App ist unabhängig vom verbundenen Kalenderkonto durch das Workspace-Passwort geschützt.

Die Synchronisierung ist **Fokus → Google**. Änderungen, Erledigen, Terminverschiebungen, Löschen und das Abwählen des Sync-Schalters aktualisieren oder entfernen den zugehörigen Fokus-Termin. Aufgaben ohne Datum warten auf ihre Terminierung; ohne Uhrzeit entstehen ganztägige Termine. Fehler verbleiben in einer dauerhaften Warteschlange mit verzögerten Wiederholungen beim nächsten App-Zugriff. Es werden ausschließlich von Fokus verwaltete Termine geändert. Trennen widerruft den Google-Zugriff; bestehende Termine verbleiben im Kalender. Ein erneutes Verbinden desselben Kontos verwendet vorhandene Verknüpfungen.

Quellen: [Google OAuth-Webserver](https://developers.google.com/identity/protocols/oauth2/web-server), [persönliche Nutzung und Verifizierung](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification), [Kalenderereignisse](https://developers.google.com/workspace/calendar/api/guides/create-events).

## Import aus anderen Quellen

Über „Importieren“ zuerst eine Datei auswählen oder einen Zeitraum im verbundenen Google-Kalender laden. In der Vorschau Titel, Datum und Notizen prüfen, einzelne Einträge auswählen und optional einem vorhandenen Thema zuordnen. Erst „Importieren“ speichert die Auswahl. Bereits importierte Einträge werden erkannt und übersprungen.

Unterstützt werden `.xlsx`, CSV (Komma oder Semikolon), TSV, JSON-Aufgabenlisten/Fokus-Exporte und iCalendar-Dateien mit VEVENT/VTODO. Die erste Tabellenzeile enthält Spaltennamen; übliche deutsche und englische Namen wie Titel/Task/Name, Notizen/Description, Datum/Due Date, Status, Priorität/Priority und Thema/Project werden erkannt. Datumsformate sind `TT.MM.JJJJ` und `JJJJ-MM-TT`; native Excel-Datumszellen werden ebenfalls gelesen. Die App bietet eine CSV-Vorlage an. Alte `.xls`-Dateien vorher als `.xlsx` speichern.

Maximal 4 MB und 500 Einträge pro Import, maximal 100 Excel-Spalten. Bei mehreren Excel-Blättern wird das erste gefüllte Blatt verwendet und darauf hingewiesen. Formeln werden niemals ausgeführt; nur gespeicherte Ergebnisse werden gelesen. ICS-Wiederholungsregeln werden als einzelne Aufgabe am Serienstart übernommen und in der Vorschau gekennzeichnet. Der Google-Import liest auf Anforderung einen Zeitraum von höchstens 93 Tagen; bereits von Fokus verwaltete Termine werden ausgelassen. Alle importierten Aufgaben starten mit ausgeschaltetem Kalender-Sync, um doppelte Termine zu verhindern. Dieser lässt sich danach pro Aufgabe aktivieren. Ein Fokus-JSON-Import erhält die Eltern-Kind-Zuordnung ausgewählter Aufgaben.

## Spracheingabe

Standardmäßig wird die browserabhängige deutsche Spracherkennung verwendet. Chrome und Edge bieten üblicherweise die beste Unterstützung; Verfügbarkeit und Verarbeitung hängen vom Browser ab. HTTPS oder localhost sowie Mikrofonfreigabe sind erforderlich. Die App weist vor der Aufnahme auf mögliche Verarbeitung durch den Browserdienst hin, zeigt den erkannten Text und speichert erst nach Marios Bestätigung. Fülllaute werden entfernt; bedeutungstragende Wörter und Verneinungen bleiben erhalten.

Eine zusätzliche Transkription über OpenAI ist implementiert, **standardmäßig ausgeschaltet** und kann Kosten verursachen. Sie wird nur durch einen ausdrücklich gesetzten `OPENAI_API_KEY` und nach Zustimmung zur Audioübertragung verwendet. Für einen ausschließlich kostenlosen Betrieb diesen Schlüssel nicht setzen. Es gibt keine Audioaufbewahrung in Fokus.

## Zeiterfassung und Auswertung

Aufgaben und Unteraufgaben haben eine eigene Zeiterfassung. Manuelle Einträge enthalten Beginn, Ende und optionale Notiz; gespeicherte Einträge lassen sich ändern, einer anderen Aufgabe zuordnen und löschen. Die geplante Kalenderdauer bleibt unabhängig von der tatsächlich erfassten Arbeitszeit.

Mehrere Timer können gleichzeitig laufen, höchstens einer pro Aufgabe und bis zu 20 im Workspace. Startzeit und Timerkennung werden dauerhaft gespeichert; die Anzeige berechnet die vergangene Zeit im Browser, auch nach Neuladen oder einer geschlossenen App. Es gibt keine sekundengenauen Serveraufrufe, Heartbeats oder Hintergrundjobs. Start, Stopp und Korrekturen schreiben nur bei Bedarf. „Alle stoppen“ beendet atomar die gerade angezeigten Timer. Erledigen oder Löschen einer Aufgabe beendet ihren Timer und gegebenenfalls die ihrer Unteraufgaben; historische Zeiteinträge bleiben erhalten.

Die Auswertung und Exporte verwenden die Workspace-Zeitzone (`APP_TIMEZONE`, hier Europe/Paris). Einträge über Mitternacht werden auf ihre jeweiligen Tage aufgeteilt; Zeitumstellungen berücksichtigen tatsächliche 23- bzw. 25-Stunden-Tage. Parallel erfasste Zeiten werden addiert. Eine zusätzliche Summe ohne Überschneidungen zeigt die zusammengeführte Zeitspanne; sie ist entsprechend kleiner, wenn Timer parallel liefen. Laufende Timer werden getrennt gezeigt und erst nach dem Stoppen als abgeschlossene Zeit exportiert.

CSV (UTF-8 mit BOM und Semikolon), XLSX und JSON lassen sich für den gewählten Zeitraum und die Aufgaben-/Themenfilter herunterladen. Grenzüberschreitende Einträge werden auf den Exportzeitraum zugeschnitten und nach Tagen aufgeteilt. CSV-Texte werden gegen Tabellenformel-Auswertung abgesichert. Der allgemeine JSON-Export enthält zusätzlich die Zeiteinträge und laufenden Timer; der bestehende Aufgabenimport übernimmt weiterhin Aufgaben und Themen, keine Zeiterfassung. Versionsprüfungen verhindern, dass eine veraltete Bearbeitung neuere Zeiteinträge überschreibt.

## Betrieb und Sicherung

Alternativ lässt sich Fokus mit dem Dockerfile als eigener Node-Dienst betreiben. `.env` mit Produktionswerten vorbereiten, `docker compose up -d --build` starten und einen HTTPS-Reverse-Proxy vorschalten. Das Docker-Volume `/data` dauerhaft sichern. Bei Neon die eigene Datenbank und den JSON-Export sichern. JSON-Exporte enthalten Aufgaben und Themen, keine Tokens oder Passwörter.

`npm test` deckt die wesentlichen Regeln für Aufgabenhierarchie, Rollbacks, Datenvalidierung, deutsche Diktiersätze, Kalenderdaten und Verschlüsselung ab. Mikrofonqualität und echte Google-Einwilligung erfordern zusätzlich einen Test mit dem jeweiligen Gerät und Google-Konto.
