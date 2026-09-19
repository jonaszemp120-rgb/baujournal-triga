/* Schritt 8: der Selbsttest zur Checkliste aus dem Prompt.
 * Deckt die zwei Punkte ab, die bisher in keiner Suite standen:
 * die Navigation zu allen vier Bereichen in beiden Breiten, und der
 * Export als PDF und Word. */
import { chromium, HIER, WURZEL, SERVER } from './umgebung.mjs';
import fs from 'node:fs';
const OUT = `${HIER}/ausgabe/shots-selbsttest`;
fs.rmSync(OUT, { recursive:true, force:true }); fs.mkdirSync(OUT, { recursive:true });
const STUB = fs.readFileSync(`${HIER}/stub.js`,'utf8');
const SAAT = JSON.parse(fs.readFileSync(`${HIER}/saat.json`,'utf8'));
const browser = await chromium.launch();
const fehler = [];
let gut = 0, schlecht = 0;
const ok = (n, b, zusatz='') => { b ? gut++ : schlecht++; console.log(`  ${b ? '✓' : '✗ FEHLER'}  ${n}${zusatz ? '  → ' + zusatz : ''}`); };

const BEREICHE = [
  ['Mitarbeiter', 'mitarbeiter.html'],
  ['Projekte',    'projekte-bereich.html'],
  ['Baujournal',  'projekte.html'],
  ['Firmenpool',  'firmenpool.html'],
  ['Dokumente',   'dokumente.html']
];

async function anmelden(breite) {
  const ctx = await browser.newContext({
    viewport:{ width:breite, height: breite>=1024?900:844 },
    locale:'de-CH', serviceWorkers:'block', acceptDownloads:true
  });
  await ctx.route('**/vendor/supabase-js-2.58.0.js', r => r.fulfill({status:200,contentType:'application/javascript',body:STUB}));
  await ctx.addInitScript(s => { if (!sessionStorage.getItem('__stub_db')) sessionStorage.setItem('__stub_db', JSON.stringify(s)); }, SAAT);
  const p = await ctx.newPage();
  p.on('console', m => { if (m.type()==='error') fehler.push(m.text()); });
  p.on('pageerror', e => fehler.push(e.message));
  await p.goto(`${SERVER}/index.html`, { waitUntil:'networkidle' });
  await p.fill('#email','test.durchlauf@triga.ch'); await p.fill('#pw','TestDurchlauf!2026');
  await p.click('#btn'); await p.waitForURL('**/start.html'); await p.waitForTimeout(800);
  return { ctx, p };
}

/* --- 0. Der App-Name, auch auf dem Anmeldebildschirm -------------------- */
{
  console.log('\n=== App-Name ===');
  const ctx = await browser.newContext({ viewport:{width:390,height:844}, locale:'de-CH', serviceWorkers:'block' });
  await ctx.route('**/vendor/supabase-js-2.58.0.js', r => r.fulfill({status:200,contentType:'application/javascript',body:STUB}));
  const p = await ctx.newPage();
  await p.goto(`${SERVER}/index.html`, { waitUntil:'networkidle' });
  await p.waitForTimeout(600);
  const karte = await p.textContent('#form');
  ok('Login-Karte heisst Anmelden', karte.includes('Anmelden'));
  ok('Login-Karte nennt die App nicht mehr Baujournal',
     !/^\s*Baujournal/m.test(karte));
  ok('Login trägt das Logo', (await p.$$('[data-logo] img')).length === 1);
  ok('Logo kommt aus der einen Quelle',
     (await p.getAttribute('[data-logo] img', 'src')) === 'assets/triga-logo.png');
  await ctx.close();
}

/* --- 1. Alle vier Bereiche, von der Startseite und aus der Leiste ------- */
for (const breite of [390, 1440]) {
  console.log(`\n=== Navigation (${breite}px) ===`);
  const { ctx, p } = await anmelden(breite);

  ok('Startseite zeigt genau sechs Kacheln', (await p.$$('#raster a')).length === 6);
  ok('Test-Banner sichtbar', await p.locator('.tr-banner:visible').first().isVisible());
  await p.screenshot({ path:`${OUT}/${breite}-start.png`, fullPage:true });

  for (const [titel, ziel] of BEREICHE) {
    await p.goto(`${SERVER}/start.html`, { waitUntil:'networkidle' });
    await p.waitForTimeout(700);
    await p.locator(`#raster a[href="${ziel}"]`).click();
    await p.waitForURL(`**/${ziel}`, { timeout:10000 }).catch(()=>{});
    await p.waitForTimeout(900);
    ok(`Kachel ${titel.padEnd(12)} führt nach ${ziel}`, p.url().endsWith(ziel));

    if (breite >= 1024) {
      const aktiv = await p.locator('.tr-nav[aria-current="page"]').textContent().catch(()=>'');
      ok(`Leiste markiert ${titel.padEnd(12)}`, aktiv.trim() === titel, aktiv.trim());
      // Acht, nicht sechs: Feed und Formulare stehen in der Leiste, aber nicht im Kachelraster.
      ok(`Leiste hat alle acht Bereiche`, (await p.$$('.tr-sidebar .tr-nav')).length === 8);
    } else {
      ok(`Zurück-Pfeil auf ${titel.padEnd(12)} vorhanden`,
         (await p.locator('.br-kopf a[href="start.html"], .topbar a[href="start.html"], a[href="start.html"]').count()) > 0);
    }
  }

  // aus der Leiste heraus quer durch alle Bereiche
  if (breite >= 1024) {
    for (const [titel, ziel] of BEREICHE) {
      await p.locator(`.tr-sidebar .tr-nav[href="${ziel}"]`).click();
      await p.waitForURL(`**/${ziel}`, { timeout:10000 }).catch(()=>{});
      await p.waitForTimeout(800);
      ok(`Leiste springt nach ${titel.padEnd(12)}`, p.url().endsWith(ziel));
    }
    await p.screenshot({ path:`${OUT}/${breite}-leiste.png`, fullPage:true });
  }
  await ctx.close();
}

/* --- 2. Export als PDF und als Word ------------------------------------- */
for (const breite of [390, 1440]) {
  console.log(`\n=== Export (${breite}px) ===`);
  const { ctx, p } = await anmelden(breite);
  await p.goto(`${SERVER}/eintrag.html?id=e1`, { waitUntil:'networkidle' });
  await p.waitForTimeout(1200);
  ok('beide Export-Knöpfe da', await p.locator('#pdf').isVisible() && await p.locator('#word').isVisible());

  for (const [art, endung] of [['pdf','.pdf'], ['word','.docx']]) {
    const [datei] = await Promise.all([
      p.waitForEvent('download', { timeout:25000 }),
      p.click('#' + art)
    ]);
    const pfad = `${OUT}/${breite}-eintrag${endung}`;
    await datei.saveAs(pfad);
    const kopf = fs.readFileSync(pfad).subarray(0, 4).toString('latin1');
    ok(`${art.toUpperCase().padEnd(4)} heruntergeladen`, datei.suggestedFilename().endsWith(endung),
       datei.suggestedFilename());
    ok(`${art.toUpperCase().padEnd(4)} ist eine echte Datei`,
       art === 'pdf' ? kopf === '%PDF' : kopf.startsWith('PK'), kopf);
    ok(`${art.toUpperCase().padEnd(4)} nicht leer`, fs.statSync(pfad).size > 3000,
       fs.statSync(pfad).size + ' Bytes');
    await p.waitForTimeout(600);
  }

  // Sammelexport aus dem Verlauf
  await p.goto(`${SERVER}/projekt-start.html?projekt=p1`, { waitUntil:'networkidle' });
  await p.waitForTimeout(1100);
  ok('Verlauf zeigt den Eintrag', (await p.$$('#liste a')).length === 1);
  await ctx.close();
}

/* --- 3. Das Test-Banner haengt wirklich an einem Schalter -------------- */
{
  console.log('\n=== Test-Banner: ein Schalter, überall weg ===');
  const echt = fs.readFileSync(`${WURZEL}/js/shell.js`,'utf8');
  const aus = echt.replace('const TEST_BANNER = true;', 'const TEST_BANNER = false;');
  ok('genau eine Stelle im Code schaltet das Banner',
     (echt.match(/const TEST_BANNER = true;/g) || []).length === 1);

  for (const breite of [390, 1440]) {
    const ctx = await browser.newContext({ viewport:{width:breite,height:breite>=1024?900:844}, locale:'de-CH', serviceWorkers:'block' });
    await ctx.route('**/vendor/supabase-js-2.58.0.js', r => r.fulfill({status:200,contentType:'application/javascript',body:STUB}));
    await ctx.route('**/js/shell.js', r => r.fulfill({status:200,contentType:'application/javascript',body:aus}));
    await ctx.addInitScript(s => { if (!sessionStorage.getItem('__stub_db')) sessionStorage.setItem('__stub_db', JSON.stringify(s)); }, SAAT);
    const p = await ctx.newPage();
    await p.goto(`${SERVER}/index.html`, { waitUntil:'networkidle' });
    await p.fill('#email','test.durchlauf@triga.ch'); await p.fill('#pw','TestDurchlauf!2026');
    await p.click('#btn'); await p.waitForURL('**/start.html'); await p.waitForTimeout(900);
    ok(`Banner weg bei ${breite}px`, (await p.$$('.tr-banner')).length === 0);
    ok(`Startseite sonst unveraendert bei ${breite}px`, (await p.$$('#raster a')).length === 6);
    await p.screenshot({ path:`${OUT}/${breite}-ohne-banner.png`, fullPage:true });
    await ctx.close();
  }
}

await browser.close();
console.log(`\n=== ${gut} von ${gut+schlecht} Prüfungen bestanden ===`);
console.log('=== Fehler im Browser ===');
console.log(fehler.length ? [...new Set(fehler)].join('\n') : 'keine');
