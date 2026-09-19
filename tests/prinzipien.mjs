/* Schritt 7: die durchgaengigen Prinzipien, quer durch alle Bereiche.
 * Nicht noch einmal jede Funktion, sondern genau das, was ueberall
 * gleich sein muss. */
import { chromium, HIER, SERVER_OFFLINE, SERVER } from './umgebung.mjs';
import fs from 'node:fs';
const OUT = `${HIER}/ausgabe/shots-prinzipien`;
fs.rmSync(OUT, { recursive:true, force:true }); fs.mkdirSync(OUT, { recursive:true });
const STUB = fs.readFileSync(`${HIER}/stub.js`,'utf8');
const SAAT = JSON.parse(fs.readFileSync(`${HIER}/saat.json`,'utf8'));
const browser = await chromium.launch();
const fehler = [];
let gut = 0, schlecht = 0;
const ok = (n, b, zusatz='') => { b ? gut++ : schlecht++; console.log(`  ${b ? '✓' : '✗ FEHLER'}  ${n}${zusatz ? '  → ' + zusatz : ''}`); };

async function neu(breite) {
  const ctx = await browser.newContext({
    viewport:{ width:breite, height: breite>=1024?900:844 },
    locale:'de-CH', serviceWorkers:'block'
  });
  await ctx.route('**/vendor/supabase-js-2.58.0.js', r => r.fulfill({status:200,contentType:'application/javascript',body:STUB}));
  await ctx.addInitScript(s => { if (!sessionStorage.getItem('__stub_db')) sessionStorage.setItem('__stub_db', JSON.stringify(s)); }, SAAT);
  const p = await ctx.newPage();
  p.on('console', m => { if (m.type()==='error') fehler.push(m.text()); });
  p.on('pageerror', e => fehler.push(e.message));
  await p.goto(`${SERVER}/index.html`, { waitUntil:'networkidle' });
  await p.fill('#email','test.durchlauf@triga.ch'); await p.fill('#pw','TestDurchlauf!2026');
  await p.click('#btn'); await p.waitForURL('**/start.html'); await p.waitForTimeout(600);
  return { ctx, p };
}

/* --- 1. Projekt: archivieren statt loeschen ----------------------------- */
{
  console.log('\n=== Projekt: archivieren statt löschen ===');
  const { ctx, p } = await neu(1440);
  await p.goto(`${SERVER}/projekte.html`, { waitUntil:'networkidle' });
  await p.waitForTimeout(900);
  ok('kein Löschen-Knopf in der Übersicht', (await p.locator('text=/löschen/i').count()) === 0);
  ok('zwei aktive Projekte sichtbar', (await p.$$('#liste a[href*="projekt-start"]')).length === 2);

  await p.goto(`${SERVER}/projekt.html?id=p1`, { waitUntil:'networkidle' });
  await p.waitForTimeout(900);
  ok('Archiv-Schalter da, kein Löschen', await p.locator('#f-archiviert').count() === 1
     && (await p.locator('text=Projekt löschen').count()) === 0);
  // Der Schalter ist ein unsichtbares Checkbox-Feld in einem <label>,
  // der sichtbare Knopf liegt darueber. Genau so tippt man auch mit dem
  // Finger drauf.
  await p.click('#archiv-knopf');
  ok('Schalter reagiert auf den sichtbaren Knopf', await p.isChecked('#f-archiviert'));
  await p.click('#speichern');
  await p.waitForTimeout(1600);
  await p.goto(`${SERVER}/projekte.html`, { waitUntil:'networkidle' });
  await p.waitForTimeout(900);
  ok('archiviertes Projekt raus aus der Hauptliste', (await p.$$('#liste a[href*="projekt-start"]')).length === 1);
  await p.click('#filter');
  await p.waitForTimeout(700);
  ok('über den Archivfilter wieder da', (await p.textContent('#liste')).includes('WUB Garten Mille Fiori'));
  await p.screenshot({ path:`${OUT}/archiv.png`, fullPage:true });

  // zurueckdrehen
  await p.goto(`${SERVER}/projekt.html?id=p1`, { waitUntil:'networkidle' });
  await p.waitForTimeout(900);
  await p.click('#archiv-knopf');
  ok('Schalter lässt sich zurückdrehen', !(await p.isChecked('#f-archiviert')));
  await p.click('#speichern');
  await p.waitForTimeout(1600);
  await p.goto(`${SERVER}/projekte.html`, { waitUntil:'networkidle' });
  await p.waitForTimeout(900);
  ok('wieder aktiv', (await p.$$('#liste a[href*="projekt-start"]')).length === 2);
  await ctx.close();
}

/* --- 2. Offline: jeder Bereich sagt, woran man ist ---------------------- */
/* Laeuft gegen die Kopie auf 8124, dort ist der Service Worker erlaubt.
 * Nur so laesst sich eine Seite ohne Netz ueberhaupt noch oeffnen, und
 * genau das ist ja die Frage. */
{
  console.log('\n=== Offline: gespiegelter Stand statt leerer Seite ===');
  const ctx = await browser.newContext({ viewport:{width:390,height:844}, locale:'de-CH' });
  await ctx.addInitScript(s => { if (!sessionStorage.getItem('__stub_db')) sessionStorage.setItem('__stub_db', JSON.stringify(s)); }, SAAT);
  const p = await ctx.newPage();
  p.on('pageerror', e => fehler.push(e.message));
  const B = SERVER_OFFLINE;
  await p.goto(`${B}/index.html`, { waitUntil:'networkidle' });
  await p.fill('#email','test.durchlauf@triga.ch'); await p.fill('#pw','TestDurchlauf!2026');
  await p.click('#btn'); await p.waitForURL('**/start.html'); await p.waitForTimeout(600);

  // Erst online besuchen, damit Service Worker und Spiegel gefuellt sind.
  for (const seite of ['mitarbeiter.html','firmenpool.html','dokumente.html']) {
    await p.goto(`${B}/${seite}`, { waitUntil:'networkidle' });
    await p.waitForTimeout(1000);
  }
  await p.waitForFunction(() => navigator.serviceWorker.controller !== null, { timeout:20000 });
  await p.waitForTimeout(1500);

  await ctx.setOffline(true);

  await p.goto(`${B}/mitarbeiter.html`, { waitUntil:'domcontentloaded' });
  await p.waitForTimeout(1600);
  ok('Mitarbeiter öffnet ohne Netz', (await p.locator('#liste').count()) === 1);
  ok('Mitarbeiter: Hinweiszeile sichtbar', await p.locator('#hinweis').isVisible());
  ok('Mitarbeiter: Liste kommt aus dem Spiegel', (await p.$$('#liste .br-zeile')).length === 3);

  await p.goto(`${B}/firmenpool.html`, { waitUntil:'domcontentloaded' });
  await p.waitForTimeout(1600);
  ok('Firmenpool öffnet ohne Netz', (await p.locator('#gruppen').count()) === 1);
  ok('Firmenpool: Hinweiszeile sichtbar', await p.locator('#hinweis').isVisible());
  ok('Firmenpool: Firmen aus dem Spiegel', (await p.$$('#gruppen [data-firma]')).length === 3);
  ok('Firmenpool: Kategorien aus dem Spiegel', (await p.$$('#kat-chips .fp-chip[data-code]')).length === 4);
  ok('Firmenpool: Ampel bleibt richtig, nicht pauschal grau',
     (await p.$$('#gruppen .punkt.gruen')).length === 1 && (await p.$$('#gruppen .punkt.gelb')).length === 1);
  await p.screenshot({ path:`${OUT}/offline-firmenpool.png`, fullPage:true });

  await p.goto(`${B}/dokumente.html`, { waitUntil:'domcontentloaded' });
  await p.waitForTimeout(1600);
  ok('Dokumente: sagt klar, dass es eine Verbindung braucht',
     (await p.textContent('#hinweis')).includes('Verbindung'));

  await ctx.setOffline(false);
  await ctx.close();
}

/* --- 3. Nirgends ein endgueltiges Loeschen ------------------------------ */
{
  console.log('\n=== Kein endgültiges Löschen, ausser bei Unterdetails ===');
  const { ctx, p } = await neu(1440);
  const seiten = [
    ['Projektübersicht', 'projekte.html'],
    ['Projekt-Startseite', 'projekt-start.html?projekt=p1'],
    ['Eintrag', 'eintrag.html?id=e1'],
    ['Papierkorb Projekt', 'papierkorb.html?projekt=p1'],
    ['Mitarbeiter', 'mitarbeiter.html'],
    ['Dokumente', 'dokumente.html'],
    ['Papierkorb Mitarbeiter', 'papierkorb-bereich.html?bereich=mitarbeiter'],
    ['Papierkorb Firmenpool', 'papierkorb-bereich.html?bereich=firmen'],
    ['Papierkorb Dokumente', 'papierkorb-bereich.html?bereich=ordner']
  ];
  for (const [name, pfad] of seiten) {
    await p.goto(`${SERVER}/${pfad}`, { waitUntil:'networkidle' });
    await p.waitForTimeout(900);
    const text = await p.textContent('body');
    ok(`${name.padEnd(24)} ohne "endgültig"`, !/endgültig/i.test(text));
  }

  // Der Firmenpool darf das Wort genau zweimal fuehren, bei den beiden
  // Unterdetails einer Firma. Das ist die abgesprochene Ausnahme.
  await p.goto(`${SERVER}/firmenpool.html`, { waitUntil:'networkidle' });
  await p.waitForTimeout(1000);
  ok('Firmenpool-Liste ohne "endgültig"', !/endgültig/i.test(await p.textContent('body')));
  await p.locator('#gruppen [data-firma="f1"]').click(); await p.waitForTimeout(1000);
  await p.click('.fp-person [data-person-weg]'); await p.waitForTimeout(600);
  ok('Ansprechperson: Rückfrage sagt es offen',
     /endgültig/i.test(await p.locator('.sheet').last().textContent()));
  await p.click('#f-nein'); await p.waitForTimeout(400);
  await p.click('#notiz-liste [data-notiz-weg]'); await p.waitForTimeout(600);
  ok('Notiz: Rückfrage sagt es offen',
     /endgültig/i.test(await p.locator('.sheet').last().textContent()));
  await p.click('#f-nein'); await p.waitForTimeout(400);
  await ctx.close();
}

/* --- 4. Papierkorb-Muster ueberall gleich ------------------------------- */
{
  console.log('\n=== Papierkorb-Muster überall gleich ===');
  const { ctx, p } = await neu(1440);
  for (const [name, bereich, erwartet] of [
    ['Mitarbeiter', 'mitarbeiter', 1], ['Firmenpool', 'firmen', 2], ['Dokumente', 'ordner', 2]
  ]) {
    await p.goto(`${SERVER}/papierkorb-bereich.html?bereich=${bereich}`, { waitUntil:'networkidle' });
    await p.waitForTimeout(1100);
    const zeilen = await p.$$('#inhalt .pk-zeile');
    ok(`${name.padEnd(12)} zeigt die gelöschten Einträge`, zeilen.length === erwartet, `${zeilen.length} statt ${erwartet}`);
    ok(`${name.padEnd(12)} nennt Datum und Person`, (await p.textContent('#inhalt')).includes('Jonas Zemp'));
    ok(`${name.padEnd(12)} hat Wiederherstellen`, (await p.$$('#inhalt button[data-id]')).length === erwartet);
  }
  await p.screenshot({ path:`${OUT}/papierkorb-firmen.png`, fullPage:true });
  await ctx.close();
}

await browser.close();
console.log(`\n=== ${gut} von ${gut+schlecht} Prüfungen bestanden ===`);
console.log('=== Fehler im Browser ===');
console.log(fehler.length ? [...new Set(fehler)].join('\n') : 'keine');
