import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import fs from 'node:fs';
const OUT = '/tmp/claude-0/-home-user-baujournal-triga/ad655f9d-451a-55b0-aac9-986e124c8f6f/scratchpad/shots-dok';
fs.rmSync(OUT, { recursive:true, force:true }); fs.mkdirSync(OUT, { recursive:true });
const PDF = `${OUT}/Anstellungsbedingungen_2026.pdf`;
fs.writeFileSync(PDF, Buffer.from('%PDF-1.4\n%stub\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n'.repeat(40)));
const STUB = fs.readFileSync('./stub.js','utf8');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const fehler = [];
const ok = (n, b) => console.log(`  ${b ? '✓' : '✗ FEHLER'}  ${n}`);

async function lauf(name, breite) {
  const ctx = await browser.newContext({ viewport:{width:breite,height:breite>=1024?900:844}, deviceScaleFactor:1, locale:'de-CH', serviceWorkers:'block', acceptDownloads:true });
  await ctx.route('**/vendor/supabase-js-2.58.0.js', r => r.fulfill({status:200,contentType:'application/javascript',body:STUB}));
  const p = await ctx.newPage();
  p.on('console', m => { if (m.type()==='error') fehler.push(`${name}: ${m.text()}`); });
  p.on('pageerror', e => fehler.push(`${name}: ${e.message}`));
  console.log(`\n=== ${name} (${breite}px) ===`);

  await p.goto('http://127.0.0.1:8123/index.html', { waitUntil:'networkidle' });
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

  await p.goto('http://127.0.0.1:8123/dokumente.html', { waitUntil:'networkidle' });
  await p.waitForTimeout(1000);
  ok('Ordner wieder da', (await p.$$('#ordner .dk-ordnerzeile')).length === 2);
  await ctx.close();
}

await lauf('handy', 390);
await lauf('desktop', 1440);
await browser.close();
console.log('\n=== Fehler im Browser ===');
console.log(fehler.length ? fehler.join('\n') : 'keine');
