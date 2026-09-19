import { chromium, HIER, SERVER } from './umgebung.mjs';
import fs from 'node:fs';
const OUT = `${HIER}/ausgabe/shots-ma`;
fs.rmSync(OUT, { recursive:true, force:true }); fs.mkdirSync(OUT, { recursive:true });
const STUB = fs.readFileSync('./stub.js','utf8');
const browser = await chromium.launch();
const fehler = [];
const ok = (n, b) => console.log(`  ${b ? '✓' : '✗ FEHLER'}  ${n}`);

async function lauf(name, breite) {
  const ctx = await browser.newContext({ viewport:{width:breite,height:breite>=1024?900:844}, deviceScaleFactor:1, locale:'de-CH', serviceWorkers:'block' });
  await ctx.route('**/vendor/supabase-js-2.58.0.js', r => r.fulfill({status:200,contentType:'application/javascript',body:STUB}));
  /* Die eigene Zeile mit erweiterter Stufe, so wie es in der echten
     Datenbank aussieht: das angemeldete Konto gehoert zu einer Person, und
     Anlegen, Bearbeiten und Papierkorb setzen seit dem Schreibschutz auf
     mitarbeiter genau das voraus. */
  await ctx.addInitScript(() => { if (sessionStorage.getItem('__stub_db')) return; sessionStorage.setItem('__stub_db', JSON.stringify({
    profile: [{ id: 'u1', name: 'Jonas Zemp' }],
    projekte: [], eintraege: [], eintraege_korrekturen: [],
    mitarbeiter: [{ id: 'ich', name: 'Jonas Zemp', rolle: 'Bauleitung',
                    user_id: 'u1', berechtigung: 'entwickler',
                    erstellt_am: '2026-09-01T07:00:00.000Z' }]
  })); });
  const p = await ctx.newPage();
  p.on('console', m => { if (m.type()==='error') fehler.push(`${name}: ${m.text()}`); });
  p.on('pageerror', e => fehler.push(`${name}: ${e.message}`));
  console.log(`\n=== ${name} (${breite}px) ===`);

  await p.goto(`${SERVER}/index.html`, { waitUntil:'networkidle' });
  await p.fill('#email','test.durchlauf@triga.ch'); await p.fill('#pw','TestDurchlauf!2026');
  await p.click('#btn'); await p.waitForURL('**/start.html');
  await p.waitForSelector('#raster a[href="mitarbeiter.html"]');
  await p.click('#raster a[href="mitarbeiter.html"]');
  await p.waitForURL('**/mitarbeiter.html'); await p.waitForTimeout(900);
  ok('Bereich lädt, nur das eigene Konto', (await p.$$('#liste .br-zeile')).length === 1);

  // Anlegen
  await p.locator('[data-neu]:visible').first().click();
  await p.waitForTimeout(500);
  await p.fill('#f-name','Thomas Zürcher');
  await p.fill('#f-rolle','Projektleiter');
  await p.fill('#f-telefon','+41 (41) 660 12 34');
  await p.fill('#f-email','thomas.zuercher@triga.ch');
  await p.click('#f-speichern'); await p.waitForTimeout(1200);
  ok('Mitarbeiter angelegt', (await p.$$('#liste .br-zeile')).length === 2);

  for (const [n, r] of [['Silvia Weber','Administration'], ['Marco Delea','Bauleiter']]) {
    await p.locator('[data-neu]:visible').first().click(); await p.waitForTimeout(400);
    await p.fill('#f-name', n); await p.fill('#f-rolle', r);
    await p.click('#f-speichern'); await p.waitForTimeout(900);
  }
  ok('vier Einträge, alphabetisch', (await p.$$eval('#liste .titel', e => e.map(x=>x.textContent)))
      .join('|') === 'Jonas Zemp|Marco Delea|Silvia Weber|Thomas Zürcher');

  // Telefon- und Mailziele
  await p.locator('#liste .br-zeile', { hasText: 'Thomas Zürcher' }).click();
  await p.waitForTimeout(600);
  const tel = await p.locator('#ma-ansicht a[href^="tel:"]').getAttribute('href');
  const mail = await p.locator('#ma-ansicht a[href^="mailto:"]').getAttribute('href');
  ok('Telefonlink ohne Sonderzeichen', tel === 'tel:+41416601234');
  ok('Mailto-Link stimmt', mail === 'mailto:thomas.zuercher@triga.ch');
  await p.screenshot({ path:`${OUT}/${name}-detail.png`, fullPage:true });

  // Bearbeiten
  await p.click('#ma-bearbeiten'); await p.waitForTimeout(500);
  await p.fill('#f-rolle','Stv. Geschäftsleitung');
  await p.click('#f-speichern'); await p.waitForTimeout(1000);
  // Auf dem Handy schliesst sich das Sheet nach dem Speichern, auf dem
  // Desktop bleibt das Detail rechts stehen.
  if (breite >= 1024) ok('Änderung im Detail', (await p.textContent('#ma-ansicht')).includes('Stv. Geschäftsleitung'));
  else ok('Sheet nach dem Speichern zu', (await p.locator('.sheet').count()) === 0);
  ok('Änderung in der Liste', (await p.textContent('#liste')).includes('Stv. Geschäftsleitung'));

  /* --- Abzeichen mit eigenem Text ---------------------------------------
     Der Fall aus der Wirklichkeit: Administration mit den Rechten der
     Geschäftsleitung. Auf dem Abzeichen soll etwas anderes stehen als
     die Stufe, und an den Rechten ändert das nichts. */
  await p.locator('#liste .br-zeile', { hasText: 'Silvia Weber' }).click();
  await p.waitForTimeout(600);
  ok('Abzeichen zeigt zunächst die Stufe',
     (await p.textContent('#ma-ansicht .stufe')).trim() === 'Mitarbeiter:in');

  await p.click('#ma-bearbeiten'); await p.waitForTimeout(500);
  ok('Das Formular hat ein Feld dafür', await p.locator('#f-badge').isVisible());
  ok('Leer heisst: die Stufe', (await p.inputValue('#f-badge')) === ''
     && (await p.getAttribute('#f-badge','placeholder')) === 'Mitarbeiter:in');
  await p.fill('#f-badge', 'Erweiterte Rechte');
  await p.click('#f-speichern'); await p.waitForTimeout(1100);

  const marken = await p.$$eval('#liste .stufe', e => e.map(x => x.textContent.trim()));
  ok('In der Liste steht der eigene Text',
     marken.filter(t => t === 'Erweiterte Rechte').length === 1);
  ok('Und nur bei ihr', marken.filter(t => t === 'Mitarbeiter:in').length === 2
     && marken.includes('Entwickler'));

  const silvia = await p.evaluate(() =>
    JSON.parse(sessionStorage.getItem('__stub_db')).mitarbeiter.find(m => m.name === 'Silvia Weber'));
  ok('badge_label steht in der Zeile', silvia.badge_label === 'Erweiterte Rechte');
  ok('Die Stufe blieb unangetastet', (silvia.berechtigung ?? null) === null);

  // Und wieder leeren: dann gilt wieder die Stufe.
  await p.locator('#liste .br-zeile', { hasText: 'Silvia Weber' }).click();
  await p.waitForTimeout(500);
  await p.click('#ma-bearbeiten'); await p.waitForTimeout(500);
  await p.fill('#f-badge', '');
  await p.click('#f-speichern'); await p.waitForTimeout(1100);
  ok('Leeres Feld heisst wieder die Stufe',
     (await p.$$eval('#liste .stufe', e => e.map(x => x.textContent.trim())))
       .filter(t => t === 'Mitarbeiter:in').length === 3);

  // Suche
  await p.fill('#suche','weber'); await p.waitForTimeout(300);
  ok('Suche filtert', (await p.$$('#liste .br-zeile')).length === 1);
  await p.fill('#suche',''); await p.waitForTimeout(300);

  // Papierkorb
  await p.locator('#liste .br-zeile', { hasText: 'Marco Delea' }).click(); await p.waitForTimeout(700);
  await p.click('#ma-weg'); await p.waitForTimeout(600);
  ok('Rückfrage nennt das Konto', (await p.locator('.sheet').last().textContent()).includes('Login-Konto bleibt unberührt'));
  await p.click('#f-ja'); await p.waitForTimeout(1200);
  ok('aus der Liste verschwunden', (await p.$$('#liste .br-zeile')).length === 3);
  await p.screenshot({ path:`${OUT}/${name}-liste.png`, fullPage:true });

  await p.locator('a[href*="papierkorb-bereich"]:visible').first().click();
  await p.waitForURL('**/papierkorb-bereich.html**'); await p.waitForTimeout(1000);
  ok('Papierkorb zeigt den Eintrag', (await p.$$('#inhalt .pk-zeile')).length === 1);
  ok('mit Löscher', (await p.textContent('#inhalt')).includes('Jonas Zemp'));
  ok('kein endgültiges Löschen', (await p.locator('text=endgültig').count()) === 0);
  await p.screenshot({ path:`${OUT}/${name}-papierkorb.png`, fullPage:true });

  await p.click('#inhalt button[data-id]'); await p.waitForTimeout(1500);
  ok('Papierkorb wieder leer', (await p.textContent('#inhalt')).includes('Papierkorb ist leer'));
  await p.goto(`${SERVER}/mitarbeiter.html`, { waitUntil:'networkidle' });
  await p.waitForTimeout(900);
  ok('Eintrag ist zurück', (await p.$$('#liste .br-zeile')).length === 4);

  if (breite >= 1024) {
    ok('Detailspalte sichtbar', await p.locator('#detail').isVisible());
    ok('Liste 360px breit', Math.round(await p.$eval('.br-liste', e => e.getBoundingClientRect().width)) === 360);
  } else {
    ok('Detailspalte ausgeblendet', !(await p.locator('#detail').isVisible()));
    ok('Telefon-Icon in der Zeile', await p.locator('#liste .br-zeile a[href^="tel:"]').first().isVisible());
  }
  await ctx.close();
}

await lauf('handy', 390);
await lauf('desktop', 1440);
await browser.close();
console.log('\n=== Fehler im Browser ===');
console.log(fehler.length ? fehler.join('\n') : 'keine');
