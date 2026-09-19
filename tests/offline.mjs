import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import fs from 'node:fs';

const BASE = 'http://127.0.0.1:8124';
const OUT = '/tmp/claude-0/-home-user-baujournal-triga/ad655f9d-451a-55b0-aac9-986e124c8f6f/scratchpad/shots-offline';
fs.mkdirSync(OUT, { recursive: true });

const fehler = [];
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'de-CH' });
const page = await ctx.newPage();
page.on('console', m => { if (m.type() === 'error') fehler.push('console: ' + m.text()); });
page.on('pageerror', e => fehler.push('pageerror: ' + e.message));
const schuss = n => page.screenshot({ path: `${OUT}/${n}.png`, fullPage: true });
const ok = (name, b) => console.log(`  ${b ? '✓' : '✗ FEHLER'}  ${name}`);

await page.goto(`${BASE}/index.html`, { waitUntil: 'networkidle' });
await page.fill('#email', 'test.durchlauf@triga.ch');
await page.fill('#pw', 'TestDurchlauf!2026');
await page.click('#btn');
await page.waitForURL('**/start.html', { timeout: 20000 });
await page.click('#raster a[href="projekte.html"]');
await page.waitForURL('**/projekte.html', { timeout: 20000 });

await page.click('a[href="projekt.html"]');
await page.waitForURL('**/projekt.html');
await page.waitForTimeout(400);
await page.fill('#f-name', 'Büroumbau Blue Diamond, Zug');
await page.fill('#f-standort', 'Baarerstrasse 12, 6300 Zug');
await page.click('#speichern');
await page.waitForURL('**/projekt-start.html**', { timeout: 20000 });
const projektUrl = page.url();
await page.waitForTimeout(800);

await page.click('#neu');
await page.waitForURL('**/journal.html**', { timeout: 20000 });
await page.waitForTimeout(900);
ok('Betrifft-Zeile fehlt ohne Gebäude', await page.locator('#betrifft-karte').isHidden());
await page.click('#wetter button[data-wert="Bewölkt"]');
await page.fill('#f-fortschritt', 'Erster Rundgang, online erfasst.');
await page.click('#speichern');
await page.waitForURL('**/projekt-start.html**', { timeout: 20000 });
await page.waitForTimeout(1500);
console.log('• Grunddaten angelegt');

await page.waitForFunction(() => navigator.serviceWorker.controller !== null, { timeout: 20000 });
const c = await page.evaluate(async () => {
  const n = await caches.keys();
  return { cache: n[0], dateien: (await caches.open(n[0])).keys().then(k => k.length) };
});
console.log('• Service Worker:', c.cache, await c.dateien, 'Dateien');

// --- offline -------------------------------------------------------------
await ctx.setOffline(true);
await page.goto(projektUrl, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1800);
ok('Projekt-Startseite lädt offline', (await page.$$('#liste a')).length === 1);
await schuss('01-offline-start');

await page.click('#neu');
await page.waitForTimeout(1600);
await page.click('#wetter button[data-wert="Schnee"]');
await page.fill('#f-fortschritt', 'In der Tiefgarage ohne Empfang erfasst.');
await page.click('#speichern');
await page.waitForURL('**/projekt-start.html**', { timeout: 20000 });
await page.waitForTimeout(1600);
ok('offline erfasster Eintrag steht in der Liste', (await page.$$('#liste a')).length === 2);
ok('als wartend markiert', (await page.textContent('#liste')).includes('wartet'));
await schuss('02-offline-gespeichert');

// offline löschen
await page.click('#liste a');
await page.waitForURL('**/eintrag.html**', { timeout: 20000 });
await page.waitForTimeout(1500);
const wegDa = await page.locator('#weg').count();
ok('wartender Eintrag hat keinen Löschen-Knopf', wegDa === 0);

await page.goto(projektUrl, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1600);
const links = await page.$$('#liste a');
await links[1].click();                       // der bereits übertragene Eintrag
await page.waitForTimeout(1500);
await page.click('#weg');
await page.waitForTimeout(400);
await page.click('#ja');
await page.waitForTimeout(2000);
ok('offline gelöscht, Liste um eins kürzer', (await page.$$('#liste a')).length === 1);
ok('Papierkorb zählt offline mit', (await page.textContent('#papierkorb-text')).includes('(1)'));
await schuss('03-offline-geloescht');

// --- wieder online -------------------------------------------------------
await ctx.setOffline(false);
await page.waitForTimeout(800);
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(3000);
ok('nach Sync stehen beide Einträge richtig', (await page.$$('#liste a')).length === 1);
ok('Papierkorb weiterhin bei 1', (await page.textContent('#papierkorb-text')).includes('(1)'));
ok('kein "wartet" mehr', !(await page.textContent('#liste')).includes('wartet'));
await schuss('04-nach-sync');

await browser.close();
console.log('\n=== Fehler im Browser ===');
console.log(fehler.length ? fehler.join('\n') : 'keine');
