/* Erinnert an ablaufende Fristen im Firmenpool.
 *
 * An einer roten Notiz kann ein Datum stehen: bis wann der
 * Versicherungsnachweis da sein muss, bis wann die Mängel behoben sind.
 * Drei Tage vorher bekommt die Person, die die Notiz geschrieben hat,
 * eine Meldung aufs Telefon.
 *
 * Warum drei Tage und nicht am Tag selbst: am Tag selbst ist es für
 * einen Anruf oft zu spät. Drei Tage reichen, um jemanden zu erreichen,
 * und sind kurz genug, dass man die Meldung nicht wieder vergisst.
 *
 * Warum nur an die verfassende Person: sie hat die Frist gesetzt und
 * weiss, worum es geht. Eine Meldung an alle wäre für sieben Leute
 * Lärm und für einen davon nützlich.
 *
 * Gemeldet wird jede Frist genau einmal. Dafür steht frist_gemeldet_am
 * an der Zeile — ohne das käme dieselbe Erinnerung jeden Tag neu, bis
 * jemand die Notiz anfasst. Wer die Frist verschiebt, setzt den Vermerk
 * zurück (das macht die App beim Speichern), und dann meldet sich auch
 * die neue Frist wieder.
 *
 * Läuft täglich über den Cron-Eintrag in vercel.json. Der Aufruf braucht
 * den Dienstschlüssel: hier werden fremde Notizen gelesen und fremde
 * Geräte angeschrieben.
 */

const { sende } = require('./_webpush.js');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://yslpkgndveoltmnmhjrf.supabase.co';

/* Wie viele Tage im Voraus gemeldet wird. Eine Zahl und kein verstreuter
   Wert: wer sie ändern will, findet sie hier und nur hier. */
const VORLAUF_TAGE = 3;

const OEFFENTLICH = () => process.env.VAPID_OEFFENTLICH
  || 'BJwToTRmPJy97puyQD3cquX3Q78mIA7r8Z_g64YfJkuVLkeTP4jjE6BNGB2w5dmxitcfyVo67xNWpw6GujHGjFw';

/* Der Tag in drei Tagen, als YYYY-MM-DD. Gerechnet wird in UTC, weil
   `frist` ein Datum ohne Uhrzeit ist und die Datenbank es genauso
   vergleicht — mit lokaler Zeit läge der Lauf je nach Sommerzeit einen
   Tag daneben. */
function zielTag(heute = new Date()) {
  const d = new Date(Date.UTC(
    heute.getUTCFullYear(), heute.getUTCMonth(), heute.getUTCDate() + VORLAUF_TAGE));
  return d.toISOString().slice(0, 10);
}

module.exports = async (req, res) => {
  const dienst = process.env.SUPABASE_SERVICE_KEY;
  const privat = process.env.VAPID_PRIVAT;
  const absender = process.env.VAPID_ABSENDER || 'mailto:info@triga.ch';

  if (!dienst || !privat) {
    console.error(`[fristen] Abbruch: es fehlt ${!dienst ? 'SUPABASE_SERVICE_KEY' : ''}${!dienst && !privat ? ' und ' : ''}${!privat ? 'VAPID_PRIVAT' : ''}.`);
    return res.status(503).json({ fehler: 'Für Erinnerungen fehlen noch die Schlüssel.' });
  }

  const geheim = process.env.CRON_SECRET;
  if (geheim && req.headers.authorization !== `Bearer ${geheim}`) {
    console.error('[fristen] Abbruch: der Aufruf trägt nicht das Cron-Geheimnis.');
    return res.status(401).json({ fehler: 'Nicht berechtigt.' });
  }

  const kopf = { apikey: dienst, Authorization: `Bearer ${dienst}`, 'Content-Type': 'application/json' };
  const tag = zielTag();

  /* Genau die Menge, für die der Index gebaut ist: rote Notizen mit
     einer Frist in drei Tagen, zu denen noch nichts gemeldet wurde.
     Der Firmenname kommt gleich mit — er steht in der Meldung, und eine
     zweite Anfrage je Notiz wäre Verschwendung. */
  const abfrage = `${SUPABASE_URL}/rest/v1/notizen` +
    `?select=id,text,autor_id,frist,firmen(name)` +
    `&farbe=eq.rot&frist=eq.${tag}&frist_gemeldet_am=is.null&limit=200`;

  let faellig;
  try {
    const antwort = await fetch(abfrage, { headers: kopf });
    if (!antwort.ok) {
      const roh = (await antwort.text()).slice(0, 300);
      console.error(`[fristen] Abbruch: die Notizen liessen sich nicht laden — Status ${antwort.status}, Antwort: ${roh}`);
      return res.status(502).json({ fehler: 'Die Notizen liessen sich nicht laden.' });
    }
    faellig = await antwort.json();
  } catch (e) {
    console.error(`[fristen] Abbruch: die Anfrage kam nicht zustande — ${e.message}`);
    return res.status(502).json({ fehler: 'Die Notizen liessen sich nicht laden.' });
  }

  if (!Array.isArray(faellig) || !faellig.length) {
    console.log(`[fristen] Für den ${tag} steht nichts an.`);
    return res.status(200).json({ gemeldet: 0 });
  }

  /* Die Geräte aller betroffenen Personen in einer Anfrage. Eine je
     Notiz wäre bei zehn Fristen zehn Rundreisen für dieselbe Auskunft. */
  const leute = [...new Set(faellig.map(n => n.autor_id).filter(Boolean))];
  let geraete = [];
  try {
    const antwort = await fetch(
      `${SUPABASE_URL}/rest/v1/push_geraete?user_id=in.(${leute.join(',')})&select=id,user_id,endpunkt,p256dh,auth`,
      { headers: kopf });
    if (antwort.ok) geraete = await antwort.json();
    else console.error(`[fristen] Die Geräte liessen sich nicht laden — Status ${antwort.status}.`);
  } catch (e) {
    console.error(`[fristen] Die Geräte liessen sich nicht laden — ${e.message}`);
  }

  let gesendet = 0;
  const erledigt = [];
  const verfallen = [];

  for (const n of faellig) {
    const meine = geraete.filter(g => g.user_id === n.autor_id);
    const firma = n.firmen?.name || 'einer Firma';
    const text = JSON.stringify({
      titel: `Frist bei ${firma} läuft bald ab`,
      /* Der Notiztext steht mit drin, gekürzt: "Frist läuft ab" allein
         zwingt zum Öffnen der App, um zu erfahren, worum es geht. */
      text: `In ${VORLAUF_TAGE} Tagen: ${String(n.text || '').slice(0, 120)}`,
      ziel: 'firmenpool.html'
    });

    for (const g of meine) {
      const dienstName = String(g.endpunkt || '').split('/')[2] || 'unbekannt';
      try {
        const status = await sende(g, text, { oeffentlich: OEFFENTLICH(), privat, absender });
        if (status === 404 || status === 410) verfallen.push(g.id);
        else if (status >= 200 && status < 300) gesendet++;
        else console.error(`[fristen] ${dienstName} hat die Meldung abgelehnt: Status ${status}.`);
      } catch (e) {
        console.error(`[fristen] ${dienstName} nicht erreicht: ${e.message}`);
      }
    }

    /* Auch ohne Gerät gilt die Frist als gemeldet. Sonst sammelte sich
       für jemanden ohne Benachrichtigungen jeden Tag derselbe Versuch
       an, und beim ersten angemeldeten Gerät käme ein Schwall alter
       Erinnerungen. */
    erledigt.push(n.id);
  }

  if (erledigt.length) {
    try {
      await fetch(`${SUPABASE_URL}/rest/v1/notizen?id=in.(${erledigt.join(',')})`, {
        method: 'PATCH', headers: kopf,
        body: JSON.stringify({ frist_gemeldet_am: new Date().toISOString() })
      });
    } catch (e) {
      console.error(`[fristen] Der Vermerk liess sich nicht setzen — ${e.message}. Die Erinnerung kommt morgen nochmals.`);
    }
  }

  if (verfallen.length) {
    await fetch(`${SUPABASE_URL}/rest/v1/push_geraete?id=in.(${verfallen.join(',')})`, {
      method: 'DELETE', headers: kopf
    }).catch(e => console.error(`[fristen] Abgemeldete Geräte liessen sich nicht wegräumen: ${e.message}`));
  }

  console.log(`[fristen] ${tag}: ${faellig.length} Frist(en), ${gesendet} Meldung(en) verschickt, ${verfallen.length} Gerät(e) abgemeldet.`);
  return res.status(200).json({ gemeldet: faellig.length, gesendet, aufgeraeumt: verfallen.length });
};

/* Für die Tests: der Tag lässt sich von aussen nachrechnen, ohne die
   Function aufzurufen. */
module.exports.zielTag = zielTag;
module.exports.VORLAUF_TAGE = VORLAUF_TAGE;
