/* Schritt 9: der Bereich Projekte und alles, was daran hängt.
   Geprüft wird die Liste aus Abschnitt 11 des Prompts. */
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import fs from 'node:fs';
const HIER = '/tmp/claude-0/-home-user-baujournal-triga/ad655f9d-451a-55b0-aac9-986e124c8f6f/scratchpad';
const OUT = `${HIER}/shots-pj`;
fs.rmSync(OUT, { recursive:true, force:true }); fs.mkdirSync(OUT, { recursive:true });
const STUB = fs.readFileSync(`${HIER}/stub.js`,'utf8');
const browser = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const fehler = [];
let gut = 0, schlecht = 0;
const ok = (n, b, zusatz='') => { b ? gut++ : schlecht++; console.log(`  ${b ? '✓' : '✗ FEHLER'}  ${n}${zusatz ? '  → ' + zusatz : ''}`); };

/* Genug Firmen, damit die Firmenpool-Seite auf dem Desktop wirklich
   scrollt — sonst prüft der Scrolltest nichts. */
const SAAT = JSON.parse(fs.readFileSync(`${HIER}/saat.json`,'utf8'));
SAAT.mitarbeiter.push(
  { id:'m4', name:'David Schmid', rolle:'Bau-/Projektleitung', telefon:'079 642 07 19', email:'david.schmid@triga.ch', erstellt_am:'2026-09-10T07:30:00.000Z' },
  { id:'m5', name:'Damian Stocker', rolle:'Bauleitung', telefon:'079 558 85 83', email:'damian.stocker@triga.ch', erstellt_am:'2026-09-10T07:30:00.000Z' }
);
for (let i = 1; i <= 40; i++) {
  SAAT.firmen.push({
    id: `fx${i}`, name: `Test Bau ${String(i).padStart(2,'0')} AG`, adresse: `Weg ${i}`,
    plz_ort: '6060 Sarnen', telefon: null, email: null, bkp_codes: ['211'],
    erstellt_am: '2026-01-01T08:00:00.000Z'
  });
}

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

for (const breite of [390, 1440]) {
  console.log(`\n=== Bereich Projekte (${breite}px) ===`);
  const { ctx, p } = await anmelden(breite);

  // --- Navigation ----------------------------------------------------------
  ok('Startseite hat sechs Kacheln', (await p.$$('#raster a')).length === 6);
  ok('Projekte-Kachel zwischen Mitarbeiter und Baujournal',
     (await p.$$eval('#raster a', e => e.map(x => x.getAttribute('href')))).join('|')
       === 'mitarbeiter.html|projekte-bereich.html|projekte.html|firmenpool.html|dokumente.html|chat.html');
  if (breite >= 1024) {
    // Acht, nicht sechs: Feed und Formulare stehen in der Leiste, aber nicht im Kachelraster.
    ok('Seitenleiste hat acht Bereiche', (await p.$$('.tr-sidebar .tr-nav')).length === 8);
    ok('Suchfeld in der Leiste', await p.locator('.tr-suche input').isVisible());
  } else {
    ok('Lupe auf der Startseite', await p.locator('a[href="suche.html"]').isVisible());
  }

  await p.click('#raster a[href="projekte-bereich.html"]');
  await p.waitForURL('**/projekte-bereich.html'); await p.waitForTimeout(1000);

  // --- Übersicht -----------------------------------------------------------
  ok('zwei aktive Projekte', (await p.$$('#liste .pj-karte')).length === 2);
  ok('Karte nennt Adresse und Bauherrschaft',
     (await p.textContent('#liste')).includes('StImmobilia GmbH'));
  ok('Karte zählt Firmen, Mitarbeiter, Ordner',
     /2 Firmen[\s\S]*2 Mitarbeiter[\s\S]*1 Ordner/.test(await p.textContent('#liste')));
  ok('Statusmarke sichtbar', (await p.$$('#liste .pj-marke')).length === 2);
  await p.screenshot({ path:`${OUT}/${breite}-uebersicht.png`, fullPage:true });

  await p.click('#filter .pj-chip[data-filter="planung"]'); await p.waitForTimeout(300);
  ok('Filter In Planung', (await p.$$('#liste .pj-karte')).length === 1);
  await p.click('#filter .pj-chip[data-filter="archiviert"]'); await p.waitForTimeout(300);
  ok('Filter Archiviert', (await p.$$('#liste .pj-karte')).length === 1);
  await p.click('#filter .pj-chip[data-filter="alle"]'); await p.waitForTimeout(300);

  // --- Neues Projekt anlegen ------------------------------------------------
  await p.locator(breite>=1024 ? '#d-neu' : '#m-neu').click(); await p.waitForTimeout(500);
  await p.fill('#pf-name', 'Sanierung Schulhaus Kerns');
  await p.fill('#pf-standort', 'Schulhausstrasse 4, 6064 Kerns');
  await p.fill('#pf-bauherrschaft', 'Einwohnergemeinde Kerns');
  await p.fill('#pf-beschrieb', 'Gesamtsanierung Fassade und Fenster.');
  await p.click('#pf-status .pj-chip[data-status="planung"]');
  await p.click('#pf-ja');
  await p.waitForURL('**/projekt-detail.html**', { timeout:10000 });
  await p.waitForTimeout(1200);
  ok('nach dem Anlegen direkt auf der Projektseite',
     (await p.textContent(breite>=1024 ? '#d-name' : '#m-name')) === 'Sanierung Schulhaus Kerns');
  ok('Stammdaten übernommen', (await p.textContent('#stammdaten')).includes('Schulhausstrasse 4'));
  ok('Beschrieb sichtbar', (await p.textContent('#stammdaten')).includes('Gesamtsanierung'));

  // --- Bestehendes Projekt: Mille Fiori bleibt heil -------------------------
  await p.goto('http://127.0.0.1:8123/projekt-detail.html?projekt=p1', { waitUntil:'networkidle' });
  await p.waitForTimeout(1300);
  ok('Mille Fiori lädt', (await p.textContent(breite>=1024 ? '#d-name' : '#m-name')).includes('Mille Fiori'));
  ok('Unternehmerliste mit zwei Firmen', (await p.textContent('#unternehmer')).includes('Unternehmerliste · 2'));
  ok('Gewerk und Summe in der Liste',
     (await p.textContent('#unternehmer')).includes('211 · Baumeisterarbeiten')
     && /CHF 1['\u2019]150['\u2019]000/.test(await p.textContent('#unternehmer')));
  ok('zwei zuständige Mitarbeiter mit Rolle',
     (await p.textContent('#personen')).includes('Bauleiter')
     && (await p.textContent('#personen')).includes('Unterstützung'));
  ok('letzter Baujournal-Eintrag sichtbar', (await p.textContent('#journal')).includes('Decke über UG'));
  ok('zugeordneter Ordner sichtbar', (await p.textContent('#dokumente')).includes('Pläne'));
  await p.screenshot({ path:`${OUT}/${breite}-projektseite.png`, fullPage:true });

  // Stammdaten ändern und prüfen, dass Kontrollpunkte und Gebäude bleiben
  const vorher = await p.evaluate(() => {
    const db = JSON.parse(sessionStorage.getItem('__stub_db'));
    const pr = db.projekte.find(x => x.id === 'p1');
    return { kp: pr.kontrollpunkte.length, geb: pr.gebaeude.length,
             eintraege: db.eintraege.filter(e => e.projekt_id === 'p1').length };
  });
  await p.locator(breite>=1024 ? '#d-bearbeiten' : '#m-bearbeiten').click();
  await p.waitForTimeout(500);
  await p.fill('#pf-beschrieb', '5 Mehrfamilienhäuser, 37 Wohnungen.');
  await p.click('#pf-ja'); await p.waitForTimeout(1200);
  ok('Beschrieb gespeichert', (await p.textContent('#stammdaten')).includes('37 Wohnungen'));
  const nachher = await p.evaluate(() => {
    const db = JSON.parse(sessionStorage.getItem('__stub_db'));
    const pr = db.projekte.find(x => x.id === 'p1');
    return { kp: pr.kontrollpunkte.length, geb: pr.gebaeude.length,
             eintraege: db.eintraege.filter(e => e.projekt_id === 'p1').length };
  });
  ok('Kontrollpunkte unverändert', vorher.kp === nachher.kp && nachher.kp === 5, `${vorher.kp} -> ${nachher.kp}`);
  ok('Gebäude unverändert', vorher.geb === nachher.geb && nachher.geb === 5, `${vorher.geb} -> ${nachher.geb}`);
  ok('Einträge unverändert', vorher.eintraege === nachher.eintraege, `${vorher.eintraege} -> ${nachher.eintraege}`);

  // --- Firma zur Unternehmerliste ------------------------------------------
  await p.click('#firma-dazu'); await p.waitForTimeout(600);
  await p.fill('#ef-suche', 'Elektro Huwyler');
  await p.waitForTimeout(300);
  await p.click('#ef-liste [data-firma]');
  await p.waitForTimeout(300);
  ok('Gewerk aus der Firma vorbelegt', (await p.inputValue('#ef-gewerk')) === '230');
  await p.click('#ef-status .pj-chip[data-status="offeriert"]');
  await p.fill('#ef-summe', "248'500");
  await p.click('#ef-ja'); await p.waitForTimeout(1300);
  ok('Firma in der Unternehmerliste', (await p.textContent('#unternehmer')).includes('Elektro Huwyler AG'));
  ok('Auftragssumme in Schweizer Schreibweise', /CHF 248['\u2019]500/.test(await p.textContent('#unternehmer')));
  ok('Status Offeriert', (await p.textContent('#unternehmer')).includes('Offeriert'));

  // --- Rückwärtsanzeige auf der Firmenseite --------------------------------
  const zurFirma = await p.locator('#unternehmer a[href*="firmenpool.html?firma="]').first().getAttribute('href');
  await p.goto('http://127.0.0.1:8123/' + zurFirma, { waitUntil:'networkidle' });
  await p.waitForTimeout(1300);
  ok('Firmenseite zeigt den Projekte-Abschnitt', (await p.textContent('#firma-links')).includes('Projekte · 1'));
  ok('mit Projektname und Status',
     (await p.textContent('#firma-links')).includes('WUB Garten Mille Fiori')
     && (await p.textContent('#firma-links')).includes('Beauftragt'));
  ok('Hinweis auf den einen Bearbeitungsort',
     (await p.textContent('#firma-links')).includes('auf der Projektseite'));
  ok('Zuordnung hier nicht bearbeitbar',
     (await p.locator('#firma-links .fp-projekt button').count()) === 0);

  // --- Notiz mit und ohne Projektbezug -------------------------------------
  await p.fill('#notiz-text', 'Termin vor Ort, betrifft Haus Lilly.');
  await p.selectOption('#notiz-projekt', { label: 'WUB Garten Mille Fiori' });
  await p.click('#notiz-speichern'); await p.waitForTimeout(1300);
  ok('Notiz mit Projektbezug angelegt',
     (await p.locator('#notiz-liste a[href*="projekt-detail.html"]').count()) === 1);
  await p.waitForTimeout(1100);
  await p.fill('#notiz-text', 'Allgemein: gute Erreichbarkeit.');
  await p.click('#notiz-speichern'); await p.waitForTimeout(1300);
  ok('Notiz ohne Projektbezug angelegt', (await p.$$('#notiz-liste .fp-notiz')).length === 3);
  ok('nur eine der beiden trägt ein Projekt',
     (await p.locator('#notiz-liste a[href*="projekt-detail.html"]').count()) === 1);
  await p.screenshot({ path:`${OUT}/${breite}-firma-projekte.png`, fullPage:true });

  // --- Mitarbeiter zuordnen -------------------------------------------------
  await p.goto('http://127.0.0.1:8123/projekt-detail.html?projekt=p1', { waitUntil:'networkidle' });
  await p.waitForTimeout(1300);
  await p.click('#person-dazu'); await p.waitForTimeout(600);
  const rollen = await p.$$eval('#mf-vorschlag .pj-chip', e => e.map(x => x.dataset.rolle));
  ok('drei Rollen zur Auswahl, Projektleiter dabei',
     rollen.join('|') === 'Bauleiter|Projektleiter|Unterstützung', rollen.join('|'));
  await p.click('#mf-liste [data-wer]');
  await p.click('#mf-vorschlag .pj-chip[data-rolle="Projektleiter"]');
  ok('Der Vorschlag landet im Freitextfeld',
     (await p.inputValue('#mf-rolle')) === 'Projektleiter');
  await p.click('#mf-ja'); await p.waitForTimeout(1300);
  ok('dritter Mitarbeiter zugeordnet', (await p.$$('#personen .pj-zeile')).length === 3);
  ok('mit der Rolle Projektleiter', (await p.textContent('#personen')).includes('Projektleiter'));

  await p.click('#personen [data-p-weg]'); await p.waitForTimeout(600);
  ok('Rückfrage nennt den unberührten Mitarbeiter-Eintrag',
     (await p.locator('.sheet').last().textContent()).includes('bleibt unberührt'));
  await p.click('#f-ja'); await p.waitForTimeout(1300);
  ok('Zuordnung entfernt', (await p.$$('#personen .pj-zeile')).length === 2);

  // --- Ordner einem Projekt zuordnen ---------------------------------------
  await p.goto('http://127.0.0.1:8123/dokumente.html', { waitUntil:'networkidle' });
  await p.waitForTimeout(1200);
  ok('zugeordneter Ordner nennt sein Projekt',
     (await p.textContent('#ordner')).includes('WUB Garten Mille Fiori'));
  await p.locator('.dk-ordnerzeile', { hasText:'Verträge' }).locator('[data-um]').click();
  await p.waitForTimeout(500);
  await p.selectOption('#of-projekt', { label: 'WUB Garten Mille Fiori' });
  await p.click('#of-ja'); await p.waitForTimeout(1300);
  ok('zweiter Ordner zugeordnet',
     (await p.$$eval('#ordner .dk-projekt', e => e.length)) === 2);

  await p.locator('.dk-ordnerzeile', { hasText:'Pläne' }).click();
  await p.waitForTimeout(900);
  ok('Ordnerkopf verlinkt das Projekt',
     (await p.locator('#detail a[href*="projekt-detail.html"]').count()) === 1);
  ok('Dateien im Ordner sichtbar', (await p.$$('#detail .dk-datei')).length === 2);

  await p.goto('http://127.0.0.1:8123/projekt-detail.html?projekt=p1', { waitUntil:'networkidle' });
  await p.waitForTimeout(1300);
  ok('Projektseite zeigt jetzt beide Ordner', (await p.$$('#dokumente .pj-zeile')).length === 2);

  // --- Globale Suche --------------------------------------------------------
  await p.goto('http://127.0.0.1:8123/suche.html', { waitUntil:'networkidle' });
  await p.waitForTimeout(900);
  const feld = breite >= 1024 ? '#d-q' : '#m-q';
  await p.fill(feld, 'sarnen'); await p.waitForTimeout(900);
  const gruppen = await p.$$eval('.su-gruppe', e => e.map(x => x.textContent.split('—')[0].trim()));
  ok('Treffer aus mehreren Bereichen', gruppen.length >= 2, gruppen.join(', '));
  await p.fill(feld, 'mille'); await p.waitForTimeout(900);
  ok('Projekt gefunden', (await p.textContent('#ergebnis')).includes('WUB Garten Mille Fiori'));
  await p.fill(feld, 'zemp'); await p.waitForTimeout(900);
  ok('Mitarbeiter gefunden', (await p.textContent('#ergebnis')).includes('Mitarbeiter'));
  await p.fill(feld, 'grundriss'); await p.waitForTimeout(900);
  ok('Datei gefunden', (await p.textContent('#ergebnis')).includes('Grundriss Haus A.pdf'));
  await p.fill(feld, 'durrer'); await p.waitForTimeout(900);
  ok('Firma gefunden', (await p.textContent('#ergebnis')).includes('Melk Durrer AG'));
  ok('Sprung zur Firma verlinkt',
     (await p.locator('#ergebnis a[href*="firmenpool.html?firma="]').count()) >= 1);
  await p.fill(feld, 'xyzniemals'); await p.waitForTimeout(900);
  ok('nichts gefunden wird gesagt', (await p.textContent('#ergebnis')).includes('Nichts gefunden'));
  await p.fill(feld, 'Bau, Holz (50%)'); await p.waitForTimeout(900);
  ok('Sonderzeichen brechen die Suche nicht', !(await p.textContent('#ergebnis')).includes('undefined'));
  await p.screenshot({ path:`${OUT}/${breite}-suche.png`, fullPage:true });

  // --- Scrollverhalten Firmenpool (nur Desktop) ----------------------------
  if (breite >= 1024) {
    await p.goto('http://127.0.0.1:8123/firmenpool.html', { waitUntil:'networkidle' });
    await p.waitForTimeout(1400);
    const scrollbar = await p.evaluate(() => document.documentElement.scrollHeight > window.innerHeight + 50);
    ok('Seite ist lang genug zum Scrollen', scrollbar);
    ok('Kategorienspalte klebt', (await p.$eval('.fp-kategorien', e => getComputedStyle(e).position)) === 'sticky');
    await p.evaluate(() => window.scrollTo(0, 1200));
    await p.waitForTimeout(500);
    const knopf = await p.evaluate(() => {
      const b = document.querySelector('#firma-neu').getBoundingClientRect();
      return { unten: Math.round(b.bottom), sicht: window.innerHeight };
    });
    ok('"Firma erfassen" bleibt sichtbar', knopf.unten > 0 && knopf.unten <= knopf.sicht,
       `unten ${knopf.unten}, Fenster ${knopf.sicht}`);
    ok('Kategorienliste scrollt für sich',
       (await p.$eval('.fp-kat-liste', e => getComputedStyle(e).overflowY)) === 'auto');
    await p.screenshot({ path:`${OUT}/${breite}-firmenpool-gescrollt.png` });
  }

  await ctx.close();
}

await browser.close();
console.log(`\n=== ${gut} von ${gut+schlecht} Prüfungen bestanden ===`);
console.log('=== Fehler im Browser ===');
console.log(fehler.length ? [...new Set(fehler)].join('\n') : 'keine');
