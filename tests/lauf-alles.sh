#!/bin/sh
cd "$(dirname "$0")" || exit 1
rm -f alles.log
for t in shell mitarbeiter dokumente firmenpool test offline durchgang prinzipien selbsttest projekte pendenzen profil schutz chat feed formulare abnahme protokoll wetter; do
  printf "%-14s " "$t" >> alles.log
  node "$t.mjs" > "/tmp/o_$t.txt" 2>&1
  echo "$(grep -c '✓' /tmp/o_$t.txt) ok, $(grep -c 'FEHLER' /tmp/o_$t.txt) Fehler" >> alles.log
  grep -E "FEHLER" "/tmp/o_$t.txt" | head -4 >> alles.log
  grep -E "TimeoutError|Error:" "/tmp/o_$t.txt" | head -2 >> alles.log
done
for t in webpush-vektor serverfunktionen; do
  printf "%-14s " "$t" >> alles.log
  node "$t.mjs" > "/tmp/o_$t.txt" 2>&1
  echo "$(grep -c '✓' /tmp/o_$t.txt) ok, $(grep -c 'FEHLER' /tmp/o_$t.txt) Fehler" >> alles.log
done
printf "%-14s " "search-ch" >> alles.log
node searchch.mjs > /tmp/o_searchch.txt 2>&1
echo "$(grep -c '✓' /tmp/o_searchch.txt) ok, $(grep -c 'FEHLER' /tmp/o_searchch.txt) Fehler" >> alles.log
echo FERTIG >> alles.log
