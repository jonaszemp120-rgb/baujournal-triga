#!/bin/sh
# Alle Suiten am Stück. Schreibt tests/ausgabe/alles.log.
#
# Die beiden Server startet das Skript selbst, wenn sie nicht schon
# laufen — daran hat sonst jedes Mal jemand nicht gedacht, und dann
# stehen zwei Suiten rot da, ohne dass am Code etwas falsch wäre. Genau
# das ist hier schon passiert.

set -e
HIER=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
WURZEL=$(dirname "$HIER")
AUSGABE="${TRIGA_AUSGABE:-$HIER/ausgabe}"
LOG="$AUSGABE/alles.log"

HAFEN=${TRIGA_HAFEN:-8123}
HAFEN_OFFLINE=${TRIGA_HAFEN_OFFLINE:-8124}

mkdir -p "$AUSGABE"
rm -f "$LOG"

# --- Die Server ------------------------------------------------------------

laeuft() { curl -s -o /dev/null --max-time 2 "http://127.0.0.1:$1/index.html"; }

if ! laeuft "$HAFEN"; then
  echo "Server auf $HAFEN wird gestartet …"
  (cd "$WURZEL" && nohup python3 -m http.server "$HAFEN" --bind 127.0.0.1 \
     > "$AUSGABE/server.log" 2>&1 &)
  sleep 2
fi

# Die Offline-Suite braucht eine Kopie der App mit fest eingebautem Stub:
# dort muss der Service Worker mitspielen, und der lässt sich nicht
# umleiten wie ein gewöhnlicher Abruf.
if ! laeuft "$HAFEN_OFFLINE"; then
  echo "Server auf $HAFEN_OFFLINE wird gestartet …"
  sh "$HIER/neustart8124.sh"
fi

# --- Die Suiten -------------------------------------------------------------

cd "$HIER"

ROH="$AUSGABE/roh"
mkdir -p "$ROH"

fahre() {
  name=$1
  datei=${2:-$1}
  printf "%-16s " "$name" >> "$LOG"
  node "$datei.mjs" > "$ROH/$name.txt" 2>&1 || true
  echo "$(grep -c '✓' "$ROH/$name.txt") ok, $(grep -c 'FEHLER' "$ROH/$name.txt") Fehler" >> "$LOG"
  grep -E "FEHLER" "$ROH/$name.txt" | head -4 >> "$LOG" || true
  grep -E "TimeoutError|Error:" "$ROH/$name.txt" | head -2 >> "$LOG" || true
}

for t in shell mitarbeiter dokumente firmenpool test offline durchgang \
         prinzipien selbsttest projekte pendenzen profil schutz chat feed \
         formulare abnahme protokoll wetter webpush-vektor serverfunktionen; do
  fahre "$t"
done
fahre search-ch searchch

echo FERTIG >> "$LOG"
cat "$LOG"
