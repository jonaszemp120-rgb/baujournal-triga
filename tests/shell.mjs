import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import fs from 'node:fs';
const OUT = '/tmp/claude-0/-home-user-baujournal-triga/ad655f9d-451a-55b0-aac9-986e124c8f6f/scratchpad/shots-shell';
fs.mkdirSync(OUT, { recursive: true });
const STUB = fs.readFileSync('/tmp/claude-0/-home-user-baujournal-triga/ad655f9d-451a-55b0-aac9-986e124c8f6f/scratchpad/stub.js','utf8');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const fehler = [];
const ok = (n, b) => console.log(`  ${b ? '✓' : '✗ FEHLER'}  ${n}`);

async function lauf(name, breite, hoehe) {
  const ctx = await browser.newContext({ viewport:{width:breite,height:hoehe}, deviceScaleFactor:2, locale:'de-CH', serviceWorkers:'block' });
  await ctx.route('**/vendor/supabase-js-2.58.0.js', r => r.fulfill({status:200,contentType:'application/javascript',body:STUB}));
  const p = await ctx.newPage();
  p.on('console', m => { if (m.type()==='error') fehler.push(`${name}: ${m.text()}`); });
  p.on('pageerror', e => fehler.push(`${name}: ${e.message}`));

  console.log(`\n=== ${name} (${breite}px) ===`);
  await p.goto('http://127.0.0.1:8123/index.html', { waitUntil:'networkidle' });
  await p.fill('#email','test.durchlauf@triga.ch'); await p.fill('#pw','TestDurchlauf!2026');
  await p.click('#btn');
  await p.waitForURL('**/start.html', { timeout:20000 });
  await p.waitForTimeout(1200);
  ok('Login landet auf der Startseite', true);
  ok('sechs Kacheln', (await p.$$('#raster a')).length === 6);
  ok('Test-Banner sichtbar', await p.locator('.tr-banner:visible').count() > 0);
  ok('Banner nur einmal sichtbar', (await p.locator('.tr-banner:visible').count()) === 1);
  const sichtbar = await p.locator('.tr-sidebar').isVisible();
  ok(breite >= 1024 ? 'Seitenleiste sichtbar' : 'Seitenleiste ausgeblendet', breite >= 1024 ? sichtbar : !sichtbar);
  await p.screenshot({ path:`${OUT}/${name}-start.png`, fullPage:true });

  // Ins Baujournal
  // Ein Projekt anlegen, damit die Kachel eine echte Zahl zeigt
  await p.goto('http://127.0.0.1:8123/projekt.html', { waitUntil:'networkidle' });
  await p.waitForTimeout(500);
  await p.fill('#f-name', 'Shell-Probe');
  await p.click('#speichern');
  await p.waitForURL('**/projekt-start.html**', { timeout:20000 });
  await p.goto('http://127.0.0.1:8123/start.html', { waitUntil:'networkidle' });
  await p.waitForTimeout(1200);
  const kachel = (await p.textContent('#raster a[href="projekte.html"]')).replace(/\s+/g,' ').trim();
  ok('Baujournal-Kachel zählt mit', /1 aktives Projekt|Projekte aktiv/.test(kachel));
  console.log('    Kachel:', kachel);

  await p.click('#raster a[href="projekte.html"]');
  await p.waitForURL('**/projekte.html', { timeout:20000 });
  await p.waitForTimeout(1200);
  ok('Baujournal erreichbar', (await p.title()).startsWith('Baujournal'));
  if (breite >= 1024) {
    ok('Seitenleiste auch im Baujournal', await p.locator('.tr-sidebar').isVisible());
    ok('Baujournal aktiv markiert', (await p.locator('.tr-nav[aria-current="page"]').textContent()).trim() === 'Baujournal');
    const links = await p.$eval('.tr-inhalt', el => getComputedStyle(el).paddingLeft);
    ok('Inhalt neben der Leiste', links === '260px');
  } else {
    ok('Zurück-Pfeil zur Startseite', await p.locator('.topbar a[href="start.html"]').isVisible());
  }
  await p.screenshot({ path:`${OUT}/${name}-baujournal.png`, fullPage:true });

  // Die neuen Bereiche
  await p.goto('http://127.0.0.1:8123/mitarbeiter.html', { waitUntil:'networkidle' });
  await p.waitForTimeout(800);
  ok('Bereich Mitarbeiter lädt', await p.locator('#suche').count() === 1);
  await p.goto('http://127.0.0.1:8123/firmenpool.html', { waitUntil:'networkidle' });
  await p.waitForTimeout(900);
  ok('Bereich Firmenpool lädt', await p.locator('#gruppen').count() === 1);
  if (breite >= 1024) ok('Firmenpool aktiv markiert', (await p.locator('.tr-nav[aria-current="page"]').textContent()).trim() === 'Firmenpool');
  await p.goto('http://127.0.0.1:8123/mitarbeiter.html', { waitUntil:'networkidle' });
  await p.waitForTimeout(600);
  if (breite >= 1024) ok('Mitarbeiter aktiv markiert', (await p.locator('.tr-nav[aria-current="page"]').textContent()).trim() === 'Mitarbeiter');
  await p.screenshot({ path:`${OUT}/${name}-mitarbeiter.png`, fullPage:true });
  await ctx.close();
}

await lauf('handy', 390, 844);
await lauf('desktop', 1440, 900);
await browser.close();
console.log('\n=== Fehler im Browser ===');
console.log(fehler.length ? fehler.join('\n') : 'keine');
