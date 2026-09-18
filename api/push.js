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
 *
 * Jede Absage schreibt eine Zeile ins Log. Eine Funktion, die 403 sagt
 * und sonst schweigt, kostet einen halben Abend Sucherei; das war hier
 * schon einmal so.
 */

const { sende } = require('./_webpush.js');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://yslpkgndveoltmnmhjrf.supabase.co';

/* Der anon key. Er ist öffentlich und steht auch in js/config.js — hier
   steht er, weil jede Anfrage an Supabase zweierlei braucht: einen
   API-Schlüssel des Projekts im Kopf `apikey`, und die Person im Kopf
   `Authorization`. Das sind zwei verschiedene Dinge, und genau das ging
   hier einmal durcheinander: das Zugangs-Token der Person stand in
   beiden Köpfen. Das Tor davor kennt aber nur die Schlüssel des
   Projekts, nicht die Token seiner Nutzer, und wies die Anfrage ab —
   woraufhin diese Funktion "kein Zugriff auf dieses Gespräch" meldete,
   obwohl die Person längst im Gespräch sass. */
const ANON = process.env.SUPABASE_ANON_KEY
  || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlzbHBrZ25kdmVvbHRtbm1oanJmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk2NDI4OTYsImV4cCI6MjEwNTIxODg5Nn0.lLTX_AkB-6u7hqT28kSRDmm-QELen5JIZh3lWw2c5Ek';

/* Der öffentliche Schlüssel steht auch in js/config.js — dort sagt er dem
   Browser, an wen das Abo ausgestellt wird, hier gehört er in den
   VAPID-Kopf. Beide müssen zum privaten Schlüssel passen, sonst weist der
   Push-Dienst den Aufruf ab. Gelesen wird er bei jedem Aufruf und nicht
   beim Laden der Datei, damit das Paar immer aus derselben Quelle kommt. */
const OEFFENTLICH = () => process.env.VAPID_OEFFENTLICH
  || 'BJwToTRmPJy97puyQD3cquX3Q78mIA7r8Z_g64YfJkuVLkeTP4jjE6BNGB2w5dmxitcfyVo67xNWpw6GujHGjFw';

/* Welche Rolle trägt der Dienstschlüssel? Der Unterschied entscheidet
   hier alles: nur service_role sieht die Geräte anderer Leute. Steht in
   der Umgebungsvariablen versehentlich der anon key, greift auf
   push_geraete die Zeilensicherheit — und die liefert dann keine
   Fehlermeldung, sondern eine leere Liste. Von aussen sieht das aus, als
   hätte schlicht niemand ein Gerät angemeldet. */
function rolleVon(schluessel) {
  if (/^sb_secret_/.test(String(schluessel))) return 'service_role';
  const teile = String(schluessel).split('.');
  if (teile.length !== 3) return 'unbekannt';
  try {
    return JSON.parse(Buffer.from(teile[1], 'base64url').toString()).role || 'unbekannt';
  } catch { return 'unbekannt'; }
}

/* Aus dem Token nur die Kennung herauslesen. Geprüft wird das Token nicht
   hier, sondern von Supabase beim nächsten Aufruf — wenn es nicht stimmt,
   kommt die Mitgliederliste leer zurück und wir senden nichts. */
function kennungAus(token) {
  try {
    return JSON.parse(Buffer.from(String(token).split('.')[1], 'base64url').toString()).sub || null;
  } catch { return null; }
}

/* Liefert immer, was wirklich zurückkam — Status und Text inklusive.
   Vorher gab es hier nur null, und damit war im Log nicht mehr zu
   erkennen, ob Supabase die Anfrage abgewiesen hat oder ob schlicht
   nichts gefunden wurde. */
async function hole(pfad, { apikey, token }) {
  try {
    const antwort = await fetch(`${SUPABASE_URL}/rest/v1/${pfad}`, {
      headers: { apikey, Authorization: `Bearer ${token}` }
    });
    const roh = await antwort.text();
    let daten = null;
    try { daten = JSON.parse(roh); } catch { /* kein JSON, dann eben der Text */ }
    return { ok: antwort.ok, status: antwort.status, daten, roh: String(roh).slice(0, 300) };
  } catch (e) {
    return { ok: false, status: 0, daten: null, roh: `Anfrage kam nicht zustande: ${e.message}` };
  }
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ fehler: 'Nur POST.' });

  const privat = process.env.VAPID_PRIVAT;
  const dienst = process.env.SUPABASE_SERVICE_KEY;
  const absender = process.env.VAPID_ABSENDER || 'mailto:info@triga.ch';
  if (!privat || !dienst) {
    console.error(`[push] Abbruch: es fehlt ${!privat ? 'VAPID_PRIVAT' : ''}${!privat && !dienst ? ' und ' : ''}${!dienst ? 'SUPABASE_SERVICE_KEY' : ''} in dieser Bereitstellung.`);
    return res.status(503).json({ fehler: 'Für Benachrichtigungen fehlen noch die Schlüssel.' });
  }

  /* Einmal pro Aufruf laut nachsehen, womit wir gleich bei Supabase
     anklopfen. Das kostet nichts und erspart die Sucherei, die es schon
     einmal gekostet hat. */
  const rolle = rolleVon(dienst);
  if (rolle !== 'service_role') {
    console.error(`[push] SUPABASE_SERVICE_KEY trägt die Rolle "${rolle}" statt "service_role". Damit greift auf push_geraete die Zeilensicherheit, und die Geräte der anderen bleiben unsichtbar — es kommt keine Meldung an, ohne dass ein Fehler entsteht.`);
  }

  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const ich = kennungAus(token);
  if (!ich) {
    console.error(`[push] Abbruch: im Kopf Authorization steckt keine Kennung (${token ? 'Token nicht lesbar' : 'kein Token mitgeschickt'}).`);
    return res.status(401).json({ fehler: 'Nicht angemeldet.' });
  }

  const daten = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const chat = String(daten.chat || '');
  if (!/^[0-9a-f-]{36}$/i.test(chat)) {
    console.error(`[push] Abbruch: "${chat}" ist keine Gesprächskennung.`);
    return res.status(400).json({ fehler: 'Kein Gespräch angegeben.' });
  }

  /* Schritt eins, mit dem Token der Person: wer gehört zu diesem
     Gespräch? Der anon key weist die Anfrage beim Projekt aus, das Token
     die Person. Steht sie nicht im Gespräch, liefert RLS eine leere
     Liste, und hier ist Schluss. */
  const mitglieder = await hole(
    `chat_mitglieder?chat_id=eq.${chat}&select=user_id`, { apikey: ANON, token });

  if (!mitglieder.ok) {
    console.error(`[push] Abbruch: Supabase hat die Mitgliederliste zu ${chat} nicht herausgegeben — Status ${mitglieder.status}, Antwort: ${mitglieder.roh}`);
    return res.status(403).json({ fehler: 'Kein Zugriff auf dieses Gespräch.' });
  }
  if (!Array.isArray(mitglieder.daten) || !mitglieder.daten.length) {
    console.error(`[push] Abbruch: ${ich} ist nicht Mitglied von ${chat}, RLS liefert eine leere Liste.`);
    return res.status(403).json({ fehler: 'Kein Zugriff auf dieses Gespräch.' });
  }

  const ziele = mitglieder.daten.map(m => m.user_id).filter(u => u !== ich);
  if (!ziele.length) {
    console.log(`[push] ${chat}: ausser der sendenden Person ist niemand im Gespräch.`);
    return res.status(200).json({ gesendet: 0 });
  }

  // Schritt zwei, mit dem Dienstschlüssel: deren Geräte.
  const geraete = await hole(
    `push_geraete?user_id=in.(${ziele.join(',')})&select=id,endpunkt,p256dh,auth`,
    { apikey: dienst, token: dienst });

  if (!geraete.ok) {
    console.error(`[push] Abbruch: die Geräte der ${ziele.length} anderen liessen sich nicht laden — Status ${geraete.status}, Antwort: ${geraete.roh}. Stimmt SUPABASE_SERVICE_KEY?`);
    return res.status(502).json({ fehler: 'Die Geräte liessen sich nicht laden.' });
  }
  if (!Array.isArray(geraete.daten) || !geraete.daten.length) {
    console.log(`[push] ${chat}: keine Geräte für ${ziele.join(', ')} gefunden (Schlüsselrolle ${rolle}).`);
    if (rolle !== 'service_role') {
      console.error('[push] Das ist vermutlich kein leeres Ergebnis, sondern die Zeilensicherheit: mit einem Schlüssel ohne service_role sieht diese Funktion nur die eigenen Geräte.');
    }
    return res.status(200).json({ gesendet: 0 });
  }

  const text = JSON.stringify({
    titel: String(daten.titel || 'TRIGA App').slice(0, 80),
    text: String(daten.text || '').slice(0, 200),
    ziel: daten.ziel ? String(daten.ziel).slice(0, 200) : `chat.html?chat=${chat}`
  });

  let gesendet = 0;
  const verfallen = [];
  await Promise.all(geraete.daten.map(async g => {
    const dienstName = String(g.endpunkt || '').split('/')[2] || 'unbekannt';
    try {
      const status = await sende(g, text, { oeffentlich: OEFFENTLICH(), privat, absender });
      if (status === 404 || status === 410) verfallen.push(g.id);
      else if (status >= 200 && status < 300) gesendet++;
      else console.error(`[push] ${dienstName} hat die Meldung abgelehnt: Status ${status}. Passen VAPID_PRIVAT und BJ_CONFIG.vapid zusammen?`);
    } catch (e) {
      // Ein stummes Gerät darf die anderen nicht aufhalten, still bleiben soll es trotzdem nicht.
      console.error(`[push] ${dienstName} nicht erreicht: ${e.message}`);
    }
  }));

  /* Abgemeldete Geräte gleich wegräumen. Sonst wächst die Tabelle mit
     jedem neu installierten Browser und wir senden ewig ins Leere. */
  if (verfallen.length) {
    await fetch(`${SUPABASE_URL}/rest/v1/push_geraete?id=in.(${verfallen.join(',')})`, {
      method: 'DELETE',
      headers: { apikey: dienst, Authorization: `Bearer ${dienst}` }
    }).catch(e => console.error(`[push] Abgemeldete Geräte liessen sich nicht wegräumen: ${e.message}`));
  }

  console.log(`[push] ${chat}: ${gesendet} von ${geraete.daten.length} Geräten erreicht, ${verfallen.length} abgemeldet.`);
  return res.status(200).json({ gesendet, aufgeraeumt: verfallen.length });
};
