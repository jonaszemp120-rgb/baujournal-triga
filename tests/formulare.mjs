/* Schritt 14: Formulare — Spesen und Ferien, einreichen, entscheiden,
   zurückziehen.

   Zwei Durchgänge mit verschiedenen Berechtigungsstufen, weil sich der
   Bereich genau daran unterscheidet: wer entscheiden darf. Auf dem Handy
   läuft die Stufe "mitarbeiter", auf dem Desktop "entwickler". */

import { chromium, HIER, SERVER } from './umgebung.mjs';
import fs from 'node:fs';
const OUT = `${HIER}/ausgabe/shots-fm`;
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
const STUB = fs.readFileSync('./stub.js', 'utf8');
const browser = await chromium.launch();
const fehler = [];
const ok = (n, b, zusatz = '') => console.log(`  ${b ? '✓' : '✗ FEHLER'}  ${n}${b ? '' : `  → ${zusatz}`}`);

const GESTERN = new Date(Date.now() - 86400000).toISOString();

async function lauf(name, breite, stufe) {
  const ctx = await browser.newContext({
    viewport: { width: breite, height: breite >= 1024 ? 950 : 844 },
    locale: 'de-CH', serviceWorkers: 'block'
  });
  await ctx.route('**/vendor/supabase-js-2.58.0.js',
    r => r.fulfill({ status: 200, contentType: 'application/javascript', body: STUB }));

  const meldungen = [];
  await ctx.route('**/api/push', async r => {
    try { meldungen.push(JSON.parse(r.request().postData() || '{}')); } catch { meldungen.push({}); }
    await r.fulfill({ status: 200, contentType: 'application/json', body: '{"gesendet":1}' });
  });

  await ctx.addInitScript(([stufe, gestern]) => {
    try { localStorage.setItem('bj_push_gefragt', '1'); } catch {}
    if (sessionStorage.getItem('__stub_db')) return;
    sessionStorage.setItem('__stub_db', JSON.stringify({
      profile: [{ id: 'u1', name: 'Jonas Zemp' }],
      projekte: [], eintraege: [], eintraege_korrekturen: [],
      mitarbeiter: [
        { id: 'ich', name: 'Jonas Zemp', rolle: 'Bauleitung', user_id: 'u1', berechtigung: stufe },
        { id: 'm2', name: 'Silvia Weber', rolle: 'Administration', user_id: 'u2', berechtigung: 'geschaeftsleitung' }
      ],
      // Ein fremder Antrag. Daran hängt, wer entscheiden darf.
      antraege: [{ id: 'a-fremd', art: 'ferien', von: '2026-11-03', bis: '2026-11-07',
                   status: 'eingereicht', erstellt_von: 'u2', erstellt_am: gestern }],
      abnahmen: [], maengel: []
    }));
  }, [stufe, GESTERN]);

  const p = await ctx.newPage();
  p.on('console', m => { if (m.type() === 'error') fehler.push(`${name}: ${m.text()}`); });
  p.on('pageerror', e => fehler.push(`${name}: ${e.message}`));
  console.log(`\n=== ${name} (${breite}px, Stufe ${stufe}) ===`);

  const db = () => p.evaluate(() => JSON.parse(sessionStorage.getItem('__stub_db')));

  await p.goto(`${SERVER}/index.html`, { waitUntil: 'networkidle' });
  await p.fill('#email', 'test.durchlauf@triga.ch'); await p.fill('#pw', 'TestDurchlauf!2026');
  await p.click('#btn'); await p.waitForURL('**/start.html');
  await p.waitForTimeout(900);

  /* --- 1. Der Weg in die Formulare -------------------------------------- */

  const kacheln = await p.$$eval('#raster .st-kachel', e => e.map(x => x.getAttribute('href')));
  ok('Startseite zeigt weiterhin genau sechs Kacheln', kacheln.length === 6, kacheln.join(' | '));
  ok('Keine Formulare-Kachel im Raster', !kacheln.includes('formulare.html'));

  if (breite >= 1024) {
    const nav = await p.$$eval('.tr-sidebar .tr-nav', e => e.map(x => x.textContent.trim()));
    ok('Formulare steht zuunterst in der Seitenleiste', nav[nav.length - 1] === 'Formulare', nav.join(' | '));
    ok('Direkt unter Chat', nav[nav.length - 2] === 'Chat', nav.join(' | '));
    ok('Es sind acht Einträge', nav.length === 8, String(nav.length));
    await p.click('.tr-sidebar .tr-nav[href="formulare.html"]');
  } else {
    const zeilen = await p.$$eval('.st-einstieg .titel', e => e.map(x => x.textContent.trim()));
    ok('Auf dem Handy führen zwei Zeilen hinein', zeilen.join('|') === 'Feed|Formulare', zeilen.join('|'));
    await p.click('.st-einstieg[href="formulare.html"]');
  }
  await p.waitForURL('**/formulare.html');
  await p.waitForTimeout(900);

  /* --- 2. Wer sieht fremde Anträge? ------------------------------------- */

  const offeneKarten = await p.locator('[data-offen]').count();
  if (stufe === 'mitarbeiter') {
    ok('Ohne erweiterte Stufe kein Genehmigen-Abschnitt',
       offeneKarten === 0 && !(await p.textContent('#offene')).includes('Genehmigung'));
    const sichtbar = await p.evaluate(async () => (await sb.from('antraege').select('*')).data.length);
    ok('Und der fremde Antrag ist auch an der Datenbank vorbei unsichtbar', sichtbar === 0, String(sichtbar));
  } else {
    ok('Mit erweiterter Stufe steht der fremde Antrag oben', offeneKarten === 1);
    ok('Mit Namen', (await p.textContent('[data-offen]')).includes('Silvia Weber'));
    ok('Und der Kurzfassung', (await p.textContent('[data-offen]')).includes('Ferien, 03.11.–07.11. · 5 Tage'),
       await p.textContent('[data-offen]'));
  }

  /* --- 3. Spesenantrag einreichen --------------------------------------- */

  const form = async () => {
    if (breite >= 1024) return p.locator('.fm-spalte-form');
    await p.locator('[data-neu]:visible').first().click();
    await p.waitForTimeout(500);
    return p.locator('.sheet');
  };

  let f = await form();
  ok('Das Formular startet bei Spesen',
     await f.locator('[data-art="spesen"]').getAttribute('aria-pressed') === 'true');
  ok('Und zeigt die Spesenfelder',
     await f.locator('[data-feld="betrag"]').isVisible()
     && !(await f.locator('[data-feld="von"]').isVisible()));

  await f.locator('[data-einreichen]').click();
  await p.waitForTimeout(300);
  ok('Ohne Betrag geht es nicht', (await f.locator('[data-fehler]').textContent()).includes('Betrag'));

  await f.locator('[data-feld="betrag"]').fill('24');
  await f.locator('[data-einreichen]').click();
  await p.waitForTimeout(300);
  ok('Ohne Beschrieb auch nicht', (await f.locator('[data-fehler]').textContent()).includes('beschreiben'));

  await f.locator('[data-feld="beschrieb"]').fill('Parkgebühren Baustelle Sarnen');
  await f.locator('[data-datei]').setInputFiles({
    name: 'beleg.png', mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
  });
  await p.waitForTimeout(400);
  ok('Der Beleg zeigt eine Vorschau', await f.locator('[data-foto] img').isVisible());
  await f.locator('[data-einreichen]').click();
  await p.waitForTimeout(1100);

  const meine = p.locator('#meine .fm-zeile');
  ok('Der Antrag steht in der eigenen Liste', await meine.count() === 1);
  ok('Mit Titel und Betrag',
     (await meine.first().textContent()).includes('Spesen — Parkgebühren Baustelle Sarnen')
     && (await meine.first().textContent()).includes('CHF 24.00'));
  ok('Status eingereicht',
     (await meine.first().locator('.pj-marke').textContent()).trim() === 'Eingereicht');

  const gespeichert = (await db()).antraege.find(a => a.beschrieb?.includes('Parkgebühren'));
  ok('In der Datenbank als Spesen mit Betrag',
     gespeichert.art === 'spesen' && gespeichert.betrag === 24 && gespeichert.status === 'eingereicht',
     JSON.stringify(gespeichert));
  ok('Der Beleg liegt unter der Kennung des Antrags',
     String(gespeichert.beleg_pfad).startsWith(gespeichert.id + '/'), gespeichert.beleg_pfad);
  ok('Ein Ferienfeld bleibt dabei leer', gespeichert.von === undefined || gespeichert.von === null);

  /* --- 4. Ferienantrag -------------------------------------------------- */

  f = await form();
  await f.locator('[data-art="ferien"]').click();
  await p.waitForTimeout(300);
  ok('Im Ferienmodus verschwinden die Spesenfelder',
     !(await f.locator('[data-feld="betrag"]').isVisible())
     && await f.locator('[data-feld="von"]').isVisible());

  await f.locator('[data-feld="von"]').fill('2026-10-24');
  await f.locator('[data-feld="bis"]').fill('2026-10-20');
  await f.locator('[data-einreichen]').click();
  await p.waitForTimeout(300);
  ok('Ein Ende vor dem Anfang wird abgewiesen',
     (await f.locator('[data-fehler]').textContent()).includes('vor dem Anfang'));

  await f.locator('[data-feld="von"]').fill('2026-10-20');
  await f.locator('[data-feld="bis"]').fill('2026-10-24');
  await f.locator('[data-feld="bemerkung"]').fill('Stellvertretung ist geregelt');
  await f.locator('[data-einreichen]').click();
  await p.waitForTimeout(1100);

  ok('Zwei eigene Anträge', await p.locator('#meine .fm-zeile').count() === 2);
  const ferien = p.locator('#meine .fm-zeile', { hasText: 'Ferien' });
  ok('Der Ferienantrag nennt Zeitraum und Tage',
     (await ferien.textContent()).includes('Ferien — 20.10.–24.10.')
     && (await ferien.textContent()).includes('5 Tage'), await ferien.textContent());

  await p.screenshot({ path: `${OUT}/${name}-liste.png`, fullPage: true });

  /* --- 5. Zurückziehen -------------------------------------------------- */

  await ferien.locator('[data-zurueck]').click();
  await p.waitForTimeout(500);
  ok('Die Rückfrage nennt den fehlenden Papierkorb',
     (await p.locator('.sheet').last().textContent()).includes('keinen Papierkorb'));
  await p.click('#f-ja');
  await p.waitForTimeout(900);
  ok('Der Ferienantrag ist weg', await p.locator('#meine .fm-zeile').count() === 1);
  ok('Und wirklich weg, nicht nur ausgeblendet',
     !(await db()).antraege.some(a => a.art === 'ferien' && a.erstellt_von === 'u1'));

  /* --- 6. Entscheiden --------------------------------------------------- */

  if (stufe === 'mitarbeiter') {
    ok('Am eigenen offenen Antrag gibt es keinen Genehmigen-Knopf',
       await p.locator('#meine [data-ja]').count() === 0);
    // Und auch nicht an der Datenbank vorbei.
    const versuch = await p.evaluate(async () => {
      const d = JSON.parse(sessionStorage.getItem('__stub_db'));
      const a = d.antraege.find(x => x.erstellt_von === 'u1');
      const { data } = await sb.from('antraege').update({ status: 'genehmigt' }).eq('id', a.id).select();
      return (data || []).length;
    });
    ok('Ohne erweiterte Stufe entscheidet niemand', versuch === 0, String(versuch));
    ok('Der Antrag steht weiterhin auf eingereicht',
       (await db()).antraege.find(a => a.erstellt_von === 'u1').status === 'eingereicht');
    /* Zwei Meldungen sind schon draussen: je eine beim Einreichen der
       beiden eigenen Anträge. Neu ist keine dazugekommen — ein
       gescheiterter Entscheid meldet nichts. */
    ok('Ein gescheiterter Entscheid meldet nichts',
       meldungen.filter(m => /genehmigt|abgelehnt/.test(m.titel || '')).length === 0,
       JSON.stringify(meldungen.map(m => m.titel)));
  } else {
    await p.locator('[data-offen] [data-ja]').click();
    await p.waitForTimeout(500);
    ok('Die Rückfrage warnt vor der Endgültigkeit',
       (await p.locator('.sheet').last().textContent()).includes('nicht mehr ändern'));
    await p.click('#f-ja');
    await p.waitForTimeout(1000);

    ok('Der fremde Antrag verschwindet aus dem Genehmigen-Abschnitt',
       await p.locator('[data-offen]').count() === 0);
    const entschieden = (await db()).antraege.find(a => a.id === 'a-fremd');
    ok('Er steht auf genehmigt', entschieden.status === 'genehmigt', entschieden.status);
    ok('Und die entscheidende Person steht darin',
       entschieden.entschieden_von === 'u1' && !!entschieden.entschieden_am,
       JSON.stringify(entschieden));

    await p.waitForTimeout(500);
    /* Neben den beiden Meldungen vom Einreichen kommt jetzt genau eine
       zum Entscheid dazu. */
    const entscheidMeldungen = meldungen.filter(m => /genehmigt|abgelehnt/.test(m.titel || ''));
    ok('Der Entscheid meldet sich genau einmal', entscheidMeldungen.length === 1,
       JSON.stringify(meldungen.map(m => m.titel)));
    ok('Und zwar über die Kennung des Antrags',
       entscheidMeldungen[0]?.antrag === 'a-fremd' && entscheidMeldungen[0]?.ziel === 'formulare.html',
       JSON.stringify(entscheidMeldungen[0]));

    // Ein zweiter Entscheid am selben Antrag, an der Oberfläche vorbei.
    const nochmal = await p.evaluate(async () =>
      (await sb.from('antraege').update({ status: 'abgelehnt' }).eq('id', 'a-fremd')).error?.message || 'durchgelassen');
    ok('Ein Entscheid lässt sich nicht drehen', /nicht mehr aendern/.test(nochmal), nochmal);

    // Und der Inhalt lässt sich beim Entscheiden nicht mitändern.
    const eigener = (await db()).antraege.find(a => a.erstellt_von === 'u1');
    const gemogelt = await p.evaluate(async id =>
      (await sb.from('antraege').update({ status: 'genehmigt', betrag: 2400 }).eq('id', id)).error?.message || 'durchgelassen',
      eigener.id);
    ok('Der Betrag lässt sich dabei nicht mitändern',
       /nur der Entscheid/.test(gemogelt), gemogelt);
  }

  await ctx.close();
}

/* ===== Erweiterung: PDF, Ablehngrund, Meldung an die Zuständigen ========== */

/* Kein Mailversand — es gibt keine verifizierte Absenderdomain. Also
   muss der Antrag in der App selbst ein Blatt werden, das man ablegen
   und weitergeben kann, und die zuständige Person muss davon erfahren,
   ohne dass jemand daran denkt. Beides wird hier geprüft. */

async function lauf2(name, breite, stufe) {
  const ctx = await browser.newContext({
    viewport: { width: breite, height: breite >= 1024 ? 950 : 844 },
    locale: 'de-CH', serviceWorkers: 'block'
  });
  await ctx.route('**/vendor/supabase-js-2.58.0.js',
    r => r.fulfill({ status: 200, contentType: 'application/javascript', body: STUB }));
  const meldungen = [];
  await ctx.route('**/api/push', async r => {
    try { meldungen.push(JSON.parse(r.request().postData() || '{}')); } catch { meldungen.push({}); }
    await r.fulfill({ status: 200, contentType: 'application/json', body: '{"gesendet":1}' });
  });

  await ctx.addInitScript(([stufe, gestern]) => {
    try { localStorage.setItem('bj_push_gefragt', '1'); } catch {}
    if (sessionStorage.getItem('__stub_db')) return;
    sessionStorage.setItem('__stub_db', JSON.stringify({
      profile: [{ id: 'u1', name: 'Jonas Zemp' }],
      projekte: [], eintraege: [], eintraege_korrekturen: [],
      /* Zwei Zuständige, wie in der echten Datenbank: David entscheidet
         die Spesen, Thomas die Ferien. Das steht in den Daten und nicht
         im Code — genau das wird hier mitgeprüft. */
      mitarbeiter: [
        { id: 'ich', name: 'Jonas Zemp', rolle: 'Bauleitung', user_id: 'u1',
          berechtigung: stufe, zustaendig_fuer: [] },
        { id: 'm-d', name: 'David Schmid', rolle: 'Geschäftsleitung', user_id: 'u-david',
          berechtigung: 'geschaeftsleitung', zustaendig_fuer: ['spesen'] },
        { id: 'm-t', name: 'Thomas Zürcher', rolle: 'Geschäftsleitung', user_id: 'u-thomas',
          berechtigung: 'geschaeftsleitung', zustaendig_fuer: ['ferien'] }
      ],
      antraege: [{ id: 'a-fremd', art: 'ferien', von: '2026-11-03', bis: '2026-11-07',
                   status: 'eingereicht', erstellt_von: 'u-david', erstellt_am: gestern }],
      abnahmen: [], maengel: []
    }));
  }, [stufe, GESTERN]);

  const p = await ctx.newPage();
  p.on('console', m => { if (m.type() === 'error') fehler.push(`${name}: ${m.text()}`); });
  p.on('pageerror', e => fehler.push(`${name}: ${e.message}`));
  console.log(`\n=== ${name}: PDF, Ablehngrund und Meldungen (${breite}px, Stufe ${stufe}) ===`);

  const db = () => p.evaluate(() => JSON.parse(sessionStorage.getItem('__stub_db')));

  await p.goto(`${SERVER}/index.html`, { waitUntil: 'networkidle' });
  await p.fill('#email', 'test.durchlauf@triga.ch'); await p.fill('#pw', 'TestDurchlauf!2026');
  await p.click('#btn'); await p.waitForURL('**/start.html');
  await p.goto(`${SERVER}/formulare.html`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(900);

  const formular = async () => {
    if (breite < 1024) {
      await p.locator('[data-neu]:visible').first().click();
      await p.waitForTimeout(500);
    }
  };

  /* --- 1. Spesenantrag: PDF entsteht beim Einreichen -------------------- */

  await formular();
  const wurzel = breite >= 1024 ? '#form-fest' : '.sheet';
  await p.fill(`${wurzel} [data-feld="betrag"]`, '87.50');
  await p.fill(`${wurzel} [data-feld="beschrieb"]`, 'Material Eisenwaren Sarnen');
  /* Ein Beleg, damit er im PDF landet. Ein winziges PNG genügt — was
     zählt, ist dass er eingebettet wird und nicht wie er aussieht. */
  await p.setInputFiles(`${wurzel} [data-datei]`, {
    name: 'beleg.png', mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
  });
  await p.waitForTimeout(400);
  await p.click(`${wurzel} [data-einreichen]`);
  await p.waitForTimeout(3000);

  const nachSpesen = (await db()).antraege.find(a => a.art === 'spesen');
  ok('Der Spesenantrag steht in der Datenbank', !!nachSpesen, JSON.stringify(nachSpesen));
  ok('Und trägt einen Pfad zu seinem PDF', !!nachSpesen?.pdf_pfad, String(nachSpesen?.pdf_pfad));
  ok('Das PDF liegt unter der Kennung des Antrags',
     nachSpesen?.pdf_pfad === `${nachSpesen.id}/antrag.pdf`, String(nachSpesen?.pdf_pfad));

  const ablage = (await db()).__objekte || {};
  ok('Und wirklich in der Ablage', !!ablage[nachSpesen.pdf_pfad], Object.keys(ablage).join(' | '));
  ok('Als PDF und nicht als etwas anderes',
     ablage[nachSpesen.pdf_pfad]?.typ === 'application/pdf',
     String(ablage[nachSpesen.pdf_pfad]?.typ));
  ok('Der Beleg liegt weiterhin daneben', !!nachSpesen.beleg_pfad, String(nachSpesen.beleg_pfad));
  ok('Beide unter derselben Kennung',
     String(nachSpesen.beleg_pfad).startsWith(nachSpesen.id + '/'), String(nachSpesen.beleg_pfad));

  /* Dass es ein echtes PDF ist und nicht eine leere Hülle: die ersten
     Zeichen eines PDF sind immer "%PDF". */
  const anfang = await p.evaluate(async pfad => {
    const { data } = await sb.storage.from('antrag-belege').createSignedUrl(pfad, 60);
    const antwort = await fetch(data.signedUrl);
    const txt = await antwort.text();
    return txt.slice(0, 200);
  }, nachSpesen.pdf_pfad);
  ok('Die Datei fängt an wie ein PDF', anfang.includes('%PDF'), anfang.slice(0, 40));

  ok('Am eingereichten Antrag steht ein Knopf zum Herunterladen',
     await p.locator('#meine [data-pdf]').count() === 1,
     String(await p.locator('#meine [data-pdf]').count()));

  /* --- 2. Die Meldung geht an die zuständige Person --------------------- */

  const spesenMeldung = meldungen.find(m => /Spesenantrag/.test(m.titel || ''));
  ok('Beim Einreichen geht eine Meldung raus', !!spesenMeldung, JSON.stringify(meldungen));
  ok('Sie nennt die Art im Titel', spesenMeldung?.titel === 'Neuer Spesenantrag', String(spesenMeldung?.titel));
  ok('Und im Text den Namen und die Kurzangabe',
     /Jonas Zemp/.test(spesenMeldung?.text || '') && /87\.50/.test(spesenMeldung?.text || ''),
     String(spesenMeldung?.text));
  ok('Sie läuft über die Kennung des Antrags und nicht über eine Person',
     spesenMeldung?.antrag === nachSpesen.id && !spesenMeldung?.ziel_person,
     JSON.stringify(spesenMeldung));

  /* --- 3. Ferienantrag: eigenes PDF, eigene Meldung --------------------- */

  meldungen.length = 0;
  await formular();
  await p.click(`${wurzel} [data-art="ferien"]`);
  await p.fill(`${wurzel} [data-feld="von"]`, '2026-12-21');
  await p.fill(`${wurzel} [data-feld="bis"]`, '2026-12-24');
  await p.fill(`${wurzel} [data-feld="bemerkung"]`, 'Stellvertretung ist geregelt');
  await p.click(`${wurzel} [data-einreichen]`);
  await p.waitForTimeout(3000);

  const nachFerien = (await db()).antraege.find(a => a.art === 'ferien' && a.erstellt_von === 'u1');
  ok('Der Ferienantrag hat ebenfalls ein PDF', !!nachFerien?.pdf_pfad, String(nachFerien?.pdf_pfad));
  ok('Er hat keinen Beleg — Ferien brauchen keinen', !nachFerien?.beleg_pfad);

  const ferienMeldung = meldungen.find(m => /Ferienantrag/.test(m.titel || ''));
  ok('Auch hier geht eine Meldung raus', !!ferienMeldung, JSON.stringify(meldungen));
  ok('Mit einem anderen Titel als bei den Spesen',
     ferienMeldung?.titel === 'Neuer Ferienantrag', String(ferienMeldung?.titel));
  ok('Im Text stehen Name, Zeitraum und Anzahl Tage',
     /Jonas Zemp/.test(ferienMeldung?.text || '') && /4 Tage/.test(ferienMeldung?.text || ''),
     String(ferienMeldung?.text));
  ok('Es ging genau eine Meldung raus und nicht zwei',
     meldungen.length === 1, JSON.stringify(meldungen.map(m => m.titel)));

  await p.screenshot({ path: `${OUT}/${breite}-pdf-am-antrag.png`, fullPage: true });

  /* --- 4. Ablehnen mit Begründung --------------------------------------- */

  if (stufe !== 'mitarbeiter') {
    meldungen.length = 0;
    ok('Der fremde Antrag steht zur Genehmigung',
       await p.locator('#offene [data-nein]').count() === 1,
       String(await p.locator('#offene [data-nein]').count()));
    ok('Und auch dort lässt sich sein PDF holen, wenn er eins hat',
       await p.locator('#offene [data-pdf]').count() === 0,   // der Antrag aus der Saat hat keins
       String(await p.locator('#offene [data-pdf]').count()));

    await p.click('#offene [data-nein]');
    await p.waitForTimeout(600);
    ok('Ablehnen fragt nach einer Begründung',
       await p.locator('#ab-grund').count() === 1);

    // Ohne Grund geht es nicht weiter.
    await p.click('#ab-ja');
    await p.waitForTimeout(400);
    ok('Ohne Begründung passiert nichts',
       await p.locator('#ab-grund').count() === 1
       && (await db()).antraege.find(a => a.id === 'a-fremd').status === 'eingereicht');
    ok('Und es steht auf dem Bildschirm, warum',
       (await p.textContent('#ab-fehler')).includes('begründen'),
       await p.textContent('#ab-fehler'));

    await p.fill('#ab-grund', 'In dieser Woche ist niemand sonst auf der Baustelle.');
    await p.click('#ab-ja');
    await p.waitForTimeout(1200);

    const abgelehnt = (await db()).antraege.find(a => a.id === 'a-fremd');
    ok('Der Antrag steht auf abgelehnt', abgelehnt.status === 'abgelehnt', abgelehnt.status);
    ok('Die Begründung steht mit in der Datenbank',
       abgelehnt.entscheid_kommentar === 'In dieser Woche ist niemand sonst auf der Baustelle.',
       String(abgelehnt.entscheid_kommentar));
    ok('Und die entscheidende Person dazu',
       abgelehnt.entschieden_von === 'u1' && !!abgelehnt.entschieden_am,
       JSON.stringify(abgelehnt));

    const ablehnMeldung = meldungen.find(m => /abgelehnt/.test(m.titel || ''));
    ok('Die Ablehnung meldet sich', !!ablehnMeldung, JSON.stringify(meldungen));
    ok('Und nimmt die Begründung mit',
       /niemand sonst auf der Baustelle/.test(ablehnMeldung?.text || ''),
       String(ablehnMeldung?.text));

    /* Eine Begründung ohne Entscheid gibt es nicht — sie wäre ein
       Vorwurf ohne Anlass. */
    const ohneEntscheid = await p.evaluate(async () => {
      const d = JSON.parse(sessionStorage.getItem('__stub_db'));
      const a = d.antraege.find(x => x.erstellt_von === 'u1' && x.status === 'eingereicht');
      return (await sb.from('antraege')
        .update({ entscheid_kommentar: 'einfach so' }).eq('id', a.id)).error?.message || 'durchgelassen';
    });
    ok('Eine Begründung ohne Entscheid weist die Datenbank ab',
       ohneEntscheid !== 'durchgelassen', ohneEntscheid);

    /* Und das PDF lässt sich nachträglich nicht austauschen: es zeigt
       den Antrag, wie er eingereicht wurde. */
    const pdfTausch = await p.evaluate(async id =>
      (await sb.from('antraege')
        .update({ status: 'genehmigt', pdf_pfad: 'irgendwo/anders.pdf' }).eq('id', id))
        .error?.message || 'durchgelassen', nachFerien.id);
    ok('Das PDF lässt sich beim Entscheiden nicht austauschen',
       /nur der Entscheid/.test(pdfTausch), pdfTausch);
  }

  /* --- 5. Der Grund steht sichtbar am eigenen Antrag -------------------- */

  /* Aus der Sicht der antragstellenden Person: sie sieht ihren
     abgelehnten Antrag mit dem Grund, ohne irgendwo hineinzutippen. */
  await p.evaluate(() => {
    const d = JSON.parse(sessionStorage.getItem('__stub_db'));
    d.antraege = d.antraege.map(a => a.art === 'ferien' && a.erstellt_von === 'u1'
      ? { ...a, status: 'abgelehnt', entschieden_von: 'u-thomas',
          entschieden_am: new Date().toISOString(),
          entscheid_kommentar: 'Über Weihnachten läuft die Rohbauabnahme.' }
      : a);
    sessionStorage.setItem('__stub_db', JSON.stringify(d));
  });
  await p.goto(`${SERVER}/formulare.html`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(900);

  ok('Der abgelehnte Antrag trägt die Marke "Abgelehnt"',
     (await p.textContent('#meine')).includes('Abgelehnt'));
  ok('Der Grund steht sichtbar daneben',
     await p.locator('#meine .fm-grund').count() === 1,
     String(await p.locator('#meine .fm-grund').count()));
  ok('Und zwar im Wortlaut',
     (await p.textContent('#meine .fm-grund')).includes('Rohbauabnahme'),
     await p.textContent('#meine .fm-grund'));
  ok('Am genehmigten oder offenen Antrag steht kein Grund',
     await p.locator('#meine .fm-grund').count() === 1);
  ok('Beide eigenen Anträge haben weiterhin ihren PDF-Knopf',
     await p.locator('#meine [data-pdf]').count() === 2,
     String(await p.locator('#meine [data-pdf]').count()));
  await p.screenshot({ path: `${OUT}/${breite}-ablehngrund.png`, fullPage: true });

  await ctx.close();
}

await lauf('handy', 390, 'mitarbeiter');
await lauf('desktop', 1440, 'entwickler');
await lauf2('handy', 390, 'mitarbeiter');
await lauf2('desktop', 1440, 'entwickler');
await browser.close();

console.log('\n=== Fehler im Browser ===');
console.log(fehler.length ? fehler.join('\n') : 'keine');
