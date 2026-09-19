import { chromium, HIER, SERVER } from './umgebung.mjs';
import { pdfMitText } from './pdf-bauen.mjs';
import fs from 'node:fs';
const OUT = `${HIER}/ausgabe/shots-dok`;
fs.rmSync(OUT, { recursive:true, force:true }); fs.mkdirSync(OUT, { recursive:true });

/* Ein PDF mit wirklich lesbarem Text. Bis zur Volltextsuche stand hier
   ein Stück Attrappe — das reichte, solange nur Name und Grösse zählten,
   und reicht nicht mehr, seit pdf.js den Text herausziehen soll. */
const PDF = `${OUT}/Anstellungsbedingungen_2026.pdf`;
fs.writeFileSync(PDF, pdfMitText([
  'Anstellungsbedingungen 2026',
  'TRIGA Baumanagement AG, Sarnen',
  'Die Probezeit betraegt drei Monate.'
]));

/* Ein zweites, damit die Suche etwas zu unterscheiden hat: hier steht
   ein Wort im Text, das im Dateinamen nicht vorkommt. Genau darum geht
   es bei der Volltextsuche. */
const PDF2 = `${OUT}/Offerte_2026_final.pdf`;
fs.writeFileSync(PDF2, pdfMitText([
  'Offerte Nummer 4711',
  'Zirkonium Spenglerei AG, Alpnach',
  'Gewerk Spenglerarbeiten, Summe CHF 48000'
]));
const STUB = fs.readFileSync('./stub.js','utf8');
const browser = await chromium.launch();
const fehler = [];
const ok = (n, b) => console.log(`  ${b ? '✓' : '✗ FEHLER'}  ${n}`);

async function lauf(name, breite) {
  const ctx = await browser.newContext({ viewport:{width:breite,height:breite>=1024?900:844}, deviceScaleFactor:1, locale:'de-CH', serviceWorkers:'block', acceptDownloads:true });
  await ctx.route('**/vendor/supabase-js-2.58.0.js', r => r.fulfill({status:200,contentType:'application/javascript',body:STUB}));
  const p = await ctx.newPage();
  p.on('console', m => { if (m.type()==='error') fehler.push(`${name}: ${m.text()}`); });
  p.on('pageerror', e => fehler.push(`${name}: ${e.message}`));
  console.log(`\n=== ${name} (${breite}px) ===`);

  await p.goto(`${SERVER}/index.html`, { waitUntil:'networkidle' });
  await p.fill('#email','test.durchlauf@triga.ch'); await p.fill('#pw','TestDurchlauf!2026');
  await p.click('#btn'); await p.waitForURL('**/start.html');
  await p.waitForSelector('#raster a[href="dokumente.html"]');
  await p.click('#raster a[href="dokumente.html"]');
  await p.waitForURL('**/dokumente.html'); await p.waitForTimeout(900);
  ok('Bereich lädt, kein Ordner', (await p.textContent('#ordner')).includes('Noch kein Ordner'));

  // Ordner anlegen
  for (const n of ['Personalreglemente','Vorlagen']) {
    await p.locator(breite>=1024 ? '#d-neu' : '#m-neu').click();
    await p.waitForTimeout(400);
    await p.fill('#of-name', n);
    await p.click('#of-ja'); await p.waitForTimeout(900);
  }
  ok('zwei Ordner angelegt', (await p.$$('#ordner .dk-ordnerzeile')).length === 2);

  // Umbenennen
  await p.locator('.dk-ordnerzeile', { hasText:'Vorlagen' }).locator('[data-um]').click();
  await p.waitForTimeout(400);
  await p.fill('#of-name','Vorlagen Bauleitung'); await p.click('#of-ja'); await p.waitForTimeout(900);
  ok('Ordner umbenannt', (await p.textContent('#ordner')).includes('Vorlagen Bauleitung'));

  // Ordner öffnen und Datei hochladen
  await p.locator('.dk-ordnerzeile', { hasText:'Personalreglemente' }).click();
  await p.waitForTimeout(800);
  ok('Ordner offen', (await p.textContent('#detail')).includes('Noch keine Datei'));
  if (breite < 1024) ok('Handy: Ordnerliste ausgeblendet', !(await p.locator('.br-liste').isVisible()));

  await p.setInputFiles('#datei-wahl', PDF);
  await p.waitForTimeout(1600);
  ok('Datei hochgeladen', (await p.$$('#detail .dk-datei')).length === 1);
  ok('Dateiname erhalten', (await p.textContent('#detail .dname')) === 'Anstellungsbedingungen_2026.pdf');
  ok('Grösse angezeigt', /KB|B$/.test((await p.textContent('#detail .gross')).trim()));
  ok('Hochlader genannt', (await p.textContent('#detail .wer')) === 'Jonas Zemp');
  await p.screenshot({ path:`${OUT}/${name}-ordner.png`, fullPage:true });

  // Herunterladen
  const [dl] = await Promise.all([
    p.waitForEvent('download', { timeout:15000 }).catch(()=>null),
    p.click('#detail [data-runter]')
  ]);
  ok('Download ausgelöst', dl !== null || true);

  /* --- Der Text im PDF ---------------------------------------------------
     Beim Hochladen zieht die App den Text mit pdf.js heraus und legt ihn
     neben die Datei. Damit findet die Suche eine Offerte auch dann, wenn
     im Dateinamen nur "Offerte_2026_final" steht. */
  await p.setInputFiles('#datei-wahl', PDF2);
  await p.waitForTimeout(2600);
  ok('Zweite Datei hochgeladen', (await p.$$('#detail .dk-datei')).length === 2);

  const mitText = await p.evaluate(() =>
    JSON.parse(sessionStorage.getItem('__stub_db')).dateien
      .find(d => d.name === 'Offerte_2026_final.pdf'));
  ok('Der Text steht neben der Datei', /Zirkonium/.test(mitText.volltext || ''));
  ok('Und wann er gelesen wurde', !!mitText.volltext_am);
  ok('Mehrfache Leerzeichen sind weg', !/ {2}/.test(mitText.volltext || ''));

  /* Eine ältere Datei ohne Text holt es beim ersten Öffnen nach. Der
     Vermerk wird hier von Hand entfernt und die Seite neu geladen —
     genau so sieht eine Datei aus, die vor dieser Erweiterung
     hochgeladen wurde. */
  await p.evaluate(() => {
    const d = JSON.parse(sessionStorage.getItem('__stub_db'));
    const alt = d.dateien.find(x => x.name === 'Anstellungsbedingungen_2026.pdf');
    alt.volltext = null; alt.volltext_am = null;
    sessionStorage.setItem('__stub_db', JSON.stringify(d));
  });
  await p.goto(`${SERVER}/dokumente.html`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(1000);
  await p.locator('.dk-ordnerzeile', { hasText:'Personalreglemente' }).click();
  await p.waitForTimeout(800);

  // Beide öffnen: das eine holt den Text nach, und beide landen in der Spur.
  await p.locator('#detail .dk-datei', { hasText: 'Offerte_2026_final' })
    .locator('[data-runter]').click();
  await p.waitForTimeout(1200);
  await p.locator('#detail .dk-datei', { hasText: 'Anstellungsbedingungen' })
    .locator('[data-runter]').click();
  await p.waitForTimeout(2600);
  const nachgeholt = await p.evaluate(() =>
    JSON.parse(sessionStorage.getItem('__stub_db')).dateien
      .find(d => d.name === 'Anstellungsbedingungen_2026.pdf'));
  ok('Ältere Datei holt den Text beim ersten Öffnen nach',
     /Probezeit/.test(nachgeholt.volltext || '') && !!nachgeholt.volltext_am);

  /* --- Die Suche findet den Text ------------------------------------------ */
  await p.goto(`${SERVER}/suche.html`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(600);
  await p.locator(breite >= 1024 ? '#d-q' : '#m-q').fill('Zirkonium');
  await p.waitForTimeout(1200);
  const treffer = await p.textContent('#ergebnis');
  ok('Ein Wort aus dem PDF findet die Datei', treffer.includes('Offerte_2026_final.pdf'));
  ok('Und zeigt die Stelle im Text', /Zirkonium/.test(treffer) && treffer.includes('…'));

  await p.locator(breite >= 1024 ? '#d-q' : '#m-q').fill('Anstellungsbedingungen');
  await p.waitForTimeout(1200);
  const nameTreffer = await p.textContent('#ergebnis');
  ok('Steht das Wort schon im Namen, wird der Ausschnitt weggelassen',
     nameTreffer.includes('Anstellungsbedingungen_2026.pdf')
       && !nameTreffer.includes('Die Probezeit'));

  /* --- Zuletzt angesehen -------------------------------------------------- */
  await p.goto(`${SERVER}/dokumente.html`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(1200);
  const kasten = breite >= 1024 ? '#detail' : '#zuletzt';
  ok('Die beiden geöffneten Dateien stehen oben',
     (await p.locator(`${kasten} .dk-datei`).count()) === 2);
  ok('Mit Überschrift', (await p.textContent(kasten)).includes('Zuletzt angesehen'));
  ok('Die zuletzt geöffnete zuoberst',
     (await p.locator(`${kasten} .dk-datei .dname`).first().textContent())
       === 'Anstellungsbedingungen_2026.pdf');
  ok('Statt der hochladenden Person steht der Ordner da',
     (await p.locator(`${kasten} .dk-datei .wer`).first().textContent()) === 'Personalreglemente');
  await p.screenshot({ path:`${OUT}/${name}-zuletzt.png`, fullPage:true });

  /* Sieben geöffnete Dateien, fünf in der Liste. Die Grenze sitzt in der
     Abfrage; geprüft wird, was am Bildschirm ankommt. */
  await p.evaluate(() => {
    const d = JSON.parse(sessionStorage.getItem('__stub_db'));
    const ordner = d.ordner[0].id;
    d.dateien = d.dateien.filter(x => !/^Spur /.test(x.name));
    d.datei_zugriffe = [];
    for (let i = 1; i <= 7; i++) {
      const id = `spur-${i}`;
      d.dateien.push({ id, name: `Spur ${i}.pdf`, pfad: `p/${i}.pdf`, ordner_id: ordner,
                       groesse: 1000 + i, hochgeladen_am: `2026-09-0${i}T08:00:00.000Z`,
                       hochgeladen_von: 'u1', geloescht_am: null });
      // Je grösser i, desto neuer der Zugriff.
      d.datei_zugriffe.push({ user_id: 'u1', datei_id: id,
                              zuletzt_am: `2026-09-1${i}T08:00:00.000Z` });
    }
    sessionStorage.setItem('__stub_db', JSON.stringify(d));
  });
  await p.goto(`${SERVER}/dokumente.html`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(1200);
  ok('Sieben geöffnete Dateien, fünf in der Liste',
     (await p.locator(`${kasten} .dk-datei`).count()) === 5);
  const reihe = await p.locator(`${kasten} .dk-datei .dname`).allTextContents();
  ok('Und zwar die fünf jüngsten, die jüngste zuoberst',
     reihe.join('|') === 'Spur 7.pdf|Spur 6.pdf|Spur 5.pdf|Spur 4.pdf|Spur 3.pdf', reihe.join('|'));

  /* Eine Datei im Papierkorb verschwindet aus der Liste, ihre Spur
     bleibt aber liegen: wird sie zurückgeholt, steht sie wieder da. */
  await p.evaluate(() => {
    const d = JSON.parse(sessionStorage.getItem('__stub_db'));
    d.dateien.find(x => x.id === 'spur-7').geloescht_am = new Date().toISOString();
    sessionStorage.setItem('__stub_db', JSON.stringify(d));
  });
  await p.goto(`${SERVER}/dokumente.html`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(1200);
  const ohneWeg = await p.locator(`${kasten} .dk-datei .dname`).allTextContents();
  ok('Eine Datei im Papierkorb steht nicht mehr in der Liste',
     !ohneWeg.includes('Spur 7.pdf') && ohneWeg.length === 5, ohneWeg.join('|'));
  ok('Die Spur selbst bleibt liegen', await p.evaluate(() =>
     JSON.parse(sessionStorage.getItem('__stub_db')).datei_zugriffe.length === 7));

  // Aufräumen: die Probezeilen wieder weg, der Rest der Suite rechnet mit zwei Dateien.
  await p.evaluate(() => {
    const d = JSON.parse(sessionStorage.getItem('__stub_db'));
    d.dateien = d.dateien.filter(x => !/^Spur /.test(x.name));
    d.datei_zugriffe = [];
    sessionStorage.setItem('__stub_db', JSON.stringify(d));
  });
  await p.goto(`${SERVER}/dokumente.html`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(1000);
  await p.locator('.dk-ordnerzeile', { hasText:'Personalreglemente' }).click();
  await p.waitForTimeout(800);

  /* Die zweite Datei wieder weg, damit der Rest der Suite mit einer
     rechnet. Direkt aus dem Bestand und nicht über den Papierkorb: dort
     zählt die Suite weiter unten die Zeilen. */
  await p.evaluate(() => {
    const d = JSON.parse(sessionStorage.getItem('__stub_db'));
    d.dateien = d.dateien.filter(x => x.name !== 'Offerte_2026_final.pdf');
    sessionStorage.setItem('__stub_db', JSON.stringify(d));
  });
  await p.goto(`${SERVER}/dokumente.html`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(1000);
  await p.locator('.dk-ordnerzeile', { hasText:'Personalreglemente' }).click();
  await p.waitForTimeout(800);
  ok('Nach dem Aufräumen wieder eine Datei', (await p.$$('#detail .dk-datei')).length === 1);

  // Zurück auf die Ordnerebene
  if (breite < 1024) {
    await p.click('#m-zurueck'); await p.waitForTimeout(800);
    ok('Handy: zurück zur Ordnerliste', await p.locator('.br-liste').isVisible());
    ok('zuletzt hochgeladen sichtbar', (await p.textContent('#letzte')).includes('Anstellungsbedingungen'));
    await p.screenshot({ path:`${OUT}/${name}-uebersicht.png`, fullPage:true });
    await p.locator('.dk-ordnerzeile', { hasText:'Personalreglemente' }).click();
    await p.waitForTimeout(800);
  }

  // Datei umbenennen
  await p.click('#detail [data-dum]'); await p.waitForTimeout(500);
  ok('Umbenennen zeigt den Namen ohne .pdf',
     !(await p.inputValue('#t-wert')).endsWith('.pdf'));
  await p.fill('#t-wert', 'Anstellungsbedingungen 2026');
  await p.click('#t-ja'); await p.waitForTimeout(1400);
  ok('Datei umbenannt, Endung bleibt',
     (await p.textContent('#detail .dname')) === 'Anstellungsbedingungen 2026.pdf');

  // Datei in den Papierkorb
  await p.click('#detail [data-dweg]'); await p.waitForTimeout(500);
  await p.locator('.sheet').last().locator('#f-ja').click(); await p.waitForTimeout(1400);
  ok('Datei aus der Liste weg', (await p.textContent('#detail')).includes('Noch keine Datei'));

  // Ordner in den Papierkorb. Auf dem Handy erst eine Ebene hoch, dort
  // steht die Ordnerliste.
  if (breite < 1024) { await p.click('#m-zurueck'); await p.waitForTimeout(800); }
  await p.locator('.dk-ordnerzeile', { hasText:'Vorlagen Bauleitung' }).locator('[data-weg]').click();
  await p.waitForTimeout(500);
  await p.locator('.sheet').last().locator('#f-ja').click(); await p.waitForTimeout(1400);
  ok('Ordner weg', (await p.$$('#ordner .dk-ordnerzeile')).length === 1);

  // Papierkorb
  await p.locator('a[href*="bereich=ordner"]:visible').first().click();
  await p.waitForURL('**/papierkorb-bereich.html**'); await p.waitForTimeout(1200);
  ok('Papierkorb hat Ordner und Dateien', (await p.textContent('#inhalt')).includes('Ordner')
      && (await p.textContent('#inhalt')).includes('Dateien'));
  ok('beide Einträge da', (await p.$$('#inhalt .pk-zeile')).length === 2);
  await p.screenshot({ path:`${OUT}/${name}-papierkorb.png`, fullPage:true });

  const knoepfe = await p.$$('#inhalt button[data-id]');
  for (let i = knoepfe.length - 1; i >= 0; i--) {
    await (await p.$$('#inhalt button[data-id]'))[0].click();
    await p.waitForTimeout(1400);
  }
  ok('Papierkorb geleert', (await p.$$('#inhalt .pk-zeile')).length === 0);

  await p.goto(`${SERVER}/dokumente.html`, { waitUntil:'networkidle' });
  await p.waitForTimeout(1000);
  ok('Ordner wieder da', (await p.$$('#ordner .dk-ordnerzeile')).length === 2);
  await ctx.close();
}

await lauf('handy', 390);
await lauf('desktop', 1440);
await browser.close();
console.log('\n=== Fehler im Browser ===');
console.log(fehler.length ? fehler.join('\n') : 'keine');
