/* Die beiden Serverless-Funktionen, ohne Netz.
   fetch wird ersetzt, damit sichtbar wird, was die Funktionen wirklich
   aufrufen — und vor allem in welcher Reihenfolge. */
import { WURZEL } from './umgebung.mjs';
import { createRequire } from 'node:module';
const require = createRequire(`${WURZEL}api/`);

let gut = 0, schlecht = 0;
const ok = (n, b, zusatz = '') => { b ? gut++ : schlecht++; console.log(`  ${b ? '✓' : '✗ FEHLER'}  ${n}${zusatz ? '  → ' + zusatz : ''}`); };

const echt = globalThis.fetch;
let spur = [];

function stubFetch(antworten) {
  globalThis.fetch = async (url, opt = {}) => {
    const u = String(url);
    spur.push({
      url: u, methode: opt.method || 'GET',
      rumpf: opt.body ? String(opt.body) : null,
      kopf: opt.headers || {}
    });
    for (const [muster, wert] of antworten) {
      if (u.includes(muster)) {
        return {
          ok: wert.status >= 200 && wert.status < 300,
          status: wert.status,
          json: async () => wert.daten,
          text: async () => (typeof wert.daten === 'string' ? wert.daten : JSON.stringify(wert.daten))
        };
      }
    }
    return { ok: true, status: 200, json: async () => ([]), text: async () => '[]' };
  };
}

/* console.error mitschreiben: eine Funktion, die abbricht und dabei
   schweigt, ist im Log nicht von einer erfolgreichen zu unterscheiden.
   Genau das hat einmal einen Abend gekostet. */
const echtesLog = { error: console.error, log: console.log };
let gemeldet = [];
function hoerZu() {
  gemeldet = [];
  console.error = (...a) => gemeldet.push(a.join(' '));
  console.log = (...a) => gemeldet.push(a.join(' '));
}
function hoerAuf() {
  console.error = echtesLog.error;
  console.log = echtesLog.log;
  return gemeldet.join('\n');
}

function antwortDoppel() {
  const a = { status: 0, daten: null };
  return {
    a,
    res: {
      status(s) { a.status = s; return this; },
      json(d) { a.daten = d; return this; }
    }
  };
}

/* ===== Bilder aufräumen =================================================== */

console.log('\n=== api/chat-aufraeumen ===');
{
  const pfad = `${WURZEL}api/chat-aufraeumen.js`;
  delete require.cache[require.resolve(pfad)];
  const aufraeumen = require(pfad);

  // --- Ohne Dienstschlüssel -------------------------------------------------
  delete process.env.SUPABASE_SERVICE_KEY;
  delete process.env.CRON_SECRET;
  let d = antwortDoppel();
  await aufraeumen({ method: 'GET', headers: {} }, d.res);
  ok('Ohne Dienstschlüssel: klare Absage statt Fehler', d.a.status === 503 && !!d.a.daten.fehler, d.a.daten.fehler);

  process.env.SUPABASE_SERVICE_KEY = 'dienst-geheim';

  // --- Cron-Geheimnis gesetzt, aber falsch ----------------------------------
  process.env.CRON_SECRET = 'nur-vercel';
  d = antwortDoppel();
  await aufraeumen({ method: 'GET', headers: { authorization: 'Bearer falsch' } }, d.res);
  ok('Fremder Aufruf wird abgewiesen', d.a.status === 401, String(d.a.status));

  // --- Nichts fällig ---------------------------------------------------------
  spur = [];
  stubFetch([['rest/v1/nachrichten', { status: 200, daten: [] }]]);
  d = antwortDoppel();
  await aufraeumen({ method: 'GET', headers: { authorization: 'Bearer nur-vercel' } }, d.res);
  ok('Nichts fällig: nichts passiert', d.a.status === 200 && d.a.daten.entfernt === 0);
  ok('Und kein Löschaufruf', !spur.some(s => s.methode === 'DELETE'));

  // --- Zwei abgelaufene Bilder ------------------------------------------------
  spur = [];
  stubFetch([
    ['rest/v1/nachrichten?select', { status: 200, daten: [
      { id: 'n1', bild_pfad: 'c1/eins.jpg' },
      { id: 'n2', bild_pfad: 'c2/zwei.png' }
    ] }],
    ['storage/v1/object/chat-bilder', { status: 200, daten: {} }],
    ['rest/v1/nachrichten?id=in', { status: 200, daten: {} }]
  ]);
  d = antwortDoppel();
  await aufraeumen({ method: 'GET', headers: { authorization: 'Bearer nur-vercel' } }, d.res);

  ok('Beide Bilder gelten als entfernt', d.a.status === 200 && d.a.daten.entfernt === 2, JSON.stringify(d.a.daten));

  const suchen = spur.findIndex(s => s.url.includes('rest/v1/nachrichten?select'));
  const loeschen = spur.findIndex(s => s.url.includes('storage/v1/object'));
  const nachfuehren = spur.findIndex(s => s.methode === 'PATCH');
  ok('Gesucht wird nach abgelaufenen mit Datei',
     spur[suchen].url.includes('bild_pfad=not.is.null') && spur[suchen].url.includes('bild_ablauf=lt.'));
  ok('Erst die Datei, dann die Zeile', loeschen < nachfuehren && loeschen > suchen,
     `suchen ${suchen}, löschen ${loeschen}, nachführen ${nachfuehren}`);
  ok('Beide Pfade werden gelöscht',
     spur[loeschen].rumpf.includes('c1/eins.jpg') && spur[loeschen].rumpf.includes('c2/zwei.png'));
  ok('Die Zeile verliert nur den Pfad',
     JSON.parse(spur[nachfuehren].rumpf).bild_pfad === null
       && Object.keys(JSON.parse(spur[nachfuehren].rumpf)).length === 1,
     spur[nachfuehren].rumpf);
  ok('Der Gesprächsverlauf bleibt unangetastet',
     !spur.some(s => s.methode === 'DELETE' && s.url.includes('rest/v1/nachrichten')));

  // --- Das Löschen im Storage geht schief --------------------------------------
  spur = [];
  stubFetch([
    ['rest/v1/nachrichten?select', { status: 200, daten: [{ id: 'n1', bild_pfad: 'c1/eins.jpg' }] }],
    ['storage/v1/object/chat-bilder', { status: 500, daten: {} }]
  ]);
  d = antwortDoppel();
  await aufraeumen({ method: 'GET', headers: { authorization: 'Bearer nur-vercel' } }, d.res);
  ok('Scheitert das Löschen, bleibt die Zeile stehen',
     d.a.status === 502 && !spur.some(s => s.methode === 'PATCH'));
}

/* ===== Benachrichtigung verschicken ======================================= */

console.log('\n=== api/push ===');
{
  const pfad = `${WURZEL}api/push.js`;
  delete require.cache[require.resolve(pfad)];
  const push = require(pfad);

  // Ein Zugangs-Token, wie Supabase es ausstellt: nur der Mittelteil zählt.
  const token = (sub) => 'x.' + Buffer.from(JSON.stringify({ sub })).toString('base64url') + '.y';
  const CHAT = '11111111-2222-3333-4444-555555555555';

  const { subtle } = require(`${WURZEL}api/_webpush.js`);
  const empfaenger = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const p256dh = Buffer.from(await subtle.exportKey('raw', empfaenger.publicKey)).toString('base64url');

  // --- Ohne Schlüssel --------------------------------------------------------
  delete process.env.VAPID_PRIVAT;
  process.env.SUPABASE_SERVICE_KEY = 'dienst-geheim';
  let d = antwortDoppel();
  await push({ method: 'POST', headers: {}, body: {} }, d.res);
  ok('Ohne VAPID-Schlüssel: klare Absage', d.a.status === 503, String(d.a.status));

  const paar = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']);
  process.env.VAPID_PRIVAT = (await subtle.exportKey('jwk', paar.privateKey)).d;
  process.env.VAPID_OEFFENTLICH = Buffer.from(await subtle.exportKey('raw', paar.publicKey)).toString('base64url');

  // --- Nicht angemeldet -------------------------------------------------------
  d = antwortDoppel();
  await push({ method: 'POST', headers: {}, body: { chat: CHAT } }, d.res);
  ok('Ohne Token: nicht angemeldet', d.a.status === 401, String(d.a.status));

  // --- Kein Mitglied ----------------------------------------------------------
  spur = [];
  stubFetch([['chat_mitglieder', { status: 200, daten: [] }]]);
  d = antwortDoppel();
  hoerZu();
  await push({ method: 'POST', headers: { authorization: `Bearer ${token('ich')}` },
               body: { chat: CHAT, text: 'Hallo' } }, d.res);
  let meldung = hoerAuf();
  ok('Wer nicht im Gespräch ist, sendet auch nichts', d.a.status === 403, String(d.a.status));
  ok('Und die Geräte werden gar nicht erst geholt', !spur.some(s => s.url.includes('push_geraete')));
  ok('Das Log sagt, dass die Person nicht Mitglied ist',
     meldung.includes('nicht Mitglied') && meldung.includes(CHAT), meldung.slice(0, 90));

  /* --- Die Anfrage an Supabase selbst wird abgewiesen -------------------------
     Genau der Fall, der in der Bereitstellung 403 ergab: die Anfrage
     kam gar nicht erst durch. Im Log muss das anders aussehen als "kein
     Mitglied", sonst sucht man an der falschen Stelle. */
  spur = [];
  stubFetch([['chat_mitglieder', { status: 401, daten: { message: 'Invalid API key' } }]]);
  d = antwortDoppel();
  hoerZu();
  await push({ method: 'POST', headers: { authorization: `Bearer ${token('ich')}` },
               body: { chat: CHAT, text: 'Hallo' } }, d.res);
  meldung = hoerAuf();
  ok('Weist Supabase die Anfrage ab, bleibt es bei 403', d.a.status === 403, String(d.a.status));
  ok('Aber das Log nennt Status und Antwort',
     meldung.includes('401') && meldung.includes('Invalid API key'), meldung.slice(0, 120));
  ok('Und verwechselt das nicht mit fehlender Mitgliedschaft',
     !meldung.includes('nicht Mitglied'), meldung.slice(0, 120));

  /* --- Die beiden Köpfe an Supabase -------------------------------------------
     Der apikey weist das Projekt aus, Authorization die Person. Standen
     beide auf dem Token der Person, wies das Tor davor die Anfrage ab —
     und die Funktion meldete "kein Zugriff", obwohl der Zugriff bestand. */
  spur = [];
  stubFetch([['chat_mitglieder', { status: 200, daten: [{ user_id: 'ich' }] }]]);
  d = antwortDoppel();
  await push({ method: 'POST', headers: { authorization: `Bearer ${token('ich')}` },
               body: { chat: CHAT, text: 'Hallo' } }, d.res);
  const abfrage = spur.find(s => s.url.includes('chat_mitglieder'));
  ok('Der apikey ist ein Schlüssel des Projekts, kein Zugangs-Token',
     /^eyJ/.test(abfrage.kopf.apikey) && JSON.parse(Buffer.from(abfrage.kopf.apikey.split('.')[1], 'base64url')).role === 'anon',
     String(abfrage.kopf.apikey).slice(0, 24) + '…');
  ok('Und die Person steht im Kopf Authorization',
     abfrage.kopf.Authorization === `Bearer ${token('ich')}`);
  ok('Beide Köpfe sind nicht dasselbe',
     abfrage.kopf.apikey !== token('ich'));

  // --- Der gute Fall ------------------------------------------------------------
  spur = [];
  stubFetch([
    ['chat_mitglieder', { status: 200, daten: [{ user_id: 'ich' }, { user_id: 'du' }, { user_id: 'sie' }] }],
    ['push_geraete?user_id=in', { status: 200, daten: [
      { id: 'g1', endpunkt: 'https://push.example/abo1', p256dh, auth: Buffer.from('0123456789abcdef').toString('base64url') },
      { id: 'g2', endpunkt: 'https://push.example/abo2', p256dh, auth: Buffer.from('fedcba9876543210').toString('base64url') }
    ] }],
    ['push.example/abo1', { status: 201, daten: {} }],
    ['push.example/abo2', { status: 410, daten: {} }]
  ]);
  d = antwortDoppel();
  await push({ method: 'POST', headers: { authorization: `Bearer ${token('ich')}` },
               body: { chat: CHAT, titel: 'Mille Fiori Team', text: 'Jonas: bin um 9 dort' } }, d.res);

  ok('Eine Meldung ging raus, eine Adresse war tot',
     d.a.status === 200 && d.a.daten.gesendet === 1 && d.a.daten.aufgeraeumt === 1, JSON.stringify(d.a.daten));

  const geraeteAbruf = spur.find(s => s.url.includes('push_geraete?user_id=in'));
  ok('Gefragt wird nur nach den anderen',
     geraeteAbruf.url.includes('du') && geraeteAbruf.url.includes('sie') && !geraeteAbruf.url.includes('ich'),
     geraeteAbruf.url.split('in.')[1]);

  const versand = spur.filter(s => s.url.startsWith('https://push.example/'));
  ok('An beide Geräte wurde gesendet', versand.length === 2);
  ok('Das tote Abo wird weggeräumt',
     spur.some(s => s.methode === 'DELETE' && s.url.includes('push_geraete') && s.url.includes('g2')));
  ok('Das lebende bleibt', !spur.some(s => s.methode === 'DELETE' && s.url.includes('g1')));

  // --- Der Inhalt darf unterwegs niemand lesen können --------------------------
  const rumpf = versand[0].rumpf;
  ok('Verschickt wird ein verschlüsselter Block, kein Klartext',
     !String(rumpf).includes('Mille Fiori') && !String(rumpf).includes('bin um 9'));

  /* ===== Der Feed ===========================================================
     Dieselbe Funktion, anderer Weg hinein. Hier geht es um die eine Regel:
     nur ein Beitrag der Kategorie "wichtig" meldet sich, und nur bei der
     Person, die ihn geschrieben hat. Die Regel steht im Server und nicht
     in der App — also muss sie auch dort geprüft werden. */

  const BEITRAG = '99999999-8888-7777-6666-555555555555';
  const geraete = [
    { id: 'g1', endpunkt: 'https://push.example/abo1', p256dh, auth: Buffer.from('0123456789abcdef').toString('base64url') }
  ];

  console.log('\n=== api/push, Weg über den Feed ===');

  // --- Weder Chat noch Beitrag ------------------------------------------------
  d = antwortDoppel();
  hoerZu();
  await push({ method: 'POST', headers: { authorization: `Bearer ${token('ich')}` }, body: {} }, d.res);
  meldung = hoerAuf();
  ok('Ohne Chat und ohne Beitrag: Absage', d.a.status === 400, String(d.a.status));

  // --- Beides zugleich ---------------------------------------------------------
  d = antwortDoppel();
  hoerZu();
  await push({ method: 'POST', headers: { authorization: `Bearer ${token('ich')}` },
               body: { chat: CHAT, beitrag: BEITRAG } }, d.res);
  hoerAuf();
  ok('Beides zugleich ist auch nichts', d.a.status === 400, String(d.a.status));

  // --- Ein fremder Beitrag -----------------------------------------------------
  spur = [];
  stubFetch([['feed_beitraege', { status: 200, daten: [
    { art: 'beitrag', kategorie: 'wichtig', erstellt_von: 'jemand-anderes' }] }]]);
  d = antwortDoppel();
  hoerZu();
  await push({ method: 'POST', headers: { authorization: `Bearer ${token('ich')}` },
               body: { beitrag: BEITRAG, text: 'Helmpflicht' } }, d.res);
  meldung = hoerAuf();
  ok('Fremde Beiträge melden sich nicht in meinem Namen', d.a.status === 403, String(d.a.status));
  ok('Und die Geräte werden gar nicht erst geholt', !spur.some(s => s.url.includes('push_geraete')));
  ok('Das Log sagt warum', meldung.includes('nicht geschrieben'), meldung.slice(0, 90));

  // --- Ein Update ---------------------------------------------------------------
  spur = [];
  stubFetch([['feed_beitraege', { status: 200, daten: [
    { art: 'beitrag', kategorie: 'update', erstellt_von: 'ich' }] }]]);
  d = antwortDoppel();
  hoerZu();
  await push({ method: 'POST', headers: { authorization: `Bearer ${token('ich')}` },
               body: { beitrag: BEITRAG, text: 'Bodenplatte fertig' } }, d.res);
  meldung = hoerAuf();
  ok('Ein Update meldet sich nicht',
     d.a.status === 200 && d.a.daten.gesendet === 0, JSON.stringify(d.a.daten));
  ok('Und niemandes Gerät wird dafür angefasst', !spur.some(s => s.url.includes('push_geraete')));
  ok('Das Log nennt Art und Kategorie', meldung.includes('beitrag/update'), meldung.slice(0, 90));

  // --- Eine Umfrage --------------------------------------------------------------
  spur = [];
  stubFetch([['feed_beitraege', { status: 200, daten: [
    { art: 'umfrage', kategorie: null, erstellt_von: 'ich' }] }]]);
  d = antwortDoppel();
  hoerZu();
  await push({ method: 'POST', headers: { authorization: `Bearer ${token('ich')}` },
               body: { beitrag: BEITRAG, text: 'Weihnachtsessen?' } }, d.res);
  hoerAuf();
  ok('Eine Umfrage meldet sich auch nicht',
     d.a.status === 200 && d.a.daten.gesendet === 0 && !spur.some(s => s.url.includes('push_geraete')),
     JSON.stringify(d.a.daten));

  // --- Und nun der wichtige Beitrag ------------------------------------------------
  spur = [];
  stubFetch([
    ['feed_beitraege', { status: 200, daten: [
      { art: 'beitrag', kategorie: 'wichtig', erstellt_von: 'ich' }] }],
    ['mitarbeiter?user_id=not.is.null', { status: 200, daten: [
      { user_id: 'ich' }, { user_id: 'du' }, { user_id: 'sie' }] }],
    ['push_geraete?user_id=in', { status: 200, daten: geraete }],
    ['push.example/abo1', { status: 201, daten: {} }]
  ]);
  d = antwortDoppel();
  await push({ method: 'POST', headers: { authorization: `Bearer ${token('ich')}` },
               body: { beitrag: BEITRAG, titel: 'Wichtig von Jonas', text: 'Ab morgen Helmpflicht' } }, d.res);

  ok('Ein wichtiger Beitrag geht raus',
     d.a.status === 200 && d.a.daten.gesendet === 1, JSON.stringify(d.a.daten));

  const feedAbruf = spur.find(s => s.url.includes('push_geraete?user_id=in'));
  ok('Gefragt wird nach allen ausser der schreibenden Person',
     feedAbruf.url.includes('du') && feedAbruf.url.includes('sie') && !feedAbruf.url.includes('ich'),
     feedAbruf.url.split('in.')[1]);

  const adressbuch = spur.find(s => s.url.includes('mitarbeiter?user_id=not.is.null'));
  ok('Das Adressbuch wird mit dem Token der Person geholt, nicht mit dem Dienstschlüssel',
     adressbuch.kopf.Authorization === `Bearer ${token('ich')}`);
  ok('Gelöschte Mitarbeitende bleiben draussen',
     adressbuch.url.includes('geloescht_am=is.null'), adressbuch.url);

  const feedVersand = spur.filter(s => s.url.startsWith('https://push.example/'));
  ok('Auch hier geht nur ein verschlüsselter Block hinaus',
     !String(feedVersand[0].rumpf).includes('Helmpflicht'));

  /* --- Erwähnungen ------------------------------------------------------------
     Wer erwähnt wurde, liest die Funktion aus dem gespeicherten Text und
     nicht aus dem Aufruf. Geprüft wird beides: dass eine Erwähnung
     ankommt, und dass sie nichts aufreisst, was die Regeln sonst zuhalten. */

  const KOMMENTAR = '12341234-5678-5678-5678-123412341234';
  const wieAlle = { status: 200, daten: ['ich', 'du', 'sie'].map(user_id => ({ user_id })) };

  // Ein Update mit Erwähnung: geht raus, aber nur an die erwähnte Person.
  spur = [];
  stubFetch([
    ['feed_beitraege', { status: 200, daten: [
      { art: 'beitrag', kategorie: 'update', erstellt_von: 'ich',
        text: 'Kannst du das anschauen, @[Silvia Weber](du)?' }] }],
    ['mitarbeiter?user_id=not.is.null', wieAlle],
    ['push_geraete?user_id=in', { status: 200, daten: geraete }],
    ['push.example/abo1', { status: 201, daten: {} }]
  ]);
  d = antwortDoppel();
  await push({ method: 'POST', headers: { authorization: `Bearer ${token('ich')}` },
               body: { beitrag: BEITRAG, titel: 'Jonas hat Sie erwähnt', text: 'Kannst du das anschauen?' } }, d.res);
  ok('Ein Update mit Erwähnung meldet sich',
     d.a.status === 200 && d.a.daten.gesendet === 1, JSON.stringify(d.a.daten));
  let gefragt = spur.find(s => s.url.includes('push_geraete?user_id=in'));
  ok('Und zwar nur bei der erwähnten Person',
     gefragt.url.includes('du') && !gefragt.url.includes('sie'),
     gefragt.url.split('in.')[1]);

  // Wichtig und Erwähnung zugleich: eine Meldung, an alle.
  spur = [];
  stubFetch([
    ['feed_beitraege', { status: 200, daten: [
      { art: 'beitrag', kategorie: 'wichtig', erstellt_von: 'ich',
        text: 'Ab morgen Helmpflicht, @[Silvia Weber](du)' }] }],
    ['mitarbeiter?user_id=not.is.null', wieAlle],
    ['push_geraete?user_id=in', { status: 200, daten: geraete }],
    ['push.example/abo1', { status: 201, daten: {} }]
  ]);
  d = antwortDoppel();
  await push({ method: 'POST', headers: { authorization: `Bearer ${token('ich')}` },
               body: { beitrag: BEITRAG, titel: 'Wichtig von Jonas', text: 'Ab morgen Helmpflicht' } }, d.res);
  gefragt = spur.filter(s => s.url.includes('push_geraete?user_id=in'));
  ok('Wichtig mit Erwähnung fragt genau einmal nach Geräten',
     gefragt.length === 1, String(gefragt.length));
  ok('Und zwar für alle anderen, die erwähnte Person inbegriffen',
     gefragt[0].url.includes('du') && gefragt[0].url.includes('sie') && !gefragt[0].url.includes('ich'),
     gefragt[0].url.split('in.')[1]);

  // Eine Umfrage meldet auch mit Erwähnung nicht.
  spur = [];
  stubFetch([['feed_beitraege', { status: 200, daten: [
    { art: 'umfrage', kategorie: null, erstellt_von: 'ich', text: 'Wer kommt, @[Silvia Weber](du)?' }] }]]);
  d = antwortDoppel();
  hoerZu();
  await push({ method: 'POST', headers: { authorization: `Bearer ${token('ich')}` },
               body: { beitrag: BEITRAG, text: 'Wer kommt?' } }, d.res);
  hoerAuf();
  ok('Eine Umfrage meldet auch mit Erwähnung nicht',
     d.a.status === 200 && d.a.daten.gesendet === 0
     && !spur.some(s => s.url.includes('push_geraete')), JSON.stringify(d.a.daten));

  // Eine erfundene Kennung im Text erreicht niemanden.
  spur = [];
  stubFetch([
    ['feed_beitraege', { status: 200, daten: [
      { art: 'beitrag', kategorie: 'update', erstellt_von: 'ich',
        text: 'Hallo @[Wer auch immer](fremd-erfunden)' }] }],
    ['mitarbeiter?user_id=not.is.null', wieAlle]
  ]);
  d = antwortDoppel();
  await push({ method: 'POST', headers: { authorization: `Bearer ${token('ich')}` },
               body: { beitrag: BEITRAG, text: 'Hallo' } }, d.res);
  ok('Eine erfundene Kennung erreicht niemanden',
     d.a.status === 200 && d.a.daten.gesendet === 0
     && !spur.some(s => s.url.includes('push_geraete')), JSON.stringify(d.a.daten));

  // Der Kommentar: nur die Erwähnten, und nur vom eigenen Kommentar aus.
  spur = [];
  stubFetch([
    ['feed_kommentare', { status: 200, daten: [
      { verfasser: 'ich', text: 'Danke @[Silvia Weber](du) fuers Nachfassen' }] }],
    ['mitarbeiter?user_id=not.is.null', wieAlle],
    ['push_geraete?user_id=in', { status: 200, daten: geraete }],
    ['push.example/abo1', { status: 201, daten: {} }]
  ]);
  d = antwortDoppel();
  await push({ method: 'POST', headers: { authorization: `Bearer ${token('ich')}` },
               body: { kommentar: KOMMENTAR, titel: 'Jonas hat Sie erwähnt', text: 'Danke' } }, d.res);
  ok('Ein Kommentar mit Erwähnung geht raus',
     d.a.status === 200 && d.a.daten.gesendet === 1, JSON.stringify(d.a.daten));
  gefragt = spur.find(s => s.url.includes('push_geraete?user_id=in'));
  ok('Nur an die erwähnte Person',
     gefragt.url.includes('du') && !gefragt.url.includes('sie'), gefragt.url.split('in.')[1]);

  spur = [];
  stubFetch([['feed_kommentare', { status: 200, daten: [
    { verfasser: 'ich', text: 'Sauber gelaufen, keine Beanstandungen.' }] }]]);
  d = antwortDoppel();
  hoerZu();
  await push({ method: 'POST', headers: { authorization: `Bearer ${token('ich')}` },
               body: { kommentar: KOMMENTAR, text: 'Sauber gelaufen' } }, d.res);
  meldung = hoerAuf();
  ok('Ein Kommentar ohne Erwähnung meldet nicht',
     d.a.status === 200 && d.a.daten.gesendet === 0 && !spur.some(s => s.url.includes('push_geraete')),
     JSON.stringify(d.a.daten));
  ok('Das Log sagt warum', meldung.includes('niemand erwaehnt'), meldung.slice(0, 90));

  spur = [];
  stubFetch([['feed_kommentare', { status: 200, daten: [
    { verfasser: 'jemand-anderes', text: 'Hallo @[Silvia Weber](du)' }] }]]);
  d = antwortDoppel();
  hoerZu();
  await push({ method: 'POST', headers: { authorization: `Bearer ${token('ich')}` },
               body: { kommentar: KOMMENTAR, text: 'Hallo' } }, d.res);
  meldung = hoerAuf();
  ok('Ein fremder Kommentar meldet sich nicht in meinem Namen',
     d.a.status === 403, String(d.a.status));
  ok('Und die Geräte werden gar nicht erst geholt',
     !spur.some(s => s.url.includes('push_geraete')));
  ok('Das Log sagt auch hier warum', meldung.includes('nicht geschrieben'), meldung.slice(0, 90));

  // Zwei Wege zugleich bleiben verboten.
  d = antwortDoppel();
  hoerZu();
  await push({ method: 'POST', headers: { authorization: `Bearer ${token('ich')}` },
               body: { beitrag: BEITRAG, kommentar: KOMMENTAR } }, d.res);
  hoerAuf();
  ok('Beitrag und Kommentar zugleich ist nichts', d.a.status === 400, String(d.a.status));
}


/* ===== Wetter von MeteoSchweiz ============================================ */

/* Diese Funktion ist der einzige Ort, an dem aus dem CSV von
   MeteoSchweiz Zahlen werden. Geht dort etwas schief — falsche Station,
   Meter pro Sekunde als km/h ausgegeben, ein Zeitstempel im falschen
   Jahrhundert —, sieht das niemand am Bildschirm: die Chips stehen
   trotzdem da, nur eben falsch. Deshalb hier und nicht erst im
   Browser. */

console.log('\n=== api/wetter ===');
{
  const pfad = `${WURZEL}api/wetter.js`;
  const frisch = () => { delete require.cache[require.resolve(pfad)]; return require(pfad); };

  /* Die Stationsliste, wie sie bei MeteoSchweiz aussieht: Semikolon,
     Kürzel klein, WGS84 neben den Landeskoordinaten. Giswil liegt nahe
     bei Sarnen, Zürich weit weg — daran hängt die Auswahl. */
  const STATIONEN = [
    'station_abbr;station_name;station_canton;station_height_masl;station_coordinates_wgs84_lat;station_coordinates_wgs84_lon',
    'GIS;Giswil;OW;471;46.8492;8.1889',
    'SMA;Zürich / Fluntern;ZH;556;47.3783;8.5653',
    'LUG;Lugano;TI;273;46.0033;8.9601'
  ].join('\n');

  /* Die Messwerte einer Station. Die Kopfzeile steht hier absichtlich
     gross: in der Ablage ist die Schreibweise nicht einheitlich, und
     ein Vergleich auf das genaue Zeichen fände hier stillschweigend
     nichts. */
  const WERTE = [
    'station_abbr;REFERENCE_TIMESTAMP;TRE200S0;FKL010Z1;FKL010Z0;RRE150Z0;SRE000Z0;URE200S0;GRE000Z0',
    'GIS;20.09.2026 11:40;17.7;17.2;8.6;0.0;9;54;612'
  ].join('\n');

  const antwortMitKopf = () => {
    const a = { status: 0, daten: null, kopf: {} };
    return { a, res: {
      status(s) { a.status = s; return this; },
      json(d) { a.daten = d; return this; },
      setHeader(n, v) { a.kopf[n] = v; return this; }
    } };
  };

  const OGD = [
    ['ogd-smn_meta_stations.csv', { status: 200, daten: STATIONEN }],
    ['/gis/ogd-smn_gis_t_now.csv', { status: 200, daten: WERTE }]
  ];

  // --- Der gewöhnliche Fall: Sarnen ------------------------------------------
  spur = [];
  stubFetch(OGD);
  let wetter = frisch();
  let d = antwortMitKopf();
  await wetter({ query: { lat: '46.897', lon: '8.246' } }, d.res);

  ok('Sarnen bekommt eine Antwort', d.a.status === 200, String(d.a.status));
  ok('Und zwar von der nächsten Station, nicht der ersten in der Liste',
     d.a.daten.station.kennung === 'gis' && d.a.daten.station.name === 'Giswil',
     JSON.stringify(d.a.daten.station));
  ok('Der Abstand steht dabei und ist plausibel',
     d.a.daten.station.abstand_km > 3 && d.a.daten.station.abstand_km < 12,
     String(d.a.daten.station.abstand_km));
  ok('Die Höhe der Station kommt mit', d.a.daten.station.hoehe_m === 471, String(d.a.daten.station.hoehe_m));
  ok('Die Quelle steht drin und heisst MeteoSchweiz', d.a.daten.quelle === 'MeteoSchweiz', d.a.daten.quelle);

  // --- Einheiten und Zeit ----------------------------------------------------
  ok('Die Gradzahl kommt unverändert durch', d.a.daten.grad === 17.7, String(d.a.daten.grad));
  ok('Die Böe wird von m/s auf km/h gerechnet',
     d.a.daten.boe_kmh === 61.9, `17.2 m/s → ${d.a.daten.boe_kmh} km/h`);
  ok('Der mittlere Wind ebenso',
     d.a.daten.wind_kmh === 31, `8.6 m/s → ${d.a.daten.wind_kmh} km/h`);
  ok('Und die beiden bleiben auseinander: die Böe ist die grössere Zahl',
     d.a.daten.boe_kmh > d.a.daten.wind_kmh);
  ok('Niederschlag, Sonnenschein, Feuchte und Strahlung stehen unverändert da',
     d.a.daten.regen_mm === 0 && d.a.daten.sonne_min === 9
       && d.a.daten.feuchte_prozent === 54 && d.a.daten.strahlung_wm2 === 612,
     JSON.stringify([d.a.daten.regen_mm, d.a.daten.sonne_min, d.a.daten.feuchte_prozent, d.a.daten.strahlung_wm2]));
  ok('20.09.2026 11:40 wird zu ISO in UTC',
     d.a.daten.gemessen_am === '2026-09-20T11:40:00.000Z', d.a.daten.gemessen_am);

  /* Genau diese Werte ergeben im Browser Sturm/Wind: 61.9 km/h Böe
     liegt über der Schwelle von 60. Dass die Umrechnung stimmt, ist
     also kein Schönheitsfehler, sondern entscheidet den Chip. */
  ok('Und liegen damit knapp über der Sturmschwelle von 60 km/h',
     d.a.daten.boe_kmh >= 60);

  // --- Die Rohwerte ----------------------------------------------------------
  ok('Der ganze Messsatz kommt als roh mit',
     d.a.daten.roh && d.a.daten.roh.tre200s0 === 17.7 && d.a.daten.roh.fkl010z1 === 17.2,
     JSON.stringify(d.a.daten.roh));
  ok('Auch bei grosser Kopfzeile in der Datei',
     Object.keys(d.a.daten.roh).some(k => k === k.toLowerCase()));

  // --- Der Weg dorthin --------------------------------------------------------
  ok('Zuerst die Stationsliste, dann die Station',
     spur[0].url.includes('ogd-smn_meta_stations.csv')
       && spur[1].url.includes('/gis/ogd-smn_gis_t_now.csv'),
     spur.map(s => s.url).join(' | '));
  ok('Der Pfad führt über den Ordner der Station',
     spur[1].url === 'https://data.geo.admin.ch/ch.meteoschweiz.ogd-smn/gis/ogd-smn_gis_t_now.csv',
     spur[1].url);
  ok('Nicht öfter gefragt als nötig: zwei Abrufe, nicht mehr',
     spur.length === 2, String(spur.length));
  ok('Die Antwort darf eine Minute liegen bleiben',
     /max-age=60/.test(d.a.kopf['Cache-Control'] || ''), d.a.kopf['Cache-Control']);

  // --- Die Liste wird nicht bei jedem Aufruf neu geholt ------------------------
  spur = [];
  d = antwortMitKopf();
  await wetter({ query: { lat: '46.897', lon: '8.246' } }, d.res);
  ok('Der zweite Aufruf holt die Stationsliste nicht noch einmal',
     !spur.some(s => s.url.includes('meta_stations')), spur.map(s => s.url).join(' | '));

  // --- Ausserhalb des Messnetzes ----------------------------------------------
  /* München und der Nordpol fallen schon durch das Rechteck. Mailand
     nicht: es liegt mittendrin, und nur der Abstand zu Lugano weist es
     ab. Genau dafür steht die Grenze da. */
  for (const [ort, lat, lon] of [['München', 48.14, 11.58], ['Nordpol', 90, 0]]) {
    spur = [];
    d = antwortMitKopf();
    await wetter({ query: { lat: String(lat), lon: String(lon) } }, d.res);
    ok(`${ort} bekommt keine erfundene Station`, d.a.status === 400, String(d.a.status));
    ok(`Und es wird gar nicht erst losgeschickt (${ort})`, spur.length === 0);
  }

  spur = [];
  d = antwortMitKopf();
  await wetter({ query: { lat: '45.46', lon: '9.19' } }, d.res);
  ok('Mailand liegt im Rechteck und wird trotzdem abgewiesen',
     d.a.status === 400, String(d.a.status));
  ok('Mit demselben Satz wie jeder Ort ausserhalb',
     /keine Messstation/.test(d.a.daten.fehler || ''), d.a.daten.fehler);
  ok('Und ohne dass eine Station abgefragt würde',
     !spur.some(s => s.url.includes('_t_now') || s.url.includes('_t_recent')),
     spur.map(s => s.url).join(' | '));

  /* Umgekehrt muss die Grenze der Schweiz Luft lassen. Vier Orte, die
     alle noch eine Antwort bekommen müssen, jeder in einer anderen
     Ecke. Die Stationsliste hier ist klein, deshalb zählt nur, dass
     der Abstand überhaupt unter der Grenze bleibt. */
  stubFetch([
    ['ogd-smn_meta_stations.csv', { status: 200, daten: STATIONEN }],
    ['_t_now.csv', { status: 200, daten: WERTE }]
  ]);
  for (const [ort, lat, lon] of [['Sarnen', 46.897, 8.246], ['Zürich', 47.377, 8.540],
                                 ['Lugano', 46.005, 8.951]]) {
    d = antwortMitKopf();
    await wetter({ query: { lat: String(lat), lon: String(lon) } }, d.res);
    ok(`${ort} bekommt weiterhin eine Antwort`, d.a.status === 200,
       `${d.a.status} ${JSON.stringify(d.a.daten && d.a.daten.station)}`);
  }

  // --- Unsinnige Eingaben ------------------------------------------------------
  for (const [was, q] of [['ohne Koordinaten', {}], ['mit Buchstaben', { lat: 'hier', lon: 'dort' }]]) {
    d = antwortMitKopf();
    await wetter({ query: q }, d.res);
    ok(`Ein Aufruf ${was} endet sauber mit 400`, d.a.status === 400, String(d.a.status));
  }

  // --- Die Ablage antwortet nicht ------------------------------------------------
  spur = [];
  stubFetch([['ogd-smn_meta_stations.csv', { status: 503, daten: '' }]]);
  wetter = frisch();
  d = antwortMitKopf();
  await wetter({ query: { lat: '46.897', lon: '8.246' } }, d.res);
  ok('Fällt die Stationsliste aus, kommt 502 und kein Absturz',
     d.a.status === 502 && !!d.a.daten.fehler, `${d.a.status} ${JSON.stringify(d.a.daten)}`);

  // --- Die Station liefert gerade nichts --------------------------------------
  spur = [];
  stubFetch([
    ['ogd-smn_meta_stations.csv', { status: 200, daten: STATIONEN }],
    ['/gis/', { status: 404, daten: '' }]
  ]);
  wetter = frisch();
  d = antwortMitKopf();
  await wetter({ query: { lat: '46.897', lon: '8.246' } }, d.res);
  ok('Liefert die Station nichts, kommt 502 statt halber Werte',
     d.a.status === 502 && !!d.a.daten.fehler, `${d.a.status} ${JSON.stringify(d.a.daten)}`);
  ok('Vorher wird aber beides versucht, now und recent',
     spur.some(s => s.url.includes('_t_now.csv')) && spur.some(s => s.url.includes('_t_recent.csv')),
     spur.map(s => s.url).join(' | '));

  // --- Eine Station ohne Temperaturfühler ---------------------------------------
  spur = [];
  stubFetch([
    ['ogd-smn_meta_stations.csv', { status: 200, daten: STATIONEN }],
    ['/gis/ogd-smn_gis_t_now.csv', { status: 200, daten:
      'station_abbr;reference_timestamp;rre150z0;sre000z0\nGIS;20.09.2026 11:40;0.4;0' }]
  ]);
  wetter = frisch();
  d = antwortMitKopf();
  await wetter({ query: { lat: '46.897', lon: '8.246' } }, d.res);
  ok('Eine halbe Messung wird durchgereicht statt abgewiesen',
     d.a.status === 200, String(d.a.status));
  ok('Was fehlt, fehlt — und wird nicht zu null gerechnet',
     d.a.daten.grad === undefined && d.a.daten.boe_kmh === null,
     JSON.stringify([d.a.daten.grad, d.a.daten.boe_kmh]));
  ok('Was da ist, steht da', d.a.daten.regen_mm === 0.4, String(d.a.daten.regen_mm));
}


/* ===== api/push: stumm, Erwähnung und die Zuständigkeit =================== */

/* Drei Regeln, die nur hier zu prüfen sind. Die App stellt die Frage
   nicht — sie schickt eine Kennung und die Funktion entscheidet, wer
   etwas erfährt. Genau deshalb steht sie dort und nicht im Browser: sie
   soll auch dann stimmen, wenn jemand den Aufruf von Hand nachbaut. */

console.log('\n=== api/push: stumm, Erwähnung, Zuständigkeit ===');
{
  const pfad = `${WURZEL}api/push.js`;
  delete require.cache[require.resolve(pfad)];
  const push = require(pfad);

  const token = (sub) => 'x.' + Buffer.from(JSON.stringify({ sub })).toString('base64url') + '.y';
  const CHAT = '11111111-2222-3333-4444-555555555555';
  const NACHRICHT = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  const ANTRAG = '99999999-8888-7777-6666-555555555555';

  const { subtle } = require(`${WURZEL}api/_webpush.js`);
  const paar = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']);
  process.env.VAPID_PRIVAT = (await subtle.exportKey('jwk', paar.privateKey)).d;
  process.env.VAPID_OEFFENTLICH = Buffer.from(await subtle.exportKey('raw', paar.publicKey)).toString('base64url');
  process.env.SUPABASE_SERVICE_KEY = 'dienst-geheim';

  /* Wen die Funktion am Ende wirklich anschreibt, steht in der Anfrage
     nach den Geräten: "user_id=in.(…)". Das ist die einzige Stelle, an
     der sich die Entscheidung ablesen lässt. */
  const ziele = () => {
    const g = spur.find(x => x.url.includes('push_geraete'));
    if (!g) return null;
    const m = /user_id=in\.\(([^)]*)\)/.exec(g.url);
    return m ? m[1].split(',').filter(Boolean).sort() : [];
  };

  const MITGLIEDER = [
    { user_id: 'ich', stumm: false },
    { user_id: 'laut', stumm: false },
    { user_id: 'still', stumm: true },
    { user_id: 'still-zwei', stumm: true }
  ];

  let d;

  /* --- Stumm gestellte bekommen nichts -------------------------------- */
  spur = [];
  stubFetch([
    ['chat_mitglieder', { status: 200, daten: MITGLIEDER }],
    ['push_geraete', { status: 200, daten: [] }]
  ]);
  d = antwortDoppel();
  await push({ method: 'POST', headers: { authorization: `Bearer ${token('ich')}` },
               body: { chat: CHAT, text: 'Hallo zusammen' } }, d.res);
  ok('Wer stumm gestellt hat, bekommt keine Meldung',
     JSON.stringify(ziele()) === JSON.stringify(['laut']), JSON.stringify(ziele()));
  ok('Und die sendende Person sich selbst auch nicht',
     !(ziele() || []).includes('ich'), JSON.stringify(ziele()));

  /* --- Sind alle stumm, wird gar nicht erst gefragt -------------------- */
  spur = [];
  stubFetch([
    ['chat_mitglieder', { status: 200, daten: [
      { user_id: 'ich', stumm: false }, { user_id: 'still', stumm: true }] }],
    ['push_geraete', { status: 200, daten: [] }]
  ]);
  d = antwortDoppel();
  hoerZu();
  await push({ method: 'POST', headers: { authorization: `Bearer ${token('ich')}` },
               body: { chat: CHAT, text: 'Hallo' } }, d.res);
  let meldung = hoerAuf();
  ok('Sind alle stumm, wird nichts verschickt',
     d.a.status === 200 && d.a.daten.gesendet === 0, JSON.stringify(d.a.daten));
  ok('Und die Geräte werden gar nicht erst geholt',
     !spur.some(x => x.url.includes('push_geraete')));
  ok('Das Log sagt warum', meldung.includes('stumm'), meldung.slice(0, 90));

  /* --- Eine Erwähnung kommt durch die Stummschaltung ------------------- */
  spur = [];
  stubFetch([
    ['chat_mitglieder', { status: 200, daten: MITGLIEDER }],
    ['nachrichten?id=eq.', { status: 200, daten: [
      { chat_id: CHAT, absender: 'ich', text: 'schaust du kurz @[Die Stille](still)?' }] }],
    ['push_geraete', { status: 200, daten: [] }]
  ]);
  d = antwortDoppel();
  await push({ method: 'POST', headers: { authorization: `Bearer ${token('ich')}` },
               body: { chat: CHAT, nachricht: NACHRICHT, text: 'schaust du kurz @Die Stille?' } }, d.res);
  ok('Wer namentlich angesprochen wird, bekommt die Meldung trotz stumm',
     JSON.stringify(ziele()) === JSON.stringify(['laut', 'still']), JSON.stringify(ziele()));
  ok('Die zweite stumme Person bleibt aber still',
     !(ziele() || []).includes('still-zwei'), JSON.stringify(ziele()));

  /* --- Eine erfundene Kennung im Text geht ins Leere ------------------- */
  spur = [];
  stubFetch([
    ['chat_mitglieder', { status: 200, daten: MITGLIEDER }],
    ['nachrichten?id=eq.', { status: 200, daten: [
      { chat_id: CHAT, absender: 'ich', text: 'hallo @[Jemand](gibtsnicht) und @[Auch](fremd)' }] }],
    ['push_geraete', { status: 200, daten: [] }]
  ]);
  d = antwortDoppel();
  await push({ method: 'POST', headers: { authorization: `Bearer ${token('ich')}` },
               body: { chat: CHAT, nachricht: NACHRICHT, text: 'hallo' } }, d.res);
  ok('Eine erfundene Kennung im Text erreicht niemanden',
     JSON.stringify(ziele()) === JSON.stringify(['laut']), JSON.stringify(ziele()));

  /* --- Eine fremde Nachricht zählt nicht ------------------------------- */
  spur = [];
  stubFetch([
    ['chat_mitglieder', { status: 200, daten: MITGLIEDER }],
    ['nachrichten?id=eq.', { status: 200, daten: [
      { chat_id: CHAT, absender: 'jemand-anders', text: 'ping @[Die Stille](still)' }] }],
    ['push_geraete', { status: 200, daten: [] }]
  ]);
  d = antwortDoppel();
  hoerZu();
  await push({ method: 'POST', headers: { authorization: `Bearer ${token('ich')}` },
               body: { chat: CHAT, nachricht: NACHRICHT, text: 'ping' } }, d.res);
  meldung = hoerAuf();
  ok('Aus einer fremden Nachricht werden keine Erwähnungen gelesen',
     JSON.stringify(ziele()) === JSON.stringify(['laut']), JSON.stringify(ziele()));
  ok('Und das Log sagt es', meldung.includes('gehoert nicht'), meldung.slice(0, 120));

  /* --- Eine Nachricht aus einem anderen Gespräch ebenfalls nicht ------- */
  spur = [];
  stubFetch([
    ['chat_mitglieder', { status: 200, daten: MITGLIEDER }],
    ['nachrichten?id=eq.', { status: 200, daten: [
      { chat_id: 'ein-anderer-chat', absender: 'ich', text: 'ping @[Die Stille](still)' }] }],
    ['push_geraete', { status: 200, daten: [] }]
  ]);
  d = antwortDoppel();
  await push({ method: 'POST', headers: { authorization: `Bearer ${token('ich')}` },
               body: { chat: CHAT, nachricht: NACHRICHT, text: 'ping' } }, d.res);
  ok('Eine Nachricht aus einem anderen Gespräch zählt auch nicht',
     JSON.stringify(ziele()) === JSON.stringify(['laut']), JSON.stringify(ziele()));

  /* --- Ohne Nachrichtenkennung bleibt alles beim Alten ----------------- */
  spur = [];
  stubFetch([
    ['chat_mitglieder', { status: 200, daten: MITGLIEDER }],
    ['push_geraete', { status: 200, daten: [] }]
  ]);
  d = antwortDoppel();
  await push({ method: 'POST', headers: { authorization: `Bearer ${token('ich')}` },
               body: { chat: CHAT, text: 'ohne Kennung' } }, d.res);
  ok('Ohne Nachrichtenkennung wird der Text gar nicht erst gelesen',
     !spur.some(x => x.url.includes('nachrichten?id=eq.')));
  ok('Und es meldet sich, wer nicht stumm ist',
     JSON.stringify(ziele()) === JSON.stringify(['laut']), JSON.stringify(ziele()));

  /* ===== Anträge: die richtige Person je Art ========================= */

  console.log('\n=== api/push: der Antrag findet seine Zuständige ===');

  /* --- Spesen gehen an David ------------------------------------------ */
  spur = [];
  stubFetch([
    ['antraege?id=eq.', { status: 200, daten: [
      { art: 'spesen', status: 'eingereicht', erstellt_von: 'ich', entschieden_von: null }] }],
    ['zustaendig_fuer=cs.', { status: 200, daten: [{ user_id: 'david' }] }],
    ['push_geraete', { status: 200, daten: [] }]
  ]);
  d = antwortDoppel();
  await push({ method: 'POST', headers: { authorization: `Bearer ${token('ich')}` },
               body: { antrag: ANTRAG, titel: 'Neuer Spesenantrag' } }, d.res);
  ok('Ein eingereichter Spesenantrag meldet sich bei der zuständigen Person',
     JSON.stringify(ziele()) === JSON.stringify(['david']), JSON.stringify(ziele()));
  const frage = spur.find(x => x.url.includes('zustaendig_fuer'));
  ok('Gefragt wird nach der Art, die wirklich in der Zeile steht',
     frage && frage.url.includes('zustaendig_fuer=cs.{spesen}'), String(frage?.url));
  ok('Und nur nach Leuten mit Konto, die nicht gelöscht sind',
     frage.url.includes('geloescht_am=is.null') && frage.url.includes('user_id=not.is.null'),
     String(frage?.url));

  /* --- Ferien gehen an Thomas ----------------------------------------- */
  spur = [];
  stubFetch([
    ['antraege?id=eq.', { status: 200, daten: [
      { art: 'ferien', status: 'eingereicht', erstellt_von: 'ich', entschieden_von: null }] }],
    ['zustaendig_fuer=cs.', { status: 200, daten: [{ user_id: 'thomas' }] }],
    ['push_geraete', { status: 200, daten: [] }]
  ]);
  d = antwortDoppel();
  await push({ method: 'POST', headers: { authorization: `Bearer ${token('ich')}` },
               body: { antrag: ANTRAG, titel: 'Neuer Ferienantrag' } }, d.res);
  ok('Ein Ferienantrag geht an die andere Person',
     JSON.stringify(ziele()) === JSON.stringify(['thomas']), JSON.stringify(ziele()));
  ok('Und die Anfrage nennt diesmal "ferien"',
     spur.find(x => x.url.includes('zustaendig_fuer')).url.includes('zustaendig_fuer=cs.{ferien}'));

  /* --- Wer den Antrag nicht eingereicht hat, meldet ihn auch nicht ----- */
  spur = [];
  stubFetch([
    ['antraege?id=eq.', { status: 200, daten: [
      { art: 'spesen', status: 'eingereicht', erstellt_von: 'jemand-anders', entschieden_von: null }] }]
  ]);
  d = antwortDoppel();
  hoerZu();
  await push({ method: 'POST', headers: { authorization: `Bearer ${token('ich')}` },
               body: { antrag: ANTRAG } }, d.res);
  meldung = hoerAuf();
  ok('Einen fremden Antrag meldet niemand ein zweites Mal',
     d.a.status === 403, String(d.a.status));
  ok('Das Log nennt den Grund', meldung.includes('nicht eingereicht'), meldung.slice(0, 100));

  /* --- Ist niemand zuständig, wird das laut gesagt --------------------- */
  spur = [];
  stubFetch([
    ['antraege?id=eq.', { status: 200, daten: [
      { art: 'spesen', status: 'eingereicht', erstellt_von: 'ich', entschieden_von: null }] }],
    ['zustaendig_fuer=cs.', { status: 200, daten: [] }]
  ]);
  d = antwortDoppel();
  hoerZu();
  await push({ method: 'POST', headers: { authorization: `Bearer ${token('ich')}` },
               body: { antrag: ANTRAG } }, d.res);
  meldung = hoerAuf();
  ok('Ist niemand zuständig, geht nichts hinaus',
     d.a.status === 200 && d.a.daten.gesendet === 0, JSON.stringify(d.a.daten));
  ok('Aber es steht als Fehler im Log — ein Antrag ohne Empfänger bleibt liegen',
     meldung.includes('zustaendig'), meldung.slice(0, 140));

  /* --- Der Entscheid geht zurück an die antragstellende Person -------- */
  spur = [];
  stubFetch([
    ['antraege?id=eq.', { status: 200, daten: [
      { art: 'spesen', status: 'abgelehnt', erstellt_von: 'wer-fragte', entschieden_von: 'ich' }] }],
    ['push_geraete', { status: 200, daten: [] }]
  ]);
  d = antwortDoppel();
  await push({ method: 'POST', headers: { authorization: `Bearer ${token('ich')}` },
               body: { antrag: ANTRAG, titel: 'Antrag abgelehnt', text: 'Spesen — Beleg fehlt' } }, d.res);
  ok('Der Entscheid meldet sich bei der antragstellenden Person',
     JSON.stringify(ziele()) === JSON.stringify(['wer-fragte']), JSON.stringify(ziele()));
  ok('Und nicht bei der zuständigen — die hat ja gerade entschieden',
     !spur.some(x => x.url.includes('zustaendig_fuer')));

  /* --- Einen fremden Entscheid meldet niemand ------------------------- */
  spur = [];
  stubFetch([
    ['antraege?id=eq.', { status: 200, daten: [
      { art: 'spesen', status: 'genehmigt', erstellt_von: 'wer-fragte', entschieden_von: 'jemand-anders' }] }]
  ]);
  d = antwortDoppel();
  hoerZu();
  await push({ method: 'POST', headers: { authorization: `Bearer ${token('ich')}` },
               body: { antrag: ANTRAG } }, d.res);
  hoerAuf();
  ok('Wer nicht entschieden hat, meldet den Entscheid auch nicht',
     d.a.status === 403, String(d.a.status));
}

globalThis.fetch = echt;
console.log(`\n=== ${gut} von ${gut + schlecht} Prüfungen bestanden ===`);
process.exit(schlecht ? 1 : 0);
