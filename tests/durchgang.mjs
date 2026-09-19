/* Schritt 7: jeder Screen in beiden Breiten.
 * Geprueft wird, was sich mechanisch pruefen laesst: laeuft die Seite
 * ohne Konsolenfehler an, steht der Rahmen (Seitenleiste ja/nein), und
 * laeuft nichts seitlich aus dem Bild. Dazu ein Bild jeder Seite. */
import { chromium, HIER, SERVER } from './umgebung.mjs';
import fs from 'node:fs';
const OUT = `${HIER}/ausgabe/shots-durchgang`;
fs.rmSync(OUT, { recursive:true, force:true }); fs.mkdirSync(OUT, { recursive:true });
const STUB = fs.readFileSync(`${HIER}/stub.js`,'utf8');
const browser = await chromium.launch();
const fehler = [];
let gut = 0, schlecht = 0;
const ok = (n, b, zusatz='') => { b ? gut++ : schlecht++; console.log(`  ${b ? '✓' : '✗ FEHLER'}  ${n}${zusatz ? '  ' + zusatz : ''}`); };

/* Die Saat liegt in saat.json, damit alle Suiten denselben Stand sehen. */
const SAAT = JSON.parse(fs.readFileSync(`${HIER}/saat.json`,'utf8'));

const SEITEN = [
  ['start',            'start.html'],
  ['projekte',         'projekte.html'],
  ['projekt-neu',      'projekt.html'],
  ['projekt-bearb',    'projekt.html?id=p1'],
  ['projekt-start',    'projekt-start.html?projekt=p1'],
  ['journal',          'journal.html?projekt=p1'],
  ['eintrag',          'eintrag.html?id=e1'],
  ['papierkorb-proj',  'papierkorb.html?projekt=p1'],
  ['projekte-bereich', 'projekte-bereich.html'],
  ['projekt-detail',   'projekt-detail.html?projekt=p1'],
  ['suche',            'suche.html?q=sarnen'],
  ['mitarbeiter',      'mitarbeiter.html'],
  ['firmenpool',       'firmenpool.html'],
  ['dokumente',        'dokumente.html'],
  ['pk-mitarbeiter',   'papierkorb-bereich.html?bereich=mitarbeiter'],
  ['pk-firmen',        'papierkorb-bereich.html?bereich=firmen'],
  ['pk-ordner',        'papierkorb-bereich.html?bereich=ordner']
];

async function lauf(name, breite) {
  const ctx = await browser.newContext({
    viewport:{ width:breite, height: breite>=1024?900:844 },
    deviceScaleFactor:1, locale:'de-CH', serviceWorkers:'block'
  });
  await ctx.route('**/vendor/supabase-js-2.58.0.js', r => r.fulfill({status:200,contentType:'application/javascript',body:STUB}));
  await ctx.addInitScript(saat => {
    if (!sessionStorage.getItem('__stub_db')) sessionStorage.setItem('__stub_db', JSON.stringify(saat));
  }, SAAT);

  const p = await ctx.newPage();
  p.on('console', m => { if (m.type()==='error') fehler.push(`${name}: ${m.text()}`); });
  p.on('pageerror', e => fehler.push(`${name}: ${e.message}`));
  console.log(`\n=== ${name} (${breite}px) ===`);

  await p.goto(`${SERVER}/index.html`, { waitUntil:'networkidle' });
  await p.waitForTimeout(400);
  await p.screenshot({ path:`${OUT}/${name}-login.png`, fullPage:true });
  ok('login: kein Querlauf', await quer(p) === false, await breiten(p));

  await p.fill('#email','test.durchlauf@triga.ch'); await p.fill('#pw','TestDurchlauf!2026');
  await p.click('#btn'); await p.waitForURL('**/start.html'); await p.waitForTimeout(600);

  for (const [kurz, pfad] of SEITEN) {
    await p.goto(`${SERVER}/${pfad}`, { waitUntil:'networkidle' });
    await p.waitForTimeout(900);
    await p.screenshot({ path:`${OUT}/${name}-${kurz}.png`, fullPage:true });

    const q = await quer(p);
    const leiste = await p.locator('.tr-sidebar').isVisible().catch(() => false);
    const erwartet = breite >= 1024;
    ok(`${kurz.padEnd(16)} kein Querlauf`, q === false, q ? await breiten(p) : '');
    ok(`${kurz.padEnd(16)} Rahmen stimmt`, leiste === erwartet,
       leiste === erwartet ? '' : `Seitenleiste ${leiste ? 'da' : 'fehlt'}`);
  }

  await ctx.close();
}

const quer = p => p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
const breiten = p => p.evaluate(() => `scrollWidth ${document.documentElement.scrollWidth} > ${window.innerWidth}`);

await lauf('handy', 390);
await lauf('desktop', 1440);
await browser.close();
console.log(`\n=== ${gut} von ${gut+schlecht} Prüfungen bestanden ===`);
console.log('=== Fehler im Browser ===');
console.log(fehler.length ? [...new Set(fehler)].join('\n') : 'keine');
