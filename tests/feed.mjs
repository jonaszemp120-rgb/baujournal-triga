/* Schritt 13: Feed — Beiträge, Umfragen, Herzen, Kommentare, Löschen.

   Zwei Durchgänge mit verschiedenen Berechtigungsstufen, weil sich der
   Feed genau daran unterscheidet: die Moderation. Auf dem Handy läuft die
   Person mit der Stufe "mitarbeiter", auf dem Desktop die mit
   "entwickler". So wird beides geprüft und nicht nur die bequeme Hälfte. */

import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import fs from 'node:fs';
const OUT = '/tmp/claude-0/-home-user-baujournal-triga/ad655f9d-451a-55b0-aac9-986e124c8f6f/scratchpad/shots-feed';
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
const STUB = fs.readFileSync('./stub.js', 'utf8');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const fehler = [];
const ok = (n, b, zusatz = '') => console.log(`  ${b ? '✓' : '✗ FEHLER'}  ${n}${b ? '' : `  → ${zusatz}`}`);

const GESTERN = new Date(Date.now() - 86400000).toISOString();

async function lauf(name, breite, stufe) {
  const ctx = await browser.newContext({
    viewport: { width: breite, height: breite >= 1024 ? 950 : 844 },
    deviceScaleFactor: 1, locale: 'de-CH', serviceWorkers: 'block'
  });
  await ctx.route('**/vendor/supabase-js-2.58.0.js', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: STUB }));

  /* Jeder Aufruf an /api/push wird mitgeschrieben statt weitergereicht.
     Darum geht es hier: welcher Beitrag meldet sich, und welcher nicht. */
  const meldungen = [];
  await ctx.route('**/api/push', async r => {
    try { meldungen.push(JSON.parse(r.request().postData() || '{}')); } catch { meldungen.push({}); }
    await r.fulfill({ status: 200, contentType: 'application/json', body: '{"gesendet":1}' });
  });

  await ctx.addInitScript(([stufe, gestern]) => {
    // Die Frage nach Benachrichtigungen kommt beim ersten Öffnen und
    // würde sonst jeden Klick verdecken.
    try { localStorage.setItem('bj_push_gefragt', '1'); } catch {}
    if (sessionStorage.getItem('__stub_db')) return;
    sessionStorage.setItem('__stub_db', JSON.stringify({
      profile: [{ id: 'u1', name: 'Jonas Zemp' }, { id: 'u2', name: 'Silvia Weber' }],
      projekte: [{ id: 'p1', name: 'Garten Mille Fiori', standort: 'Sarnen',
                   bauherrschaft: 'StImmobilia GmbH', status: 'laufend', archiviert: false }],
      eintraege: [], eintraege_korrekturen: [],
      mitarbeiter: [
        { id: 'ich', name: 'Jonas Zemp', rolle: 'Bauleitung', user_id: 'u1',
          berechtigung: stufe, erstellt_am: '2026-09-01T07:00:00.000Z' },
        { id: 'm2', name: 'Silvia Weber', rolle: 'Administration', user_id: 'u2',
          berechtigung: 'geschaeftsleitung', erstellt_am: '2026-09-01T07:00:00.000Z' }
      ],
      // Ein Beitrag, der jemand anderem gehört. Daran hängt die Moderation.
      feed_beitraege: [{ id: 'b-fremd', art: 'beitrag', kategorie: 'update',
                         text: 'Beitrag von Silvia', erstellt_von: 'u2', erstellt_am: gestern }],
      feed_bilder: [],
      feed_optionen: [], feed_stimmen: [], feed_reaktionen: [], feed_kommentare: []
    }));
  }, [stufe, GESTERN]);

  const p = await ctx.newPage();
  p.on('console', m => { if (m.type() === 'error') fehler.push(`${name}: ${m.text()}`); });
  p.on('pageerror', e => fehler.push(`${name}: ${e.message}`));
  console.log(`\n=== ${name} (${breite}px, Stufe ${stufe}) ===`);

  const db = () => p.evaluate(() => JSON.parse(sessionStorage.getItem('__stub_db')));

  await p.goto('http://127.0.0.1:8123/index.html', { waitUntil: 'networkidle' });
  await p.fill('#email', 'test.durchlauf@triga.ch'); await p.fill('#pw', 'TestDurchlauf!2026');
  await p.click('#btn'); await p.waitForURL('**/start.html');
  await p.waitForTimeout(900);

  /* --- 1. Der Weg in den Feed ------------------------------------------- */

  const kacheln = await p.$$eval('#raster .st-kachel', e => e.map(x => x.getAttribute('href')));
  ok('Startseite zeigt weiterhin genau sechs Kacheln', kacheln.length === 6, kacheln.join(' | '));
  ok('Keine Feed-Kachel im Raster', !kacheln.includes('feed.html'), kacheln.join(' | '));

  if (breite >= 1024) {
    const nav = await p.$$eval('.tr-sidebar .tr-nav', e => e.map(x => x.textContent.trim()));
    ok('Feed steht zuoberst in der Seitenleiste', nav[0] === 'Feed', nav.join(' | '));
    ok('Danach kommt Mitarbeiter wie bisher', nav[1] === 'Mitarbeiter', nav.join(' | '));
    ok('Es sind acht Einträge', nav.length === 8, String(nav.length));
    await p.click('.tr-sidebar .tr-nav[href="feed.html"]');
  } else {
    ok('Auf dem Handy führt eine eigene Zeile zum Feed', await p.locator('.st-einstieg[href="feed.html"]').isVisible());
    ok('Und die steht über den Kacheln', await p.evaluate(() => {
      const z = document.querySelector('.st-einstieg').getBoundingClientRect().top;
      const k = document.querySelector('#raster .st-kachel').getBoundingClientRect().top;
      return z < k;
    }));
    await p.click('.st-einstieg[href="feed.html"]');
  }
  await p.waitForURL('**/feed.html');
  await p.waitForTimeout(900);

  ok('Der fremde Beitrag ist da', (await p.$$('#liste .fd-karte')).length === 1);

  /* --- 2. Moderation: darf ich fremde Beiträge löschen? ------------------ */

  const wegAmFremden = await p.locator('#liste .fd-karte[data-beitrag="b-fremd"] [data-weg]').count();
  if (stufe === 'mitarbeiter') {
    ok('Ohne erweiterte Stufe kein Löschknopf am fremden Beitrag', wegAmFremden === 0);
    // Und auch nicht an der Datenbank vorbei: die Policy trifft keine Zeile.
    const uebrig = await p.evaluate(async () =>
      (await sb.from('feed_beitraege').delete().eq('id', 'b-fremd')).data.length);
    ok('Und auch direkt an der Datenbank geht es nicht', uebrig === 0, String(uebrig));
    ok('Der fremde Beitrag steht noch', (await p.$$('#liste .fd-karte')).length === 1);
  } else {
    ok('Mit erweiterter Stufe ein Löschknopf am fremden Beitrag', wegAmFremden === 1);
  }

  /* --- 3. Beitrag schreiben --------------------------------------------- */

  await p.locator('[data-neu]:visible').first().click();
  await p.waitForTimeout(500);
  ok('Der Dialog heisst "Neuer Beitrag"', (await p.textContent('.sheet')).includes('Neuer Beitrag'));
  ok('Er startet im Modus Beitrag',
     await p.getAttribute('#nb-beitrag', 'aria-pressed') === 'true'
     && await p.getAttribute('#nb-umfrage', 'aria-pressed') === 'false');
  ok('Kategorie Update ist vorbelegt',
     await p.getAttribute('#nb-kategorie [data-kat="update"]', 'aria-pressed') === 'true');
  ok('Die Projektliste kennt das Projekt',
     (await p.$$eval('#nb-projekt option', e => e.map(x => x.textContent)))
       .join('|') === 'Kein Projekt ausgewählt|Garten Mille Fiori');

  await p.fill('#nb-text', 'Bodenplatte Haus Lilly fertig betoniert');
  await p.selectOption('#nb-projekt', { label: 'Garten Mille Fiori' });
  await p.click('#nb-ja');
  await p.waitForTimeout(1000);

  ok('Der Beitrag steht zuoberst', (await p.textContent('#liste .fd-karte')).includes('Bodenplatte Haus Lilly'));
  ok('Mit dem eigenen Namen', (await p.textContent('#liste .fd-karte .fd-name')).includes('Jonas Zemp'));
  ok('Und dem Projekt in der Zeile darunter',
     (await p.textContent('#liste .fd-karte .fd-meta')).includes('Garten Mille Fiori'));
  ok('Kein roter Rahmen bei einem Update',
     !(await p.$eval('#liste .fd-karte', e => e.classList.contains('wichtig'))));
  if (breite >= 1024) {
    ok('Auf dem Desktop trägt er die Marke "Update"',
       (await p.textContent('#liste .fd-karte')).includes('Update'));
  } else {
    ok('Auf dem Handy bleibt die Marke "Update" weg',
       !(await p.locator('#liste .fd-karte').first().locator('.fd-marke').isVisible().catch(() => false)));
  }

  /* --- 4. Wichtiger Beitrag --------------------------------------------- */

  await p.locator('[data-neu]:visible').first().click();
  await p.waitForTimeout(500);
  await p.click('#nb-kategorie [data-kat="wichtig"]');
  await p.fill('#nb-text', 'Ab morgen gilt auf allen Baustellen die neue Helmpflicht-Regelung.');
  await p.click('#nb-ja');
  await p.waitForTimeout(1000);

  const erste = p.locator('#liste .fd-karte').first();
  ok('Der wichtige Beitrag steht zuoberst', (await erste.textContent()).includes('Helmpflicht'));
  ok('Er hat den roten Rahmen', await erste.evaluate(e => e.classList.contains('wichtig')));
  ok('Der Rahmen ist wirklich rot', await erste.evaluate(e => {
    const s = getComputedStyle(e);
    return s.borderTopColor === 'rgb(178, 0, 0)' && parseFloat(s.borderTopWidth) >= 2;
  }), await erste.evaluate(e => getComputedStyle(e).borderTopColor + ' ' + getComputedStyle(e).borderTopWidth));
  ok('Und die Marke "Wichtig"', (await erste.locator('.fd-marke.wichtig').textContent()).trim() === 'Wichtig');
  await p.screenshot({ path: `${OUT}/${name}-feed.png`, fullPage: true });

  /* --- 4a. Push nur bei "Wichtig" ---------------------------------------- */

  await p.waitForTimeout(600);
  ok('Der wichtige Beitrag löst genau eine Meldung aus', meldungen.length === 1,
     JSON.stringify(meldungen));
  ok('Und zwar über die Kennung des Beitrags, nicht über einen Chat',
     !!meldungen[0]?.beitrag && !meldungen[0]?.chat, JSON.stringify(meldungen[0]));
  ok('Die Kennung ist die des obersten Beitrags',
     meldungen[0].beitrag === await erste.getAttribute('data-beitrag'));
  ok('Die Meldung führt in den Feed', meldungen[0].ziel === 'feed.html');
  ok('Titel und Text stimmen',
     meldungen[0].titel === 'Wichtig von Jonas' && meldungen[0].text.includes('Helmpflicht'),
     JSON.stringify(meldungen[0]));
  ok('Der Beitrag davor hat nichts ausgelöst',
     !meldungen.some(m => String(m.text || '').includes('Bodenplatte')));

  /* --- 4b. Beitrag mit mehreren Fotos ------------------------------------- */

  await p.locator('[data-neu]:visible').first().click();
  await p.waitForTimeout(500);
  await p.click('#nb-ja'); await p.waitForTimeout(400);
  ok('Ein leerer Beitrag geht nicht', (await p.textContent('#nb-fehler')).includes('Text oder ein Foto'));

  // Das kleinste gültige PNG, ein Pixel. Es geht um den Weg, nicht um das Bild.
  const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const png = n => ({ name: `${n}.png`, mimeType: 'image/png', buffer: Buffer.from(PNG, 'base64') });

  await p.setInputFiles('#nb-datei', [png('bodenplatte'), png('geruest')]);
  await p.waitForTimeout(500);
  ok('Der Dialog zeigt beide Vorschauen', await p.locator('#nb-fotos .fd-vorschau').count() === 2);
  ok('Und zählt sie im Knopf mit', (await p.textContent('#nb-foto')).includes('(2)'));

  await p.locator('#nb-fotos [data-fweg="0"]').click();
  await p.waitForTimeout(300);
  ok('Eine Vorschau lässt sich einzeln wieder wegnehmen',
     await p.locator('#nb-fotos .fd-vorschau').count() === 1);

  await p.setInputFiles('#nb-datei', [png('fassade'), png('dach')]);
  await p.waitForTimeout(500);
  ok('Nachlegen geht auch', await p.locator('#nb-fotos .fd-vorschau').count() === 3);

  await p.fill('#nb-text', 'Rundgang Haus Lilly');
  await p.click('#nb-ja');
  await p.waitForTimeout(1600);

  const mitFoto = p.locator('#liste .fd-karte', { hasText: 'Rundgang Haus Lilly' });
  ok('Alle drei Fotos stehen im Beitrag', await mitFoto.locator('.fd-spur .fd-bild').count() === 3);
  ok('Darunter drei Punkte', await mitFoto.locator('.fd-punkt').count() === 3);
  ok('Der erste Punkt ist gesetzt',
     await mitFoto.locator('.fd-punkt').first().evaluate(e => e.classList.contains('an')));
  ok('Mit dem Hinweis auf die 30 Tage',
     (await mitFoto.locator('.fd-ablauf').textContent()).includes('automatisch gelöscht'));

  const beitragId = await mitFoto.getAttribute('data-beitrag');
  const dazu = (await db()).feed_bilder.filter(x => x.beitrag_id === beitragId);
  ok('Drei Zeilen in feed_bilder', dazu.length === 3, String(dazu.length));
  ok('Die Pfade liegen unter der Kennung des Beitrags',
     dazu.every(x => String(x.bild_pfad).startsWith(beitragId + '/')),
     JSON.stringify(dazu.map(x => x.bild_pfad)));
  ok('Durchnummeriert in der Reihenfolge der Auswahl',
     dazu.map(x => x.reihenfolge).sort().join('') === '012',
     JSON.stringify(dazu.map(x => x.reihenfolge)));
  ok('Das Ablaufdatum liegt 30 Tage in der Zukunft',
     Math.round((new Date(dazu[0].bild_ablauf) - Date.now()) / 86400000) === 30, dazu[0].bild_ablauf);
  ok('Am Beitrag selbst steht kein Pfad mehr',
     !('bild_pfad' in (await db()).feed_beitraege.find(b => b.id === beitragId)));

  if (breite >= 1024) {
    await mitFoto.locator('[data-blaettern="1"]').click();
    await p.waitForTimeout(900);
    ok('Der Pfeil blättert weiter',
       await mitFoto.locator('.fd-punkt').nth(1).evaluate(e => e.classList.contains('an')));
  }

  await p.screenshot({ path: `${OUT}/${name}-galerie.png`, fullPage: true });

  // Und wieder weg, damit die Zählungen weiter unten stimmen.
  await mitFoto.locator('[data-weg]').click();
  await p.waitForTimeout(500);
  await p.click('#f-ja');
  await p.waitForTimeout(1100);
  ok('Mit dem Beitrag verschwinden auch alle Dateien',
     !Object.keys((await db()).__objekte || {}).length);
  ok('Und die Fotozeilen dazu', !(await db()).feed_bilder.length);
  ok('Ein Update mit Fotos meldet sich trotzdem nicht', meldungen.length === 1,
     JSON.stringify(meldungen.map(m => m.titel)));

  /* --- 5. Umfrage ------------------------------------------------------- */

  await p.locator('[data-neu]:visible').first().click();
  await p.waitForTimeout(500);
  await p.click('#nb-umfrage');
  await p.waitForTimeout(300);
  ok('Im Umfragemodus verschwindet der Beitragsteil',
     !(await p.locator('#nb-teil-beitrag').isVisible()) && await p.locator('#nb-teil-umfrage').isVisible());
  ok('Der Knopf heisst jetzt "Umfrage posten"',
     (await p.textContent('#nb-ja')).trim() === 'Umfrage posten');
  ok('Zwei Antwortfelder stehen bereit', (await p.$$('#nb-antworten [data-antwort]')).length === 2);

  await p.click('#nb-ja'); await p.waitForTimeout(400);
  ok('Ohne Frage geht es nicht', (await p.textContent('#nb-fehler')).includes('Frage'));

  await p.fill('#nb-frage', 'Weihnachtsessen: welcher Tag passt besser?');
  await p.click('#nb-ja'); await p.waitForTimeout(400);
  ok('Ohne zwei Antworten auch nicht', (await p.textContent('#nb-fehler')).includes('zwei'));

  await p.fill('#nb-antworten [data-antwort="0"]', 'Freitag, 11.12.');
  await p.fill('#nb-antworten [data-antwort="1"]', 'Samstag, 12.12.');
  await p.click('#nb-mehr'); await p.waitForTimeout(250);
  ok('Eine dritte Option lässt sich hinzufügen', (await p.$$('#nb-antworten [data-antwort]')).length === 3);
  await p.click('#nb-antworten [data-antwort-weg="2"]'); await p.waitForTimeout(250);
  ok('Und wieder entfernen', (await p.$$('#nb-antworten [data-antwort]')).length === 2);

  ok('Anonym ist zuerst aus', await p.getAttribute('#nb-anonym', 'aria-checked') === 'false');
  await p.click('#nb-anonym');
  ok('Und lässt sich einschalten', await p.getAttribute('#nb-anonym', 'aria-checked') === 'true');
  await p.click('#nb-ja');
  await p.waitForTimeout(1000);

  const umfrage = p.locator('#liste .fd-karte').first();
  ok('Die Umfrage steht zuoberst', (await umfrage.textContent()).includes('Weihnachtsessen'));
  ok('Sie ist als Umfrage gekennzeichnet',
     (await umfrage.locator('.fd-art').textContent()).includes('Umfrage'));
  ok('Und als anonym', (await umfrage.locator('.fd-meta').textContent()).includes('anonym'));
  ok('Vor der Stimme sind es Knöpfe, keine Balken',
     (await umfrage.locator('.fd-option').count()) === 2
     && (await umfrage.locator('.fd-balken').count()) === 0);
  ok('Der Hinweis nennt die Regel',
     (await umfrage.locator('.fd-abgestimmt').textContent()).includes('Eine Stimme pro Person'));
  await p.waitForTimeout(500);
  ok('Eine Umfrage meldet sich nicht', meldungen.length === 1,
     JSON.stringify(meldungen.map(m => m.titel)));

  /* --- 6. Abstimmen ----------------------------------------------------- */

  await umfrage.locator('.fd-option').first().click();
  await p.waitForTimeout(900);

  const nach = p.locator('#liste .fd-karte').first();
  ok('Nach der Stimme sind es Balken',
     (await nach.locator('.fd-balken').count()) === 2 && (await nach.locator('.fd-option').count()) === 0);
  ok('Die eigene Wahl ist markiert',
     await nach.locator('.fd-balken').first().evaluate(e => e.classList.contains('meine')));
  ok('Eine Stimme heisst 100 Prozent',
     (await nach.locator('.fd-balken').first().locator('.prozent').textContent()).trim() === '100 %');
  ok('Die andere Option steht bei 0 Prozent',
     (await nach.locator('.fd-balken').nth(1).locator('.prozent').textContent()).trim() === '0 %');
  ok('Der Zähler nennt beide Zahlen',
     (await nach.locator('.fd-abgestimmt').textContent()).trim() === '1 von 2 haben abgestimmt',
     await nach.locator('.fd-abgestimmt').textContent());

  const stimmen = (await db()).feed_stimmen;
  ok('Genau eine Stimmzeile', stimmen.length === 1 && stimmen[0].user_id === 'u1');

  // Ein zweiter Versuch an der Oberfläche vorbei: der Schlüssel hält.
  const zweite = await p.evaluate(async () => {
    const d = JSON.parse(sessionStorage.getItem('__stub_db'));
    const s = d.feed_stimmen[0];
    const andere = d.feed_optionen.find(o => o.beitrag_id === s.beitrag_id && o.id !== s.option_id);
    const { error } = await sb.from('feed_stimmen')
      .insert({ beitrag_id: s.beitrag_id, option_id: andere.id, user_id: 'u1' });
    return error ? error.message : 'durchgelassen';
  });
  ok('Eine zweite Stimme wird abgewiesen', /duplicate key/.test(zweite), zweite);

  // Und eine Stimme auf eine Option aus einer fremden Umfrage.
  const fremdeOption = await p.evaluate(async () => {
    const d = JSON.parse(sessionStorage.getItem('__stub_db'));
    const { error } = await sb.from('feed_stimmen')
      .insert({ beitrag_id: 'b-fremd', option_id: d.feed_optionen[0].id, user_id: 'u1' });
    return error ? error.message : 'durchgelassen';
  });
  ok('Eine Option aus einer anderen Umfrage wird abgewiesen',
     /row-level security/.test(fremdeOption), fremdeOption);

  /* --- 7. Filter -------------------------------------------------------- */

  const zaehleMit = async f => {
    await p.click(`#filter [data-filter="${f}"]`);
    await p.waitForTimeout(350);
    return (await p.$$('#liste .fd-karte')).length;
  };
  ok('Filter "Alle" zeigt alles', await zaehleMit('alle') === 4);
  ok('Filter "Update" zeigt nur Updates', await zaehleMit('update') === 2);
  ok('Filter "Wichtig" zeigt nur den wichtigen', await zaehleMit('wichtig') === 1);
  ok('Filter "Umfragen" zeigt nur die Umfrage', await zaehleMit('umfragen') === 1);
  ok('Der gewählte Chip ist markiert',
     await p.getAttribute('#filter [data-filter="umfragen"]', 'aria-pressed') === 'true'
     && await p.getAttribute('#filter [data-filter="alle"]', 'aria-pressed') === 'false');
  await zaehleMit('alle');

  /* --- 8. Herz ---------------------------------------------------------- */

  const karteHelm = p.locator('#liste .fd-karte', { hasText: 'Helmpflicht' });
  ok('Das Herz steht auf null', (await karteHelm.locator('[data-herz] span').textContent()).trim() === '0');
  await karteHelm.locator('[data-herz]').click();
  await p.waitForTimeout(700);
  const karteHelm2 = p.locator('#liste .fd-karte', { hasText: 'Helmpflicht' });
  ok('Ein Herz gesetzt', (await karteHelm2.locator('[data-herz] span').textContent()).trim() === '1');
  ok('Und es ist als gesetzt markiert',
     await karteHelm2.locator('[data-herz]').getAttribute('aria-pressed') === 'true');
  await karteHelm2.locator('[data-herz]').click();
  await p.waitForTimeout(700);
  ok('Wieder entfernt', (await p.locator('#liste .fd-karte', { hasText: 'Helmpflicht' })
       .locator('[data-herz] span').textContent()).trim() === '0');
  ok('Und in der Datenbank steht nichts mehr', (await db()).feed_reaktionen.length === 0);

  /* --- 9. Kommentare ---------------------------------------------------- */

  const karteBoden = () => p.locator('#liste .fd-karte', { hasText: 'Bodenplatte' });
  await karteBoden().locator('[data-kommentare]').click();
  await p.waitForTimeout(500);
  ok('Der Kommentarbereich klappt auf', await karteBoden().locator('.fd-schreiben').isVisible());
  ok('Und sagt, dass noch nichts da ist',
     (await karteBoden().locator('.fd-kommentare').textContent()).includes('Noch kein Kommentar'));

  await karteBoden().locator('[data-kfeld]').fill('Sauber gelaufen, keine Beanstandungen.');
  await karteBoden().locator('[data-ksenden]').click();
  await p.waitForTimeout(800);
  ok('Der Kommentar steht da',
     (await karteBoden().locator('.fd-kommentar .was').textContent()).includes('Sauber gelaufen'));
  ok('Mit Verfasser', (await karteBoden().locator('.fd-kommentar .wer').textContent()).trim() === 'Jonas Zemp');
  ok('Und Zeitangabe', /heute, \d\d:\d\d/.test(await karteBoden().locator('.fd-kommentar .wann').textContent()));
  ok('Der Zähler steht auf eins',
     (await karteBoden().locator('[data-kommentare]').textContent()).trim().startsWith('1'));

  await karteBoden().locator('.fd-kommentar [data-kweg]').click();
  await p.waitForTimeout(500);
  await p.click('#f-ja');
  await p.waitForTimeout(800);
  ok('Der Kommentar ist weg', (await db()).feed_kommentare.length === 0);

  /* --- 9b. Erwähnungen ---------------------------------------------------- */

  await karteBoden().locator('[data-kfeld]').click();
  await karteBoden().locator('[data-kfeld]').type('Danke @Sil');
  await p.waitForTimeout(500);
  ok('Die Auswahlliste klappt auf', await p.locator('.fd-erwaehnliste').isVisible());
  const vorschlaege = await p.$$eval('.fd-erwaehnliste button', e => e.map(x => x.textContent.trim()));
  ok('Sie zeigt die passende Person', vorschlaege.length === 1 && vorschlaege[0].includes('Silvia Weber'),
     vorschlaege.join('|'));
  ok('Und niemals einen selbst', !vorschlaege.some(t => t.includes('Jonas Zemp')), vorschlaege.join('|'));

  await p.locator('.fd-erwaehnliste button').first().click();
  await p.waitForTimeout(400);
  ok('Die Liste schliesst nach der Wahl', await p.locator('.fd-erwaehnliste').count() === 0);
  ok('Im Feld steht der Name, nicht die Kennung',
     (await karteBoden().locator('[data-kfeld]').inputValue()) === 'Danke @Silvia Weber ',
     await karteBoden().locator('[data-kfeld]').inputValue());

  await karteBoden().locator('[data-kfeld]').type('fuers Nachfassen');
  await karteBoden().locator('[data-ksenden]').click();
  await p.waitForTimeout(1000);

  const k = (await db()).feed_kommentare.find(x => (x.text || '').includes('Danke'));
  ok('Gespeichert wird die Erwähnung mit Kennung',
     k.text === 'Danke @[Silvia Weber](u2) fuers Nachfassen', k.text);
  ok('Am Bildschirm steht sie als Name',
     (await karteBoden().locator('.fd-kommentar .was').textContent()) === 'Danke @Silvia Weber fuers Nachfassen',
     await karteBoden().locator('.fd-kommentar .was').textContent());
  ok('Hervorgehoben und verlinkt',
     (await karteBoden().locator('.fd-kommentar a.fd-erwaehnt').getAttribute('href')) === 'mitarbeiter.html?person=m2',
     await karteBoden().locator('.fd-kommentar a.fd-erwaehnt').getAttribute('href'));

  const erwMeldung = meldungen[meldungen.length - 1];
  ok('Die erwähnte Person bekommt eine Meldung',
     erwMeldung?.kommentar === k.id, JSON.stringify(erwMeldung));
  ok('Mit sprechendem Titel und ohne Klammern im Text',
     erwMeldung.titel === 'Jonas hat Sie erwähnt'
     && erwMeldung.text === 'Danke @Silvia Weber fuers Nachfassen', JSON.stringify(erwMeldung));

  // Ein Kommentar ohne Erwähnung meldet nichts.
  const standMeldungen = meldungen.length;
  await karteBoden().locator('[data-kfeld]').fill('Noch eine Bemerkung ohne alles');
  await karteBoden().locator('[data-ksenden]').click();
  await p.waitForTimeout(900);
  ok('Ein Kommentar ohne Erwähnung meldet sich nicht', meldungen.length === standMeldungen,
     JSON.stringify(meldungen.slice(standMeldungen)));

  // Immer den ersten: nach dem Löschen wird die Liste neu gezeichnet,
  // ein vorher geholter zweiter Knopf hinge dann im Leeren.
  while (await karteBoden().locator('.fd-kommentar [data-kweg]').count()) {
    await karteBoden().locator('.fd-kommentar [data-kweg]').first().click();
    await p.waitForTimeout(400);
    await p.click('#f-ja');
    await p.waitForTimeout(800);
  }
  ok('Beide Kommentare wieder weg', (await db()).feed_kommentare.length === 0);

  // Dasselbe im Beitrag selbst: ein Update mit Erwähnung meldet sich.
  const standVorBeitrag = meldungen.length;
  await p.locator('[data-neu]:visible').first().click();
  await p.waitForTimeout(500);
  await p.locator('#nb-text').type('Bitte anschauen @Silvia');
  await p.waitForTimeout(500);
  ok('Auch im Beitrag klappt die Auswahlliste auf', await p.locator('.fd-erwaehnliste').isVisible());
  await p.locator('.fd-erwaehnliste button').first().click();
  await p.waitForTimeout(300);
  await p.click('#nb-ja');
  await p.waitForTimeout(1300);

  const mitErw = p.locator('#liste .fd-karte', { hasText: 'Bitte anschauen' });
  ok('Die Erwähnung steht im Beitrag als Name',
     (await mitErw.locator('.fd-text').textContent()).trim() === 'Bitte anschauen @Silvia Weber',
     await mitErw.locator('.fd-text').textContent());
  ok('Und ist verlinkt', await mitErw.locator('a.fd-erwaehnt').count() === 1);
  const beitragErw = (await db()).feed_beitraege.find(b => (b.text || '').includes('Bitte anschauen'));
  ok('Gespeichert mit Kennung', beitragErw.text === 'Bitte anschauen @[Silvia Weber](u2)', beitragErw.text);
  ok('Ein Update mit Erwähnung meldet sich', meldungen.length === standVorBeitrag + 1,
     JSON.stringify(meldungen.slice(standVorBeitrag)));
  ok('Unter dem Titel der Erwähnung, nicht unter "Wichtig"',
     meldungen[meldungen.length - 1].titel === 'Jonas hat Sie erwähnt',
     meldungen[meldungen.length - 1].titel);

  await mitErw.locator('[data-weg]').click();
  await p.waitForTimeout(500);
  await p.click('#f-ja');
  await p.waitForTimeout(900);
  ok('Und wieder weg', !(await db()).feed_beitraege.some(b => (b.text || '').includes('Bitte anschauen')));

  /* --- 9c. Wenn die erwähnte Person umbenannt wird oder weg ist ----------- */

  /* Der Name steht im Text, nicht in der Anzeige: @[Silvia Weber](u2).
     Ein alter Beitrag behält damit den Namen, der zum Zeitpunkt des
     Schreibens galt — dasselbe Muster wie bei den Teilnehmenden eines
     Sitzungsprotokolls. Verknüpft wird über die Kennung, und die ändert
     sich beim Umbenennen nicht. */

  /* Ein Kommentar von damals, mit der Erwähnung so gespeichert, wie die
     App sie schreibt. Direkt gesetzt, weil es hier nicht ums Schreiben
     geht, sondern darum, was Monate später davon zu sehen ist. */
  await p.evaluate(async id => {
    await sb.from('feed_kommentare').insert({
      beitrag_id: id, verfasser: 'u1',
      text: 'Danke @[Silvia Weber](u2) fuers Nachfassen'
    });
  }, (await db()).feed_beitraege.find(b => (b.text || '').includes('Bodenplatte')).id);

  /* Umbenennen und Löschen sind Sache der Personalverwaltung und laufen
     hier an der Oberfläche vorbei: geprüft wird der Feed, nicht der
     Bereich Mitarbeiter. */
  const setzeSilvia = felder => p.evaluate(f => {
    const d = JSON.parse(sessionStorage.getItem('__stub_db'));
    d.mitarbeiter = d.mitarbeiter.map(m => m.id === 'm2' ? { ...m, ...f } : m);
    sessionStorage.setItem('__stub_db', JSON.stringify(d));
  }, felder);

  await setzeSilvia({ name: 'Silvia Weber-Amrein' });
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(1300);
  await karteBoden().locator('[data-kommentare]').click();
  await p.waitForTimeout(600);

  const nachUmbenennen = karteBoden().locator('.fd-kommentar .fd-erwaehnt').first();
  ok('Nach dem Umbenennen steht im alten Kommentar weiter der alte Name',
     (await nachUmbenennen.textContent()).trim() === '@Silvia Weber',
     await nachUmbenennen.textContent());
  ok('Und die Verknüpfung führt weiterhin zur richtigen Person',
     await karteBoden().locator('.fd-kommentar a.fd-erwaehnt[href="mitarbeiter.html?person=m2"]').count() === 1);
  ok('Neu geschrieben würde der neue Name vorgeschlagen',
     await p.evaluate(() => JSON.parse(sessionStorage.getItem('__stub_db'))
       .mitarbeiter.find(m => m.id === 'm2').name === 'Silvia Weber-Amrein'));

  /* Und wenn die Person ganz weg ist: die App lädt nur Zeilen ohne
     Löschdatum, die Erwähnung findet also niemanden mehr. Der Name bleibt
     trotzdem lesbar, nur ohne Verknüpfung — ins Leere führen soll sie
     nicht. */
  await setzeSilvia({ geloescht_am: new Date().toISOString() });
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(1300);
  await karteBoden().locator('[data-kommentare]').click();
  await p.waitForTimeout(600);

  const nachLoeschen = karteBoden().locator('.fd-kommentar .fd-erwaehnt').first();
  ok('Nach dem Löschen steht der Name immer noch da',
     (await nachLoeschen.textContent()).trim() === '@Silvia Weber',
     await nachLoeschen.textContent());
  ok('Aber ohne Verknüpfung ins Leere',
     await karteBoden().locator('.fd-kommentar a.fd-erwaehnt').count() === 0
     && await karteBoden().locator('.fd-kommentar span.fd-erwaehnt').count() === 1);
  ok('Der Kommentartext bleibt vollständig lesbar',
     (await karteBoden().locator('.fd-kommentar .was').first().textContent()).trim()
       === 'Danke @Silvia Weber fuers Nachfassen',
     await karteBoden().locator('.fd-kommentar .was').first().textContent());
  ok('Und in der Datenbank steht unverändert die Momentaufnahme',
     (await db()).feed_kommentare.some(k => k.text === 'Danke @[Silvia Weber](u2) fuers Nachfassen'));

  // Zurücksetzen, damit die folgenden Abschnitte auf demselben Stand stehen.
  await setzeSilvia({ name: 'Silvia Weber', geloescht_am: null });
  await p.evaluate(async () => {
    for (const k of JSON.parse(sessionStorage.getItem('__stub_db')).feed_kommentare) {
      await sb.from('feed_kommentare').delete().eq('id', k.id);
    }
  });
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(1200);

  /* --- 10. Projekt-Hub --------------------------------------------------- */

  await p.goto('http://127.0.0.1:8123/projekt-detail.html?projekt=p1', { waitUntil: 'networkidle' });
  await p.waitForTimeout(1200);
  ok('Der Projekt-Hub hat einen Feed-Block',
     (await p.textContent('#feed')).includes('Feed — Beiträge zu diesem Projekt'));
  ok('Und zeigt den zugeordneten Beitrag',
     (await p.textContent('#feed')).includes('Bodenplatte Haus Lilly'));
  ok('Aber nicht den Beitrag ohne Projekt',
     !(await p.textContent('#feed')).includes('Helmpflicht'));
  await p.screenshot({ path: `${OUT}/${name}-hub.png`, fullPage: true });

  /* --- 11. Eigenen Beitrag löschen --------------------------------------- */

  await p.goto('http://127.0.0.1:8123/feed.html', { waitUntil: 'networkidle' });
  await p.waitForTimeout(1000);
  const vorher = (await p.$$('#liste .fd-karte')).length;
  await p.locator('#liste .fd-karte', { hasText: 'Bodenplatte' }).locator('[data-weg]').click();
  await p.waitForTimeout(500);
  ok('Die Rückfrage nennt den fehlenden Papierkorb',
     (await p.textContent('.sheet')).includes('keinen Papierkorb'));
  await p.click('#f-ja');
  await p.waitForTimeout(900);
  ok('Der eigene Beitrag ist weg', (await p.$$('#liste .fd-karte')).length === vorher - 1);
  ok('Und wirklich weg, nicht nur ausgeblendet',
     !(await db()).feed_beitraege.some(b => (b.text || '').includes('Bodenplatte')));

  /* --- 12. Moderation, zweite Hälfte ------------------------------------- */

  if (stufe !== 'mitarbeiter') {
    await p.locator('#liste .fd-karte[data-beitrag="b-fremd"] [data-weg]').click();
    await p.waitForTimeout(500);
    ok('Die Rückfrage nennt die fremde Person',
       (await p.textContent('.sheet')).includes('Silvia Weber'));
    await p.click('#f-ja');
    await p.waitForTimeout(900);
    ok('Die erweiterte Stufe löscht auch fremde Beiträge',
       !(await db()).feed_beitraege.some(b => b.id === 'b-fremd'));
  }

  /* --- 13. Umfrage löschen nimmt alles mit -------------------------------- */

  await p.locator('#liste .fd-karte', { hasText: 'Weihnachtsessen' }).locator('[data-weg]').click();
  await p.waitForTimeout(500);
  ok('Die Rückfrage spricht von Stimmen', (await p.textContent('.sheet')).includes('Stimmen'));
  await p.click('#f-ja');
  await p.waitForTimeout(900);
  const d = await db();
  ok('Umfrage, Optionen und Stimmen sind zusammen weg',
     !d.feed_beitraege.some(b => b.art === 'umfrage')
     && d.feed_optionen.length === 0 && d.feed_stimmen.length === 0,
     `${d.feed_optionen.length} Optionen, ${d.feed_stimmen.length} Stimmen`);

  await ctx.close();
}

/* ===== Echtzeit: zwei Tabs, eine Datenbank ================================

   Derselbe Aufbau wie beim Chat: __stub_geteilt schaltet die Testdatenbank
   von sessionStorage auf localStorage um, damit beide Tabs dieselbe sehen
   und eine Änderung im einen im anderen ein storage-Ereignis auslöst.
   Daraus baut der Stub den Änderungsstrom von Postgres nach — und, seit
   dem Feed, auch den Rundruf über den Kanal. */

async function echtzeit() {
  console.log('\n=== Echtzeit (zwei Tabs) ===');
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 950 }, locale: 'de-CH', serviceWorkers: 'block'
  });
  await ctx.route('**/vendor/supabase-js-2.58.0.js',
    r => r.fulfill({ status: 200, contentType: 'application/javascript', body: STUB }));
  await ctx.route('**/api/push',
    r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"gesendet":1}' }));

  await ctx.addInitScript(() => {
    try {
      localStorage.setItem('__stub_geteilt', '1');
      localStorage.setItem('bj_push_gefragt', '1');
    } catch {}
    if (localStorage.getItem('__stub_db')) return;
    localStorage.setItem('__stub_db', JSON.stringify({
      profile: [{ id: 'u1', name: 'Jonas Zemp' }],
      projekte: [], eintraege: [], eintraege_korrekturen: [],
      mitarbeiter: [{ id: 'ich', name: 'Jonas Zemp', rolle: 'Bauleitung',
                      user_id: 'u1', berechtigung: 'entwickler' }],
      feed_beitraege: [], feed_bilder: [], feed_optionen: [], feed_stimmen: [],
      feed_reaktionen: [], feed_kommentare: []
    }));
  });

  const oeffne = async () => {
    const s = await ctx.newPage();
    s.on('console', m => { if (m.type() === 'error') fehler.push(`echtzeit: ${m.text()}`); });
    s.on('pageerror', e => fehler.push(`echtzeit: ${e.message}`));
    await s.goto('http://127.0.0.1:8123/index.html', { waitUntil: 'networkidle' });
    if (await s.locator('#email').count()) {
      await s.fill('#email', 'test.durchlauf@triga.ch');
      await s.fill('#pw', 'TestDurchlauf!2026');
      await s.click('#btn');
      await s.waitForURL('**/start.html');
    }
    await s.goto('http://127.0.0.1:8123/feed.html', { waitUntil: 'networkidle' });
    await s.waitForTimeout(900);
    return s;
  };

  const a = await oeffne();
  const b = await oeffne();
  ok('Beide Tabs starten leer',
     (await a.$$('#liste .fd-karte')).length === 0 && (await b.$$('#liste .fd-karte')).length === 0);

  // --- Ein Beitrag in Tab A ------------------------------------------------
  await a.locator('[data-neu]:visible').first().click();
  await a.waitForTimeout(500);
  await a.fill('#nb-text', 'Kran steht ab Montag');
  await a.click('#nb-ja');
  await a.waitForTimeout(1300);
  ok('Der Beitrag erscheint in Tab B ohne Neuladen',
     (await b.textContent('#liste')).includes('Kran steht ab Montag'));

  // --- Ein Herz in Tab B ----------------------------------------------------
  await b.locator('#liste .fd-karte [data-herz]').first().click();
  await b.waitForTimeout(1300);
  ok('Das Herz erscheint in Tab A',
     (await a.locator('#liste .fd-karte [data-herz] span').first().textContent()).trim() === '1');
  await b.locator('#liste .fd-karte [data-herz]').first().click();
  await b.waitForTimeout(1300);
  ok('Und verschwindet dort auch wieder',
     (await a.locator('#liste .fd-karte [data-herz] span').first().textContent()).trim() === '0');

  // --- Ein Kommentar in Tab A -----------------------------------------------
  await a.locator('#liste .fd-karte [data-kommentare]').first().click();
  await a.waitForTimeout(400);
  await a.locator('#liste [data-kfeld]').first().fill('Zufahrt bleibt frei');
  await a.locator('#liste [data-ksenden]').first().click();
  await a.waitForTimeout(1300);
  ok('Der Kommentarzähler steigt in Tab B',
     (await b.locator('#liste .fd-karte [data-kommentare]').first().textContent()).trim().startsWith('1'));

  /* Tab B tippt gerade, während in Tab A etwas passiert. Der halbe Satz
     darf dabei nicht verloren gehen. */
  await b.locator('#liste .fd-karte [data-kommentare]').first().click();
  await b.waitForTimeout(400);
  await b.locator('#liste [data-kfeld]').first().fill('Halb getippt');
  await a.locator('#liste .fd-karte [data-herz]').first().click();
  await a.waitForTimeout(1300);
  ok('Der angefangene Kommentar in Tab B überlebt die Aktualisierung',
     (await b.locator('#liste [data-kfeld]').first().inputValue()) === 'Halb getippt');

  // --- Eine anonyme Umfrage, abstimmen in Tab A ------------------------------
  await a.locator('[data-neu]:visible').first().click();
  await a.waitForTimeout(500);
  await a.click('#nb-umfrage');
  await a.waitForTimeout(300);
  await a.fill('#nb-frage', 'Znüni um neun oder halb zehn?');
  await a.fill('#nb-antworten [data-antwort="0"]', 'Neun');
  await a.fill('#nb-antworten [data-antwort="1"]', 'Halb zehn');
  await a.click('#nb-anonym');
  await a.click('#nb-ja');
  await a.waitForTimeout(1500);

  const umfrageB = b.locator('#liste .fd-karte', { hasText: 'Znüni' });
  ok('Die Umfrage erscheint in Tab B', await umfrageB.count() === 1);
  ok('Samt ihren Antwortmöglichkeiten', (await umfrageB.locator('.fd-option').count()) === 2,
     await umfrageB.textContent());

  await a.locator('#liste .fd-karte', { hasText: 'Znüni' }).locator('.fd-option').first().click();
  await a.waitForTimeout(1600);
  /* Tab B hat selbst nicht abgestimmt und sieht darum weiter Knöpfe — aber
     der Zähler darunter muss die neue Stimme kennen. Genau das ist der
     Rundruf: die Stimmzeile selbst bekäme Tab B bei einer anonymen
     Umfrage nie zu sehen. */
  const zaehlerB = await b.locator('#liste .fd-karte', { hasText: 'Znüni' })
    .locator('.fd-abgestimmt').textContent();
  ok('Tab B erfährt von der Stimme', zaehlerB.trim().startsWith('1 von'), zaehlerB);
  ok('Ohne sie zu sehen: keine Balken, solange Tab B nicht selbst gestimmt hat',
     (await b.locator('#liste .fd-karte', { hasText: 'Znüni' }).locator('.fd-balken').count()) === 0);
  ok('Und Tab A zeigt das Ergebnis',
     (await a.locator('#liste .fd-karte', { hasText: 'Znüni' }).locator('.fd-balken').count()) === 2);

  // --- Löschen in Tab A -------------------------------------------------------
  await a.locator('#liste .fd-karte', { hasText: 'Kran steht' }).locator('[data-weg]').click();
  await a.waitForTimeout(500);
  await a.click('#f-ja');
  await a.waitForTimeout(1400);
  ok('Der gelöschte Beitrag verschwindet auch in Tab B',
     !(await b.textContent('#liste')).includes('Kran steht ab Montag'));

  await ctx.close();
}

await lauf('handy', 390, 'mitarbeiter');
await lauf('desktop', 1440, 'entwickler');
await echtzeit();
await browser.close();

console.log('\n=== Fehler im Browser ===');
console.log(fehler.length ? fehler.join('\n') : 'keine');
