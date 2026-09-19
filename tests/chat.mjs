/* Schritt 12: Chat und Benachrichtigungen.
   Geprüft wird die Liste aus Abschnitt 4 der Vorgabe. */
import { chromium, HIER, SERVER } from './umgebung.mjs';
import fs from 'node:fs';
const OUT = `${HIER}/ausgabe/shots-ch`;
fs.rmSync(OUT, { recursive:true, force:true }); fs.mkdirSync(OUT, { recursive:true });
const STUB = fs.readFileSync(`${HIER}/stub.js`,'utf8');
/* Die gemeinsame Saat kennt drei Personen mit Konto. Für den Chat braucht
   es ein paar mehr, sonst lässt sich in einer Gruppe niemand mehr
   hinzufügen. Die zwei stehen nur hier, damit die anderen Suiten ihre
   Zahlen behalten. */
/* Der Chat rechnet mit dem Kalender: ein Tagestrenner sagt "Heute", und
   eine Nachricht von heute trägt nur die Uhrzeit. Die Saat steht auf
   einem festen Datum, also wird es hier auf den heutigen Tag gezogen —
   sonst bestünde die Suite nur an dem einen Tag, an dem sie entstand. */
const HEUTE = new Date().toISOString().slice(0, 10);
const heute = t => String(t).replaceAll('2026-09-18', HEUTE);

const SAAT = (() => {
  const d = JSON.parse(heute(fs.readFileSync(`${HIER}/saat.json`, 'utf8')));
  d.mitarbeiter.push(
    { id:'m5', name:'Thomas Zürcher', rolle:'Projektleiter', telefon:'079 957 58 44',
      email:'thomas.zuercher@triga.ch', berechtigung:'geschaeftsleitung',
      user_id:'u9-thomas', unterschrift:null, unterschrift_am:null,
      erstellt_am:'2026-09-10T07:30:00.000Z' },
    { id:'m6', name:'Marco Delea', rolle:'Bauleiter', telefon:'079 652 75 70',
      email:'marco.delea@triga.ch', berechtigung:'mitarbeiter',
      user_id:'u9-marco', unterschrift:null, unterschrift_am:null,
      erstellt_am:'2026-09-10T07:30:00.000Z' }
  );
  return d;
})();
const browser = await chromium.launch();
const fehler = [];
let gut = 0, schlecht = 0;
const ok = (n, b, zusatz='') => { b ? gut++ : schlecht++; console.log(`  ${b ? '✓' : '✗ FEHLER'}  ${n}${zusatz ? '  → ' + zusatz : ''}`); };

/* Die Frage nach Benachrichtigungen kommt beim ersten Öffnen und würde
   sonst jeden Klick verdecken. Wo sie selbst geprüft wird, bleibt der
   Merker weg. */
/* erlaubnis sagt, in welchem Zustand die Benachrichtigungen stehen
   sollen: 'default' heisst noch nicht gefragt, 'granted' erteilt,
   'denied' abgelehnt. Das wird gesetzt und nicht geerbt — der eine
   Chromium-Build liefert dafür von sich aus "default", der nächste
   "denied", und ctx.grantPermissions() greift im neueren gar nicht mehr.
   Dann steht die Suite rot da, ohne dass an der App etwas falsch wäre;
   genau das ist hier passiert. Geprüft wird, was die App aus einem
   Zustand macht, nicht wie der Browser zu ihm kommt. */
async function baueKontext(breite, { saat = SAAT, gefragt = true, geteilt = false,
                                     erlaubnis = null } = {}) {
  const ctx = await browser.newContext({
    viewport:{ width:breite, height: breite>=1024?900:844 },
    locale:'de-CH', serviceWorkers:'block'
  });
  await ctx.route('**/vendor/supabase-js-2.58.0.js', r => r.fulfill({status:200,contentType:'application/javascript',body:STUB}));
  await ctx.route('**/api/push', r => r.fulfill({status:200,contentType:'application/json',body:'{"gesendet":1}'}));
  await ctx.addInitScript(([s, g, t, e]) => {
    try {
      if (t) localStorage.setItem('__stub_geteilt', '1');
      if (g) localStorage.setItem('bj_push_gefragt', '1');
    } catch {}
    const lager = t ? localStorage : sessionStorage;
    if (!lager.getItem('__stub_db')) lager.setItem('__stub_db', JSON.stringify(s));

    if (e && typeof Notification !== 'undefined') {
      try {
        Object.defineProperty(Notification, 'permission', {
          configurable: true, get: () => e
        });
        // Wer zusagt, bekommt auch die Zusage zurück.
        Notification.requestPermission = async () => e === 'default' ? 'granted' : e;
      } catch {}
    }
  }, [saat, gefragt, geteilt, erlaubnis]);
  return ctx;
}

async function anmelden(ctx) {
  const p = await ctx.newPage();
  p.on('console', m => { if (m.type()==='error') fehler.push(m.text()); });
  p.on('pageerror', e => fehler.push(e.message));
  await p.goto(`${SERVER}/index.html`, { waitUntil:'networkidle' });
  await p.fill('#email','test.durchlauf@triga.ch'); await p.fill('#pw','TestDurchlauf!2026');
  await p.click('#btn'); await p.waitForURL('**/start.html'); await p.waitForTimeout(600);
  return p;
}

const namen = p => p.$$eval('#gespraeche .ch-zeile .name', e => e.map(x => x.textContent.trim()));
/* Der Text einer Blase steht seit den Zeitstempeln in .wort — daneben
   liegen Uhrzeit und Haken, die hier nicht mitgelesen werden sollen. */
const blasen = p => p.$$eval('#verlauf .ch-blase .wort', e => e.map(x => x.textContent.trim()));

/* ===== 1. Navigation ====================================================== */

for (const breite of [390, 1440]) {
  console.log(`\n=== Zugang zum Chat (${breite}px) ===`);
  const ctx = await baueKontext(breite);
  const p = await anmelden(ctx);

  ok('Startseite zeigt sechs Bereiche', (await p.$$('#raster a')).length === 6);
  ok('Chat-Kachel ist dabei',
     (await p.$$eval('#raster a', e => e.map(x => x.getAttribute('href')))).includes('chat.html'));
  if (breite >= 1024) {
    // Acht, nicht sechs: Feed und Formulare stehen in der Leiste, aber nicht im Kachelraster.
    ok('Seitenleiste hat acht Einträge', (await p.$$('.tr-sidebar .tr-nav')).length === 8);
    ok('Chat steht zwischen Dokumenten und Formularen',
       (await p.$$eval('.tr-sidebar .tr-nav span', e => e.map(x => x.textContent.trim()))).slice(-3).join('|')
         === 'Dokumente|Chat|Formulare');
  }
  await p.screenshot({ path:`${OUT}/${breite}-start.png`, fullPage:true });
  await ctx.close();
}

/* ===== 2. Liste und Gespräch ============================================== */

for (const breite of [390, 1440]) {
  console.log(`\n=== Chat (${breite}px) ===`);
  const ctx = await baueKontext(breite);
  const p = await anmelden(ctx);
  await p.goto(`${SERVER}/chat.html`, { waitUntil:'networkidle' });
  await p.waitForTimeout(1000);

  ok('Beide Gespräche stehen in der Liste', (await namen(p)).length === 2);
  ok('Neuestes zuerst', (await namen(p))[0] === 'Mille Fiori Team', (await namen(p)).join(' | '));
  ok('Die Gruppe heisst nach ihrem Namen', (await namen(p)).includes('Mille Fiori Team'));
  ok('Der Einzelchat heisst nach der anderen Person', (await namen(p)).includes('Adrian Zemp'));
  ok('Vorschau nennt Absender und Text',
     (await p.textContent('#gespraeche')).includes('Silvia: Rechnung für Fankhauser'));
  ok('Gruppen und Personen sehen verschieden aus',
     (await p.$$('#gespraeche .bild.gruppe')).length === 1 && (await p.$$('#gespraeche .bild.person')).length === 1);
  await p.screenshot({ path:`${OUT}/${breite}-liste.png`, fullPage:true });

  // --- Gespräch öffnen -----------------------------------------------------
  await p.click('#gespraeche .ch-zeile:first-child');
  await p.waitForTimeout(900);

  ok('Kopfzeile nennt die Gruppe', (await p.textContent('.ch-kopf .titel')).trim() === 'Mille Fiori Team');
  ok('Kopfzeile nennt die Mitglieder',
     (await p.textContent('.ch-kopf .wer')).includes('Adrian'));
  ok('Alle drei Nachrichten stehen da', (await blasen(p)).length === 3);
  ok('In der richtigen Reihenfolge',
     (await blasen(p))[0].startsWith('bin um 9') && (await blasen(p))[2].startsWith('Rechnung'));
  ok('Eigene Nachricht rechts, fremde links',
     (await p.$$('#verlauf .ch-blase.ich')).length === 1 && (await p.$$('#verlauf .ch-blase.andere')).length === 2);
  ok('In der Gruppe steht der Name über fremden Nachrichten',
     (await p.$$eval('#verlauf .ch-absender', e => e.map(x => x.textContent.trim()))).join('|')
       === 'Adrian Zemp|Silvia Weber');
  ok('Tagestrenner vorhanden', (await p.textContent('#verlauf')).includes('Heute'));
  ok('Eingabezeile ist da', await p.locator('#e-text').isVisible());

  if (breite < 1024) {
    ok('Auf dem Handy ist die Liste weg', !(await p.locator('#spalte-liste').isVisible()));
    await p.click('#g-zurueck');
    await p.waitForTimeout(500);
    ok('Zurück führt in die Liste', await p.locator('#spalte-liste').isVisible());
    await p.click('#gespraeche .ch-zeile:first-child');
    await p.waitForTimeout(800);
  } else {
    ok('Auf dem Desktop bleiben beide Spalten stehen',
       await p.locator('#spalte-liste').isVisible() && await p.locator('#verlauf').isVisible());
  }

  // --- Im Einzelchat kein Absendername ------------------------------------
  // Auf dem Handy liegt gerade das Gespräch über der Liste.
  if (breite < 1024) { await p.click('#g-zurueck'); await p.waitForTimeout(400); }
  await p.click('#gespraeche .ch-zeile:nth-child(2)');
  await p.waitForTimeout(800);
  ok('Im Einzelchat steht kein Absendername', (await p.$$('#verlauf .ch-absender')).length === 0);
  ok('Auch der Einzelchat hat ein Menü — zum Löschen', (await p.$$('#g-mehr')).length === 1);

  // --- Senden ---------------------------------------------------------------
  await p.fill('#e-text', 'Ja, liegen im Ordner Pläne 👍');
  await p.click('#e-senden');
  await p.waitForTimeout(900);
  ok('Gesendete Nachricht steht im Verlauf',
     (await blasen(p)).includes('Ja, liegen im Ordner Pläne 👍'));
  ok('Und zwar als eigene', (await p.$$('#verlauf .ch-blase.ich')).length === 1);
  ok('Das Feld ist wieder leer', (await p.inputValue('#e-text')) === '');
  ok('Die Liste zeigt die neue Vorschau',
     (await p.textContent('#gespraeche')).includes('Sie: Ja, liegen im Ordner'));
  ok('Und sortiert das Gespräch nach oben', (await namen(p))[0] === 'Adrian Zemp');
  await p.screenshot({ path:`${OUT}/${breite}-gespraech.png`, fullPage:true });

  // --- Emoji -----------------------------------------------------------------
  await p.click('#e-emoji');
  await p.waitForSelector('.ch-emoji', { state:'visible' });
  ok('Emoji-Auswahl geht auf', (await p.$$('.ch-emoji button')).length > 20);
  await p.click('.ch-emoji button:first-child');
  await p.waitForTimeout(400);
  ok('Das gewählte Emoji steht im Feld', (await p.inputValue('#e-text')).length > 0);
  await p.fill('#e-text', '');

  // --- Suche -------------------------------------------------------------------
  // Dafür braucht es wieder die Liste, auf dem Handy also einen Schritt zurück.
  if (breite < 1024) { await p.click('#g-zurueck'); await p.waitForTimeout(400); }
  await p.fill('#suche', 'mille');
  await p.waitForTimeout(300);
  ok('Suche filtert die Liste', (await namen(p)).length === 1);
  await p.fill('#suche', '');
  await p.waitForTimeout(300);

  await ctx.close();
}

/* ===== 3. Ungelesen-Zähler ================================================ */

console.log('\n=== Ungelesen ===');
{
  const saat = structuredClone(SAAT);
  // Zwei Nachrichten nach dem letzten Lesen, eine davon von einem selbst.
  saat.nachrichten.push(
    { id:'n9', chat_id:'c1', absender:'u9-adrian', text:'Noch etwas', bild_pfad:null, bild_ablauf:null, erstellt_am:heute('2026-09-18T09:00:00.000Z') },
    { id:'n10', chat_id:'c1', absender:'u9-silvia', text:'Und noch etwas', bild_pfad:null, bild_ablauf:null, erstellt_am:heute('2026-09-18T09:05:00.000Z') },
    { id:'n11', chat_id:'c1', absender:'u1', text:'Von mir', bild_pfad:null, bild_ablauf:null, erstellt_am:heute('2026-09-18T09:06:00.000Z') }
  );
  const ctx = await baueKontext(1440, { saat });
  const p = await anmelden(ctx);
  await p.goto(`${SERVER}/chat.html`, { waitUntil:'networkidle' });
  await p.waitForTimeout(1000);

  const zaehler = await p.$$eval('#gespraeche .zaehler', e => e.map(x => x.textContent.trim()));
  ok('Genau ein Gespräch ist ungelesen', zaehler.length === 1, zaehler.join(','));
  /* Nach dem letzten Lesen stehen fünf Nachrichten im Gespräch, eine davon
     von einem selbst. Gezählt werden die vier anderen. */
  ok('Der Zähler zählt nur fremde Nachrichten', zaehler[0] === '4', zaehler[0]);

  await p.click('#gespraeche .ch-zeile:first-child');
  await p.waitForTimeout(900);
  ok('Beim Öffnen verschwindet der Zähler', (await p.$$('#gespraeche .zaehler')).length === 0);

  await p.reload({ waitUntil:'networkidle' });
  await p.waitForTimeout(1100);
  ok('Und bleibt auch nach dem Neuladen weg', (await p.$$('#gespraeche .zaehler')).length === 0);
  await ctx.close();
}

/* ===== 4. Echtzeit über zwei Tabs ========================================= */

console.log('\n=== Echtzeit ===');
{
  const ctx = await baueKontext(1440, { geteilt: true });
  const eins = await anmelden(ctx);
  await eins.goto(`${SERVER}/chat.html?chat=c1`, { waitUntil:'networkidle' });
  await eins.waitForTimeout(1000);

  const zwei = await anmelden(ctx);
  await zwei.goto(`${SERVER}/chat.html?chat=c1`, { waitUntil:'networkidle' });
  await zwei.waitForTimeout(1000);

  ok('Beide Tabs zeigen dasselbe Gespräch',
     (await blasen(eins)).length === (await blasen(zwei)).length);

  const vorher = (await blasen(eins)).length;
  await zwei.fill('#e-text', 'Kommt das drüben an?');
  await zwei.click('#e-senden');
  // Kein Neuladen, nur warten.
  await eins.waitForTimeout(1500);

  const drueben = await blasen(eins);
  ok('Die Nachricht erscheint im anderen Tab ohne Neuladen',
     drueben.includes('Kommt das drüben an?'), `${vorher} → ${drueben.length}`);
  ok('Und steht dort als fremde oder eigene Blase genau einmal',
     drueben.filter(t => t === 'Kommt das drüben an?').length === 1);

  // Auch die Liste im anderen Tab zieht nach.
  await zwei.goto(`${SERVER}/chat.html`, { waitUntil:'networkidle' });
  await zwei.waitForTimeout(800);
  await eins.fill('#e-text', 'Und zurück');
  await eins.click('#e-senden');
  await zwei.waitForTimeout(1500);
  ok('Die Liste im anderen Tab zeigt die neue Vorschau',
     (await zwei.textContent('#gespraeche')).includes('Und zurück'));

  await ctx.close();
}

/* ===== 5. Gruppe erstellen ================================================ */

for (const breite of [390, 1440]) {
  console.log(`\n=== Gruppe erstellen (${breite}px) ===`);
  const ctx = await baueKontext(breite);
  const p = await anmelden(ctx);
  await p.goto(`${SERVER}/chat.html`, { waitUntil:'networkidle' });
  await p.waitForTimeout(1000);

  await p.locator('[data-neu]:visible').first().click();
  await p.waitForSelector('#n-gruppe', { state:'visible' });
  ok('Neues Gespräch bietet alle anderen und eine Gruppe an',
     (await p.$$('[data-person]')).length === 4 && await p.locator('#n-gruppe').isVisible(),
     `${(await p.$$('[data-person]')).length} Personen`);

  await p.click('#n-gruppe');
  await p.waitForSelector('#gr-name', { state:'visible' });
  ok('Zähler startet bei einem — man selbst',
     (await p.textContent('#gr-zahl')).includes('1 ausgewählt'), await p.textContent('#gr-zahl'));

  await p.click('#gr-ja');
  await p.waitForTimeout(400);
  ok('Ohne Namen kommt eine Meldung', (await p.textContent('#gr-fehler')).includes('Namen'));

  await p.fill('#gr-name', 'Büroumbau Blue Diamond');
  await p.click('#gr-ja');
  await p.waitForTimeout(400);
  ok('Ohne Mitglieder kommt eine Meldung', (await p.textContent('#gr-fehler')).includes('mindestens eine'));

  await p.click('[data-wahl]:nth-child(1)');
  await p.click('[data-wahl]:nth-child(2)');
  await p.waitForTimeout(300);
  ok('Der Zähler zählt mit', (await p.textContent('#gr-zahl')).includes('3 ausgewählt'), await p.textContent('#gr-zahl'));
  ok('Die Haken stehen', (await p.$$('[data-wahl][aria-checked="true"]')).length === 2);
  await p.screenshot({ path:`${OUT}/${breite}-gruppe.png` });

  await p.click('#gr-ja');
  await p.waitForTimeout(1200);

  ok('Die Gruppe steht in der Liste', (await namen(p)).includes('Büroumbau Blue Diamond'));
  ok('Und ist gleich offen', (await p.textContent('.ch-kopf .titel')).trim() === 'Büroumbau Blue Diamond');
  ok('Mit drei Mitgliedern', (await p.textContent('.ch-kopf .wer')).split(',').length === 3,
     await p.textContent('.ch-kopf .wer'));
  ok('Man selbst ist immer dabei', (await p.textContent('.ch-kopf .wer')).includes('Jonas'));

  // --- Mitglieder pflegen ---------------------------------------------------
  await p.click('#g-mehr');
  await p.waitForSelector('[data-mit]', { state:'visible' });
  ok('Die erstellende Person ist Admin und darf pflegen',
     (await p.textContent('.sheet')).includes('Sie sind Admin dieser Gruppe'),
     (await p.textContent('.sheet')).slice(0, 90));
  const dazu = await p.locator('[data-mit][aria-checked="false"]').first();
  await dazu.click();
  await p.waitForTimeout(700);
  ok('Mitglied hinzugefügt', (await p.textContent('.ch-kopf .wer')).split(',').length === 4,
     await p.textContent('.ch-kopf .wer'));
  await p.locator('[data-mit][aria-checked="true"]').first().click();
  await p.waitForTimeout(700);
  ok('Mitglied wieder entfernt', (await p.textContent('.ch-kopf .wer')).split(',').length === 3);

  await ctx.close();
}

/* ===== 6. Einzelchat entsteht von selbst ================================== */

console.log('\n=== Einzelchat ===');
{
  const ctx = await baueKontext(1440);
  const p = await anmelden(ctx);
  await p.goto(`${SERVER}/chat.html`, { waitUntil:'networkidle' });
  await p.waitForTimeout(1000);
  const vorher = (await namen(p)).length;

  await p.locator('[data-neu]:visible').first().click();
  await p.waitForSelector('[data-person]', { state:'visible' });
  // Silvia Weber hat noch kein Einzelgespräch mit uns.
  await p.locator('[data-person]', { hasText: 'Silvia Weber' }).click();
  await p.waitForTimeout(1200);

  ok('Das Gespräch entsteht beim ersten Öffnen', (await namen(p)).length === vorher + 1);
  ok('Und heisst nach der Person', (await p.textContent('.ch-kopf .titel')).trim() === 'Silvia Weber');
  ok('Es ist noch leer', (await p.textContent('#verlauf')).includes('Noch keine Nachricht'));

  await p.fill('#e-text', 'Hallo Silvia');
  await p.click('#e-senden');
  await p.waitForTimeout(900);
  ok('Schreiben geht sofort', (await blasen(p)).includes('Hallo Silvia'));

  // Ein zweites Mal öffnen legt nichts Neues an.
  await p.click('#gespraeche .ch-zeile:nth-child(2)');
  await p.waitForTimeout(500);
  await p.locator('[data-neu]:visible').first().click();
  await p.waitForSelector('[data-person]', { state:'visible' });
  await p.locator('[data-person]', { hasText: 'Silvia Weber' }).click();
  await p.waitForTimeout(1000);
  ok('Beim zweiten Mal entsteht kein zweites Gespräch', (await namen(p)).length === vorher + 1);
  ok('Und die Nachricht steht noch drin', (await blasen(p)).includes('Hallo Silvia'));

  await ctx.close();
}

/* ===== 7. Bilder und ihr Ablauf =========================================== */

console.log('\n=== Bilder ===');
{
  const saat = structuredClone(SAAT);
  const in30 = new Date(Date.now() + 30 * 86400000).toISOString();
  saat.nachrichten.push(
    { id:'nb1', chat_id:'c1', absender:'u9-adrian', text:null,
      bild_pfad:'c1/beispiel.jpg', bild_ablauf:in30, erstellt_am:heute('2026-09-18T07:20:00.000Z') },
    // Dasselbe, aber der Aufräumlauf war schon da: Datei weg, Eintrag bleibt.
    { id:'nb2', chat_id:'c1', absender:'u9-adrian', text:null,
      bild_pfad:null, bild_ablauf:'2026-08-01T07:00:00.000Z', erstellt_am:'2026-07-02T07:00:00.000Z' },
    { id:'nb3', chat_id:'c1', absender:'u9-adrian', text:'Das war das Bild von vorhin',
      bild_pfad:null, bild_ablauf:null, erstellt_am:'2026-07-02T07:01:00.000Z' }
  );
  const ctx = await baueKontext(1440, { saat });
  const p = await anmelden(ctx);
  await p.goto(`${SERVER}/chat.html?chat=c1`, { waitUntil:'networkidle' });
  await p.waitForTimeout(1200);

  const ablauf = await p.$$eval('#verlauf .ch-ablauf', e => e.map(x => x.textContent.trim()));
  ok('Das gültige Bild nennt sein Ablaufdatum', ablauf.length === 1, ablauf.join(' | '));
  ok('Und sagt, was danach passiert', ablauf[0].includes('danach automatisch gelöscht'), ablauf[0]);
  const erwartet = new Date(in30).toLocaleDateString('de-CH', { day:'2-digit', month:'2-digit' });
  ok('Das Datum liegt 30 Tage in der Zukunft', ablauf[0].includes(erwartet), `${ablauf[0]} soll ${erwartet}`);

  const platz = await p.$$eval('#verlauf .platzhalter', e => e.map(x => x.textContent.trim()));
  ok('Das abgelaufene Bild hinterlässt einen Hinweis',
     platz.some(t => t.includes('nicht mehr verfügbar')), platz.join(' | '));
  ok('Aber kein Ablaufdatum mehr', ablauf.length === 1);
  ok('Der Text darum herum steht unverändert da',
     (await blasen(p)).includes('Das war das Bild von vorhin'));
  ok('Es gibt keine Galerie über alle Bilder des Chats',
     (await p.$$('[data-galerie], .ch-galerie')).length === 0);
  await p.screenshot({ path:`${OUT}/bilder.png`, fullPage:true });

  // --- Ein Bild senden ------------------------------------------------------
  const bild = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64');
  await p.setInputFiles('#e-datei', { name:'baustelle.png', mimeType:'image/png', buffer: bild });
  await p.waitForTimeout(1500);
  const nachher = await p.$$eval('#verlauf .ch-ablauf', e => e.map(x => x.textContent.trim()));
  ok('Nach dem Senden trägt auch das neue Bild ein Ablaufdatum', nachher.length === 2, String(nachher.length));
  ok('Die Liste zeigt "Foto gesendet"', (await p.textContent('#gespraeche')).includes('Foto gesendet'));
  const abgelegt = await p.evaluate(() => {
    const d = JSON.parse(sessionStorage.getItem('__stub_db'));
    const n = d.nachrichten.filter(x => x.bild_pfad).pop();
    return { pfad: n.bild_pfad, tage: Math.round((new Date(n.bild_ablauf) - Date.now()) / 86400000) };
  });
  ok('Das Bild liegt im Ordner des Gesprächs', abgelegt.pfad.startsWith('c1/'), abgelegt.pfad);
  ok('Und läuft in 30 Tagen ab', abgelegt.tage === 30, String(abgelegt.tage));

  await ctx.close();
}

/* ===== 8. Benachrichtigungen ============================================== */

console.log('\n=== Benachrichtigungen ===');
{
  const ctx = await baueKontext(1440, { gefragt: false, erlaubnis: 'default' });
  const p = await anmelden(ctx);
  await p.goto(`${SERVER}/chat.html`, { waitUntil:'networkidle' });
  await p.waitForTimeout(1200);

  ok('Beim ersten Öffnen wird gefragt', await p.locator('.sheet').isVisible());
  const text = await p.textContent('.sheet');
  ok('Mit einer Begründung', text.includes('wenn die App gerade nicht offen ist'), text.slice(0, 60));
  ok('Und dem Hinweis, dass es auch ohne geht', text.includes('funktioniert der Chat genau gleich'));

  // Ablehnen.
  await p.click('#f-nein');
  await p.waitForTimeout(600);
  ok('Nach dem Ablehnen ist der Dialog weg', (await p.$$('.sheet')).length === 0);
  ok('Der Chat läuft trotzdem', (await namen(p)).length === 2);

  await p.click('#gespraeche .ch-zeile:first-child');
  await p.waitForTimeout(800);
  await p.fill('#e-text', 'Geht auch ohne Meldung');
  await p.click('#e-senden');
  await p.waitForTimeout(900);
  ok('Und Senden geht auch ohne Erlaubnis', (await blasen(p)).includes('Geht auch ohne Meldung'));

  await p.reload({ waitUntil:'networkidle' });
  await p.waitForTimeout(1200);
  ok('Beim zweiten Mal wird nicht wieder gefragt', (await p.$$('.sheet')).length === 0);

  ok('Der Schlüssel für Web Push liegt im Client',
     await p.evaluate(() => typeof BJ_CONFIG.vapid === 'string' && BJ_CONFIG.vapid.length > 80));
  ok('Die Grundlage ist nicht an den Chat gebunden',
     await p.evaluate(() => typeof pushFragen === 'function' && typeof pushAnmelden === 'function'
       && typeof pushAbmelden === 'function' && typeof pushSenden === 'function'));

  await ctx.close();
}

/* ===== 9. Kein Zugriff von aussen ========================================= */

console.log('\n=== Zugriff ===');
{
  const saat = structuredClone(SAAT);
  // Ein Konto ohne Eintrag im Adressbuch.
  saat.mitarbeiter.find(m => m.user_id === 'u1').user_id = null;
  const ctx = await baueKontext(1440, { saat });
  const p = await anmelden(ctx);
  await p.goto(`${SERVER}/chat.html`, { waitUntil:'networkidle' });
  await p.waitForTimeout(1000);

  ok('Ohne Eintrag im Adressbuch kein Chat',
     (await p.textContent('#gespraeche')).includes('dem TRIGA-Team vorbehalten'));
  ok('Und kein Knopf für ein neues Gespräch',
     (await p.$$eval('[data-neu]', e => e.filter(x => !x.hidden).length)) === 0);
  await ctx.close();
}

/* ===== 10. Anlegen stolpert nicht über die eigene Policy ================== */

console.log('\n=== Anlegen ohne Henne-Ei ===');
{
  const ctx = await baueKontext(1440);
  const p = await anmelden(ctx);
  await p.goto(`${SERVER}/chat.html`, { waitUntil:'networkidle' });
  await p.waitForTimeout(1000);

  /* Genau der Weg, der gescheitert ist: ein Gespräch anlegen und sich
     selbst als erstes Mitglied eintragen. Im Moment des ersten Eintrags
     ist noch niemand Mitglied — wenn die Regel das verlangt, beisst sie
     sich selbst. */
  const einzel = await p.evaluate(async () => {
    const s = await session();
    const id = crypto.randomUUID();
    const a = await sb.from('chats').insert({ id, art:'einzel', erstellt_von: s.user.id });
    const b = await sb.from('chat_mitglieder').insert([
      { chat_id: id, user_id: s.user.id },
      { chat_id: id, user_id: 'u9-thomas' }
    ]);
    return { chat: a.error?.message || null, mitglieder: b.error?.message || null, id };
  });
  ok('Gespräch anlegen geht durch', !einzel.chat, einzel.chat || '');
  ok('Und beide Mitglieder gleich mit', !einzel.mitglieder, einzel.mitglieder || '');

  const nachricht = await p.evaluate(async id => {
    const s = await session();
    const { error } = await sb.from('nachrichten')
      .insert({ chat_id: id, absender: s.user.id, text: 'Erste Nachricht' });
    return error?.message || null;
  }, einzel.id);
  ok('Danach lässt sich darin schreiben', !nachricht, nachricht || '');

  const gruppe = await p.evaluate(async () => {
    const s = await session();
    const id = crypto.randomUUID();
    const a = await sb.from('chats').insert({ id, art:'gruppe', name:'Regelprobe', erstellt_von: s.user.id });
    const b = await sb.from('chat_mitglieder').insert([
      { chat_id: id, user_id: s.user.id },
      { chat_id: id, user_id: 'u9-thomas' },
      { chat_id: id, user_id: 'u9-marco' }
    ]);
    return { chat: a.error?.message || null, mitglieder: b.error?.message || null };
  });
  ok('Gruppe mit mehreren Personen geht auch', !gruppe.chat && !gruppe.mitglieder,
     gruppe.chat || gruppe.mitglieder || '');

  /* Und die Gegenprobe: ein Gespräch, das jemand anderes angelegt hat und
     an dem man nicht beteiligt ist. c2 gehört Adrian. */
  const fremd = await p.evaluate(async () => {
    const s = await session();
    const d = JSON.parse(sessionStorage.getItem('__stub_db'));
    // Erst die eigene Mitgliedschaft aus dem fremden Gespräch entfernen,
    // damit es wirklich fremd ist.
    d.chat_mitglieder = d.chat_mitglieder.filter(m => !(m.chat_id === 'c2' && m.user_id === s.user.id));
    sessionStorage.setItem('__stub_db', JSON.stringify(d));
    const { error } = await sb.from('chat_mitglieder').insert({ chat_id:'c2', user_id: s.user.id });
    return error?.message || null;
  });
  ok('In ein fremdes Gespräch kommt niemand hinein', !!fremd, fremd || 'DURCHGELASSEN');
  ok('Und die Meldung sagt auch warum', (fremd || '').includes('row-level security'), fremd || '');

  await ctx.close();
}

/* ===== 11. Eine einzelne Nachricht löschen ================================ */

console.log('\n=== Nachricht löschen ===');
{
  const ctx = await baueKontext(1440);
  const p = await anmelden(ctx);
  await p.goto(`${SERVER}/chat.html?chat=c1`, { waitUntil:'networkidle' });
  await p.waitForTimeout(1200);

  ok('Nur an der eigenen Nachricht steht ein Löschknopf',
     (await p.$$('#verlauf [data-loeschen]')).length === 1);
  ok('Und zwar in der eigenen Blase',
     (await p.$$('#verlauf .ch-blase.ich [data-loeschen]')).length === 1);

  await p.click('#verlauf [data-loeschen]');
  await p.waitForSelector('#f-ja', { state:'visible' });
  const gefragt = await p.textContent('.sheet');
  ok('Vor dem Löschen wird gefragt', gefragt.includes('Nachricht löschen?'), gefragt.slice(0, 40));
  ok('Mit dem Hinweis auf den Platzhalter', gefragt.includes('Nachricht gelöscht'));
  await p.click('#f-ja');
  await p.waitForTimeout(1000);

  ok('Der Verlauf behält seine Länge', (await blasen(p)).length === 3, String((await blasen(p)).length));
  ok('An der Stelle steht der Platzhalter', (await blasen(p))[1] === 'Nachricht gelöscht', (await blasen(p)).join(' | '));
  ok('Die Blase ist als gelöscht gekennzeichnet', (await p.$$('#verlauf .ch-blase.geloescht')).length === 1);
  ok('Und lässt sich nicht noch einmal löschen', (await p.$$('#verlauf [data-loeschen]')).length === 0);
  ok('Die Nachrichten darum herum stehen unverändert da',
     (await blasen(p))[0].startsWith('bin um 9') && (await blasen(p))[2].startsWith('Rechnung'));
  ok('Die Liste zeigt weiter die letzte Nachricht',
     (await p.textContent('#gespraeche')).includes('Silvia: Rechnung'));
  await p.screenshot({ path:`${OUT}/geloescht.png`, fullPage:true });

  const zeile = await p.evaluate(() =>
    JSON.parse(sessionStorage.getItem('__stub_db')).nachrichten.find(n => n.id === 'n2'));
  ok('In der Datenbank ist der Inhalt weg', (zeile.text ?? null) === null, String(zeile.text));
  ok('Der Löschzeitpunkt steht drin', !!zeile.geloescht_am, String(zeile.geloescht_am));
  ok('Die Zeile selbst bleibt stehen', zeile.id === 'n2' && zeile.chat_id === 'c1');

  await p.reload({ waitUntil:'networkidle' });
  await p.waitForTimeout(1200);
  ok('Nach dem Neuladen steht der Platzhalter immer noch da',
     (await blasen(p))[1] === 'Nachricht gelöscht');

  /* Die Gegenprobe am Client vorbei: eine fremde Nachricht. In der
     Datenbank hält die Policy dagegen, hier der Nachbau davon. */
  const fremd = await p.evaluate(async () => {
    const lies = () => JSON.parse(sessionStorage.getItem('__stub_db')).nachrichten.find(n => n.id === 'n1');
    const vorher = lies().text;
    const { error } = await sb.from('nachrichten')
      .update({ text: null, bild_pfad: null, geloescht_am: new Date().toISOString() }).eq('id', 'n1');
    return { vorher, nachher: lies().text, geloescht: lies().geloescht_am ?? null, fehler: error?.message || null };
  });
  ok('Eine fremde Nachricht lässt sich auch am Bildschirm vorbei nicht löschen',
     fremd.nachher === fremd.vorher && !fremd.geloescht, `${fremd.vorher} → ${fremd.nachher}`);

  /* Und die zweite Gegenprobe: die eigene Nachricht umschreiben statt
     löschen. Der Trigger lässt genau die eine Änderung zu. */
  await p.fill('#e-text', 'Steht so und bleibt so');
  await p.click('#e-senden');
  await p.waitForTimeout(900);
  const umschreiben = await p.evaluate(async () => {
    const d = JSON.parse(sessionStorage.getItem('__stub_db'));
    const eigene = d.nachrichten.filter(n => n.absender === 'u1' && n.text).pop();
    const { error } = await sb.from('nachrichten').update({ text: 'ganz was anderes' }).eq('id', eigene.id);
    return error?.message || null;
  });
  ok('Auch umschreiben geht nicht', !!umschreiben, umschreiben || 'DURCHGELASSEN');

  await ctx.close();
}

/* ===== 12. Admin in der Gruppe, und wer löschen darf ====================== */

/* Dieselbe Ordnung wie in den üblichen Messengern: wer die Gruppe anlegt,
   führt sie und kann diese Rolle weitergeben; nur ein Admin löscht für
   alle. Alle anderen können gehen, ohne die Gruppe mitzunehmen. Im
   Einzelchat bleibt es dabei, dass jedes der beiden Mitglieder beenden
   darf — es sind ja nur zwei. */

console.log('\n=== Gruppe ohne Admin-Recht ===');
{
  const saat = structuredClone(SAAT);
  // Die Gruppe gehört jemand anderem, und der führt sie auch.
  saat.chats.find(c => c.id === 'c1').erstellt_von = 'u9-adrian';
  saat.chat_mitglieder.forEach(m => {
    if (m.chat_id === 'c1') m.admin = m.user_id === 'u9-adrian';
  });

  const ctx = await baueKontext(1440, { saat });
  const p = await anmelden(ctx);
  await p.goto(`${SERVER}/chat.html?chat=c1`, { waitUntil:'networkidle' });
  await p.waitForTimeout(1200);

  await p.click('#g-mehr');
  await p.waitForSelector('#g-raus', { state:'visible' });
  ok('Ohne Admin-Recht steht kein Löschknopf da',
     await p.locator('#g-weg').count() === 0);
  ok('Dafür der Weg hinaus', await p.locator('#g-raus').isVisible());
  ok('Mitglieder pflegen darf diese Person nicht',
     (await p.$$('[data-mit]:not([disabled])')).length === 0);
  const menue = await p.textContent('.sheet');
  ok('Das Menü nennt den Admin beim Namen', menue.includes('Admin ist Adrian Zemp'), menue.slice(0, 90));
  ok('Und sagt, wer löschen darf', menue.includes('gelöscht wird sie nur von einem Admin'));
  const zeilen = await p.$$eval('.ch-mitzeile', e => e.map(x => x.textContent.replace(/\s+/g, ' ').trim()));
  ok('Beim Admin steht das Abzeichen',
     zeilen.some(t => t.includes('Adrian Zemp') && t.endsWith('Admin'))
     && !zeilen.some(t => t.includes('Silvia Weber') && t.endsWith('Admin')),
     zeilen.join(' | '));

  // Auch am Bildschirm vorbei geht nichts: weder löschen noch sich selbst ernennen.
  const versuche = await p.evaluate(async () => {
    const r1 = await sb.from('chats').delete().eq('id', 'c1').select();
    const r2 = await sb.from('chat_mitglieder').update({ admin: true })
      .eq('chat_id', 'c1').eq('user_id', 'u1').select();
    const r3 = await sb.from('chat_mitglieder').delete()
      .eq('chat_id', 'c1').eq('user_id', 'u9-silvia').select();
    return { weg: (r1.data || []).length, chef: r2.error?.message || `durchgelassen`,
             raus: (r3.data || []).length,
             chats: JSON.parse(sessionStorage.getItem('__stub_db')).chats.map(c => c.id) };
  });
  ok('Löschen trifft keine Zeile', versuche.weg === 0 && versuche.chats.includes('c1'));
  ok('Zum Admin macht sich niemand selbst',
     /anderer Admin/.test(versuche.chef), versuche.chef);
  ok('Und fremde Mitglieder trägt man nicht aus', versuche.raus === 0, String(versuche.raus));

  // Austreten: die Gruppe bleibt für die übrigen stehen.
  await p.click('#g-raus');
  await p.waitForSelector('#f-ja', { state:'visible' });
  const frage = await p.textContent('.sheet:has(#f-ja)');
  ok('Vor dem Verlassen wird gefragt', frage.includes('Gruppe verlassen?'), frage.slice(0, 40));
  ok('Mit dem Hinweis, dass sie ohne einen weiterläuft',
     frage.includes('läuft ohne Sie weiter'));
  await p.click('#f-ja');
  await p.waitForTimeout(1400);

  const nachher = await p.evaluate(() => {
    const d = JSON.parse(sessionStorage.getItem('__stub_db'));
    return { chats: d.chats.map(c => c.id),
             c1: d.chat_mitglieder.filter(m => m.chat_id === 'c1').map(m => m.user_id),
             nachrichten: d.nachrichten.filter(n => n.chat_id === 'c1').length };
  });
  ok('Die Gruppe steht weiterhin da', nachher.chats.includes('c1'), nachher.chats.join(','));
  ok('Nur die eigene Mitgliedschaft ist weg',
     !nachher.c1.includes('u1') && nachher.c1.length === 2, nachher.c1.join(','));
  ok('Die Nachrichten der anderen bleiben', nachher.nachrichten === 3, String(nachher.nachrichten));
  ok('Und aus der eigenen Liste ist sie verschwunden',
     !(await namen(p)).includes('Mille Fiori Team'), (await namen(p)).join(' | '));

  await ctx.close();
}

console.log('\n=== Admin ernennen und weitergeben ===');
{
  const ctx = await baueKontext(1440);   // hier ist u1 selbst Admin von c1
  const p = await anmelden(ctx);
  await p.goto(`${SERVER}/chat.html?chat=c1`, { waitUntil:'networkidle' });
  await p.waitForTimeout(1200);

  await p.click('#g-mehr');
  await p.waitForSelector('[data-admin]', { state:'visible' });
  const menue = await p.textContent('.sheet');
  ok('Als Admin sagt es das Menü', menue.includes('Sie sind Admin dieser Gruppe'), menue.slice(0, 90));
  ok('Mitglieder pflegen geht jetzt',
     (await p.$$('[data-mit]:not([disabled])')).length > 0);
  ok('Neben jedem Mitglied steht ein Admin-Schalter',
     (await p.$$('[data-admin]')).length === 2,
     String((await p.$$('[data-admin]')).length));
  ok('Noch ist niemand sonst Admin',
     (await p.$$('[data-admin][aria-pressed="true"]')).length === 0);

  await p.click('[data-admin="u9-silvia"]');
  await p.waitForTimeout(1000);
  ok('Silvia ist jetzt Admin',
     await p.evaluate(() => JSON.parse(sessionStorage.getItem('__stub_db'))
       .chat_mitglieder.some(m => m.chat_id === 'c1' && m.user_id === 'u9-silvia' && m.admin === true)));
  ok('Und der Schalter zeigt es',
     await p.locator('[data-admin="u9-silvia"][aria-pressed="true"]').count() === 1);

  // Mit zwei Admins darf der erste gehen.
  await p.click('#g-raus');
  await p.waitForSelector('#f-ja', { state:'visible' });
  await p.click('#f-ja');
  await p.waitForTimeout(1400);
  const rest = await p.evaluate(() => {
    const d = JSON.parse(sessionStorage.getItem('__stub_db'));
    return { chats: d.chats.map(c => c.id),
             c1: d.chat_mitglieder.filter(m => m.chat_id === 'c1').map(m => `${m.user_id}${m.admin ? '*' : ''}`) };
  });
  ok('Ein Admin darf gehen, solange ein anderer bleibt',
     rest.chats.includes('c1') && rest.c1.join(',') === 'u9-adrian,u9-silvia*', rest.c1.join(','));

  await ctx.close();
}

console.log('\n=== Der letzte Admin bleibt ===');
{
  const ctx = await baueKontext(1440);
  const p = await anmelden(ctx);
  await p.goto(`${SERVER}/chat.html?chat=c1`, { waitUntil:'networkidle' });
  await p.waitForTimeout(1200);

  await p.click('#g-mehr');
  await p.waitForSelector('#g-raus', { state:'visible' });
  await p.click('#g-raus');
  await p.waitForSelector('#f-ja', { state:'visible' });
  await p.click('#f-ja');
  await p.waitForTimeout(1200);

  const stand = await p.evaluate(() => {
    const d = JSON.parse(sessionStorage.getItem('__stub_db'));
    return d.chat_mitglieder.filter(m => m.chat_id === 'c1').map(m => m.user_id);
  });
  ok('Der einzige Admin kommt nicht heraus', stand.includes('u1'), stand.join(','));
  ok('Und die App sagt warum',
     (await p.textContent('body')).includes('braucht einen Admin'));

  // Auch das Häkchen ablegen geht nicht, solange niemand sonst es trägt.
  const ablegen = await p.evaluate(async () => {
    const r = await sb.from('chat_mitglieder').update({ admin: false })
      .eq('chat_id', 'c1').eq('user_id', 'u1');
    return r.error?.message || 'durchgelassen';
  });
  ok('Das Häkchen legt der letzte Admin auch nicht ab',
     /braucht einen Admin|anderer Admin/.test(ablegen), ablegen);

  await ctx.close();
}

console.log('\n=== Gespräch löschen ===');
{
  const saat = structuredClone(SAAT);   // u1 ist Admin von c1
  saat.nachrichten.push({ id:'nb9', chat_id:'c1', absender:'u1', text:null,
    bild_pfad:'c1/plan.jpg', bild_ablauf:new Date(Date.now() + 30*86400000).toISOString(),
    erstellt_am:heute('2026-09-18T07:30:00.000Z') });
  saat.__objekte = { 'c1/plan.jpg': { name:'plan.jpg', groesse: 10 } };

  const ctx = await baueKontext(1440, { saat });
  const p = await anmelden(ctx);
  await p.goto(`${SERVER}/chat.html?chat=c1`, { waitUntil:'networkidle' });
  await p.waitForTimeout(1200);

  await p.click('#g-mehr');
  await p.waitForSelector('#g-weg', { state:'visible' });
  ok('Als Admin steht der Löschknopf da', await p.locator('#g-weg').isVisible());
  const hinweis = await p.textContent('.sheet');
  ok('Das Menü sagt, was das Löschen bedeutet', hinweis.includes('auch bei den anderen Beteiligten'));

  await p.click('#g-weg');
  await p.waitForSelector('#f-ja', { state:'visible' });
  // Das Menü schliesst sich mit einer kurzen Blende — gemeint ist die
  // Rückfrage, also das Blatt mit dem Ja-Knopf darin.
  const rueckfrage = await p.textContent('.sheet:has(#f-ja)');
  ok('Vor dem Löschen wird gefragt', rueckfrage.includes('Gespräch löschen?'), rueckfrage.slice(0, 40));
  ok('Und gesagt, dass es für alle gilt',
     rueckfrage.includes('auch bei allen anderen Beteiligten'));
  await p.click('#f-ja');
  await p.waitForTimeout(1400);

  ok('Das Gespräch ist aus der Liste verschwunden', !(await namen(p)).includes('Mille Fiori Team'),
     (await namen(p)).join(' | '));
  ok('Das andere steht noch da', (await namen(p)).includes('Adrian Zemp'));
  ok('Die rechte Spalte steht wieder auf Auswahl',
     (await p.textContent('#verlauf')).includes('Links ein Gespräch auswählen'));

  const rest = await p.evaluate(() => {
    const d = JSON.parse(sessionStorage.getItem('__stub_db'));
    return {
      chats: d.chats.map(c => c.id),
      mitglieder: d.chat_mitglieder.filter(m => m.chat_id === 'c1').length,
      nachrichten: d.nachrichten.filter(n => n.chat_id === 'c1').length,
      bild: !!(d.__objekte || {})['c1/plan.jpg']
    };
  });
  ok('Die Zeile ist wirklich weg, kein Ausblenden', !rest.chats.includes('c1'), rest.chats.join(','));
  ok('Die Mitgliedschaften fallen mit', rest.mitglieder === 0, String(rest.mitglieder));
  ok('Die Nachrichten auch', rest.nachrichten === 0, String(rest.nachrichten));
  ok('Und die Bilder im Ablageordner', rest.bild === false);

  /* Ein Gespräch, an dem man nicht beteiligt ist, geht niemanden etwas an
     — auch nicht zum Löschen. */
  const fremd = await p.evaluate(async () => {
    const s = await session();
    const d = JSON.parse(sessionStorage.getItem('__stub_db'));
    d.chat_mitglieder = d.chat_mitglieder.filter(m => !(m.chat_id === 'c2' && m.user_id === s.user.id));
    sessionStorage.setItem('__stub_db', JSON.stringify(d));
    await sb.from('chats').delete().eq('id', 'c2');
    return JSON.parse(sessionStorage.getItem('__stub_db')).chats.some(c => c.id === 'c2');
  });
  ok('Ein fremdes Gespräch lässt sich nicht löschen', fremd === true);

  await ctx.close();
}

/* Im Einzelchat ändert sich nichts: c2 hat Adrian angelegt, löschen darf
   es trotzdem jedes der beiden Mitglieder. Das Admin-Häkchen spielt dort
   keine Rolle und niemand bekommt es. */
console.log('\n=== Einzelchat bleibt wie bisher ===');
{
  const ctx = await baueKontext(1440);
  const p = await anmelden(ctx);
  await p.goto(`${SERVER}/chat.html?chat=c2`, { waitUntil:'networkidle' });
  await p.waitForTimeout(1200);

  await p.click('#g-mehr');
  await p.waitForSelector('#g-weg', { state:'visible' });
  ok('Auch ohne die Gruppe angelegt zu haben, steht der Löschknopf da',
     await p.locator('#g-weg').isVisible());
  ok('Ohne Mitgliederliste und ohne Austritt',
     await p.locator('[data-mit]').count() === 0 && await p.locator('#g-raus').count() === 0);
  ok('Und ohne Admin-Schalter', await p.locator('[data-admin]').count() === 0);
  ok('Das Menü nennt es ein Einzelgespräch',
     (await p.textContent('.sheet')).includes('Einzelgespräch mit Adrian Zemp'));

  await p.click('#g-weg');
  await p.waitForSelector('#f-ja', { state:'visible' });
  await p.click('#f-ja');
  await p.waitForTimeout(1400);
  ok('Und das Löschen geht durch',
     await p.evaluate(() => !JSON.parse(sessionStorage.getItem('__stub_db')).chats.some(c => c.id === 'c2')));

  // Ein neu angelegter Einzelchat bekommt kein Admin-Häkchen.
  const frisch = await p.evaluate(async () => {
    const id = crypto.randomUUID();
    await sb.from('chats').insert({ id, art: 'einzel', erstellt_von: 'u1' });
    await sb.from('chat_mitglieder').insert([
      { chat_id: id, user_id: 'u1' }, { chat_id: id, user_id: 'u9-marco' }]);
    const { data } = await sb.from('chat_mitglieder').select('user_id, admin').eq('chat_id', id);
    return (data || []).map(m => `${m.user_id}:${m.admin}`).join(',');
  });
  ok('Im neuen Einzelchat trägt niemand ein Admin-Häkchen',
     frisch === 'u1:false,u9-marco:false', frisch);

  await ctx.close();
}

/* ===== 13. Zeitstempel und Lesebestätigung =============================== */

console.log('\n=== Zeit und Haken ===');
{
  const saat = structuredClone(SAAT);
  saat.nachrichten.unshift({ id:'nalt', chat_id:'c1', absender:'u9-adrian',
    text:'Vom letzten Monat', bild_pfad:null, bild_ablauf:null,
    erstellt_am:'2026-08-20T11:05:00.000Z' });

  const ctx = await baueKontext(1440, { saat });
  const p = await anmelden(ctx);
  await p.goto(`${SERVER}/chat.html?chat=c1`, { waitUntil:'networkidle' });
  await p.waitForTimeout(1200);

  const wann = await p.$$eval('#verlauf .ch-fuss .wann', e => e.map(x => x.textContent.trim()));
  ok('Jede Nachricht trägt eine Zeit', wann.length === 4, `${wann.length} von 4`);
  ok('Die ältere zusätzlich mit Datum', /^\d{2}\.\d{2}\., \d{2}:\d{2}$/.test(wann[0]), wann[0]);
  ok('Die von heute nur mit Uhrzeit',
     wann.slice(1).every(t => /^\d{2}:\d{2}$/.test(t)), wann.slice(1).join(' | '));

  ok('Die eigene Nachricht zeigt einen Haken',
     (await p.$$('#verlauf .ch-blase.ich .haken')).length === 1);
  ok('Solange niemand gelesen hat, bleibt es bei einem',
     (await p.$$('#verlauf .ch-blase.ich .haken.gelesen')).length === 0);
  ok('Fremde Nachrichten tragen keine Haken',
     (await p.$$('#verlauf .ch-blase.andere .haken')).length === 0);
  await p.screenshot({ path:`${OUT}/haken.png`, fullPage:true });
  await ctx.close();
}

{
  // Alle anderen haben gelesen: zwei Haken.
  const saat = structuredClone(SAAT);
  for (const m of saat.chat_mitglieder) {
    if (m.chat_id === 'c1' && m.user_id !== 'u1') m.zuletzt_gelesen = heute('2026-09-18T08:00:00.000Z');
  }
  const ctx = await baueKontext(1440, { saat });
  const p = await anmelden(ctx);
  await p.goto(`${SERVER}/chat.html?chat=c1`, { waitUntil:'networkidle' });
  await p.waitForTimeout(1200);
  ok('Haben alle gelesen, stehen zwei Haken',
     (await p.$$('#verlauf .ch-blase.ich .haken.gelesen')).length === 1);
  await ctx.close();
}

{
  // In der Gruppe genügt eine Person nicht.
  const saat = structuredClone(SAAT);
  const einer = saat.chat_mitglieder.find(m => m.chat_id === 'c1' && m.user_id === 'u9-adrian');
  einer.zuletzt_gelesen = heute('2026-09-18T08:00:00.000Z');
  const ctx = await baueKontext(1440, { saat });
  const p = await anmelden(ctx);
  await p.goto(`${SERVER}/chat.html?chat=c1`, { waitUntil:'networkidle' });
  await p.waitForTimeout(1200);
  ok('In der Gruppe reicht eine Person nicht für zwei Haken',
     (await p.$$('#verlauf .ch-blase.ich .haken.gelesen')).length === 0);
  ok('Es bleibt beim einen Haken',
     (await p.$$('#verlauf .ch-blase.ich .haken')).length === 1);
  await ctx.close();
}

/* ===== 14. Uhrzeit, Haken und Eimer bleiben auseinander ================== */

for (const breite of [390, 1440]) {
  console.log(`\n=== Fusszeile lesbar (${breite}px) ===`);
  const ctx = await baueKontext(breite);
  const p = await anmelden(ctx);
  await p.goto(`${SERVER}/chat.html?chat=c1`, { waitUntil:'networkidle' });
  await p.waitForTimeout(1200);

  const mass = await p.evaluate(() => {
    const f = document.querySelector('#verlauf .ch-blase.ich .ch-fuss');
    const kasten = w => { const el = f.querySelector(w); return el ? el.getBoundingClientRect() : null; };
    const wann = kasten('.wann'), haken = kasten('.haken'), weg = kasten('.ch-weg');
    return {
      zeitZuHaken: Math.round(haken.left - wann.right),
      hakenZuWeg: Math.round(weg.left - haken.right),
      eineZeile: Math.abs(wann.top - weg.top) < 14,
      ruhig: getComputedStyle(f.querySelector('.ch-weg')).opacity
    };
  });

  ok('Zwischen Uhrzeit und Haken liegt Luft', mass.zeitZuHaken >= 8, `${mass.zeitZuHaken}px`);
  ok('Zwischen Haken und Eimer noch etwas mehr', mass.hakenZuWeg >= 10, `${mass.hakenZuWeg}px`);
  ok('Alle drei stehen auf einer Zeile', mass.eineZeile);
  ok('Der Eimer drängt sich nicht auf, bis man hinfährt', Number(mass.ruhig) < 0.5, mass.ruhig);

  await p.hover('#verlauf .ch-blase.ich');
  await p.waitForTimeout(300);
  const beimZeigen = await p.$eval('#verlauf .ch-blase.ich .ch-weg', el => getComputedStyle(el).opacity);
  ok('Beim Darüberfahren erscheint er', Number(beimZeigen) >= 0.5, beimZeigen);
  ok('Und lässt sich dann auch anklicken',
     await p.locator('#verlauf .ch-blase.ich .ch-weg').isVisible());
  await p.screenshot({ path:`${OUT}/${breite}-fusszeile.png` });
  await ctx.close();
}

{
  // Und der Wechsel geschieht ohne Neuladen.
  console.log('\n=== Haken in Echtzeit ===');
  const ctx = await baueKontext(1440, { geteilt: true });
  const eins = await anmelden(ctx);
  await eins.goto(`${SERVER}/chat.html?chat=c1`, { waitUntil:'networkidle' });
  await eins.waitForTimeout(1200);
  ok('Vorher ein Haken', (await eins.$$('#verlauf .ch-blase.ich .haken.gelesen')).length === 0);

  const zwei = await anmelden(ctx);
  await zwei.goto(`${SERVER}/chat.html`, { waitUntil:'networkidle' });
  await zwei.waitForTimeout(900);
  /* Die Gegenseite liest — im echten Betrieb tut das ihre App beim
     Öffnen, von ihrem Konto aus. Von hier aus lässt sich das nicht
     nachspielen: den Lesestand setzt jede Person nur bei sich selbst,
     dafür sorgt der Trigger. Also wird die Zeile direkt in der
     gemeinsamen Ablage gesetzt und derselbe Anstoss ausgelöst, den der
     Change-Feed schickt. */
  const fremderStand = await zwei.evaluate(async () => {
    const r = await sb.from('chat_mitglieder').update({ zuletzt_gelesen: new Date().toISOString() })
      .eq('chat_id', 'c1').eq('user_id', 'u9-adrian');
    return r.error?.message || 'durchgelassen';
  });
  ok('Den Lesestand einer anderen Person setzt niemand',
     /nur bei sich selbst/.test(fremderStand), fremderStand);

  await zwei.evaluate(() => {
    const jetzt = new Date().toISOString();
    const d = JSON.parse(localStorage.getItem('__stub_db'));
    const reihen = [];
    d.chat_mitglieder = d.chat_mitglieder.map(m => {
      if (m.chat_id !== 'c1' || m.user_id === 'u1') return m;
      const n = { ...m, zuletzt_gelesen: jetzt };
      reihen.push(n);
      return n;
    });
    localStorage.setItem('__stub_db', JSON.stringify(d));
    localStorage.setItem('__stub_ereignis', JSON.stringify({
      tabelle: 'chat_mitglieder', reihen, art: 'UPDATE', n: Date.now() }));
  });
  await eins.waitForTimeout(1600);
  ok('Sobald alle gelesen haben, werden ohne Neuladen zwei daraus',
     (await eins.$$('#verlauf .ch-blase.ich .haken.gelesen')).length === 1);

  await ctx.close();
}

/* ===== 15. Die Anmeldung für Benachrichtigungen schweigt nicht ==========
   Geräte und Dienst gibt es im Test nicht, also werden sie nachgebildet.
   Geprüft wird nicht Web Push, sondern das, was hier schiefging: eine
   Anmeldung, die scheitert, ohne dass jemand etwas davon sieht. */

console.log('\n=== Benachrichtigungen: Fehler sichtbar ===');
{
  const ctx = await baueKontext(1440, { erlaubnis: 'granted' });
  const p = await anmelden(ctx);
  await p.goto(`${SERVER}/chat.html`, { waitUntil:'networkidle' });
  await p.waitForTimeout(900);

  const nachbilden = art => p.evaluate(a => {
    const abo = {
      toJSON: () => ({ endpoint:'https://push.example/abo-neu',
                       keys:{ p256dh:'p'.repeat(87), auth:'a'.repeat(22) } }),
      options: {},
      unsubscribe: async () => true
    };
    Object.defineProperty(navigator.serviceWorker, 'ready', {
      configurable: true,
      get: () => Promise.resolve({ pushManager: {
        getSubscription: async () => null,
        subscribe: async () => {
          if (a === 'dienst') {
            const e = new Error('Registration failed - push service error');
            e.name = 'AbortError';
            throw e;
          }
          return abo;
        }
      } })
    });
    try {
      if (a === 'tabelle') sessionStorage.setItem('__stub_fehler', 'push_geraete');
      else sessionStorage.removeItem('__stub_fehler');
    } catch {}
    document.querySelectorAll('.toast').forEach(t => t.remove());
  }, art);

  ok('Die Erlaubnis gilt als erteilt',
     await p.evaluate(() => Notification.permission) === 'granted');

  // --- Der gute Fall ---------------------------------------------------------
  await nachbilden('gut');
  const gutgegangen = await p.evaluate(() => pushAnmelden({ laut: true }));
  await p.waitForTimeout(400);
  ok('Die Anmeldung geht durch', gutgegangen === true, String(gutgegangen));
  const zeile = await p.evaluate(() =>
    JSON.parse(sessionStorage.getItem('__stub_db')).push_geraete?.[0] || null);
  ok('Das Gerät steht in push_geraete', !!zeile && zeile.endpunkt === 'https://push.example/abo-neu',
     JSON.stringify(zeile));
  ok('Mit Schlüssel und Kennung', !!zeile && zeile.p256dh.length === 87 && zeile.auth.length === 22);
  ok('Und ohne Fehlermeldung auf dem Bildschirm',
     (await p.$$('.toast.err')).length === 0);

  // --- Der Dienst lehnt ab ---------------------------------------------------
  await nachbilden('dienst');
  const abgelehnt = await p.evaluate(() => pushAnmelden({ laut: true }));
  await p.waitForTimeout(500);
  const meldung1 = await p.$$eval('.toast.err', e => e.map(x => x.textContent).join(' | '));
  ok('Lehnt der Dienst ab, ist die Anmeldung gescheitert', abgelehnt === false);
  ok('Und es steht auf dem Bildschirm', meldung1.includes('liessen sich nicht einschalten'), meldung1);
  ok('Mit dem Grund', meldung1.includes('beim Dienst nicht anmelden'), meldung1);

  // --- Die Zeile lässt sich nicht schreiben ----------------------------------
  await nachbilden('tabelle');
  const nichtGespeichert = await p.evaluate(() => pushAnmelden({ laut: true }));
  await p.waitForTimeout(500);
  const meldung2 = await p.$$eval('.toast.err', e => e.map(x => x.textContent).join(' | '));
  ok('Scheitert das Eintragen, gilt die Anmeldung nicht als erledigt', nichtGespeichert === false);
  ok('Auch das steht auf dem Bildschirm', meldung2.includes('nicht eintragen'), meldung2);
  await p.screenshot({ path:`${OUT}/push-fehler.png` });

  await ctx.close();
}


/* ===== Erweiterung: Reaktionen, Stumm, Fotos, Medien, Suche, @ ============ */

/* Sechs Dinge, die nebeneinander stehen und einander nicht berühren.
   Geprüft wird jedes einzeln und am Ende, dass sie sich gegenseitig
   nicht im Weg stehen — genau dort geht bei additiven Erweiterungen
   sonst etwas kaputt. */

/* Ein Gespräch mit Fotos und mehr Text, damit Medien und Suche etwas zu
   zeigen haben. Es steht nur hier, damit die Zahlen der anderen
   Abschnitte gleich bleiben. */
const SAAT_PLUS = (() => {
  const d = JSON.parse(JSON.stringify(SAAT));
  const T = (h, m) => `${HEUTE}T${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:00.000Z`;
  const morgen = new Date(Date.now() + 25 * 86400000).toISOString();
  d.nachrichten.push(
    { id:'p1', chat_id:'c1', absender:'u9-adrian', text:'Der Kran steht seit heute früh still',
      bild_pfad:null, bild_ablauf:null, erstellt_am:T(8, 5) },
    { id:'p2', chat_id:'c1', absender:'u9-silvia', text:null,
      bild_pfad:'c1/foto-a.jpg', bild_ablauf:morgen, erstellt_am:T(8, 20) },
    { id:'p3', chat_id:'c1', absender:'u9-adrian', text:null,
      bild_pfad:'c1/foto-b.jpg', bild_ablauf:morgen, erstellt_am:T(8, 40) },
    { id:'p4', chat_id:'c1', absender:'u9-silvia',
      text:'@[Jonas Zemp](u1) schaust du dir den Kran an?',
      bild_pfad:null, bild_ablauf:null, erstellt_am:T(9, 0) }
  );
  d.nachrichten_reaktionen = [
    { nachricht_id:'p1', user_id:'u9-silvia', emoji:'\u{1F44D}' },
    { nachricht_id:'p1', user_id:'u9-adrian', emoji:'\u{1F44D}' },
    { nachricht_id:'p1', user_id:'u9-thomas', emoji:'❗' }
  ];
  /* Die Ablage im Stub schluesselt ohne den Bucket-Namen — genauso wie
     storage.from('chat-bilder').createSignedUrl('c1/foto-a.jpg') fragt. */
  d.__objekte = Object.assign({}, d.__objekte, {
    'c1/foto-a.jpg': { name:'foto-a.jpg', groesse:1024, typ:'image/jpeg', inhalt:null },
    'c1/foto-b.jpg': { name:'foto-b.jpg', groesse:1024, typ:'image/jpeg', inhalt:null }
  });
  return d;
})();

const gruppeAuf = async p => {
  await p.click('#gespraeche .ch-zeile:first-child');
  await p.waitForTimeout(900);
};

/* --- 1. Reaktionen -------------------------------------------------------- */

console.log('\n=== Reaktionen an einer Nachricht ===');
{
  const ctx = await baueKontext(390, { saat: SAAT_PLUS });
  const p = await anmelden(ctx);
  await p.goto(`${SERVER}/chat.html`, { waitUntil:'networkidle' });
  await p.waitForTimeout(700);
  await gruppeAuf(p);

  const blase = () => p.locator('#n-p1');
  ok('Die Reaktionen aus der Saat stehen unter der Nachricht',
     await blase().locator('.ch-reaktion').count() === 2,
     String(await blase().locator('.ch-reaktion').count()));
  ok('Der Daumen zählt zwei, das Ausrufezeichen eines',
     (await blase().locator('.ch-reaktion').allTextContents()).join('|').replace(/\s/g,'') === '\u{1F44D}2|❗1',
     (await blase().locator('.ch-reaktion').allTextContents()).join('|'));
  ok('Keine davon ist meine',
     await blase().locator('.ch-reaktion.meine').count() === 0);
  ok('Die Namen stehen im Titel',
     (await blase().locator('.ch-reaktion').first().getAttribute('title')).includes('Silvia'),
     await blase().locator('.ch-reaktion').first().getAttribute('title'));

  // Mitreagieren: ein Tipp auf den bestehenden Daumen
  await blase().locator('.ch-reaktion').first().click();
  await p.waitForTimeout(600);
  ok('Ein Tipp macht aus zwei Daumen drei',
     (await blase().locator('.ch-reaktion').first().textContent()).replace(/\s/g,'') === '\u{1F44D}3',
     await blase().locator('.ch-reaktion').first().textContent());
  ok('Und hebt sie als meine hervor',
     await blase().locator('.ch-reaktion.meine').count() === 1);
  ok('In der Datenbank steht eine Zeile mehr',
     (await p.evaluate(() => JSON.parse(sessionStorage.getItem('__stub_db')).nachrichten_reaktionen.length)) === 4);

  // Zurücknehmen
  await blase().locator('.ch-reaktion.meine').click();
  await p.waitForTimeout(600);
  ok('Noch ein Tipp nimmt sie zurück',
     (await blase().locator('.ch-reaktion').first().textContent()).replace(/\s/g,'') === '\u{1F44D}2',
     await blase().locator('.ch-reaktion').first().textContent());
  ok('Und die Zeile ist wieder weg',
     (await p.evaluate(() => JSON.parse(sessionStorage.getItem('__stub_db')).nachrichten_reaktionen.length)) === 3);

  // Die Auswahl beim Halten
  await p.locator('#n-p4').dispatchEvent('contextmenu');
  await p.waitForTimeout(500);
  ok('Langes Drücken öffnet die Auswahl', await p.locator('.ch-reaktionswahl').count() === 1);
  ok('Sie bietet genau fünf Zeichen',
     await p.locator('.ch-reaktionswahl button').count() === 5,
     String(await p.locator('.ch-reaktionswahl button').count()));
  ok('Und zwar die aus der Vorgabe',
     (await p.locator('.ch-reaktionswahl button').allTextContents()).join('') === '\u{1F44D}❤️✅\u{1F602}❗',
     (await p.locator('.ch-reaktionswahl button').allTextContents()).join(''));

  await p.locator('.ch-reaktionswahl button').nth(2).click();   // Haken
  await p.waitForTimeout(700);
  ok('Die gewählte Reaktion steht an der Nachricht',
     (await p.locator('#n-p4 .ch-reaktion').textContent()).replace(/\s/g,'') === '✅1',
     await p.locator('#n-p4 .ch-reaktion').textContent());
  ok('Eine Nachricht ohne Reaktion hat auch keine Zeile',
     await p.locator('#n-n2 .ch-reaktionen').count() === 0);

  // Eine fremde lässt sich nicht wegnehmen: die Policy trifft keine Zeile.
  const fremdWeg = await p.evaluate(async () =>
    (await sb.from('nachrichten_reaktionen').delete()
      .eq('nachricht_id','p1').eq('user_id','u9-silvia').eq('emoji','\u{1F44D}')).data.length);
  ok('Eine fremde Reaktion lässt sich nicht zurücknehmen', fremdWeg === 0, String(fremdWeg));

  // Und im fremden Namen geht gar nichts.
  const fremdSetzen = await p.evaluate(async () =>
    (await sb.from('nachrichten_reaktionen')
      .insert({ nachricht_id:'p1', user_id:'u9-silvia', emoji:'❤️' })).error?.message || null);
  ok('Im fremden Namen reagieren weist die Datenbank ab',
     /row-level security/.test(fremdSetzen || ''), String(fremdSetzen));

  await p.screenshot({ path:`${OUT}/reaktionen.png`, fullPage:true });
  await ctx.close();
}

/* --- 1b. Lesebestätigung im Detail ----------------------------------------
   Langes Antippen einer eigenen Nachricht in der Gruppe zeigt, wer sie
   gelesen hat und wer nicht. Dafür braucht es nichts Neues in der
   Datenbank: chat_mitglieder.zuletzt_gelesen steht seit dem
   Ungelesen-Zähler dort und trägt schon den zweiten Haken. Die Rechnung
   ist dieselbe, nur einzeln statt für alle zusammen. */

console.log('\n=== Wer hat gelesen ===');
{
  /* Eine eigene Nachricht in der Gruppe und eine im Einzelgespräch. Die
     Lesestände liegen absichtlich davor: gelesen hat sie noch niemand. */
  const saat = JSON.parse(JSON.stringify(SAAT_PLUS));
  const T = (h, m) => `${HEUTE}T${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:00.000Z`;
  saat.nachrichten.push(
    { id:'lb1', chat_id:'c1', absender:'u1', text:'Bitte alle den Plan anschauen',
      bild_pfad:null, bild_ablauf:null, erstellt_am:T(10, 0) },
    /* Früher als lb1: die Gruppe soll in der Liste zuoberst bleiben,
       sonst öffnet gruppeAuf() das Einzelgespräch. */
    { id:'lb2', chat_id:'c2', absender:'u1', text:'Die Pläne liegen im Büro',
      bild_pfad:null, bild_ablauf:null, erstellt_am:T(9, 50) }
  );
  for (const m of saat.chat_mitglieder) m.zuletzt_gelesen = T(9, 30);

  const ctx = await baueKontext(390, { saat });
  const p = await anmelden(ctx);
  await p.goto(`${SERVER}/chat.html`, { waitUntil:'networkidle' });
  await p.waitForTimeout(700);
  await gruppeAuf(p);

  const stand = () => p.locator('.ch-lesestand');
  const schliessen = async () => {
    await p.locator('.sheet-bg').last().click({ force:true, position:{ x:5, y:5 } });
    await p.waitForTimeout(400);
  };

  ok('Die eigene Nachricht trägt einen Haken',
     await p.locator('#n-lb1 .haken').count() === 1
       && await p.locator('#n-lb1 .haken.gelesen').count() === 0);

  await p.locator('#n-lb1').dispatchEvent('contextmenu');
  await p.waitForTimeout(500);
  ok('Langes Drücken zeigt den Lesestand', await stand().count() === 1);
  ok('Die Reaktionen bleiben daneben stehen',
     await p.locator('.ch-reaktionswahl button').count() === 5);
  ok('Noch hat niemand gelesen',
     (await stand().locator('.titel').textContent()).trim() === 'Gelesen von 0 von 2',
     await stand().locator('.titel').textContent());
  ok('Beide stehen unter "Noch nicht gelesen"',
     (await stand().locator('.marke').textContent()).includes('Noch nicht gelesen')
       && await stand().locator('.ch-lesezeile').count() === 2);
  ok('Mit Namen und ohne Uhrzeit',
     (await stand().locator('.ch-lesezeile .wer').allTextContents()).sort().join('|')
       === 'Adrian Zemp|Silvia Weber'
       && await stand().locator('.ch-lesezeile .wann').count() === 0,
     (await stand().locator('.ch-lesezeile .wer').allTextContents()).join('|'));
  ok('Die eigene Person steht nicht auf der Liste',
     !(await stand().textContent()).includes('Jonas Zemp'));
  await p.screenshot({ path:`${OUT}/lesestand-niemand.png`, fullPage:true });
  await schliessen();

  /* Adrian liest mit. Über Realtime wandert sein Lesestand weiter — und
     damit ändert sich genau eine Zeile im Blatt. */
  await p.evaluate(zeit => window.__stubMelde('chat_mitglieder',
    { chat_id:'c1', user_id:'u9-adrian', zuletzt_gelesen: zeit, admin:false }, 'UPDATE'),
    T(10, 30));
  await p.waitForTimeout(800);

  await p.locator('#n-lb1').dispatchEvent('contextmenu');
  await p.waitForTimeout(500);
  ok('Einer von zweien hat gelesen',
     (await stand().locator('.titel').textContent()).trim() === 'Gelesen von 1 von 2',
     await stand().locator('.titel').textContent());
  ok('Adrian steht im gelesenen Teil',
     (await stand().locator('.gelesen .wer').textContent()) === 'Adrian Zemp');
  ok('Mit dem Zeitpunkt daneben',
     /^\d{2}:\d{2}$/.test((await stand().locator('.gelesen .wann').textContent()).trim()),
     await stand().locator('.gelesen .wann').textContent());
  ok('Silvia steht weiterhin darunter',
     (await stand().locator('.marke').textContent()).includes('Noch nicht gelesen')
       && (await stand().textContent()).includes('Silvia Weber'));
  await p.screenshot({ path:`${OUT}/lesestand-einer.png`, fullPage:true });
  await schliessen();

  /* Beide gelesen: aus einem Haken werden zwei, und die zweite Gruppe
     fällt weg. */
  await p.evaluate(zeit => window.__stubMelde('chat_mitglieder',
    { chat_id:'c1', user_id:'u9-silvia', zuletzt_gelesen: zeit, admin:false }, 'UPDATE'),
    T(10, 40));
  await p.waitForTimeout(800);
  ok('Jetzt stehen zwei Haken an der Nachricht',
     await p.locator('#n-lb1 .haken.gelesen').count() === 1);

  await p.locator('#n-lb1').dispatchEvent('contextmenu');
  await p.waitForTimeout(500);
  ok('Beide haben gelesen',
     (await stand().locator('.titel').textContent()).trim() === 'Gelesen von 2 von 2');
  ok('Und "Noch nicht gelesen" fällt weg', await stand().locator('.marke').count() === 0);
  ok('Die zuletzt Eingetroffene zuoberst',
     (await stand().locator('.gelesen .wer').first().textContent()) === 'Silvia Weber');
  await schliessen();

  /* An einer fremden Nachricht steht nichts davon: wer gelesen hat, geht
     die schreibende Person an und nicht die lesende. */
  await p.locator('#n-p1').dispatchEvent('contextmenu');
  await p.waitForTimeout(500);
  ok('An einer fremden Nachricht kein Lesestand', await stand().count() === 0);
  ok('Die Reaktionen gibt es dort trotzdem',
     await p.locator('.ch-reaktionswahl button').count() === 5);
  await schliessen();

  /* Im Einzelgespräch sagt der doppelte Haken schon alles. Eine Liste
     mit genau einem Namen darunter wäre dasselbe zweimal. */
  await p.click('#g-zurueck'); await p.waitForTimeout(700);
  await p.locator('#gespraeche .ch-zeile', { hasText:'Adrian' }).first().click();
  await p.waitForTimeout(900);
  await p.locator('#n-lb2').dispatchEvent('contextmenu');
  await p.waitForTimeout(500);
  ok('Im Einzelgespräch kein Lesestand', await stand().count() === 0);
  await schliessen();

  await ctx.close();
}

/* --- 2. Stummschaltung ----------------------------------------------------- */

console.log('\n=== Chat stummschalten ===');
{
  const ctx = await baueKontext(390, { saat: SAAT_PLUS });
  const p = await anmelden(ctx);
  await p.goto(`${SERVER}/chat.html`, { waitUntil:'networkidle' });
  await p.waitForTimeout(700);
  await gruppeAuf(p);

  const vorher = (await blasen(p)).length;
  await p.click('#g-mehr');
  await p.waitForTimeout(500);
  ok('Im Menü steht ein Schalter für Stumm',
     await p.locator('[data-schalter="stumm"]').count() === 1);
  ok('Er steht anfangs auf aus',
     await p.getAttribute('[data-schalter="stumm"]', 'aria-checked') === 'false');
  ok('Daneben steht, was er bewirkt',
     (await p.textContent('[data-schalter="stumm"]')).includes('aufs Telefon'));

  await p.click('[data-schalter="stumm"]');
  await p.waitForTimeout(800);
  ok('Der Schalter landet in der Datenbank',
     (await p.evaluate(() => JSON.parse(sessionStorage.getItem('__stub_db'))
       .chat_mitglieder.find(m => m.chat_id==='c1' && m.user_id==='u1').stumm)) === true);
  ok('Die Gesprächsliste zeigt ein Stumm-Zeichen',
     await p.locator('#gespraeche .ch-stummzeichen').count() === 1);
  ok('Die Nachrichten bleiben alle lesbar', (await blasen(p)).length === vorher,
     `${(await blasen(p)).length} von ${vorher}`);

  ok('Der Hinweistext sagt jetzt, dass eine Erwähnung trotzdem durchkommt',
     (await p.textContent('[data-schalter="stumm"]')).includes('@'),
     await p.textContent('[data-schalter="stumm"]'));

  /* Der Ungelesen-Zähler muss weiterlaufen: stumm heisst leise, nicht
     blind. Geprüft am anderen Gespräch, das ungelesen bleibt. */
  /* Das Blatt schliesst über den Hintergrund. Ein Klick in die Ecke
     trifft ihn sicher — mittendrin liegt ein Knopf im Weg. */
  await p.mouse.click(5, 5);
  await p.waitForTimeout(400);
  const zaehler = await p.evaluate(async () => {
    const d = JSON.parse(sessionStorage.getItem('__stub_db'));
    d.nachrichten.push({ id:'pz', chat_id:'c1', absender:'u9-adrian', text:'noch was',
      bild_pfad:null, bild_ablauf:null, erstellt_am:new Date().toISOString() });
    d.chat_mitglieder = d.chat_mitglieder.map(m =>
      m.chat_id==='c1' && m.user_id==='u1' ? { ...m, zuletzt_gelesen:'2020-01-01T00:00:00.000Z' } : m);
    sessionStorage.setItem('__stub_db', JSON.stringify(d));
    return true;
  });
  /* Ohne ?chat= in der Adresse, sonst öffnet sich das Gespräch beim
     Neuladen gleich wieder und gilt damit als gelesen. */
  await p.goto(`${SERVER}/chat.html`, { waitUntil:'networkidle' });
  await p.waitForTimeout(900);
  ok('Und der Ungelesen-Zähler zählt trotz Stumm weiter',
     await p.locator('#gespraeche .zaehler').count() >= 1 && zaehler);
  ok('Neben dem Zähler steht weiterhin das Stumm-Zeichen',
     await p.locator('#gespraeche .ch-stummzeichen').count() === 1);

  // Fremde Zeile stumm stellen: der Trigger weist es ab.
  const fremd = await p.evaluate(async () =>
    (await sb.from('chat_mitglieder').update({ stumm:true })
      .eq('chat_id','c1').eq('user_id','u9-adrian')).error?.message || null);
  ok('Eine fremde Zeile stumm zu stellen weist die Datenbank ab',
     /nur bei sich selbst/.test(fremd || ''), String(fremd));

  await p.screenshot({ path:`${OUT}/stumm.png`, fullPage:true });
  await ctx.close();
}

/* --- 3. Fotos sichern ------------------------------------------------------ */

console.log('\n=== Fotos aus dem Chat sichern ===');
{
  const ctx = await baueKontext(390, { saat: SAAT_PLUS });
  const p = await anmelden(ctx);
  /* Das Teilen-Blatt gibt es in Chromium nicht. Nachgebaut wird deshalb
     genau die Schnittstelle, die iOS anbietet — mehr weiss die App über
     sie ohnehin nicht. */
  await p.addInitScript(() => {
    window.__geteilt = [];
    navigator.canShare = d => !!d?.files?.length;
    navigator.share = async d => { window.__geteilt.push(d.files.map(f => f.name)); };
  });
  await p.goto(`${SERVER}/chat.html`, { waitUntil:'networkidle' });
  await p.waitForTimeout(700);
  await gruppeAuf(p);

  await p.click('#g-mehr');
  await p.waitForTimeout(500);
  ok('Im Menü steht ein Schalter für das Sichern',
     await p.locator('[data-schalter="fotos_sichern"]').count() === 1);
  ok('Und ein Knopf für alle Bilder des Chats',
     await p.locator('#g-allebilder').count() === 1);
  ok('Ausgeschaltet sagt er, dass nichts gesammelt wird',
     (await p.textContent('[data-schalter="fotos_sichern"]')).includes('nicht gesammelt'),
     (await p.textContent('[data-schalter="fotos_sichern"]')).replace(/\s+/g,' ').trim());

  await p.click('#g-allebilder');
  await p.waitForTimeout(1500);
  const geteilt = await p.evaluate(() => window.__geteilt);
  ok('Alle Bilder dieses Chats sichern gibt beide ans Teilen-Blatt',
     geteilt.length === 1 && geteilt[0].length === 2, JSON.stringify(geteilt));
  ok('Mit sprechenden Dateinamen',
     geteilt[0].every(n => /^TRIGA_\d{4}-\d{2}-\d{2}_/.test(n)), JSON.stringify(geteilt[0]));

  // Der Schalter, und danach ein neues Foto über die Echtzeit.
  await p.click('#g-mehr');
  await p.waitForTimeout(500);
  await p.click('[data-schalter="fotos_sichern"]');
  await p.waitForTimeout(800);
  ok('Der Schalter landet in der Datenbank',
     (await p.evaluate(() => JSON.parse(sessionStorage.getItem('__stub_db'))
       .chat_mitglieder.find(m => m.chat_id==='c1' && m.user_id==='u1').fotos_sichern)) === true);
  ok('Beim Einschalten wird nicht rückwirkend gesammelt',
     await p.locator('.ch-sicherbanner').count() === 0);

  /* Der Satz, auf den es ankommt: die App verspricht kein stilles
     Speichern in die Fotomediathek, weil es das im Browser nicht gibt. */
  /* Das Blatt steht nach dem Umlegen wieder offen — die App zeichnet es
     neu, damit man den neuen Stand sieht. Also kein zweites Öffnen. */
  ok('Eingeschaltet sagt er ehrlich, dass es einen Tipp braucht',
     (await p.textContent('[data-schalter="fotos_sichern"]')).includes('Tipp auf'),
     (await p.textContent('[data-schalter="fotos_sichern"]')).replace(/\s+/g,' ').trim());
  await p.mouse.click(5, 5); await p.waitForTimeout(400);

  await p.evaluate(() => {
    const morgen = new Date(Date.now() + 25*86400000).toISOString();
    /* Die Datei muss es auch geben, sonst holt die App sie vergeblich. */
    const d = JSON.parse(sessionStorage.getItem('__stub_db'));
    d.__objekte = d.__objekte || {};
    d.__objekte['c1/foto-c.jpg'] = { name:'foto-c.jpg', groesse:1024, typ:'image/jpeg', inhalt:null };
    sessionStorage.setItem('__stub_db', JSON.stringify(d));
    __stubMelde('nachrichten', { id:'pneu', chat_id:'c1', absender:'u9-adrian',
      text:null, bild_pfad:'c1/foto-c.jpg', bild_ablauf:morgen,
      erstellt_am:new Date().toISOString() }, 'INSERT');
  });
  await p.waitForTimeout(900);
  ok('Ein neues Foto legt sich auf den Stapel',
     await p.locator('.ch-sicherbanner').count() === 1);
  ok('Der Knopf nennt die Anzahl',
     (await p.textContent('.ch-sicherbanner')).includes('1 neues Foto'),
     await p.textContent('.ch-sicherbanner'));

  await p.evaluate(() => { window.__geteilt = []; });
  await p.click('[data-sichern-jetzt]');
  await p.waitForTimeout(1500);
  const stapel = await p.evaluate(() => window.__geteilt);
  ok('Ein Tipp gibt den Stapel ans Teilen-Blatt',
     stapel.length === 1 && stapel[0].length === 1, JSON.stringify(stapel));
  ok('Danach ist der Stapel leer', await p.locator('.ch-sicherbanner').count() === 0);

  await ctx.close();
}

/* --- 4. Medien ------------------------------------------------------------- */

console.log('\n=== Medien-Reiter ===');
{
  const ctx = await baueKontext(390, { saat: SAAT_PLUS });
  const p = await anmelden(ctx);
  await p.goto(`${SERVER}/chat.html`, { waitUntil:'networkidle' });
  await p.waitForTimeout(700);
  await gruppeAuf(p);

  ok('Über dem Verlauf stehen drei Reiter',
     await p.locator('#g-reiter button').count() === 3);
  ok('Sie heissen Verlauf, Medien und Suchen',
     (await p.locator('#g-reiter button').allTextContents()).map(t => t.trim()).join('|') === 'Verlauf|Medien|Suchen',
     (await p.locator('#g-reiter button').allTextContents()).join('|'));
  ok('Der Verlauf ist vorbelegt',
     await p.getAttribute('#g-reiter [data-blick="verlauf"]', 'aria-pressed') === 'true');

  await p.click('#g-reiter [data-blick="medien"]');
  await p.waitForTimeout(1200);
  ok('Der Medien-Reiter zeigt ein Raster',
     await p.locator('#verlauf .ch-raster').count() === 1);
  ok('Mit beiden Fotos des Gesprächs',
     await p.locator('.ch-kachel').count() === 2,
     String(await p.locator('.ch-kachel').count()));
  ok('Neuestes zuerst',
     await p.locator('.ch-kachel').first().getAttribute('data-hin') === 'p3',
     await p.locator('.ch-kachel').first().getAttribute('data-hin'));
  ok('Die Anzahl steht im Kopf', (await p.textContent('.ch-medienkopf')).includes('2 Fotos'),
     await p.textContent('.ch-medienkopf'));
  ok('Und ein Knopf, um alle zu sichern',
     await p.locator('[data-alle-sichern]').count() === 1);
  ok('Die Bilder sind wirklich geladen und nicht nur Platzhalter',
     await p.locator('.ch-kachel img').count() === 2,
     String(await p.locator('.ch-kachel img').count()));
  await p.screenshot({ path:`${OUT}/medien.png`, fullPage:true });

  await p.locator('.ch-kachel').last().click();   // das ältere Foto, p2
  await p.waitForTimeout(900);
  ok('Ein Tipp führt zurück in den Verlauf',
     await p.getAttribute('#g-reiter [data-blick="verlauf"]', 'aria-pressed') === 'true');
  ok('Und zur Nachricht, in der das Foto steht',
     await p.locator('#n-p2').count() === 1);
  ok('Die Stelle wird kurz hervorgehoben',
     await p.locator('#n-p2.gefunden').count() === 1);

  await ctx.close();
}

/* --- 5. Suche -------------------------------------------------------------- */

console.log('\n=== Suche im Gespräch ===');
{
  const ctx = await baueKontext(390, { saat: SAAT_PLUS });
  const p = await anmelden(ctx);
  await p.goto(`${SERVER}/chat.html`, { waitUntil:'networkidle' });
  await p.waitForTimeout(700);
  await gruppeAuf(p);

  await p.click('#g-reiter [data-blick="suche"]');
  await p.waitForTimeout(600);
  ok('Der Suchreiter zeigt ein Feld', await p.locator('#ch-suchfeld').count() === 1);
  ok('Und sagt, was zu tun ist',
     (await p.textContent('#verlauf')).includes('Tippen Sie ein Wort'));

  await p.fill('#ch-suchfeld', 'Kran');
  await p.waitForTimeout(600);
  ok('Zwei Nachrichten enthalten "Kran"',
     await p.locator('.ch-treffer button').count() === 2,
     String(await p.locator('.ch-treffer button').count()));
  ok('Am Treffer steht das Datum',
     /\d{2}\.\d{2}\.\d{4}/.test(await p.textContent('.ch-treffer .wann')),
     await p.textContent('.ch-treffer .wann'));
  ok('Und wer es geschrieben hat',
     (await p.textContent('.ch-treffer .wer')).length > 2,
     await p.textContent('.ch-treffer .wer'));
  ok('Das gesuchte Wort ist hervorgehoben',
     await p.locator('.ch-treffer mark').count() === 2);
  ok('Neuestes zuerst',
     await p.locator('.ch-treffer button').first().getAttribute('data-hin') === 'p4',
     await p.locator('.ch-treffer button').first().getAttribute('data-hin'));

  ok('Eine Erwähnung wird im Klartext durchsucht, nicht als Kennung',
     (await p.textContent('.ch-treffer')).includes('@Jonas Zemp')
       && !(await p.textContent('.ch-treffer')).includes('](u1)'),
     (await p.textContent('.ch-treffer')).slice(0, 120));

  await p.fill('#ch-suchfeld', 'Hubschrauber');
  await p.waitForTimeout(600);
  ok('Ohne Treffer steht ein klarer Satz',
     (await p.textContent('#verlauf')).includes('Nichts gefunden'));

  await p.fill('#ch-suchfeld', 'Kran');
  await p.waitForTimeout(600);
  await p.locator('.ch-treffer button').first().click();
  await p.waitForTimeout(900);
  ok('Ein Treffer führt zur Nachricht im Verlauf',
     await p.locator('#n-p4.gefunden').count() === 1);
  await p.screenshot({ path:`${OUT}/suche.png`, fullPage:true });

  await ctx.close();
}

/* --- 6. Erwähnungen -------------------------------------------------------- */

console.log('\n=== @-Erwähnungen im Chat ===');
{
  const ctx = await baueKontext(390, { saat: SAAT_PLUS });
  const p = await anmelden(ctx);
  const rufe = [];
  await p.unroute('**/api/push').catch(() => {});
  await ctx.route('**/api/push', async r => {
    rufe.push(JSON.parse(r.request().postData() || '{}'));
    await r.fulfill({ status:200, contentType:'application/json', body:'{"gesendet":1}' });
  });
  await p.goto(`${SERVER}/chat.html`, { waitUntil:'networkidle' });
  await p.waitForTimeout(700);
  await gruppeAuf(p);

  ok('Eine Erwähnung steht im Klartext und nicht in Klammern',
     (await p.textContent('#n-p4')).includes('@Jonas Zemp')
       && !(await p.textContent('#n-p4')).includes('](u1)'),
     await p.textContent('#n-p4'));
  ok('Sie ist hervorgehoben', await p.locator('#n-p4 .ch-erwaehnt').count() === 1);
  ok('Und führt ins Adressbuch',
     (await p.getAttribute('#n-p4 .ch-erwaehnt', 'href') || '').startsWith('mitarbeiter.html?person='),
     await p.getAttribute('#n-p4 .ch-erwaehnt', 'href'));
  ok('Wer selbst gemeint ist, sieht es an der Blase',
     await p.locator('#n-p4.anMich').count() === 1);
  ok('Eine gewöhnliche Nachricht ist nicht hervorgehoben',
     await p.locator('#n-p1.anMich').count() === 0);

  // Selbst eine schreiben
  await p.fill('#e-text', 'kannst du kurz schauen @Adrian');
  await p.waitForTimeout(600);
  ok('Beim Tippen klappt die Auswahlliste auf',
     await p.locator('.fd-erwaehnliste').count() === 1);
  ok('Sie zeigt nur passende Namen',
     (await p.locator('.fd-erwaehnliste button').allTextContents()).join('|').includes('Adrian Zemp'),
     (await p.locator('.fd-erwaehnliste button').allTextContents()).join('|'));
  await p.locator('.fd-erwaehnliste button').first().click();
  await p.waitForTimeout(400);
  ok('Im Feld steht der Name, nicht die Kennung',
     (await p.inputValue('#e-text')).includes('@Adrian Zemp')
       && !(await p.inputValue('#e-text')).includes('('),
     await p.inputValue('#e-text'));

  await p.click('#e-senden');
  await p.waitForTimeout(1200);
  const gespeichert = await p.evaluate(() =>
    JSON.parse(sessionStorage.getItem('__stub_db')).nachrichten.slice(-1)[0].text);
  ok('Gespeichert wird die Form mit der Kennung',
     gespeichert.includes('@[Adrian Zemp](u9-adrian)'), gespeichert);
  ok('Am Bildschirm steht weiterhin nur der Name',
     (await p.textContent('#verlauf')).includes('@Adrian Zemp'));

  const letzterRuf = rufe[rufe.length - 1] || {};
  ok('Der Push-Aufruf trägt die Nachrichtenkennung mit',
     !!letzterRuf.nachricht && !!letzterRuf.chat, JSON.stringify(letzterRuf));
  ok('Und im Text steht der Klartext, nicht die Klammerform',
     String(letzterRuf.text || '').includes('@Adrian Zemp')
       && !String(letzterRuf.text || '').includes(']('), String(letzterRuf.text));

  // Die Karte wird nach dem Senden geleert.
  await p.fill('#e-text', 'nochmal @Adrian Zemp ohne Auswahl');
  await p.click('#e-senden');
  await p.waitForTimeout(1000);
  const zweite = await p.evaluate(() =>
    JSON.parse(sessionStorage.getItem('__stub_db')).nachrichten.slice(-1)[0].text);
  ok('Ein getippter Name ohne Auswahl wird nicht zur Erwähnung',
     !zweite.includes(']('), zweite);

  await ctx.close();
}

/* --- 7. Die sechs stehen einander nicht im Weg ------------------------------ */

console.log('\n=== Alles zusammen im selben Gespräch ===');
{
  const ctx = await baueKontext(1440, { saat: SAAT_PLUS });
  const p = await anmelden(ctx);
  await p.goto(`${SERVER}/chat.html`, { waitUntil:'networkidle' });
  await p.waitForTimeout(700);
  await gruppeAuf(p);

  // Stumm stellen, dann reagieren, dann in die Medien und zurück.
  await p.click('#g-mehr'); await p.waitForTimeout(400);
  await p.click('[data-schalter="stumm"]'); await p.waitForTimeout(700);
  await p.mouse.click(5, 5); await p.waitForTimeout(400);   // das Blatt steht nach dem Umlegen wieder offen
  await p.locator('#n-p1 .ch-reaktion').first().click(); await p.waitForTimeout(600);
  ok('Reagieren geht auch im stumm gestellten Gespräch',
     await p.locator('#n-p1 .ch-reaktion.meine').count() === 1);

  await p.click('#g-reiter [data-blick="medien"]'); await p.waitForTimeout(900);
  await p.click('#g-reiter [data-blick="verlauf"]'); await p.waitForTimeout(900);
  ok('Nach dem Wechsel in die Medien und zurück steht die Reaktion noch',
     await p.locator('#n-p1 .ch-reaktion.meine').count() === 1);
  ok('Und der Verlauf ist vollständig', (await blasen(p)).length >= 5,
     String((await blasen(p)).length));
  ok('Die Erwähnung ist noch hervorgehoben',
     await p.locator('#n-p4 .ch-erwaehnt').count() === 1);

  await p.click('#g-reiter [data-blick="suche"]'); await p.waitForTimeout(500);
  await p.fill('#ch-suchfeld', 'kran'); await p.waitForTimeout(600);
  ok('Die Suche findet unabhängig von Gross- und Kleinschreibung',
     await p.locator('.ch-treffer button').count() === 2,
     String(await p.locator('.ch-treffer button').count()));

  await p.click('#g-reiter [data-blick="verlauf"]'); await p.waitForTimeout(700);
  await p.fill('#e-text', 'alles zusammen geprüft');
  await p.click('#e-senden');
  await p.waitForTimeout(1000);
  ok('Und senden geht danach immer noch',
     (await blasen(p)).slice(-1)[0] === 'alles zusammen geprüft',
     (await blasen(p)).slice(-1)[0]);
  ok('Das Gespräch ist weiterhin stumm',
     (await p.evaluate(() => JSON.parse(sessionStorage.getItem('__stub_db'))
       .chat_mitglieder.find(m => m.chat_id==='c1' && m.user_id==='u1').stumm)) === true);
  await p.screenshot({ path:`${OUT}/zusammen.png`, fullPage:true });

  await ctx.close();
}

await browser.close();
console.log(`\n=== ${gut} von ${gut+schlecht} Prüfungen bestanden ===`);
console.log('=== Fehler im Browser ===');
console.log(fehler.length ? [...new Set(fehler)].join('\n') : 'keine');
