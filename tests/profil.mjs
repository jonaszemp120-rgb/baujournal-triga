/* Schritt 11: Zoom-Fix, Mein Profil, eigene Unterschrift.
   Geprüft wird die Liste aus Abschnitt 4 der Vorgabe. */
import { chromium, HIER, SERVER } from './umgebung.mjs';
import fs from 'node:fs';
const OUT = `${HIER}/ausgabe/shots-pr`;
fs.rmSync(OUT, { recursive:true, force:true }); fs.mkdirSync(OUT, { recursive:true });
const STUB = fs.readFileSync(`${HIER}/stub.js`,'utf8');
const SAAT = JSON.parse(fs.readFileSync(`${HIER}/saat.json`,'utf8'));
const browser = await chromium.launch();
const fehler = [];
let gut = 0, schlecht = 0;
const ok = (n, b, zusatz='') => { b ? gut++ : schlecht++; console.log(`  ${b ? '✓' : '✗ FEHLER'}  ${n}${zusatz ? '  → ' + zusatz : ''}`); };

const SEITEN = [
  'index.html', 'start.html', 'profil.html', 'mitarbeiter.html', 'projekte-bereich.html',
  'projekt-detail.html?projekt=p1', 'pendenzen.html?projekt=p1', 'projekte.html',
  'firmenpool.html', 'dokumente.html', 'suche.html', 'papierkorb-bereich.html',
  'projekt.html', 'projekt-start.html?id=p1', 'journal.html?projekt=p1',
  'eintrag.html?id=e1', 'papierkorb.html?projekt=p1'
];

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
  await p.goto(`${SERVER}/index.html`, { waitUntil:'networkidle' });
  await p.fill('#email','test.durchlauf@triga.ch'); await p.fill('#pw','TestDurchlauf!2026');
  await p.click('#btn'); await p.waitForURL('**/start.html'); await p.waitForTimeout(800);
  return { ctx, p };
}

/* Eine Unterschrift ins Feld malen. */
async function male(p, feld = '#us-feld') {
  const k = await p.locator(feld).boundingBox();
  const y = k.y + k.height / 2;
  await p.mouse.move(k.x + k.width * 0.18, y);
  await p.mouse.down();
  for (let i = 0; i <= 40; i++) {
    const t = i / 40;
    await p.mouse.move(k.x + k.width * (0.18 + 0.62 * t),
                       y + Math.sin(t * Math.PI * 3) * k.height * 0.26);
  }
  await p.mouse.up();
}

/* ===== 1. Zoom ============================================================ */

console.log('\n=== Zoom abgeschaltet ===');
{
  const { ctx, p } = await anmelden(390);

  for (const seite of SEITEN) {
    await p.goto(`${SERVER}/${seite}`, { waitUntil:'domcontentloaded' });
    const m = await p.$eval('meta[name="viewport"]', e => e.content);
    const kurz = seite.split('?')[0];
    ok(`${kurz}: kein Hineinzoomen`,
       /maximum-scale=1\b/.test(m) && /user-scalable=no\b/.test(m), m);
    ok(`${kurz}: Breite und Safe-Area unverändert`,
       /width=device-width/.test(m) && /viewport-fit=cover/.test(m));
  }

  await p.goto(`${SERVER}/start.html`, { waitUntil:'networkidle' });
  ok('Doppeltipp-Zoom per touch-action abgestellt',
     (await p.evaluate(() => getComputedStyle(document.documentElement).touchAction)) === 'manipulation');
  ok('Schriftgrössen bleiben unangetastet',
     (await p.evaluate(() => getComputedStyle(document.documentElement).webkitTextSizeAdjust ?? 'auto')) !== 'none',
     'kein text-size-adjust:none, die Systemvergrösserung greift weiter');

  const manifest = await (await fetch(`${SERVER}/manifest.json`)).json();
  ok('Manifest läuft im Vollbild', manifest.display === 'standalone', manifest.display);

  await ctx.close();
}

/* ===== 2. Mein Profil ===================================================== */

for (const breite of [390, 1440]) {
  console.log(`\n=== Mein Profil (${breite}px) ===`);
  const { ctx, p } = await anmelden(breite);

  // --- Zugang --------------------------------------------------------------
  if (breite >= 1024) {
    await p.click('.tr-konto');
    await p.waitForTimeout(500);
    ok('Konto-Feld der Seitenleiste führt zu Mein Profil',
       (await p.getAttribute('.sheet a[href="profil.html"]', 'href')) === 'profil.html');
    await p.click('.sheet a[href="profil.html"]');
  } else {
    await p.click('#konto');
    await p.waitForTimeout(500);
    ok('Startseite führt zu Mein Profil',
       await p.locator('.sheet a[href="profil.html"]').isVisible());
    await p.click('.sheet a[href="profil.html"]');
  }
  await p.waitForURL('**/profil.html');
  await p.waitForTimeout(1000);

  ok('Seite heisst Mein Profil', (await p.title()).startsWith('Mein Profil'), await p.title());

  // --- Die eigene Zeile ----------------------------------------------------
  ok('Eigener Name steht oben',
     (await p.textContent('.pr-kopfkarte .name')).trim() === 'Jonas Zemp');
  ok('Eigene Funktion steht dabei',
     (await p.textContent('.pr-kopfkarte .rolle')).trim() === 'Bau-/Projektleitung, Inhaber, Mitglied der GL');
  ok('Berechtigungsstufe wird gezeigt',
     (await p.textContent('.pr-kopfkarte .pj-marke')).trim() === 'Entwickler');
  ok('Telefon kommt aus der Mitarbeiter-Zeile',
     (await p.inputValue('#p-telefon')) === '079 000 00 01');
  ok('E-Mail kommt aus der Mitarbeiter-Zeile',
     (await p.inputValue('#p-email')) === 'jonas.zemp@triga.ch');
  ok('Name ist hier nicht editierbar', (await p.$$('#p-name')).length === 0);
  ok('Funktion ist hier nicht editierbar', (await p.$$('#p-rolle')).length === 0);
  ok('Hinweis nennt den Grund',
     (await p.textContent('.pr-hinweis')).includes('Administration'));

  await p.screenshot({ path:`${OUT}/${breite}-profil-leer.png`, fullPage:true });

  // --- Ändern --------------------------------------------------------------
  await p.fill('#p-telefon', '079 111 22 33');
  await p.fill('#p-email', 'j.zemp@triga.ch');
  await p.click('#p-speichern');
  await p.waitForTimeout(1000);
  ok('Geänderte Nummer steht nach dem Speichern da',
     (await p.inputValue('#p-telefon')) === '079 111 22 33');

  // Genau eine Zeile in der Datenbank, keine zweite Kopie.
  const zeilen = await p.evaluate(() => {
    const d = JSON.parse(sessionStorage.getItem('__stub_db'));
    return d.mitarbeiter.map(m => ({ name:m.name, telefon:m.telefon, email:m.email, user:m.user_id }));
  });
  const jz = zeilen.filter(z => z.name === 'Jonas Zemp');
  ok('Es gibt weiterhin genau eine Zeile zu dieser Person', jz.length === 1);
  ok('Geändert wurde genau diese Zeile',
     jz[0].telefon === '079 111 22 33' && jz[0].email === 'j.zemp@triga.ch');
  ok('Fremde Zeilen blieben unberührt',
     zeilen.filter(z => z.name !== 'Jonas Zemp')
           .every(z => z.telefon !== '079 111 22 33' && z.email !== 'j.zemp@triga.ch'));

  // --- Und zwar überall ----------------------------------------------------
  await p.goto(`${SERVER}/mitarbeiter.html`, { waitUntil:'networkidle' });
  await p.waitForTimeout(1000);
  const jzNr = await p.$$eval('#liste .br-zeile', (els, name) => {
    const z = els.find(e => e.querySelector('.titel').textContent.trim() === name);
    const tel = z?.querySelector('a[href^="tel:"]');
    const mail = z?.querySelector('a[href^="mailto:"]');
    return { tel: tel?.getAttribute('href') || null, mail: mail?.getAttribute('href') || null };
  }, 'Jonas Zemp');
  if (breite < 1024) {
    ok('Mitarbeiter-Liste wählt die neue Nummer', jzNr.tel === 'tel:0791112233', jzNr.tel);
    ok('Mitarbeiter-Liste schreibt an die neue Adresse', jzNr.mail === 'mailto:j.zemp@triga.ch', jzNr.mail);
  }
  // Im Detail stehen beide in jeder Breite.
  const nr = await p.$$eval('#liste .br-zeile', (els, name) =>
    els.findIndex(e => e.querySelector('.titel').textContent.trim() === name), 'Jonas Zemp');
  await p.click(`#liste .br-zeile:nth-child(${nr + 1})`);
  await p.waitForTimeout(700);
  const detail = await p.textContent('#ma-ansicht');
  ok('Mitarbeiter-Detail zeigt die neue Nummer', detail.includes('079 111 22 33'));
  ok('Mitarbeiter-Detail zeigt die neue Adresse', detail.includes('j.zemp@triga.ch'));

  // Auch dort, wo die Person einem Projekt zugeordnet ist.
  await p.goto(`${SERVER}/projekt-detail.html?projekt=p1`, { waitUntil:'networkidle' });
  await p.waitForTimeout(1200);
  ok('Projektseite kennt die Person weiterhin',
     (await p.textContent('#personen')).includes('Adrian Zemp'));

  // --- Fremde Daten sind über diese Seite nicht erreichbar -----------------
  await p.goto(`${SERVER}/profil.html?id=m2&mitarbeiter=m2`, { waitUntil:'networkidle' });
  await p.waitForTimeout(1000);
  ok('Eine ID in der Adresszeile ändert nichts',
     (await p.textContent('.pr-kopfkarte .name')).trim() === 'Jonas Zemp');
  ok('Fremde Kontaktdaten erscheinen nicht',
     !(await p.textContent('#inhalt')).includes('silvia.weber@triga.ch'));

  const abfrage = await p.evaluate(async () => {
    // So, wie die Seite ihre Zeile sucht: über das Konto, nicht über eine ID.
    const { data } = await sb.from('mitarbeiter').select('id, name').eq('user_id', 'u9-silvia');
    return data.map(d => d.name);
  });
  ok('Die Zeile einer anderen Person hängt an deren Konto',
     abfrage.join() === 'Silvia Weber', abfrage.join());

  await ctx.close();
}

/* ===== 3. Unterschrift ==================================================== */

for (const breite of [390, 1440]) {
  console.log(`\n=== Unterschrift (${breite}px) ===`);
  const { ctx, p } = await anmelden(breite);
  await p.goto(`${SERVER}/profil.html`, { waitUntil:'networkidle' });
  await p.waitForTimeout(1000);

  ok('Leerzustand sagt, dass noch nichts da ist',
     (await p.textContent('.pr-unterschrift .leer')).includes('Noch keine Unterschrift'));
  ok('Knopf heisst beim ersten Mal "Unterschrift erfassen"',
     (await p.textContent('#p-unterschreiben')).trim() === 'Unterschrift erfassen');
  ok('Ohne Unterschrift gibt es nichts zu entfernen', (await p.$$('#p-us-weg')).length === 0);

  // Ein leeres Feld lässt sich nicht übernehmen.
  await p.click('#p-unterschreiben');
  await p.waitForSelector('#us-feld', { state:'visible' });
  await p.waitForTimeout(400);
  await p.click('#us-ja');
  await p.waitForTimeout(400);
  ok('Leeres Feld wird nicht übernommen', await p.locator('#us-feld').isVisible());
  await p.click('#us-nein');
  await p.waitForTimeout(400);
  ok('Abbrechen speichert nichts', (await p.$$('.pr-unterschrift img')).length === 0);

  // Erfassen.
  await p.click('#p-unterschreiben');
  await p.waitForSelector('#us-feld', { state:'visible' });
  await p.waitForTimeout(400);
  await male(p);
  await p.screenshot({ path:`${OUT}/${breite}-unterschreiben.png` });
  await p.click('#us-ja');
  await p.waitForTimeout(1000);

  ok('Unterschrift steht jetzt im Profil', (await p.$$('.pr-unterschrift img')).length === 1);
  const erste = await p.$eval('.pr-unterschrift img', e => e.src);
  ok('Gespeichert wurde ein PNG', erste.startsWith('data:image/png;base64,'), erste.slice(0, 30));
  ok('Zugeschnitten statt ganzes Feld', erste.length < 120000, `${Math.round(erste.length/1024)} KB`);
  ok('Knopf heisst jetzt "Unterschrift neu erfassen"',
     (await p.textContent('#p-unterschreiben')).trim() === 'Unterschrift neu erfassen');
  ok('Erfassungsdatum steht dabei',
     (await p.textContent('#inhalt')).includes('Erfasst am'));
  ok('Jetzt lässt sie sich auch entfernen', (await p.$$('#p-us-weg')).length === 1);
  await p.screenshot({ path:`${OUT}/${breite}-profil-unterschrieben.png`, fullPage:true });

  // Ersetzen überschreibt, es gibt keine Historie.
  await p.click('#p-unterschreiben');
  await p.waitForSelector('#us-feld', { state:'visible' });
  await p.waitForTimeout(400);
  const k = await p.locator('#us-feld').boundingBox();
  await p.mouse.move(k.x + k.width * 0.25, k.y + k.height * 0.3);
  await p.mouse.down();
  await p.mouse.move(k.x + k.width * 0.75, k.y + k.height * 0.7);
  await p.mouse.up();
  await p.click('#us-ja');
  await p.waitForTimeout(1000);
  const zweite = await p.$eval('.pr-unterschrift img', e => e.src);
  ok('Die neue Unterschrift ersetzt die alte', zweite !== erste);
  ok('Es gibt weiterhin genau eine', (await p.$$('.pr-unterschrift img')).length === 1);
  const gespeichert = await p.evaluate(() => {
    const d = JSON.parse(sessionStorage.getItem('__stub_db'));
    const m = d.mitarbeiter.find(x => x.name === 'Jonas Zemp');
    return { hat: !!m.unterschrift, felder: Object.keys(m).filter(k => k.startsWith('unterschrift')) };
  });
  ok('Keine Historie in der Datenbank',
     gespeichert.hat && gespeichert.felder.join() === 'unterschrift,unterschrift_am',
     gespeichert.felder.join());

  // --- Was spätere Schritte davon sehen ------------------------------------
  const mit = await p.evaluate(() => meineUnterschrift());
  ok('meineUnterschrift() liefert das Bild', !!mit.bild && mit.name === 'Jonas Zemp');
  ok('Der fertige Block zeigt es auch',
     (await p.evaluate(u => unterschriftBlock(u), mit)).includes('<img'));

  // Und ohne hinterlegte Unterschrift: ein Hinweis, kein Fehler.
  await p.click('#p-us-weg');
  await p.waitForSelector('#f-ja', { state:'visible' });
  await p.click('#f-ja');
  await p.waitForTimeout(1000);
  ok('Entfernen führt zurück in den Leerzustand',
     (await p.$$('.pr-unterschrift img')).length === 0);

  const ohne = await p.evaluate(() => meineUnterschrift());
  ok('Ohne Unterschrift kommt kein Fehler, sondern ein Hinweis',
     ohne.bild === null && ohne.fehlt === true);
  ok('Der Hinweis schickt ins Profil', ohne.grund.includes('Mein Profil'), ohne.grund);
  const block = await p.evaluate(u => unterschriftBlock(u), ohne);
  ok('Der Block verlinkt das Profil', block.includes('profil.html') && !block.includes('<img'));

  await ctx.close();
}

await browser.close();
console.log(`\n=== ${gut} von ${gut+schlecht} Prüfungen bestanden ===`);
console.log('=== Fehler im Browser ===');
console.log(fehler.length ? [...new Set(fehler)].join('\n') : 'keine');
