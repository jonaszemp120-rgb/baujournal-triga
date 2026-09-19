/* Schritt 10: Pendenzenliste und Rollen-Abzeichen.
   Geprüft wird die Liste aus Abschnitt 4 der Vorgabe. */
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import fs from 'node:fs';
const HIER = '/tmp/claude-0/-home-user-baujournal-triga/ad655f9d-451a-55b0-aac9-986e124c8f6f/scratchpad';
const OUT = `${HIER}/shots-pd`;
fs.rmSync(OUT, { recursive:true, force:true }); fs.mkdirSync(OUT, { recursive:true });
const STUB = fs.readFileSync(`${HIER}/stub.js`,'utf8');
const SAAT = JSON.parse(fs.readFileSync(`${HIER}/saat.json`,'utf8'));
const browser = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const fehler = [];
let gut = 0, schlecht = 0;
const ok = (n, b, zusatz='') => { b ? gut++ : schlecht++; console.log(`  ${b ? '✓' : '✗ FEHLER'}  ${n}${zusatz ? '  → ' + zusatz : ''}`); };

async function anmelden(breite) {
  const ctx = await browser.newContext({
    viewport:{ width:breite, height: breite>=1024?900:844 },
    locale:'de-CH', serviceWorkers:'block'
  });
  await ctx.route('**/vendor/supabase-js-2.58.0.js', r => r.fulfill({status:200,contentType:'application/javascript',body:STUB}));
  await ctx.addInitScript(s => { if (!sessionStorage.getItem('__stub_db')) sessionStorage.setItem('__stub_db', JSON.stringify(s)); }, SAAT);
  const p = await ctx.newPage();
  p.on('console', m => { if (m.type()==='error') fehler.push(`${breite}: ${m.text()}`); });
  p.on('pageerror', e => fehler.push(`${breite}: ${e.message}`));
  await p.goto('http://127.0.0.1:8123/index.html', { waitUntil:'networkidle' });
  await p.fill('#email','test.durchlauf@triga.ch'); await p.fill('#pw','TestDurchlauf!2026');
  await p.click('#btn'); await p.waitForURL('**/start.html'); await p.waitForTimeout(800);
  return { ctx, p };
}

const hubTitel = p => p.$eval('#pendenzen h2', e => e.textContent.trim());
const hubZeilen = p => p.$$eval('#pendenzen .pj-pendenz .text', e => e.map(x => x.textContent.trim()));

for (const breite of [390, 1440]) {
  console.log(`\n=== Pendenzen (${breite}px) ===`);
  const { ctx, p } = await anmelden(breite);

  // --- Der Abschnitt auf der Projektseite -----------------------------------
  await p.goto('http://127.0.0.1:8123/projekt-detail.html?projekt=p1', { waitUntil:'networkidle' });
  await p.waitForTimeout(1200);

  ok('Abschnitt Pendenzen vorhanden', await p.locator('#pendenzen').isVisible());
  ok('Zähler zeigt drei offene', (await hubTitel(p)) === 'Pendenzen · 3 offen', await hubTitel(p));
  ok('Nur die offenen Punkte im Auszug', (await hubZeilen(p)).length === 3);
  ok('Erledigter Punkt steht nicht im Auszug',
     !(await hubZeilen(p)).includes('Zufahrt Baustrasse ausbessern'));
  ok('Firma steht bei der Pendenz',
     (await p.$$eval('#pendenzen .pj-pendenz .wer', e => e.map(x => x.textContent.trim())))
       .includes('Melk Durrer AG'));
  ok('Link auf die volle Liste',
     (await p.getAttribute('#pendenzen .pj-mehr', 'href')) === 'pendenzen.html?projekt=p1');

  // --- Anlegen, ohne Firma ---------------------------------------------------
  await p.click('#pendenz-dazu');
  await p.waitForSelector('#pd-text', { state:'visible' });
  ok('Dialog hat kein Fälligkeitsdatum', (await p.$$('#pd-datum, #pd-frist')).length === 0);
  ok('Dialog hat keine Priorität', (await p.$$('#pd-prio')).length === 0);
  ok('Firma ist optional vorbelegt', (await p.$eval('#pd-firma', e => e.value)) === '');
  await p.fill('#pd-text', 'Bauabschrankung Nordseite ergänzen');
  await p.click('#pd-ja');
  await p.waitForTimeout(900);
  ok('Zähler nach dem Erfassen bei vier', (await hubTitel(p)) === 'Pendenzen · 4 offen', await hubTitel(p));
  ok('Neuer Punkt steht in der Liste',
     (await hubZeilen(p)).includes('Bauabschrankung Nordseite ergänzen'));
  ok('Punkt ohne Firma zeigt keine Firma',
     await p.$$eval('#pendenzen .pj-pendenz', (e, t) => {
       const z = e.find(x => x.querySelector('.text').textContent.trim() === t);
       return !!z && !z.querySelector('.wer');
     }, 'Bauabschrankung Nordseite ergänzen'));

  // --- Anlegen, mit Firma ----------------------------------------------------
  await p.click('#pendenz-dazu');
  await p.waitForSelector('#pd-text', { state:'visible' });
  const firmenAuswahl = await p.$$eval('#pd-firma option', e => e.map(x => x.textContent.trim()));
  ok('Nur die Firmen dieses Projekts zur Auswahl',
     firmenAuswahl.length === 3 && firmenAuswahl.includes('Melk Durrer AG')
       && firmenAuswahl.includes('Slanzi Malen Gipsen AG'),
     firmenAuswahl.join(' | '));
  await p.fill('#pd-text', 'Gipserarbeiten Treppenhaus nachbessern');
  await p.selectOption('#pd-firma', { label:'Slanzi Malen Gipsen AG' });
  await p.click('#pd-ja');
  await p.waitForTimeout(900);
  ok('Zugeordnete Firma erscheint an der Pendenz',
     await p.$$eval('#pendenzen .pj-pendenz', (e, t) => {
       const z = e.find(x => x.querySelector('.text').textContent.trim() === t);
       return !!z && z.querySelector('.wer')?.textContent.trim() === 'Slanzi Malen Gipsen AG';
     }, 'Gipserarbeiten Treppenhaus nachbessern'));

  // --- Leerer Beschrieb wird abgefangen --------------------------------------
  await p.click('#pendenz-dazu');
  await p.waitForSelector('#pd-text', { state:'visible' });
  await p.click('#pd-ja');
  await p.waitForTimeout(400);
  ok('Ohne Beschrieb kommt eine Meldung', await p.locator('#pd-fehler').isVisible());
  await p.click('#pd-nein');
  await p.waitForTimeout(500);
  ok('Abbrechen legt nichts an', (await hubTitel(p)) === 'Pendenzen · 5 offen', await hubTitel(p));

  // --- Erledigen -------------------------------------------------------------
  await p.click('#pendenzen .pj-pendenz .haken');
  await p.waitForTimeout(900);
  ok('Zähler sinkt beim Abhaken', (await hubTitel(p)) === 'Pendenzen · 4 offen', await hubTitel(p));
  ok('Abgehakter Punkt fällt aus dem Auszug',
     !(await hubZeilen(p)).includes('Fassadengerüst Haus Flora abbauen'));

  await p.screenshot({ path:`${OUT}/${breite}-hub.png`, fullPage:true });

  // --- Die volle Liste -------------------------------------------------------
  await p.goto('http://127.0.0.1:8123/pendenzen.html?projekt=p1', { waitUntil:'networkidle' });
  await p.waitForTimeout(1000);

  const gruppen = await p.$$eval('#liste .pj-gruppe', e => e.map(x => x.textContent.trim()));
  ok('Zwei Gruppen: offen und erledigt',
     gruppen.length === 2 && gruppen[0].startsWith('Offen') && gruppen[1].startsWith('Erledigt'),
     gruppen.join(' | '));
  ok('Gruppenzahlen stimmen', gruppen[0] === 'Offen — 4' && gruppen[1] === 'Erledigt — 2', gruppen.join(' | '));

  const alleTexte = await p.$$eval('#liste .pj-pendenz .text', e => e.map(x => x.textContent.trim()));
  ok('Erledigte Punkte bleiben sichtbar',
     alleTexte.includes('Zufahrt Baustrasse ausbessern')
       && alleTexte.includes('Fassadengerüst Haus Flora abbauen'));
  ok('Erledigte sind durchgestrichen',
     await p.$$eval('#liste .pj-pendenz[data-erledigt="1"] .text',
       e => e.length === 2 && e.every(x => getComputedStyle(x).textDecorationLine.includes('line-through'))));
  ok('Titel nennt das Projekt',
     (await p.title()).startsWith('Pendenzen — WUB Garten Mille Fiori'), await p.title());
  ok('Zurück führt auf die Projektseite',
     (await p.getAttribute(breite >= 1024 ? '#d-zurueck' : '#m-zurueck', 'href'))
       === 'projekt-detail.html?projekt=p1');
  ok(breite >= 1024 ? 'Erfassen-Knopf in der Kopfzeile' : 'Erfassen-Knopf in der Fussleiste',
     await p.locator(breite >= 1024 ? '#d-neu' : '#m-neu').isVisible());

  // --- Wieder öffnen ----------------------------------------------------------
  await p.click('#liste .pj-pendenz[data-erledigt="1"] .haken');
  await p.waitForTimeout(900);
  ok('Erledigter Punkt lässt sich wieder öffnen',
     (await p.$$eval('#liste .pj-gruppe', e => e.map(x => x.textContent.trim())))[0] === 'Offen — 5');

  // --- Löschen ---------------------------------------------------------------
  await p.click('#liste .pj-pendenz [data-fort]');
  await p.waitForSelector('#f-ja', { state:'visible' });
  ok('Löschen fragt nach', (await p.textContent('#f-ja')).trim() === 'Löschen');
  await p.click('#f-ja');
  await p.waitForTimeout(900);
  ok('Nach dem Löschen ein Punkt weniger',
     (await p.$$eval('#liste .pj-gruppe', e => e.map(x => x.textContent.trim())))[0] === 'Offen — 4');
  ok('Pendenzen haben keinen Papierkorb-Knopf',
     (await p.$$('a[href="papierkorb-bereich.html?teil=pendenzen"]')).length === 0);

  await p.screenshot({ path:`${OUT}/${breite}-liste.png`, fullPage:true });

  // --- Kein seitlicher Überlauf ----------------------------------------------
  for (const seite of ['pendenzen.html?projekt=p1', 'projekt-detail.html?projekt=p1', 'mitarbeiter.html']) {
    await p.goto(`http://127.0.0.1:8123/${seite}`, { waitUntil:'networkidle' });
    await p.waitForTimeout(900);
    const ueber = await p.evaluate(() => {
      const b = [];
      for (const el of document.querySelectorAll('body *')) {
        const r = el.getBoundingClientRect();
        if (r.width && r.right > document.documentElement.clientWidth + 1) {
          b.push(`${el.className || el.tagName} ${Math.round(r.right)}`);
        }
      }
      return { breiter: document.documentElement.scrollWidth > document.documentElement.clientWidth, b: b.slice(0, 3) };
    });
    ok(`${seite.split('?')[0]} läuft nicht seitlich über`, !ueber.breiter && !ueber.b.length, ueber.b.join(' | '));
  }

  // --- Rollen-Abzeichen -------------------------------------------------------
  await p.goto('http://127.0.0.1:8123/mitarbeiter.html', { waitUntil:'networkidle' });
  await p.waitForTimeout(1000);

  const marken = await p.$$eval('#liste .pj-marke.stufe', e => e.map(x => x.textContent.trim()));
  ok('Jede Zeile trägt ein Abzeichen', marken.length === 3, marken.join(' | '));
  ok('Alle drei Stufen kommen vor',
     marken.join('|') === 'Geschäftsleitung|Entwickler|Mitarbeiter:in', marken.join('|'));
  ok('"Mitarbeitend" steht nirgends mehr',
     !(await p.textContent('body')).includes('Mitarbeitend'));
  ok('Die unterste Stufe heisst "Mitarbeiter:in"',
     !(await p.$$eval('#liste .pj-marke.stufe', e => e.map(x => x.textContent.trim())))
       .includes('Mitarbeiter'));
  ok('Abzeichen hebt sich vom Grund ab',
     await p.$eval('#liste .pj-marke.stufe', e =>
       getComputedStyle(e).backgroundColor !== getComputedStyle(e.closest('.br-zeile')).backgroundColor));

  // Lange Funktion plus Abzeichen: nichts darf sich überlappen oder
  // aus der Zeile geschoben werden.
  const zeilen = await p.$$eval('#liste .br-zeile', els => els.map(el => {
    const z = el.getBoundingClientRect();
    const f = el.querySelector('.unter');
    const m = el.querySelector('.pj-marke.stufe');
    const k = el.querySelector('.br-nur-handy');
    const kb = k && k.getBoundingClientRect().width ? k.getBoundingClientRect() : null;
    return {
      name: el.querySelector('.titel').textContent.trim(),
      funktionRechts: f.getBoundingClientRect().right,
      funktionGekuerzt: f.scrollWidth > f.clientWidth + 1,
      markeLinks: m.getBoundingClientRect().left,
      markeRechts: m.getBoundingClientRect().right,
      markeBreite: m.getBoundingClientRect().width,
      knoepfeLinks: kb ? kb.left : null,
      zeileRechts: z.right
    };
  }));
  ok('Funktion und Abzeichen überlappen nie',
     zeilen.every(z => z.funktionRechts <= z.markeLinks + 1),
     zeilen.filter(z => z.funktionRechts > z.markeLinks + 1).map(z => z.name).join(', '));
  ok('Abzeichen wird nicht gequetscht',
     zeilen.every(z => z.markeBreite > 50), zeilen.map(z => Math.round(z.markeBreite)).join(', '));
  ok('Abzeichen bleibt vor den Knöpfen',
     zeilen.every(z => z.knoepfeLinks === null || z.markeRechts <= z.knoepfeLinks + 1));
  ok('Abzeichen stehen alle am selben rechten Rand',
     new Set(zeilen.map(z => Math.round(z.markeRechts))).size === 1,
     zeilen.map(z => Math.round(z.markeRechts)).join(', '));
  ok('Lange Funktion wird abgeschnitten statt umgebrochen',
     zeilen.find(z => z.name === 'Jonas Zemp')?.funktionGekuerzt === true);

  // --- Die Regel steht an genau einer Stelle -----------------------------------
  const regel = await p.evaluate(() => ({
    gl: istBerechtigt('geschaeftsleitung'),
    ent: istBerechtigt('entwickler'),
    ma: istBerechtigt('mitarbeiter'),
    leer: istBerechtigt(null),
    unbekannt: istBerechtigt('irgendwas'),
    titelLeer: stufeTitel(null),
    titelAlt: stufeTitel('mitarbeitend')
  }));
  ok('Geschäftsleitung ist berechtigt', regel.gl);
  ok('Entwickler ist genauso berechtigt', regel.ent);
  ok('Mitarbeiter ist es nicht', !regel.ma);
  ok('Leere Stufe gilt als Mitarbeiter', !regel.leer && regel.titelLeer === 'Mitarbeiter:in');
  ok('Unbekannte Stufe berechtigt nicht', !regel.unbekannt);
  ok('Der alte Wert fällt auf Mitarbeiter zurück', regel.titelAlt === 'Mitarbeiter:in');

  // --- Im Detail ----------------------------------------------------------------
  for (const [nr, stufe] of [[1,'Geschäftsleitung'], [2,'Entwickler'], [3,'Mitarbeiter:in']]) {
    await p.goto('http://127.0.0.1:8123/mitarbeiter.html', { waitUntil:'networkidle' });
    await p.waitForTimeout(900);
    await p.click(`#liste .br-zeile:nth-child(${nr})`);
    await p.waitForTimeout(700);
    ok(`Detail zeigt ${stufe}`,
       (await p.$eval('#ma-ansicht .pj-marke.stufe', e => e.textContent.trim())) === stufe);
  }

  await p.click('#ma-bearbeiten');
  await p.waitForTimeout(600);
  ok('Formular hat kein Feld für die Stufe',
     (await p.$$('#ma-form #f-berechtigung, #ma-form select')).length === 0);
  const beschriftungen = await p.$$eval('#ma-form label', e => e.map(x => x.textContent.trim()));
  /* Das Abzeichen kam dazu und ist ausdrücklich nur ein Anzeigetext; die
     Stufe selbst bleibt aus dem Formular heraus. */
  ok('Formular nennt Name, Funktion, Telefon, E-Mail und das Abzeichen',
     beschriftungen.join('|') === 'Name|Funktion|Telefon|E-Mail|Abzeichen (freilassen für die Stufe)',
     beschriftungen.join('|'));

  // Name ändern und speichern: die Stufe darf das nicht verlieren.
  await p.fill('#f-rolle', 'Administration, Test');
  await p.click('#f-speichern');
  await p.waitForTimeout(1000);
  // Auf dem Handy schliesst sich das Sheet nach dem Speichern, also nochmal auf.
  if (breite < 1024) { await p.click('#liste .br-zeile:nth-child(3)'); await p.waitForTimeout(700); }
  ok('Stufe überlebt das Speichern',
     (await p.$eval('#ma-ansicht .pj-marke.stufe', e => e.textContent.trim())) === 'Mitarbeiter:in');

  await p.goto('http://127.0.0.1:8123/mitarbeiter.html', { waitUntil:'networkidle' });
  await p.waitForTimeout(900);
  await p.screenshot({ path:`${OUT}/${breite}-mitarbeiter.png`, fullPage:true });

  // --- Die Stufe schränkt nichts ein ------------------------------------------
  await p.goto('http://127.0.0.1:8123/start.html', { waitUntil:'networkidle' });
  await p.waitForTimeout(800);
  ok('Startseite zeigt weiterhin alle sechs Bereiche', (await p.$$('#raster a')).length === 6);

  await ctx.close();
}

await browser.close();
console.log(`\n=== ${gut} von ${gut+schlecht} Prüfungen bestanden ===`);
console.log('=== Fehler im Browser ===');
console.log(fehler.length ? [...new Set(fehler)].join('\n') : 'keine');
