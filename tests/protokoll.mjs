/* Schritt 15: Sitzungsprotokolle.

   Zwei Durchgänge. Auf dem Handy liegt im Projekt schon ein Ordner und
   das Gerät kann teilen; auf dem Desktop gibt es keinen Ordner (der
   muss also entstehen) und keine Teilen-Funktion, dort greift der
   Download als Rückfall. */

import { chromium, HIER, SERVER } from './umgebung.mjs';
import fs from 'node:fs';
const OUT = `${HIER}/ausgabe/shots-pk`;
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
const STUB = fs.readFileSync('./stub.js', 'utf8');
const browser = await chromium.launch();
const fehler = [];
const ok = (n, b, zusatz = '') => console.log(`  ${b ? '✓' : '✗ FEHLER'}  ${n}${b ? '' : `  → ${zusatz}`}`);

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

async function lauf(name, breite, { ordnerDa, kannTeilen }) {
  const ctx = await browser.newContext({
    viewport: { width: breite, height: breite >= 1024 ? 950 : 844 },
    locale: 'de-CH', serviceWorkers: 'block', acceptDownloads: true
  });
  await ctx.route('**/vendor/supabase-js-2.58.0.js',
    r => r.fulfill({ status: 200, contentType: 'application/javascript', body: STUB }));

  await ctx.addInitScript(([ordnerDa, kannTeilen]) => {
    try { localStorage.setItem('bj_push_gefragt', '1'); } catch {}

    /* Die Teilen-Funktion des Geräts, nachgebaut. Was wirklich
       weitergereicht wurde, landet in window.__geteilt. */
    window.__geteilt = [];
    if (kannTeilen) {
      navigator.canShare = () => true;
      navigator.share = async d => {
        window.__geteilt.push({
          titel: d.title,
          dateien: (d.files || []).map(f => ({ name: f.name, typ: f.type, groesse: f.size }))
        });
      };
    } else {
      delete navigator.canShare;
      delete navigator.share;
    }

    if (sessionStorage.getItem('__stub_db')) return;
    sessionStorage.setItem('__stub_db', JSON.stringify({
      profile: [{ id: 'u1', name: 'Jonas Zemp' }],
      projekte: [{
        id: 'p1', name: 'Garten Mille Fiori', standort: 'Museumstrasse, 6060 Sarnen',
        bauherrschaft: 'StImmobilia GmbH', status: 'laufend', archiviert: false,
        projekt_nr: '25004', kontrollpunkte: [], gebaeude: []
      }],
      eintraege: [], eintraege_korrekturen: [],
      mitarbeiter: [
        { id: 'ich', name: 'Jonas Zemp', rolle: 'Bauleitung', user_id: 'u1', berechtigung: 'geschaeftsleitung' },
        { id: 'm2', name: 'Thomas Zürcher', rolle: 'Bauleiter', user_id: 'u2', berechtigung: 'mitarbeiter' }
      ],
      firmen: [{ id: 'f1', name: 'Steiger Baucontrol AG', bkp_codes: ['211'] }],
      projekteinsaetze: [{ id: 'e1', projekt_id: 'p1', firma_id: 'f1', gewerk: '211', status: 'beauftragt' }],
      ansprechpersonen: [{ id: 'a1', firma_id: 'f1', name: 'Res Steiger', funktion: 'Geschäftsführer' }],
      ordner: ordnerDa ? [{ id: 'o1', name: 'Garten Mille Fiori — Protokolle', projekt_id: 'p1' }] : [],
      dateien: [], pendenzen: [],
      protokolle: [], protokoll_teilnehmer: [], protokoll_traktanden: []
    }));
  }, [ordnerDa, kannTeilen]);

  const p = await ctx.newPage();
  p.on('console', m => { if (m.type() === 'error') fehler.push(`${name}: ${m.text()}`); });
  p.on('pageerror', e => fehler.push(`${name}: ${e.message}`));
  console.log(`\n=== ${name} (${breite}px, Ordner ${ordnerDa ? 'vorhanden' : 'fehlt'}, Teilen ${kannTeilen ? 'ja' : 'nein'}) ===`);

  const db = () => p.evaluate(() => JSON.parse(sessionStorage.getItem('__stub_db')));
  const B = SERVER;

  await p.goto(`${B}/index.html`, { waitUntil: 'networkidle' });
  await p.fill('#email', 'test.durchlauf@triga.ch'); await p.fill('#pw', 'TestDurchlauf!2026');
  await p.click('#btn'); await p.waitForURL('**/start.html');

  /* --- 1. Der Weg über die Projektseite --------------------------------- */

  await p.goto(`${B}/projekt-detail.html?projekt=p1`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(900);
  const zeile = p.locator('#protokolle a');
  ok('Die Projektseite führt zu den Sitzungsprotokollen', await zeile.count() === 1);
  ok('Ohne Protokolle ohne Zähler',
     (await zeile.textContent()).includes('Sitzungsprotokolle')
     && !/Sitzungsprotokolle ·/.test(await zeile.textContent()), await zeile.textContent());
  await p.screenshot({ path: `${OUT}/${name}-1-projekt.png`, fullPage: true });
  await zeile.click();
  await p.waitForURL('**/protokolle.html**');
  await p.waitForTimeout(700);

  /* --- 2. Anlegen, Nummer fortlaufend ----------------------------------- */

  ok('Die leere Übersicht sagt, was hier hingehört',
     (await p.textContent('#inhalt')).includes('noch kein Sitzungsprotokoll'));

  const neuKnopf = () => breite >= 1024 ? p.locator('#d-neu') : p.locator('#m-neu');
  const anlegen = async ort => {
    await neuKnopf().click();
    await p.waitForTimeout(500);
    if (ort !== null) await p.fill('#pn-ort', ort);
    await p.click('#pn-ja');
    await p.waitForURL('**/protokoll.html**');
    await p.waitForTimeout(800);
  };

  await neuKnopf().click();
  await p.waitForTimeout(500);
  ok('Der Dialog nennt die nächste Nummer',
     (await p.textContent('.sheet')).includes('Baubesprechung Nr. 1'));
  ok('Und schlägt das heutige Datum vor',
     (await p.inputValue('#pn-datum')) === new Date().toISOString().slice(0, 10));
  await p.fill('#pn-ort', 'Baustelle Sarnen');
  await p.click('#pn-ja');
  await p.waitForURL('**/protokoll.html**');
  await p.waitForTimeout(900);

  const p1 = (await db()).protokolle[0];
  ok('Das erste Protokoll trägt die Nummer 1', p1.nummer === 1, String(p1.nummer));
  ok('Und steht auf vorbereitet', p1.status === 'vorbereitet', p1.status);
  ok('Die Kopfzeile nennt Bezeichnung und Nummer',
     (await p.textContent(breite >= 1024 ? '#d-titel' : '#m-titel')) === 'Baubesprechung Nr. 1');

  // Ein zweites, um die fortlaufende Nummer zu prüfen.
  await p.goto(`${B}/protokolle.html?projekt=p1`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(700);
  await anlegen('Büro Sarnen');
  const zwei = (await db()).protokolle;
  ok('Das zweite bekommt die Nummer 2',
     zwei.length === 2 && zwei.some(x => x.nummer === 2), JSON.stringify(zwei.map(x => x.nummer)));
  const p2 = zwei.find(x => x.nummer === 2);

  /* --- 3. Teilnehmende mit allen vier Status ---------------------------- */

  await p.goto(`${B}/protokoll.html?protokoll=${p1.id}`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(900);
  if (breite < 1024) {
    const reiter = await p.$$eval('#tabs button', e => e.map(x => x.textContent.trim()));
    ok('Auf dem Handy zwei Reiter', reiter.join('|') === 'Traktanden|Teilnehmer · 0', reiter.join('|'));
    await p.click('#tabs [data-tab="teilnehmer"]');
    await p.waitForTimeout(300);
  }

  await p.locator('[data-tdazu]:visible').first().click();
  await p.waitForTimeout(500);
  const wahl = await p.$$eval('.sheet [data-wahl] span span:first-child', e => e.map(x => x.textContent.trim()));
  ok('Zur Auswahl stehen Mitarbeitende und Ansprechpersonen des Projekts',
     wahl.includes('Jonas Zemp') && wahl.includes('Thomas Zürcher') && wahl.includes('Res Steiger'),
     wahl.join('|'));
  for (const n of ['Jonas Zemp', 'Thomas Zürcher', 'Res Steiger']) {
    await p.locator('.sheet [data-wahl]', { hasText: n }).click();
  }
  await p.click('#pw-ja');
  await p.waitForTimeout(900);

  ok('Drei Personen auf der Liste', await p.locator('.pk-person').count() === 3);
  const ersteMarke = await p.locator('.pk-person').first().locator('.pk-status').textContent();
  ok('Die erste Person führt den Vorsitz', ersteMarke.trim() === 'Vorsitz', ersteMarke);
  ok('Die Firma steht bei der Ansprechperson',
     (await p.locator('.pk-person', { hasText: 'Res Steiger' }).textContent()).includes('Steiger Baucontrol AG'));

  // Durchschalten: anwesend -> abwesend -> verteiler -> vorsitz
  const zweite = p.locator('.pk-person', { hasText: 'Thomas Zürcher' }).locator('.pk-status');
  ok('Weitere stehen auf anwesend', (await zweite.textContent()).trim() === 'Anwesend');
  const gesehen = [];
  for (let i = 0; i < 4; i++) {
    await zweite.click();
    await p.waitForTimeout(400);
    gesehen.push((await p.locator('.pk-person', { hasText: 'Thomas Zürcher' }).locator('.pk-status').textContent()).trim());
  }
  ok('Ein Tipp schaltet durch alle vier Möglichkeiten',
     gesehen.join('|') === 'Abwesend|Verteiler|Vorsitz|Anwesend', gesehen.join('|'));

  ok('Damit steht das Protokoll auf Entwurf',
     (await db()).protokolle.find(x => x.id === p1.id).status === 'entwurf');

  await p.screenshot({ path: `${OUT}/${name}-2-teilnehmer.png`, fullPage: true });

  /* --- 4. Traktanden anlegen, umordnen, löschen ------------------------- */

  if (breite < 1024) {
    await p.click('#tabs [data-tab="traktanden"]');
    await p.waitForTimeout(300);
  }
  const dazu = () => breite >= 1024 ? p.locator('#tr-neu') : p.locator('#tr-dazu');
  for (const t of ['Stand Rohbau Haus Lilly', 'Fassadengerüst Haus Flora', 'Schlüsselübergabe']) {
    await dazu().click();
    await p.waitForTimeout(400);
    await p.fill('#tn-titel', t);
    await p.click('#tn-ja');
    await p.waitForTimeout(700);
  }
  const titelListe = () => p.$$eval('.pk-traktandum input.titel', e => e.map(x => x.value));
  ok('Drei Traktanden in der Reihenfolge der Erfassung',
     (await titelListe()).join('|') === 'Stand Rohbau Haus Lilly|Fassadengerüst Haus Flora|Schlüsselübergabe',
     (await titelListe()).join('|'));
  ok('Nummeriert ab eins',
     (await p.$$eval('.pk-traktandum .zahl', e => e.map(x => x.textContent))).join('') === '123');
  ok('Der obersten fehlt der Pfeil nach oben',
     await p.locator('.pk-traktandum').first().locator('[data-hoch]').isDisabled());

  await p.locator('.pk-traktandum').nth(1).locator('[data-hoch]').click();
  await p.waitForTimeout(800);
  ok('Der Pfeil schiebt das Traktandum nach oben',
     (await titelListe())[0] === 'Fassadengerüst Haus Flora', (await titelListe()).join('|'));
  ok('Und die Nummern wandern mit',
     (await p.locator('.pk-traktandum').first().locator('.zahl').textContent()) === '1');

  // Der Titel steht in einem Eingabefeld, hasText greift darauf nicht.
  ok('Schlüsselübergabe steht zuunterst', (await titelListe())[2] === 'Schlüsselübergabe');
  await p.locator('.pk-traktandum').nth(2).locator('[data-tweg]').click();
  await p.waitForTimeout(500);
  ok('Die Rückfrage nennt den fehlenden Papierkorb',
     (await p.locator('.sheet').last().textContent()).includes('keinen Papierkorb'));
  await p.click('#f-ja');
  await p.waitForTimeout(800);
  ok('Das Traktandum ist weg', (await titelListe()).length === 2);
  ok('Und wirklich weg, nicht nur ausgeblendet',
     !(await db()).protokoll_traktanden.some(t => t.titel === 'Schlüsselübergabe'));

  /* --- 5. Text, Foto, Beschluss ----------------------------------------- */

  const erste = p.locator('.pk-traktandum').first();
  await erste.locator('textarea').fill('Muss bis Ende Monat abgebaut werden.');
  await erste.locator('input.titel').click();      // Fokus weg -> speichern
  await p.waitForTimeout(700);
  ok('Der Text landet in der Datenbank',
     (await db()).protokoll_traktanden.some(t => t.text === 'Muss bis Ende Monat abgebaut werden.'));

  await p.locator('.pk-traktandum').nth(1).locator('[data-beschluss]').click();
  await p.waitForTimeout(700);
  ok('Beschluss lässt sich markieren',
     await p.locator('.pk-traktandum').nth(1).locator('[data-beschluss]').getAttribute('aria-pressed') === 'true');
  ok('Und steht so in der Datenbank',
     (await db()).protokoll_traktanden.filter(t => t.beschluss).length === 1);

  await erste.locator('[data-foto]').click();
  await p.setInputFiles('#tr-datei', { name: 'geruest.png', mimeType: 'image/png', buffer: Buffer.from(PNG, 'base64') });
  await p.waitForTimeout(1200);
  ok('Das Foto hängt am Traktandum', await erste.locator('img.foto').count() === 1);
  const mitFoto = (await db()).protokoll_traktanden.find(t => t.foto_pfad);
  ok('Und liegt unter der Kennung des Protokolls',
     String(mitFoto.foto_pfad).startsWith(p1.id + '/'), mitFoto?.foto_pfad);

  /* --- 6. Pendenz aus einem Traktandum ---------------------------------- */

  await erste.locator('[data-pendenz]').click();
  await p.waitForTimeout(600);
  ok('Der Beschrieb ist aus dem Traktandum vorgeschlagen',
     (await p.inputValue('#pd-text')) === 'Muss bis Ende Monat abgebaut werden.',
     await p.inputValue('#pd-text'));
  await p.fill('#pd-text', 'Fassadengerüst Haus Flora abbauen');
  await p.selectOption('#pd-firma', 'f1');
  await p.click('#pd-ja');
  await p.waitForTimeout(1000);

  ok('Das Traktandum zeigt danach die erstellte Pendenz',
     await erste.locator('.pendenz-da').count() === 1);
  const pendenzen = (await db()).pendenzen;
  ok('Es gibt genau eine Pendenz, im richtigen Projekt',
     pendenzen.length === 1 && pendenzen[0].projekt_id === 'p1', JSON.stringify(pendenzen));
  ok('Mit der zuständigen Firma', pendenzen[0].firma_id === 'f1');
  ok('Und das Traktandum verweist darauf',
     (await db()).protokoll_traktanden.some(t => t.pendenz_id === pendenzen[0].id));

  await p.screenshot({ path: `${OUT}/${name}-3-traktanden.png`, fullPage: true });

  // Sie steht in der bestehenden Liste des Projekts, nicht in einer zweiten.
  await p.goto(`${B}/pendenzen.html?projekt=p1`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(900);
  ok('Die Pendenz steht in der Pendenzenliste des Projekts',
     (await p.textContent('body')).includes('Fassadengerüst Haus Flora abbauen'));

  /* --- 7. Abschliessen -------------------------------------------------- */

  await p.goto(`${B}/protokoll.html?protokoll=${p1.id}`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(1000);

  const abschluss = breite >= 1024 ? p.locator('[data-abschluss]') : p.locator('#m-abschluss');
  await abschluss.click();
  await p.waitForTimeout(600);
  const zusammen = await p.locator('.sheet').last().textContent();
  ok('Die Zusammenfassung zählt Traktanden, Beschlüsse und Pendenzen',
     zusammen.includes('2 Traktanden') && zusammen.includes('1 Beschluss') && zusammen.includes('1 neue Pendenz'),
     zusammen.replace(/\s+/g, ' ').slice(0, 200));
  ok('Und warnt vor der Endgültigkeit', zusammen.includes('nichts mehr ändern'));

  const download = kannTeilen ? null : p.waitForEvent('download', { timeout: 20000 });
  await p.click('#ab-ja');
  await p.waitForTimeout(6000);

  const nachher = await db();
  const fertig = nachher.protokolle.find(x => x.id === p1.id);
  ok('Das Protokoll ist abgeschlossen',
     fertig.status === 'abgeschlossen' && !!fertig.abgeschlossen_am, JSON.stringify(fertig));

  const datei = nachher.dateien.find(d => d.id === fertig.pdf_datei_id);
  ok('Es ist ein PDF entstanden', !!datei && datei.typ === 'application/pdf', JSON.stringify(datei));
  ok('Mit sprechendem Namen',
     /^Baubesprechung_Nr_1_Garten_Mille_Fiori_\d{4}-\d{2}-\d{2}\.pdf$/.test(datei?.name || ''), datei?.name);
  ok('Und einer Grösse jenseits eines leeren Blatts', (datei?.groesse || 0) > 2000, String(datei?.groesse));

  const ordner = nachher.ordner.find(o => o.id === datei.ordner_id);
  ok('Es liegt in einem Ordner dieses Projekts', ordner?.projekt_id === 'p1', JSON.stringify(ordner));
  if (ordnerDa) {
    ok('Und zwar im vorhandenen', ordner.id === 'o1', ordner.id);
  } else {
    ok('Der Ordner ist dafür entstanden',
       nachher.ordner.length === 1 && /Protokolle/.test(ordner.name), JSON.stringify(nachher.ordner));
  }

  /* --- 8. Teilen bzw. Download ------------------------------------------ */

  if (kannTeilen) {
    const geteilt = await p.evaluate(() => window.__geteilt);
    ok('Das Gerät hat das PDF zum Teilen bekommen',
       geteilt.length === 1 && geteilt[0].dateien.length === 1
       && geteilt[0].dateien[0].typ === 'application/pdf', JSON.stringify(geteilt));
    ok('Unter dem Namen der Sitzung',
       geteilt[0].titel === 'Baubesprechung Nr. 1', geteilt[0]?.titel);
  } else {
    const d = await download;
    ok('Ohne Teilen-Funktion wird heruntergeladen',
       d.suggestedFilename().endsWith('.pdf'), d.suggestedFilename());
  }

  /* --- 9. Danach ist zu -------------------------------------------------- */

  await p.goto(`${B}/protokoll.html?protokoll=${p1.id}`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(1000);
  ok('Der Abschluss steht als Hinweis da', await p.locator('.pk-fertig').count() === 1);
  ok('Kein Feld lässt sich mehr ändern',
     await p.locator('.pk-traktandum textarea:not([disabled])').count() === 0
     && await p.locator('.pk-traktandum input.titel:not([disabled])').count() === 0);
  ok('Keine Pfeile, kein Löschen, kein neues Traktandum',
     await p.locator('[data-hoch]').count() === 0
     && await p.locator('[data-tweg]').count() === 0
     && await p.locator('#tr-neu, #tr-dazu').count() === 0);
  ok('Der Beschluss bleibt sichtbar',
     (await p.textContent('#rechts')).includes('Beschluss'));
  ok('Statt Abschliessen steht jetzt Teilen da',
     await p.locator('[data-teilen]').count() >= 1 && await p.locator('[data-abschluss]').count() === 0);
  ok('Und kein Papierkorb mehr', await p.locator('[data-weg]').count() === 0);
  await p.screenshot({ path: `${OUT}/${name}-4-fertig.png`, fullPage: true });

  // An der Oberfläche vorbei geht es auch nicht.
  const versuche = await p.evaluate(async id => {
    const t = (await sb.from('protokoll_traktanden').select('*').eq('protokoll_id', id)).data[0];
    return {
      aendern: (await sb.from('protokoll_traktanden').update({ titel: 'X' }).eq('id', t.id)).error?.message || 'durchgelassen',
      einfuegen: (await sb.from('protokoll_traktanden').insert({ protokoll_id: id, reihenfolge: 9, titel: 'Nachtrag', erstellt_von: 'u1' })).error?.message || 'durchgelassen',
      person: (await sb.from('protokoll_teilnehmer').update({ status: 'abwesend' }).eq('protokoll_id', id)).error?.message || 'durchgelassen',
      schieben: (await sb.rpc('traktandum_schieben', { p_traktandum: t.id, p_hoch: true })).error?.message || 'durchgelassen',
      kopf: (await sb.from('protokolle').update({ ort: 'Anderswo' }).eq('id', id)).error?.message || 'durchgelassen',
      loeschen: (await sb.from('protokolle').delete().eq('id', id)).error?.message || 'durchgelassen'
    };
  }, p1.id);
  ok('Traktandum ändern wird abgewiesen', /nichts mehr aendern/.test(versuche.aendern), versuche.aendern);
  ok('Traktandum einfügen ebenso', /nichts mehr aendern/.test(versuche.einfuegen), versuche.einfuegen);
  ok('Teilnehmer ändern ebenso', /nichts mehr aendern/.test(versuche.person), versuche.person);
  ok('Umordnen ebenso', /nichts mehr aendern/.test(versuche.schieben), versuche.schieben);
  ok('Die Kopfdaten ebenso', /nicht mehr aendern/.test(versuche.kopf), versuche.kopf);
  ok('Und löschen lässt es sich gar nicht', /nicht loeschen/.test(versuche.loeschen), versuche.loeschen);
  ok('Das Protokoll steht noch da',
     (await db()).protokolle.some(x => x.id === p1.id));

  /* --- 10. Ein offenes Protokoll lässt sich löschen ---------------------- */

  await p.goto(`${B}/protokoll.html?protokoll=${p2.id}`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(900);
  await p.locator('[data-weg]:visible').first().click();
  await p.waitForTimeout(500);
  ok('Auch hier die Rückfrage mit dem fehlenden Papierkorb',
     (await p.locator('.sheet').last().textContent()).includes('keinen Papierkorb'));
  await p.click('#f-ja');
  await p.waitForURL('**/protokolle.html**', { timeout: 15000 });
  await p.waitForTimeout(800);
  ok('Das vorbereitete Protokoll ist weg',
     !(await db()).protokolle.some(x => x.id === p2.id));

  /* --- 11. Die Übersicht ------------------------------------------------- */

  const karten = breite >= 1024 ? p.locator('.pk-reihe') : p.locator('.pk-karte');
  ok('Ein Protokoll steht in der Übersicht', await karten.count() === 1);
  const text = (await karten.first().textContent()).replace(/\s+/g, ' ');
  ok('Mit Titel, Zahlen und Status',
     text.includes('Baubesprechung Nr. 1') && text.includes('2 Traktanden')
     && text.includes('1 neue Pendenz') && text.includes('Abgeschlossen'), text);
  await p.screenshot({ path: `${OUT}/${name}-5-uebersicht.png`, fullPage: true });

  /* --- 11b. Die Suche über alle Protokolle -------------------------------
     Gesucht wird in zwei Töpfen: im Text der Traktanden und in den
     Firmennamen auf der Teilnehmerliste. Damit es etwas zu unterscheiden
     gibt, kommen zwei weitere Protokolle dazu — sonst prüfte die Suite
     eine Suche über genau ein Protokoll, und das ist keine. */

  await p.evaluate(() => {
    const d = JSON.parse(sessionStorage.getItem('__stub_db'));
    d.protokolle.push(
      { id: 'pr7', projekt_id: 'p1', nummer: 7, bezeichnung: 'Baubesprechung',
        datum: '2026-05-14', ort: 'Sarnen', status: 'abgeschlossen',
        abgeschlossen_am: '2026-05-14T16:00:00.000Z', erstellt_von: 'u1' },
      { id: 'pr8', projekt_id: 'p1', nummer: 8, bezeichnung: 'Bauherrensitzung',
        datum: '2026-06-02', ort: 'Alpnach', status: 'entwurf', erstellt_von: 'u1' },
      /* Ein Protokoll eines anderen Projekts. Es darf in keinem Treffer
         auftauchen, auch wenn dasselbe Wort darin steht. */
      { id: 'pr9', projekt_id: 'p2', nummer: 1, bezeichnung: 'Baubesprechung',
        datum: '2026-06-09', ort: 'Kerns', status: 'entwurf', erstellt_von: 'u1' });
    d.projekte.push({ id: 'p2', name: 'Anderes Projekt', status: 'laufend', archiviert: false });

    d.protokoll_traktanden.push(
      { id: 't7', protokoll_id: 'pr7', reihenfolge: 1, titel: 'Werkleitungen',
        text: 'Die Rohre der Zirkonium AG kommen erst im Mai, der Graben bleibt offen.',
        erstellt_von: 'u1', erstellt_am: '2026-05-14T08:00:00.000Z' },
      { id: 't8', protokoll_id: 'pr8', reihenfolge: 1, titel: 'Zirkonium AG: Nachtrag',
        text: 'Wird an der naechsten Sitzung behandelt.',
        erstellt_von: 'u1', erstellt_am: '2026-06-02T08:00:00.000Z' },
      { id: 't9', protokoll_id: 'pr9', reihenfolge: 1, titel: 'Zirkonium im fremden Projekt',
        text: 'Gehoert nicht hierher.',
        erstellt_von: 'u1', erstellt_am: '2026-06-09T08:00:00.000Z' });

    /* Derselbe Firmenname bei drei Personen im selben Protokoll: im
       Ergebnis soll er einmal stehen und nicht dreimal. */
    d.protokoll_teilnehmer.push(
      { id: 'tn1', protokoll_id: 'pr8', name: 'Res Steiger', firma: 'Fankhauser Holzbau AG', status: 'anwesend' },
      { id: 'tn2', protokoll_id: 'pr8', name: 'Anna Muster', firma: 'Fankhauser Holzbau AG', status: 'anwesend' },
      { id: 'tn3', protokoll_id: 'pr8', name: 'Urs Meier', firma: 'Fankhauser Holzbau AG', status: 'verteiler' });
    sessionStorage.setItem('__stub_db', JSON.stringify(d));
  });

  await p.goto(`${B}/protokolle.html?projekt=p1`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(1100);
  ok('Das Suchfeld steht über der Liste', await p.locator('#p-suche').isVisible());
  ok('Drei Protokolle in der Übersicht', (await p.locator('#inhalt .pk-karte').count()) === 3);

  // Ein Buchstabe ist noch keine Suche.
  await p.fill('#p-suche', 'Z'); await p.waitForTimeout(600);
  ok('Ein einzelner Buchstabe lässt die Liste stehen',
     (await p.locator('#inhalt .pk-karte').count()) === 3
       && (await p.locator('#inhalt .pk-fund').count()) === 0);

  await p.fill('#p-suche', 'Zirkonium'); await p.waitForTimeout(800);
  const gefunden = (await p.textContent('#inhalt')).replace(/\s+/g, ' ');
  ok('Der Traktandentext wird durchsucht', gefunden.includes('Werkleitungen'));
  ok('Der Traktandentitel auch', gefunden.includes('Zirkonium AG: Nachtrag'));
  ok('Zwei Protokolle als Treffer',
     (await p.locator('#inhalt .pk-karte').count()) === 2,
     String(await p.locator('#inhalt .pk-karte').count()));
  ok('Die Zahl der Fundstellen steht dabei',
     /2 Fundstellen in 2 Protokollen/.test(gefunden), gefunden.slice(0, 120));
  ok('Jeder Treffer nennt die Protokollnummer',
     gefunden.includes('Baubesprechung Nr. 7') && gefunden.includes('Bauherrensitzung Nr. 8'));
  ok('Und das Datum', gefunden.includes('14.05.2026') && gefunden.includes('02.06.2026'));
  ok('Ein fremdes Projekt bleibt draussen', !gefunden.includes('fremden Projekt'));
  ok('Das Neueste zuerst',
     (await p.locator('#inhalt .pk-karte .titel').first().textContent()) === 'Bauherrensitzung Nr. 8');
  await p.screenshot({ path: `${OUT}/${name}-5b-suche.png`, fullPage: true });

  /* Steht das Wort im Titel, braucht es den Ausschnitt nicht; steht es
     nur im Text, schon. */
  ok('Ausschnitt nur, wo der Titel nichts hergibt',
     gefunden.includes('… der Zirkonium AG kommen erst im Mai')
       || gefunden.includes('Die Rohre der Zirkonium AG'), gefunden);

  await p.fill('#p-suche', 'Fankhauser'); await p.waitForTimeout(800);
  const firmenTreffer = (await p.textContent('#inhalt')).replace(/\s+/g, ' ');
  ok('Ein Firmenname von der Teilnehmerliste wird gefunden',
     firmenTreffer.includes('Fankhauser Holzbau AG'));
  ok('Die Firma steht einmal da und nicht dreimal',
     (firmenTreffer.match(/Fankhauser Holzbau AG/g) || []).length === 1, firmenTreffer);
  ok('Mit der Kennzeichnung "Beteiligt"', firmenTreffer.includes('Beteiligt'));
  ok('Nur im Protokoll, auf dessen Liste sie steht',
     firmenTreffer.includes('Bauherrensitzung Nr. 8') && !firmenTreffer.includes('Nr. 7'));

  await p.fill('#p-suche', 'Bagatellschaden'); await p.waitForTimeout(800);
  ok('Ohne Treffer ein Satz statt einer leeren Fläche',
     (await p.textContent('#inhalt')).includes('steht nichts zu «Bagatellschaden»'));

  await p.fill('#p-suche', ''); await p.waitForTimeout(600);
  ok('Leeres Feld: die gewohnte Liste ist zurück',
     (await p.locator('#inhalt .pk-karte').count()) === 3
       && (await p.locator('#inhalt .pk-fund').count()) === 0);
  ok('Und zwar mit den Zahlen darunter',
     (await p.textContent('#inhalt')).includes('Traktanden'));

  /* Eine Eingabe mit Komma und Prozent baut in PostgREST sonst eine
     kaputte Abfrage. Hier darf sie höchstens nichts finden. */
  await p.fill('#p-suche', 'Bau, Holz (50%)'); await p.waitForTimeout(800);
  ok('Sonderzeichen bauen keine kaputte Abfrage',
     (await p.textContent('#inhalt')).length > 0
       && !fehler.some(f => /ilike|PGRST/.test(f)));
  await p.fill('#p-suche', ''); await p.waitForTimeout(600);

  // Aufräumen: die Probeprotokolle wieder weg.
  await p.evaluate(() => {
    const d = JSON.parse(sessionStorage.getItem('__stub_db'));
    const weg = new Set(['pr7', 'pr8', 'pr9']);
    d.protokolle = d.protokolle.filter(x => !weg.has(x.id));
    d.protokoll_traktanden = d.protokoll_traktanden.filter(x => !weg.has(x.protokoll_id));
    d.protokoll_teilnehmer = d.protokoll_teilnehmer.filter(x => !weg.has(x.protokoll_id));
    d.projekte = d.projekte.filter(x => x.id !== 'p2');
    sessionStorage.setItem('__stub_db', JSON.stringify(d));
  });

  /* --- 12. Zurück auf der Projektseite ----------------------------------- */

  await p.goto(`${B}/projekt-detail.html?projekt=p1`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(900);
  ok('Die Projektseite zählt jetzt mit',
     (await p.textContent('#protokolle')).includes('Sitzungsprotokolle · 1'),
     await p.textContent('#protokolle'));

  /* --- 13. Eine Pendenz aus einem fertigen Protokoll bleibt löschbar ----- */

  const weg = await p.evaluate(async () => {
    const pd = (await sb.from('pendenzen').select('*')).data[0];
    const f = (await sb.from('pendenzen').delete().eq('id', pd.id)).error?.message || null;
    const rest = (await sb.from('protokoll_traktanden').select('*')).data;
    return { f, offen: rest.filter(t => t.pendenz_id).length, beschluss: rest.filter(t => t.beschluss).length };
  });
  ok('Eine Pendenz lässt sich auch nach dem Abschluss noch löschen', weg.f === null, String(weg.f));
  ok('Ihre Spur im Traktandum verblasst dabei', weg.offen === 0, String(weg.offen));
  ok('Der Rest des Traktandums bleibt unberührt', weg.beschluss === 1, String(weg.beschluss));

  /* --- 14. Die Prüfspur --------------------------------------------------- */

  /* Beschlüsse und Teilnehmerlisten können rechtlich zählen. Wer wann
     was eingetragen oder geändert hat, schreibt deshalb die Datenbank
     mit — nicht die App, und nicht änderbar. */

  const alles = await p.evaluate(() => JSON.parse(sessionStorage.getItem('__stub_db')));
  const prot = alles.protokolle[0];
  const spur = (alles.pruefspur || []).filter(s => s.vorgang_id === prot.id);

  ok('Zum Protokoll steht eine Prüfspur da', spur.length > 10, String(spur.length));
  ok('Alle Einträge sind dem Bereich Protokoll und dem Projekt zugeordnet',
     spur.every(s => s.bereich === 'protokoll' && s.projekt_id === 'p1'));
  ok('Wer es war, steht mit Kennung und Namen daneben',
     spur.every(s => s.wer === 'u1' && s.wer_name === 'Jonas Zemp'));
  ok('Das Anlegen des Protokolls steht drin',
     spur.some(s => s.tabelle === 'protokolle' && s.was === 'erstellt'));
  ok('Jedes Traktandum auch',
     spur.filter(s => s.tabelle === 'protokoll_traktanden' && s.was === 'erstellt').length >= 2,
     String(spur.filter(s => s.tabelle === 'protokoll_traktanden' && s.was === 'erstellt').length));
  ok('Und der Bezug ist ohne Verknüpfung lesbar',
     spur.some(s => /^Traktandum \d+: ./.test(s.bezug || '')),
     spur.map(s => s.bezug).join(' | ').slice(0, 160));

  const status = spur.find(s => s.tabelle === 'protokoll_teilnehmer' && s.aenderungen?.status);
  ok('Ein geänderter Teilnehmerstatus steht mit vorher und nachher da',
     !!status && status.aenderungen.status.vorher !== status.aenderungen.status.nachher,
     JSON.stringify(status?.aenderungen?.status));

  const beschlossen = spur.find(s => s.tabelle === 'protokoll_traktanden' && s.aenderungen?.beschluss);
  ok('Ein gesetzter Beschluss ebenso',
     beschlossen?.aenderungen.beschluss.nachher === true,
     JSON.stringify(beschlossen?.aenderungen?.beschluss));

  ok('Der Abschluss steht als eigener Eintrag drin',
     spur.some(s => s.tabelle === 'protokolle' && s.aenderungen?.abgeschlossen_am
                    && s.aenderungen.abgeschlossen_am.vorher === null));
  ok('Ein gelöschtes Traktandum bleibt in der Spur stehen',
     spur.some(s => s.tabelle === 'protokoll_traktanden' && s.was === 'geloescht'));

  const hand = await p.evaluate(async id => {
    const r1 = await sb.from('pruefspur').insert({
      bereich: 'protokoll', vorgang_id: id, tabelle: 'protokolle', zeile_id: id, was: 'erstellt' });
    const r2 = await sb.from('pruefspur').delete().eq('vorgang_id', id).select();
    const { data } = await sb.from('pruefspur').select('*').eq('vorgang_id', id);
    return { fehler: r1.error?.message || 'durchgelassen', weg: (r2.data || []).length,
             gelesen: (data || []).length };
  }, prot.id);
  ok('Von Hand schreibt niemand in die Prüfspur',
     /row-level security/.test(hand.fehler), hand.fehler);
  ok('Und löschen lässt sie sich auch nicht',
     hand.weg === 0 && hand.gelesen === spur.length, `${hand.weg} / ${hand.gelesen}`);

  await ctx.close();
}

await lauf('handy', 390, { ordnerDa: true, kannTeilen: true });
await lauf('desktop', 1440, { ordnerDa: false, kannTeilen: false });
await browser.close();

console.log('\n=== Fehler im Browser ===');
console.log(fehler.length ? fehler.join('\n') : 'keine');
