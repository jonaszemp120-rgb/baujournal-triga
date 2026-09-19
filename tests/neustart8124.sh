#!/bin/sh
# Die Kopie der App für die Offline-Suite.
#
# Warum eine Kopie und nicht derselbe Server: dort muss der Service
# Worker mitspielen, und der lässt sich nicht umleiten wie ein
# gewöhnlicher Abruf — er holt seine Dateien selbst. Also wird der Stub
# fest an die Stelle von supabase-js gelegt und das Ganze auf einem
# eigenen Hafen ausgeliefert.

set -e
HIER=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
WURZEL=$(dirname "$HIER")
AUSGABE="${TRIGA_AUSGABE:-$HIER/ausgabe}"
HAFEN=${TRIGA_HAFEN_OFFLINE:-8124}
APP="$AUSGABE/offline-app"

PIDS=$(pgrep -f "http.server $HAFEN" | tr '\n' ' ' || true)
[ -n "$PIDS" ] && kill $PIDS 2>/dev/null || true
sleep 1

rm -rf "$APP"
mkdir -p "$APP"
# Alles ausser der Ausgabe selbst — sonst kopierte sich das Verzeichnis
# in sich hinein.
( cd "$WURZEL" && tar --exclude='./tests/ausgabe' --exclude='./.git' -cf - . ) \
  | ( cd "$APP" && tar -xf - )
cp "$HIER/stub.js" "$APP/vendor/supabase-js-2.58.0.js"

cd "$APP"
nohup python3 -m http.server "$HAFEN" --bind 127.0.0.1 > "$AUSGABE/server-offline.log" 2>&1 &
sleep 2
exit 0
