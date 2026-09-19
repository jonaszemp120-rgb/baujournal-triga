# Die Testsuiten

22 Suiten mit zusammen rund 2300 Prüfungen, gefahren mit Playwright gegen
Chromium. Sie laufen nicht gegen die echte Datenbank, sondern gegen einen
handgeschriebenen Supabase-Ersatz.

## Fahren

```sh
sh tests/lauf-alles.sh      # alles am Stück
node tests/chat.mjs         # eine einzelne Suite
```

Die beiden Server startet `lauf-alles.sh` selbst, wenn sie nicht schon
laufen. Daran hat sonst jedes Mal jemand nicht gedacht, und dann stehen
zwei Suiten rot da, ohne dass am Code etwas falsch wäre — genau das ist
hier schon passiert. Für eine einzelne Suite braucht es den Server auf
8123 von Hand:

```sh
python3 -m http.server 8123 --bind 127.0.0.1 &
```

Alles, was bei einem Lauf entsteht — Bildschirmfotos, Protokolle, die
Kopie der App —, landet in `tests/ausgabe/` und steht in `.gitignore`.

Gebraucht wird Playwright samt Chromium. Ist es global installiert, wird
es gefunden; sonst zeigt `TRIGA_PLAYWRIGHT` auf sein `index.mjs`. Der
Browser kommt über Playwrights eigene Ablage oder über
`PLAYWRIGHT_BROWSERS_PATH`.

| Variable | wofür |
|---|---|
| `TRIGA_PLAYWRIGHT` | Pfad zu `playwright/index.mjs`, falls die gewöhnliche Auflösung fehlschlägt |
| `TRIGA_BASIS` | Adresse des Servers, sonst `http://127.0.0.1:8123` |
| `TRIGA_BASIS_OFFLINE` | dasselbe für die Offline-Kopie, sonst `:8124` |
| `TRIGA_HAFEN`, `TRIGA_HAFEN_OFFLINE` | welche Häfen `lauf-alles.sh` öffnet |
| `TRIGA_AUSGABE` | wohin Bildschirmfotos und Protokolle gehen |

## Warum ein eigener Stub und kein echter Supabase

`stub.js` tritt an die Stelle von `vendor/supabase-js`. Die Suiten leiten
den Abruf darauf um, die App merkt nichts davon. Das hat zwei Gründe. Der
eine ist praktisch: aus der Entwicklungsumgebung ist der echte Endpunkt
gesperrt. Der andere wiegt schwerer — ein Test, der eine gemeinsame
Datenbank verändert, ist nach dem dritten Durchlauf ein anderer Test.

Der Preis dafür steht gleich dabei: **der Stub ist nur so gut wie sein
Nachbau.** Er führt die Policies, Trigger und Prüfregeln aus der Datenbank
ein zweites Mal, und jede Regel, die dort dazukommt, muss hier nachgezogen
werden. Sonst prüfen die Suiten etwas Freundlicheres als das Original.
Genau das ist schon vorgekommen: der Grundbestand kannte kein Adressbuch,
und damit lief eine Prüfung durch, die in der echten Datenbank abgewiesen
worden wäre.

Deshalb gilt die Reihenfolge: **jede Regel wird zuerst auf der echten
Datenbank nachgewiesen**, mit einem `DO`-Block, der am Schluss
`raise exception` wirft und damit alles zurückrollt. Erst danach lernt der
Stub dieselbe Regel. Der Nachweis ist das Original, der Stub die Kopie.

## Aufbau

```
umgebung.mjs         wo alles liegt: Playwright, die Server, der Stub.
                     Jede Suite holt sich das von dort und kennt selbst
                     keinen einzigen absoluten Pfad
stub.js              der Supabase-Ersatz: Abfragen, Policies, Trigger,
                     Storage, Echtzeit
saat.json            der gemeinsame Anfangsbestand
import-test.csv      Testdaten für den Import im Bereich Mitarbeiter
lauf-alles.sh        fährt alle Suiten, startet die Server dafür selbst
neustart8124.sh      baut die Kopie für die Offline-Suite

shell mitarbeiter dokumente firmenpool test offline durchgang
prinzipien selbsttest projekte pendenzen profil schutz chat feed
formulare abnahme protokoll wetter webpush-vektor serverfunktionen
searchch
```

`schutz` und `serverfunktionen` sind die beiden, die am ehesten etwas
finden: die eine prüft, was ein direkter Aufruf an der Oberfläche vorbei
ausrichtet, die andere die Serverless-Funktionen ohne Netz.

Die Offline-Suite braucht einen zweiten Server, weil dort der Service
Worker mitspielen muss — und der holt seine Dateien selbst und lässt sich
nicht umleiten wie ein gewöhnlicher Abruf. `neustart8124.sh` legt deshalb
eine Kopie der App an, in der der Stub fest an der Stelle von supabase-js
liegt.

## Was hier nicht geprüft wird

Zwei Dinge gehen mit dieser Einrichtung grundsätzlich nicht, und das
steht hier, damit es niemand für eine Lücke hält:

**Das Teilen-Blatt von iOS.** Chromium hat keines. Beim Sichern von Fotos
aus dem Chat wird deshalb die Schnittstelle nachgebaut, die iOS anbietet —
mehr weiss die App über sie ohnehin nicht. Ob das Gerät beim ersten
echten Antippen mitspielt, sieht man nur auf einem iPhone.

**Freigabe-Dialoge des Betriebssystems.** Standort, Benachrichtigungen,
Kamera: geprüft ist alles, was in unserem Code steht — erteilt,
verweigert, stumm, kaputt, offline —, nicht die Maschinerie dahinter.
