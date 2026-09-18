/* Abgelaufene Bilder wegräumen — einmal geschrieben, zweimal gebraucht.
 *
 * Im Chat und im Feed gilt dieselbe Regel: ein hochgeladenes Bild lebt 30
 * Tage, danach verschwindet die Datei wirklich. Die Zeile bleibt stehen
 * und verliert nur ihren Pfad; daran erkennt die App den Unterschied
 * zwischen "war nie ein Bild" und "Bild ist weg".
 *
 * Beide Bereiche rufen dieselbe Routine mit ihren eigenen Namen auf. Zwei
 * Kopien desselben Ablaufs wären zwei Orte, an denen jemand später etwas
 * ändert und den anderen vergisst.
 *
 * Der Aufruf braucht den Dienstschlüssel, weil hier fremde Zeilen und
 * fremde Dateien angefasst werden — genau dafür liegt er in den
 * Umgebungsvariablen und nirgends sonst.
 *
 * Vercel ruft Cron-Funktionen mit CRON_SECRET im Authorization-Kopf auf.
 * Ist die Variable gesetzt, verlangt diese Routine sie auch.
 */

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://yslpkgndveoltmnmhjrf.supabase.co';

/* tabelle  — wo die Zeilen mit den Bildern stehen
   bucket   — wo die Dateien liegen */
async function raeumeAb(req, res, { tabelle, bucket }) {
  const dienst = process.env.SUPABASE_SERVICE_KEY;
  if (!dienst) return res.status(503).json({ fehler: 'Der Dienstschlüssel fehlt.' });

  const geheim = process.env.CRON_SECRET;
  if (geheim && req.headers.authorization !== `Bearer ${geheim}`) {
    return res.status(401).json({ fehler: 'Nicht berechtigt.' });
  }

  const kopf = { apikey: dienst, Authorization: `Bearer ${dienst}`, 'Content-Type': 'application/json' };
  const jetzt = new Date().toISOString();

  // Abgelaufen ist, was ein Ablaufdatum in der Vergangenheit hat und noch
  // eine Datei trägt. Alles andere ist längst weg oder war nie ein Bild.
  const abfrage = `${SUPABASE_URL}/rest/v1/${tabelle}` +
    `?select=id,bild_pfad&bild_pfad=not.is.null&bild_ablauf=lt.${encodeURIComponent(jetzt)}&limit=500`;

  const antwort = await fetch(abfrage, { headers: kopf });
  if (!antwort.ok) return res.status(502).json({ fehler: 'Die Liste liess sich nicht laden.' });
  const faellig = await antwort.json();
  if (!faellig.length) return res.status(200).json({ entfernt: 0 });

  /* Erst die Datei, dann die Zeile. In dieser Reihenfolge, weil der
     umgekehrte Weg im Fehlerfall eine Datei zurückliesse, die niemand mehr
     findet — dann läge sie für immer im Bucket. So bleibt beim Abbruch
     höchstens ein Eintrag stehen, den der nächste Lauf erneut aufgreift. */
  const weg = await fetch(`${SUPABASE_URL}/storage/v1/object/${bucket}`, {
    method: 'DELETE',
    headers: kopf,
    body: JSON.stringify({ prefixes: faellig.map(n => n.bild_pfad) })
  });
  if (!weg.ok) return res.status(502).json({ fehler: 'Die Bilder liessen sich nicht löschen.' });

  const ids = faellig.map(n => n.id);
  const leeren = await fetch(
    `${SUPABASE_URL}/rest/v1/${tabelle}?id=in.(${ids.join(',')})`, {
      method: 'PATCH',
      headers: { ...kopf, Prefer: 'return=minimal' },
      body: JSON.stringify({ bild_pfad: null })
    });
  if (!leeren.ok) return res.status(502).json({ fehler: 'Die Einträge liessen sich nicht nachführen.' });

  return res.status(200).json({ entfernt: ids.length });
}

module.exports = { raeumeAb };
