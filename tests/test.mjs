import { chromium, HIER, SERVER } from './umgebung.mjs';
import fs from 'node:fs';

const BASE = SERVER;
const OUT = `${HIER}/ausgabe/shots`;
fs.mkdirSync(OUT, { recursive: true });

const fehler = [];
const browser = await chromium.launch();
// BREITE=1440 fährt denselben Durchlauf in Desktop-Breite.
const BREITE = Number(process.env.BREITE || 390);
const ctx = await browser.newContext({
  viewport: { width: BREITE, height: BREITE >= 1024 ? 900 : 844 }, deviceScaleFactor: 2,
  acceptDownloads: true, locale: 'de-CH', serviceWorkers: 'block'
});
console.log(`(Viewport ${BREITE}px)`);
// Der echte Supabase-Endpunkt ist aus diesem Container gesperrt.
const STUB = fs.readFileSync(`${HIER}/stub.js`, 'utf8');
await ctx.route('**/vendor/supabase-js-2.58.0.js', r =>
  r.fulfill({ status: 200, contentType: 'application/javascript', body: STUB }));
const page = await ctx.newPage();
page.on('console', m => { if (m.type() === 'error') fehler.push('console: ' + m.text()); });
page.on('pageerror', e => fehler.push('pageerror: ' + e.message));

const schuss = n => page.screenshot({ path: `${OUT}/${n}.png`, fullPage: true });
const ok = (name, bedingung) => console.log(`  ${bedingung ? '✓' : '✗ FEHLER'}  ${name}`);

// --- Login ---------------------------------------------------------------
await page.goto(`${BASE}/index.html`, { waitUntil: 'networkidle' });
await page.fill('#email', 'test.durchlauf@triga.ch');
await page.fill('#pw', 'TestDurchlauf!2026');
await page.click('#btn');
// Nach dem Login kommt neu die Startseite, von dort ins Baujournal.
await page.waitForURL('**/start.html', { timeout: 20000 });
await page.waitForSelector('#raster a[href="projekte.html"]', { timeout: 20000 });
await page.click('#raster a[href="projekte.html"]');
await page.waitForURL('**/projekte.html', { timeout: 20000 });
console.log('• Login');

// --- Projekt anlegen: Kontrollpunkte vorbefüllt, editierbar --------------
await page.click('a[href="projekt.html"]');
await page.waitForURL('**/projekt.html');
await page.waitForTimeout(500);
const vorbelegt = await page.$$eval('#kp-liste input', n => n.map(x => x.value));
ok('neues Projekt startet mit 10 Standardpunkten', vorbelegt.length === 10);
ok('erster Punkt stimmt', vorbelegt[0] === 'Gerüste (Zustand, Verankerung)');

await page.fill('#f-name', 'WUB Garten Mille Fiori, Sarnen');
await page.fill('#f-standort', 'Museumstrasse / Gartenstrasse, 6060 Sarnen');
await page.fill('#f-bauherrschaft', 'StImmobilia GmbH');
// einen Standardpunkt umbenennen, einen entfernen, einen ergänzen
await page.fill('#kp-liste input[data-i="1"]', 'Bauzaun rundum geschlossen');
await page.click('#kp-liste button[data-weg="7"]');            // Bauschild vorhanden
await page.fill('#kp-neu', 'Rissaufnahme Nachbarbauten prüfen');
await page.click('#kp-add');
for (const g of ['Magnolia', 'Lilly']) { await page.fill('#geb-neu', g); await page.click('#geb-add'); }
await schuss('01-projekt-erstellen');
await page.click('#speichern');
await page.waitForURL('**/projekt-start.html**', { timeout: 20000 });
console.log('• Projekt erstellt, landet auf der Projekt-Startseite');

const projektUrl = page.url();
await page.waitForTimeout(900);
await schuss('02-projekt-start-leer');
ok('Startseite zeigt "Neues Baujournal"', await page.locator('#neu').isVisible());
ok('Liste noch leer', (await page.textContent('#liste')).includes('Noch kein Eintrag'));

// --- Eintrag erfassen ----------------------------------------------------
await page.click('#neu');
await page.waitForURL('**/journal.html**', { timeout: 20000 });
await page.waitForTimeout(900);
const kps = await page.$$('#kontrolle .kp');
ok('Formular zeigt 10 Punkte (10 - 1 entfernt + 1 ergänzt)', kps.length === 10);
const labels = await page.$$eval('#kontrolle .label', n => n.map(x => x.textContent.trim()));
ok('umbenannter Punkt ist da', labels.includes('Bauzaun rundum geschlossen'));
ok('entfernter Punkt ist weg', !labels.includes('Bauschild vorhanden'));
ok('kein Projektspezifisch-Badge mehr', (await page.locator('text=PROJEKTSPEZIFISCH').count()) === 0);
ok('keine Verlaufsliste mehr im Formular', (await page.locator('text=Bisherige Einträge').count()) === 0);

await page.click('#betrifft button[data-wert="Magnolia"]');
await page.click('#wetter button[data-wert="Wechselhaft"]');
await page.click('#temperatur button[data-wert="10–20°C"]');
for (const i of [0, 1, 3, 4, 6]) await kps[i].click();
await page.fill('#f-firmen', 'Steiger Baucontrol (4), Keller+Steiner (2)');
await page.fill('#f-fortschritt', 'Magnolia: Rohbau 2. OG abgeschlossen.');
await page.fill('#f-feststellungen', 'Absturzsicherung Treppenauge fehlt noch.');
await schuss('03-journal');
await page.click('#speichern');
await page.waitForURL('**/projekt-start.html**', { timeout: 20000 });
await page.waitForTimeout(1500);
console.log('• Eintrag gespeichert, zurück auf der Startseite');

// --- DER BUG: Liste muss den Eintrag zeigen ------------------------------
const zeilen = await page.$$('#liste a');
ok('BUG behoben: Eintrag erscheint in der Liste', zeilen.length === 1);
console.log('    Zeile:', (await page.textContent('#liste a')).replace(/\s+/g, ' ').trim());
ok('Papierkorb-Zähler noch ohne Zahl', (await page.textContent('#papierkorb-text')) === 'Papierkorb');
await schuss('04-projekt-start-mit-eintrag');

// --- Detail, Korrektur ---------------------------------------------------
await page.click('#liste a');
await page.waitForURL('**/eintrag.html**', { timeout: 20000 });
await page.waitForTimeout(1200);
ok('Detailansicht geladen', (await page.textContent('#inhalt')).includes('Bauzaun rundum geschlossen'));
ok('Löschen-Knopf vorhanden', await page.locator('#weg').isVisible());
await schuss('05-eintrag-detail');

await page.click('#stift');
await page.waitForTimeout(500);
await page.fill('#e-feststellungen', 'Absturzsicherung wurde am selben Tag montiert.');
await page.click('#uebernehmen');
await page.waitForTimeout(2000);
ok('Korrektur protokolliert', (await page.locator('text=Nachträgliche Korrekturen').count()) > 0);

// --- Export --------------------------------------------------------------
const [dlPdf] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.click('#pdf')]);
await dlPdf.saveAs(`${OUT}/export.pdf`);
const [dlDoc] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.click('#word')]);
await dlDoc.saveAs(`${OUT}/export.docx`);
console.log('• Export:', fs.statSync(`${OUT}/export.pdf`).size, '/', fs.statSync(`${OUT}/export.docx`).size, 'bytes');

// --- Löschen -------------------------------------------------------------
await page.click('#weg');
await page.waitForTimeout(500);
ok('Bestätigungsdialog erscheint', (await page.locator('text=Eintrag in den Papierkorb verschieben?').count()) > 0);
await schuss('06-loeschen-dialog');
await page.click('#ja');
await page.waitForURL('**/projekt-start.html**', { timeout: 20000 });
await page.waitForTimeout(1600);
ok('Eintrag aus der Liste verschwunden', (await page.$$('#liste a')).length === 0);
ok('Papierkorb zählt 1', (await page.textContent('#papierkorb-text')) === 'Papierkorb (1)');
await schuss('07-nach-loeschen');

// "Letzter Eintrag" auf der Übersicht darf den gelöschten nicht mehr zählen
await page.goto(`${BASE}/projekte.html`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
const kachel = (await page.textContent('#liste a')).replace(/\s+/g, ' ');
ok('Übersicht zeigt "Noch kein Eintrag"', kachel.includes('Noch kein Eintrag'));
console.log('    Kachel:', kachel.trim());

// --- Papierkorb, Wiederherstellen ---------------------------------------
await page.goto(projektUrl, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
await page.click('#papierkorb');
await page.waitForURL('**/papierkorb.html**', { timeout: 20000 });
await page.waitForTimeout(1200);
ok('Papierkorb zeigt den Eintrag', (await page.$$('#liste button[data-id]')).length === 1);
ok('mit Löscher und Zeitpunkt', (await page.textContent('#liste')).includes('Gelöscht von Jonas Zemp'));
ok('kein endgültiges Löschen', (await page.locator('text=endgültig').count()) === 0);
await schuss('08-papierkorb');

await page.click('#liste button[data-id]');
await page.waitForTimeout(2000);
ok('Papierkorb wieder leer', (await page.textContent('#liste')).includes('Papierkorb ist leer'));
await schuss('09-papierkorb-leer');

await page.goto(projektUrl, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
ok('Eintrag ist zurück in der Liste', (await page.$$('#liste a')).length === 1);

// --- Momentaufnahme: Vorlage ändern, alter Eintrag bleibt wie er war ----
await page.goto(projektUrl, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
const vorher = (await page.textContent('#liste a')).replace(/\s+/g, ' ').trim();

await page.click('#p-edit');
await page.waitForURL('**/projekt.html**', { timeout: 20000 });
await page.waitForTimeout(900);
await page.fill('#kp-liste input[data-i="0"]', 'Gerüste komplett neu benannt');
await page.click('#kp-liste button[data-weg="3"]');
await page.fill('#kp-neu', 'Zusätzlicher Punkt nach dem Eintrag');
await page.click('#kp-add');
await page.click('#speichern');
await page.waitForURL('**/projekt-start.html**', { timeout: 20000 });
await page.waitForTimeout(1500);

ok('Verlaufszeile des alten Eintrags unverändert', (await page.textContent('#liste a')).replace(/\s+/g, ' ').trim() === vorher);
await page.click('#liste a');
await page.waitForURL('**/eintrag.html**', { timeout: 20000 });
await page.waitForTimeout(1400);
const detail = await page.textContent('#inhalt');
ok('Eintrag zeigt weiterhin den alten Punktetext', detail.includes('Bauzaun rundum geschlossen'));
ok('Eintrag kennt die Umbenennung nicht', !detail.includes('Gerüste komplett neu benannt'));
ok('entfernter Punkt steht noch im Eintrag', detail.includes('Ordnung / Sauberkeit Baustelle'));
ok('neuer Vorlagenpunkt taucht im alten Eintrag nicht auf', !detail.includes('Zusätzlicher Punkt nach dem Eintrag'));
await schuss('10-momentaufnahme');

// Ein frischer Eintrag übernimmt dagegen die neue Vorlage
await page.goto(projektUrl, { waitUntil: 'networkidle' });
await page.waitForTimeout(900);
await page.click('#neu');
await page.waitForTimeout(1200);
const neueLabels = await page.$$eval('#kontrolle .label', n => n.map(x => x.textContent.trim()));
ok('neuer Eintrag nutzt die geänderte Vorlage', neueLabels.includes('Gerüste komplett neu benannt') && neueLabels.includes('Zusätzlicher Punkt nach dem Eintrag'));

await browser.close();
console.log('\n=== Fehler im Browser ===');
console.log(fehler.length ? fehler.join('\n') : 'keine');
