/* Verschickt eine Benachrichtigung an die anderen Mitglieder eines Chats.
 *
 * Warum überhaupt serverseitig: ein Push muss mit dem privaten
 * VAPID-Schlüssel signiert werden, und die Abos der anderen Leute darf ein
 * Browser nicht lesen. Beides gehört hinter diese Funktion.
 *
 * Wer darf senden: die Funktion nimmt das Zugangs-Token der angemeldeten
 * Person entgegen und fragt damit selbst bei Supabase nach den Mitgliedern
 * des Chats. Steht die Person nicht drin, liefert RLS eine leere Liste und
 * hier ist Schluss. Der Dienstschlüssel kommt erst danach zum Einsatz, und
 * nur für die Abos der so ermittelten Personen.
 *
 * Umgebungsvariablen in Vercel:
 *   VAPID_PRIVAT        privater Schlüssel, Gegenstück zu BJ_CONFIG.vapid
 *   VAPID_ABSENDER      mailto:-Adresse für den Push-Dienst
 *   SUPABASE_SERVICE_KEY  Dienstschlüssel, nur hier, nie im Frontend
 *
 * Fehlt eine davon, antwortet die Funktion mit einem klaren Hinweis statt
 * mit einem Fehler ohne Erklärung — der Chat läuft dann ohne
 * Benachrichtigungen weiter.
 */

const { sende } = require('./_webpush.js');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://yslpkgndveoltmnmhjrf.supabase.co';

/* Der öffentliche Schlüssel steht auch in js/config.js — dort sagt er dem
   Browser, an wen das Abo ausgestellt wird, hier gehört er in den
   VAPID-Kopf. Beide müssen zum privaten Schlüssel passen, sonst weist der
   Push-Dienst den Aufruf ab. Gelesen wird er bei jedem Aufruf und nicht
   beim Laden der Datei, damit das Paar immer aus derselben Quelle kommt. */
const OEFFENTLICH = () => process.env.VAPID_OEFFENTLICH
  || 'BJwToTRmPJy97puyQD3cquX3Q78mIA7r8Z_g64YfJkuVLkeTP4jjE6BNGB2w5dmxitcfyVo67xNWpw6GujHGjFw';

/* Aus dem Token nur die Kennung herauslesen. Geprüft wird das Token nicht
   hier, sondern von Supabase beim nächsten Aufruf — wenn es nicht stimmt,
   kommt die Mitgliederliste leer zurück und wir senden nichts. */
function kennungAus(token) {
  try {
    return JSON.parse(Buffer.from(String(token).split('.')[1], 'base64url').toString()).sub || null;
  } catch { return null; }
}

async function hole(pfad, token, dienst) {
  const antwort = await fetch(`${SUPABASE_URL}/rest/v1/${pfad}`, {
    headers: { apikey: dienst || token, Authorization: `Bearer ${dienst || token}` }
  });
  if (!antwort.ok) return null;
  return antwort.json();
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ fehler: 'Nur POST.' });

  const privat = process.env.VAPID_PRIVAT;
  const dienst = process.env.SUPABASE_SERVICE_KEY;
  const absender = process.env.VAPID_ABSENDER || 'mailto:info@triga.ch';
  if (!privat || !dienst) {
    return res.status(503).json({ fehler: 'Für Benachrichtigungen fehlen noch die Schlüssel.' });
  }

  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const ich = kennungAus(token);
  if (!ich) return res.status(401).json({ fehler: 'Nicht angemeldet.' });

  const daten = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const chat = String(daten.chat || '');
  if (!/^[0-9a-f-]{36}$/i.test(chat)) return res.status(400).json({ fehler: 'Kein Gespräch angegeben.' });

  // Schritt eins, mit dem Token der Person: wer gehört zu diesem Gespräch?
  const mitglieder = await hole(
    `chat_mitglieder?chat_id=eq.${chat}&select=user_id`, token, null);
  if (!mitglieder || !mitglieder.length) {
    return res.status(403).json({ fehler: 'Kein Zugriff auf dieses Gespräch.' });
  }

  const ziele = mitglieder.map(m => m.user_id).filter(u => u !== ich);
  if (!ziele.length) return res.status(200).json({ gesendet: 0 });

  // Schritt zwei, mit dem Dienstschlüssel: deren Geräte.
  const geraete = await hole(
    `push_geraete?user_id=in.(${ziele.join(',')})&select=id,endpunkt,p256dh,auth`, null, dienst);
  if (!geraete || !geraete.length) return res.status(200).json({ gesendet: 0 });

  const text = JSON.stringify({
    titel: String(daten.titel || 'TRIGA App').slice(0, 80),
    text: String(daten.text || '').slice(0, 200),
    ziel: daten.ziel ? String(daten.ziel).slice(0, 200) : `chat.html?chat=${chat}`
  });

  let gesendet = 0;
  const verfallen = [];
  await Promise.all(geraete.map(async g => {
    try {
      const status = await sende(g, text, { oeffentlich: OEFFENTLICH(), privat, absender });
      if (status === 404 || status === 410) verfallen.push(g.id);
      else if (status >= 200 && status < 300) gesendet++;
    } catch { /* ein stummes Gerät darf die anderen nicht aufhalten */ }
  }));

  /* Abgemeldete Geräte gleich wegräumen. Sonst wächst die Tabelle mit
     jedem neu installierten Browser und wir senden ewig ins Leere. */
  if (verfallen.length) {
    await fetch(`${SUPABASE_URL}/rest/v1/push_geraete?id=in.(${verfallen.join(',')})`, {
      method: 'DELETE',
      headers: { apikey: dienst, Authorization: `Bearer ${dienst}` }
    }).catch(() => {});
  }

  return res.status(200).json({ gesendet, aufgeraeumt: verfallen.length });
};
