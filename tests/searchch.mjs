/* Die Serverless-Function einmal wirklich laufen lassen.
 * search.ch ist von hier aus nicht erreichbar und einen Schluessel gibt
 * es noch nicht, also wird fetch ersetzt. Geprueft wird das, was ich
 * selbst geschrieben habe: die Faelle ohne Schluessel, mit zu kurzer
 * Anfrage, mit einem Fehler der Gegenseite, und die Umformung der
 * Antwort. */
import { WURZEL_URL, WURZEL } from './umgebung.mjs';
import { createRequire } from 'node:module';
const require = createRequire(WURZEL_URL);
const pfad = `${WURZEL}api/search-ch.js`;

let gut = 0, schlecht = 0;
const ok = (n, b, zusatz='') => { b ? gut++ : schlecht++; console.log(`  ${b ? '✓' : '✗ FEHLER'}  ${n}${zusatz ? '  → ' + zusatz : ''}`); };

function antwort() {
  const r = { code:0, kopf:{}, koerper:null };
  r.status = c => { r.code = c; return r; };
  r.json = k => { r.koerper = k; return r; };
  r.setHeader = (k,v) => { r.kopf[k] = v; };
  return r;
}

async function ruf(q, env, fetchDoppel) {
  delete require.cache[pfad];
  const alteEnv = process.env.SEARCH_CH_API_KEY;
  const altesFetch = globalThis.fetch;
  if (env === null) delete process.env.SEARCH_CH_API_KEY;
  else process.env.SEARCH_CH_API_KEY = env;
  if (fetchDoppel) globalThis.fetch = fetchDoppel;
  const handler = require(pfad);
  const r = antwort();
  await handler({ query: { q } }, r);
  process.env.SEARCH_CH_API_KEY = alteEnv;
  globalThis.fetch = altesFetch;
  return r;
}

console.log('\n=== api/search-ch.js ===');

let r = await ruf('Melk Durrer', null);
ok('ohne Schlüssel: 503 statt Absturz', r.code === 503);
ok('ohne Schlüssel: Hinweis im Klartext', /API-Schlüssel/.test(r.koerper.fehler), r.koerper.fehler);

r = await ruf('M', 'geheim');
ok('zu kurze Anfrage: 400', r.code === 400);

let gesehen = null;
r = await ruf('Melk Durrer', 'geheim', async (url) => {
  gesehen = url;
  return { ok:true, json: async () => ({ entries: [
    { org:'Melk Durrer AG', street:'Kanalstrasse', streetno:'20', zip:'6056', city:'Kägiswil',
      phone:'041 660 56 58', email:'mario.durrer@melkdurrer.ch' },
    { firstname:'Mario', name:'Durrer', zip:'6056', city:'Kägiswil', phone:'079 000 00 00' }
  ] }) };
});
ok('Treffer werden durchgereicht', r.code === 200 && r.koerper.treffer.length === 2);
const t = r.koerper.treffer[0];
ok('Firma: Name aus org', t.name === 'Melk Durrer AG');
ok('Firma: Strasse und Nummer zusammengesetzt', t.adresse === 'Kanalstrasse 20');
ok('Firma: PLZ und Ort zusammengesetzt', t.plz_ort === '6056 Kägiswil');
ok('Firma: Telefon und Mail übernommen',
   t.telefon === '041 660 56 58' && t.email === 'mario.durrer@melkdurrer.ch');
const t2 = r.koerper.treffer[1];
ok('Person: Name aus Vor- und Nachname', t2.name === 'Mario Durrer');
ok('fehlende Felder werden null, nicht "undefined"', t2.adresse === null && t2.email === null);

ok('Schlüssel geht an search.ch, nicht an den Browser', /key=geheim/.test(gesehen));
ok('Suchbegriff wird kodiert übergeben', /was=Melk\+Durrer/.test(gesehen), gesehen.slice(0, 90));
ok('Antwort ist nur privat zwischengespeichert',
   (r.kopf['Cache-Control'] || '').startsWith('private'), r.kopf['Cache-Control']);

r = await ruf('Melk Durrer', 'geheim', async () => ({ ok:false, status:429 }));
ok('Fehler der Gegenseite: 502 mit Status im Text',
   r.code === 502 && /429/.test(r.koerper.fehler), r.koerper.fehler);

r = await ruf('Melk Durrer', 'geheim', async () => { throw new Error('ENOTFOUND'); });
ok('Netzfehler: 502 statt Absturz', r.code === 502);

r = await ruf('Melk Durrer', 'geheim', async () => ({ ok:true, json: async () => ({}) }));
ok('unerwartete Antwortform: leere Trefferliste statt Absturz',
   r.code === 200 && r.koerper.treffer.length === 0);

console.log(`\n=== ${gut} von ${gut+schlecht} Prüfungen bestanden ===`);
