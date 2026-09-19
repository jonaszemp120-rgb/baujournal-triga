#!/bin/sh
SC="$(dirname "$0")"
PIDS=$(pgrep -f "http.server 8124" | tr '\n' ' ')
[ -n "$PIDS" ] && kill $PIDS 2>/dev/null
sleep 1
rm -rf "$SC/offline-app"
mkdir -p "$SC/offline-app"
cp -r /home/user/baujournal-triga/* "$SC/offline-app/"
cp "$SC/stub.js" "$SC/offline-app/vendor/supabase-js-2.58.0.js"
cd "$SC/offline-app" || exit 1
nohup python3 -m http.server 8124 --bind 127.0.0.1 > /tmp/srv2.log 2>&1 &
sleep 2
exit 0
