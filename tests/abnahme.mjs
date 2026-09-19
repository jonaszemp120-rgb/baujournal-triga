/* Schritt 14: Bauabnahme — Plan, Stecknadeln, Abschluss mit Unterschrift
   und PDF-Protokoll.

   Der Plan wird im Test als echtes PDF hinterlegt, mit jsPDF erzeugt und
   von pdf.js gerendert — also genau dem Weg, den die App auch nimmt. Ein
   Bild statt eines PDF würde den halben Ablauf überspringen. */

import { chromium, HIER, SERVER } from './umgebung.mjs';
import fs from 'node:fs';
const OUT = `${HIER}/ausgabe/shots-ba`;
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
const STUB = fs.readFileSync('./stub.js', 'utf8');
const browser = await chromium.launch();
const fehler = [];
const ok = (n, b, zusatz = '') => console.log(`  ${b ? '✓' : '✗ FEHLER'}  ${n}${b ? '' : `  → ${zusatz}`}`);

/* Eine Unterschrift ins Feld malen. Dieselben Pointer-Ereignisse, die
   auch ein Finger auslöst. */
async function unterschreiben(p, wahl = '#us-feld') {
  const feld = await p.waitForSelector(wahl, { timeout: 5000 });
  /* Das Blatt fährt von unten herein. Wer die Masse währenddessen nimmt,
     zielt auf die Stelle, an der das Feld gerade noch war. */
  await p.waitForTimeout(450);
  const b = await feld.boundingBox();
  await p.mouse.move(b.x + 30, b.y + b.height / 2);
  await p.mouse.down();
  await p.mouse.move(b.x + 90, b.y + b.height / 2 - 24, { steps: 6 });
  await p.mouse.move(b.x + 150, b.y + b.height / 2 + 18, { steps: 6 });
  await p.mouse.up();
  await p.waitForTimeout(200);
  await p.click('#us-ja');
  await p.waitForTimeout(400);
}

async function lauf(name, breite) {
  const ctx = await browser.newContext({
    viewport: { width: breite, height: breite >= 1024 ? 1000 : 900 },
    locale: 'de-CH', serviceWorkers: 'block'
  });
  await ctx.route('**/vendor/supabase-js-2.58.0.js',
    r => r.fulfill({ status: 200, contentType: 'application/javascript', body: STUB }));

  await ctx.addInitScript(() => {
    try { localStorage.setItem('bj_push_gefragt', '1'); } catch {}
    if (sessionStorage.getItem('__stub_db')) return;
    sessionStorage.setItem('__stub_db', JSON.stringify({
      profile: [{ id: 'u1', name: 'Jonas Zemp' }],
      eintraege: [], eintraege_korrekturen: [],
      projekte: [{ id: 'p1', name: 'Garten Mille Fiori', standort: 'Sarnen',
                   bauherrschaft: 'StImmobilia GmbH', status: 'laufend', archiviert: false }],
      mitarbeiter: [{ id: 'ich', name: 'Jonas Zemp', rolle: 'Bauleitung', user_id: 'u1',
                      berechtigung: 'entwickler',
                      // Die Unterschrift aus dem Profil, wie sie Schritt 11 ablegt.
                      unterschrift: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
                      unterschrift_am: '2026-09-10T08:00:00.000Z' }],
      firmen: [{ id: 'f1', name: 'Fankhauser Holzbau', bkp_codes: [] }],
      projekteinsaetze: [{ id: 'e1', projekt_id: 'p1', firma_id: 'f1', status: 'beauftragt' }],
      ordner: [{ id: 'o1', name: 'Pläne', projekt_id: 'p1' }],
      dateien: [], abnahmen: [], maengel: []
    }));
  });

  const p = await ctx.newPage();
  p.on('console', m => { if (m.type() === 'error') fehler.push(`${name}: ${m.text()}`); });
  p.on('pageerror', e => fehler.push(`${name}: ${e.message}`));
  console.log(`\n=== ${name} (${breite}px) ===`);

  const db = () => p.evaluate(() => JSON.parse(sessionStorage.getItem('__stub_db')));

  await p.goto(`${SERVER}/index.html`, { waitUntil: 'networkidle' });
  await p.fill('#email', 'test.durchlauf@triga.ch'); await p.fill('#pw', 'TestDurchlauf!2026');
  await p.click('#btn'); await p.waitForURL('**/start.html');

  /* --- 1. Ohne Plan: Aufforderung statt Fehler --------------------------- */

  await p.goto(`${SERVER}/abnahme.html?projekt=p1`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(1100);
  ok('Ohne Plan kommt die Aufforderung, einen hochzuladen',
     (await p.textContent('#inhalt')).includes('noch kein Plan'));
  ok('Mit dem Weg in die Dokumente',
     await p.locator('#inhalt a[href="dokumente.html"]').isVisible());
  ok('Und kein Fehler auf der Seite', !(await p.textContent('#inhalt')).toLowerCase().includes('fehler'));

  /* --- 2. Einen echten Grundriss als PDF hinterlegen ---------------------- */

  /* Mit jsPDF erzeugt, in der Ablage gespeichert wie ein Upload im Bereich
     Dokumente. Danach liegt ein echtes PDF da, das pdf.js lesen muss. */
  await p.evaluate(async () => {
    await ladeSkript('vendor/jspdf-2.5.2.umd.min.js');
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' });
    doc.setFontSize(22);
    doc.text('Grundriss Erdgeschoss', 20, 30);
    doc.rect(20, 40, 240, 140);
    doc.addPage();
    doc.text('Obergeschoss', 20, 30);
    const blob = doc.output('blob');
    const datei = new File([blob], 'Grundriss.pdf', { type: 'application/pdf' });
    const pfad = 'o1/grundriss.pdf';
    await sb.storage.from('dokumente').upload(pfad, datei, { contentType: 'application/pdf' });
    await sb.from('dateien').insert({
      id: 'd1', ordner_id: 'o1', name: 'Grundriss.pdf', pfad,
      groesse: blob.size, typ: 'application/pdf', hochgeladen_von: 'u1'
    });
  });

  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(1100);
  ok('Mit Plan erscheint das Einrichten', await p.locator('#a-titel').isVisible());
  ok('Der Plan steht zur Auswahl', (await p.textContent('#a-dokumente')).includes('Grundriss.pdf'));

  await p.click('#a-los'); await p.waitForTimeout(400);
  ok('Ohne Bezeichnung geht es nicht', (await p.textContent('#a-fehler')).includes('Bezeichnung'));
  await p.fill('#a-titel', 'Erdgeschoss');
  await p.click('#a-los'); await p.waitForTimeout(400);
  ok('Ohne Plan auch nicht', (await p.textContent('#a-fehler')).includes('Grundriss'));

  await p.click('#a-dokumente [data-dok="d1"]');
  await p.waitForTimeout(300);
  ok('Bei einem PDF fragt die App nach der Seite', await p.locator('#a-seite').isVisible());
  ok('Der Dateiname wird als Plantitel vorgeschlagen',
     await p.inputValue('#a-plantitel') === 'Grundriss', await p.inputValue('#a-plantitel'));

  await p.fill('#a-plantitel', '');
  await p.click('#a-los'); await p.waitForTimeout(400);
  ok('Ohne Namen für den Plan geht es nicht',
     (await p.textContent('#a-fehler')).includes('Namen geben'), await p.textContent('#a-fehler'));

  await p.fill('#a-plantitel', 'Haus Magnolia, EG');
  await p.fill('#a-seite-nr', '1');
  await p.click('#a-los');

  await p.waitForSelector('#plan img', { timeout: 30000 });
  await p.waitForTimeout(600);

  const ab = (await db()).abnahmen[0];
  const plan1 = (await db()).abnahme_plaene[0];
  ok('Die Abnahme ist angelegt', ab?.titel === 'Erdgeschoss' && ab.projekt_id === 'p1');
  ok('Der erste Plan hängt an der Abnahme und trägt seinen Namen',
     plan1?.abnahme_id === ab.id && plan1.titel === 'Haus Magnolia, EG',
     JSON.stringify(plan1 && { a: plan1.abnahme_id, t: plan1.titel }));
  ok('Der Plan wurde einmal als Bild abgelegt',
     String(plan1.bild_pfad).startsWith(ab.id + '/plan-') && plan1.bild_pfad.endsWith('.png'),
     plan1.bild_pfad);
  ok('Und die gewählte Seite steht dabei', plan1.seite === 1, String(plan1.seite));
  ok('An der Abnahme selbst steht kein Plan mehr',
     !('plan_bild_pfad' in ab) && !('plan_seite' in ab), Object.keys(ab).join(','));
  ok('Bei einem einzigen Plan bleibt die Planleiste ohne Reiter',
     await p.locator('.ba-planchip[data-plan]').count() === 0);

  const planBild = await p.evaluate(async pfad => {
    const o = JSON.parse(sessionStorage.getItem('__stub_db')).__objekte[pfad];
    const bild = new Image();
    await new Promise(ok => { bild.onload = ok; bild.onerror = ok; bild.src = window.__stub_inhalte.get(pfad); });
    return { typ: o.typ, breite: bild.naturalWidth, hoch: bild.naturalHeight };
  }, plan1.bild_pfad);
  ok('Das gerenderte Bild ist ein PNG mit echten Massen',
     planBild.typ === 'image/png' && planBild.breite > 500 && planBild.hoch > 300,
     JSON.stringify(planBild));
  ok('Und es ist im Querformat, wie die PDF-Seite',
     planBild.breite > planBild.hoch, `${planBild.breite}x${planBild.hoch}`);

  await p.screenshot({ path: `${OUT}/${name}-plan.png`, fullPage: true });

  /* --- 3. Mängel auf dem Plan verorten ------------------------------------ */

  const plan = p.locator('#plan img');
  const b = await plan.boundingBox();
  await p.mouse.click(b.x + b.width * 0.3, b.y + b.height * 0.4);
  await p.waitForTimeout(500);
  ok('Ein Tipp auf den Plan öffnet das Mängelformular', await p.locator('#mf-text').isVisible());

  await p.click('#mf-ja'); await p.waitForTimeout(300);
  ok('Ohne Beschrieb geht es nicht', (await p.textContent('#mf-fehler')).includes('beschreiben'));

  await p.fill('#mf-text', 'Türzarge Wohnung 1.02 verkratzt');
  await p.selectOption('#mf-firma', { label: 'Fankhauser Holzbau' });
  await p.fill('#mf-frist', '2026-09-30');
  await p.locator('#mf-datei').setInputFiles({
    name: 'mangel.png', mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
  });
  await p.waitForTimeout(400);
  await p.click('#mf-ja');
  await p.waitForTimeout(1200);

  ok('Die Nadel steht auf dem Plan', await p.locator('.ba-nadel').count() === 1);
  ok('Sie trägt die Nummer 1', (await p.locator('.ba-nadel .zahl').textContent()).trim() === '1');
  ok('Der Mangel steht in der Liste',
     (await p.textContent('.ba-mangel')).includes('Türzarge Wohnung 1.02 verkratzt'));
  ok('Mit Firma und Frist',
     (await p.textContent('.ba-mangel')).includes('Fankhauser Holzbau')
     && (await p.textContent('.ba-mangel')).includes('30.09.2026'),
     await p.textContent('.ba-mangel'));

  const m1 = (await db()).maengel[0];
  ok('Die Stelle steht als Anteil zwischen 0 und 1',
     Math.abs(m1.x - 0.3) < 0.03 && Math.abs(m1.y - 0.4) < 0.03, `${m1.x} / ${m1.y}`);
  ok('Das Foto liegt unter der Kennung der Abnahme',
     String(m1.foto_pfad).startsWith(ab.id + '/'), m1.foto_pfad);

  // Ein zweiter Mangel, über den Knopf statt über den Plan.
  await p.click('#m-neu'); await p.waitForTimeout(500);
  await p.fill('#mf-text', 'Silikonfuge Bad undicht');
  await p.click('#mf-ja'); await p.waitForTimeout(1200);
  ok('Zwei Nadeln, fortlaufend nummeriert',
     (await p.$$eval('.ba-nadel .zahl', e => e.map(x => x.textContent.trim()))).join(',') === '1,2');
  ok('Der Zähler nennt die offenen', (await p.textContent('.ba-kopfzeile h2')).includes('2 offen'));

  /* --- 4. Erledigen und löschen -------------------------------------------- */

  await p.locator('.ba-mangel', { hasText: 'Silikonfuge' }).locator('[data-haken]').click();
  await p.waitForTimeout(900);
  ok('Ein erledigter Mangel wird durchgestrichen',
     await p.locator('.ba-mangel[data-erledigt="1"]').count() === 1);
  ok('Und der Zähler zählt nur noch einen offenen',
     (await p.textContent('.ba-kopfzeile h2')).includes('1 offen'));
  ok('Erledigt heisst: kein Löschknopf mehr',
     await p.locator('.ba-mangel[data-erledigt="1"] [data-mweg]').count() === 0);

  // Und auch nicht an der Oberfläche vorbei.
  const weg = await p.evaluate(async () => {
    const d = JSON.parse(sessionStorage.getItem('__stub_db'));
    const m = d.maengel.find(x => x.erledigt_am);
    const { data } = await sb.from('maengel').delete().eq('id', m.id).select();
    return (data || []).length;
  });
  ok('Ein erledigter Mangel lässt sich auch direkt nicht löschen', weg === 0, String(weg));

  await p.locator('.ba-mangel', { hasText: 'Silikonfuge' }).locator('[data-haken]').click();
  await p.waitForTimeout(900);
  await p.locator('.ba-mangel', { hasText: 'Silikonfuge' }).locator('[data-mweg]').click();
  await p.waitForTimeout(500);
  await p.click('#f-ja');
  await p.waitForTimeout(900);
  ok('Ein offener Mangel lässt sich löschen', (await db()).maengel.length === 1);
  ok('Und die Nadel verschwindet mit', await p.locator('.ba-nadel').count() === 1);

  /* --- 4b. Ein zweiter Plan in derselben Abnahme --------------------------- */

  /* Fünf Häuser mit mehreren Geschossen: die Abnahme trägt mehrere
     Grundrisse, und jede Nadel steckt auf genau einem davon. Am Schluss
     dieses Abschnitts steht wieder derselbe Stand wie davor, damit der
     Abschluss unverändert prüfbar bleibt. */

  await p.click('#p-neu');
  await p.waitForSelector('#a-plantitel', { timeout: 5000 });
  await p.waitForTimeout(400);
  await p.click('#a-dokumente [data-dok="d1"]');
  await p.waitForTimeout(250);
  await p.fill('#a-plantitel', 'Haus Magnolia, 1. OG');
  await p.fill('#a-seite-nr', '2');
  await p.click('#p-ja');
  await p.waitForSelector('#plan img', { timeout: 30000 });
  await p.waitForTimeout(700);

  const plaene = (await db()).abnahme_plaene;
  ok('Die Abnahme trägt jetzt zwei Pläne', plaene.length === 2, String(plaene.length));
  const plan2 = plaene.find(x => x.titel === 'Haus Magnolia, 1. OG');
  ok('Der zweite Plan hat ein eigenes Bild und die zweite Seite',
     !!plan2 && plan2.bild_pfad !== plan1.bild_pfad && plan2.seite === 2,
     JSON.stringify(plan2 && { b: plan2.bild_pfad, s: plan2.seite }));
  ok('Ab zwei Plänen erscheinen die Reiter',
     await p.locator('.ba-planchip[data-plan]').count() === 2);
  ok('Der neue Plan steht gleich am Bildschirm',
     await p.locator(`.ba-planchip[data-plan="${plan2.id}"].an`).count() === 1);
  ok('Auf ihm steckt noch keine Nadel', await p.locator('.ba-nadel').count() === 0);
  ok('Die Mängelliste nennt jetzt den Plan je Mangel',
     (await p.textContent('.ba-mangel')).includes('Haus Magnolia, EG'),
     await p.textContent('.ba-mangel'));

  const plan2Bild = await p.locator('#plan img').boundingBox();
  await p.mouse.click(plan2Bild.x + plan2Bild.width * 0.6, plan2Bild.y + plan2Bild.height * 0.2);
  await p.waitForTimeout(500);
  ok('Das Formular nennt den Plan, auf dem markiert wird',
     (await p.textContent('body')).includes('auf Haus Magnolia, 1. OG'));
  await p.fill('#mf-text', 'Fenstergriff Zimmer 2 lose');
  await p.click('#mf-ja');
  await p.waitForTimeout(1200);

  const m2 = (await db()).maengel.find(x => x.beschrieb.startsWith('Fenstergriff'));
  ok('Der neue Mangel hängt am zweiten Plan', m2?.plan_id === plan2.id);
  ok('Die Nummer läuft über beide Pläne hinweg weiter', m2.nummer === 2, String(m2.nummer));
  ok('Auf dem zweiten Plan steckt genau eine Nadel',
     await p.locator('.ba-nadel').count() === 1);
  ok('Und es ist die Nummer 2',
     (await p.locator('.ba-nadel .zahl').textContent()).trim() === '2');

  await p.click(`.ba-planchip[data-plan="${plan1.id}"]`);
  await p.waitForSelector('#plan img', { timeout: 15000 });
  await p.waitForTimeout(700);
  ok('Auf dem ersten Plan steckt weiterhin nur seine eigene Nadel',
     await p.locator('.ba-nadel').count() === 1
     && (await p.locator('.ba-nadel .zahl').textContent()).trim() === '1');
  ok('Die Liste zeigt weiterhin beide Mängel',
     await p.locator('.ba-mangel').count() === 2);

  // Ein Plan mit Nadeln darauf geht nicht weg — auch nicht direkt.
  await p.click(`.ba-planchip[data-plan="${plan2.id}"]`);
  await p.waitForTimeout(800);
  await p.click('#p-weg');
  await p.waitForTimeout(500);
  ok('Ein Plan mit Nadel lässt sich nicht entfernen',
     (await p.textContent('body')).includes('stecken')
     && (await db()).abnahme_plaene.length === 2);

  const planVersuche = await p.evaluate(async ([a, p1, p2]) => {
    const r1 = await sb.from('abnahme_plaene').delete().eq('id', p2).select();
    const r2 = await sb.from('maengel').insert({
      abnahme_id: a, nummer: 8, x: 0.1, y: 0.1, beschrieb: 'ohne Plan', erstellt_von: 'u1' });
    const { data: fremd } = await sb.from('abnahmen')
      .insert({ projekt_id: 'p1', titel: 'Fremde Abnahme', erstellt_von: 'u1' }).select().single();
    const r3 = await sb.from('maengel').insert({
      abnahme_id: fremd.id, nummer: 1, plan_id: p1, x: 0.1, y: 0.1,
      beschrieb: 'fremder Plan', erstellt_von: 'u1' });
    await sb.from('abnahmen').delete().eq('id', fremd.id);
    return [r1.error?.message || `durchgelassen (${(r1.data || []).length})`,
            r2.error?.message || 'durchgelassen',
            r3.error?.message || 'durchgelassen'];
  }, [ab.id, plan1.id, plan2.id]);
  ok('Auch direkt bleibt ein Plan mit Nadel stehen',
     /stecken/.test(planVersuche[0]), planVersuche[0]);
  ok('Ein Mangel ohne Plan wird abgewiesen',
     /plan_id/.test(planVersuche[1]), planVersuche[1]);
  ok('Und ein Plan aus einer fremden Abnahme auch',
     /maengel_plan_passt/.test(planVersuche[2]), planVersuche[2]);

  // Aufräumen: Nadel weg, Plan weg — danach steht wieder der Stand von vorhin.
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(1400);
  await p.locator('.ba-mangel', { hasText: 'Fenstergriff' }).locator('[data-mweg]').click();
  await p.waitForTimeout(500);
  await p.click('#f-ja');
  await p.waitForTimeout(1000);
  await p.click(`.ba-planchip[data-plan="${plan2.id}"]`);
  await p.waitForTimeout(800);
  await p.click('#p-weg');
  await p.waitForTimeout(500);
  await p.click('#f-ja');
  await p.waitForTimeout(1200);
  ok('Ein Plan ohne Nadel lässt sich entfernen',
     (await db()).abnahme_plaene.length === 1);
  ok('Danach sind die Reiter wieder weg',
     await p.locator('.ba-planchip[data-plan]').count() === 0);

  /* --- 5. Abnahme abschliessen --------------------------------------------- */

  await p.locator('[data-abschluss]:visible').first().click();
  await p.waitForTimeout(800);
  ok('Die Zusammenfassung nennt Projekt und Abnahme',
     (await p.textContent('.ba-zusammen')).includes('Garten Mille Fiori')
     && (await p.textContent('.ba-zusammen')).includes('Erdgeschoss'));
  ok('Und die Zahl der Mängel mit Frist',
     (await p.textContent('.ba-zusammen')).includes('1 Mangel')
     && (await p.textContent('.ba-zusammen')).includes('30.09.2026'),
     await p.textContent('.ba-zusammen'));
  ok('Die eigene Unterschrift kommt aus dem Profil',
     await p.locator('#u-triga .ba-unterschrift img').isVisible());

  await p.click('#u-ja'); await p.waitForTimeout(400);
  ok('Ohne Namen der Gegenseite geht es nicht',
     (await p.textContent('#u-fehler')).includes('Namen'));

  await p.fill('#u-name', 'Res Steiger (Steiger Baucontrol AG)');
  ok('Der Name wandert in die Zusammenfassung',
     (await p.textContent('.ba-zusammen')).includes('Res Steiger'));
  await p.click('#u-ja'); await p.waitForTimeout(400);
  ok('Ohne ihre Unterschrift auch nicht',
     (await p.textContent('#u-fehler')).includes('Unterschrift'));

  await p.click('#u-feld');
  await unterschreiben(p);
  ok('Die erfasste Unterschrift steht im Feld',
     await p.locator('#u-feld img').isVisible());
  await p.screenshot({ path: `${OUT}/${name}-abschluss.png`, fullPage: true });

  await p.click('#u-ja');
  try {
    await p.waitForSelector('.ba-fertig', { timeout: 30000 });
  } catch (e) {
    ok('Der Abschluss läuft durch', false,
       (await p.textContent('#u-fehler').catch(() => '')) || 'ohne Meldung');
    throw e;
  }
  await p.waitForTimeout(800);

  const fertig = (await db()).abnahmen[0];
  ok('Die Abnahme ist abgeschlossen', !!fertig.abgeschlossen_am);
  ok('Beide Unterschriften stehen in der Zeile',
     String(fertig.unterschrift_triga).startsWith('data:image/')
     && String(fertig.unterschrift_gast).startsWith('data:image/'));
  ok('Mit dem Namen der Gegenseite', fertig.gast_name === 'Res Steiger (Steiger Baucontrol AG)');

  /* --- 6. Das Protokoll ------------------------------------------------------ */

  const dateien = (await db()).dateien;
  const protokoll = dateien.find(d => d.name.startsWith('Abnahmeprotokoll_'));
  ok('Ein Protokoll liegt unter Dokumente', !!protokoll, dateien.map(d => d.name).join(' | '));
  ok('Es ist mit der Abnahme verknüpft', fertig.protokoll_datei_id === protokoll.id);
  ok('Es liegt im Ordner des Projekts', protokoll.ordner_id === 'o1');
  ok('Und es ist ein PDF', protokoll.typ === 'application/pdf' && protokoll.name.endsWith('.pdf'));

  const inhalt = await p.evaluate(pfad => {
    const roh = atob(String(window.__stub_inhalte.get(pfad)).split(',')[1]);
    return { groesse: roh.length, kopf: roh.slice(0, 5), text: roh };
  }, protokoll.pfad);
  ok('Die Datei beginnt wie ein PDF', inhalt.kopf === '%PDF-', inhalt.kopf);
  ok('Und ist nicht leer', inhalt.groesse > 20000, String(inhalt.groesse));
  ok('Der Mangeltext steht im Protokoll',
     /T.{0,3}rzarge/.test(inhalt.text) || inhalt.text.includes('Wohnung 1.02'),
     'nicht gefunden');

  /* --- 7. Danach ist zu ------------------------------------------------------- */

  ok('Der Abschluss-Knopf ist weg', await p.locator('[data-abschluss]').count() === 0);
  ok('Es gibt keinen Mangel-Knopf mehr', await p.locator('#m-neu').count() === 0);
  ok('Und keine Haken oder Löscher an den Mängeln',
     await p.locator('.ba-mangel [data-haken]').count() === 0
     && await p.locator('.ba-mangel [data-mweg]').count() === 0);
  ok('Die Seite sagt, dass sie abgeschlossen ist',
     (await p.textContent('.ba-fertig')).includes('Res Steiger'));

  const versuche = await p.evaluate(async () => {
    const d = JSON.parse(sessionStorage.getItem('__stub_db'));
    const a = d.abnahmen[0];
    const m = d.maengel[0];
    const r1 = await sb.from('maengel').insert({ abnahme_id: a.id, nummer: 9, x: 0.1, y: 0.1, beschrieb: 'Nachtrag', erstellt_von: 'u1' });
    const r2 = await sb.from('maengel').update({ beschrieb: 'umgeschrieben' }).eq('id', m.id);
    const r3 = await sb.from('abnahmen').update({ titel: 'Obergeschoss' }).eq('id', a.id);
    const r4 = await sb.from('abnahmen').delete().eq('id', a.id);
    return [r1, r2, r3, r4].map(r => r.error?.message || 'durchgelassen');
  });
  ok('Kein Mangel kommt nachträglich dazu', /abgeschlossen/.test(versuche[0]), versuche[0]);
  ok('Keiner lässt sich ändern', /abgeschlossen/.test(versuche[1]), versuche[1]);
  ok('Die Abnahme selbst auch nicht', /abgeschlossen/.test(versuche[2]), versuche[2]);
  ok('Und löschen lässt sie sich nicht', /abgeschlossen/.test(versuche[3]), versuche[3]);

  /* --- 7b. Die Prüfspur --------------------------------------------------------- */

  /* Eine Mängelrüge mit Frist kann vor Gericht landen. Dann zählt nicht
     nur, was am Schluss dasteht, sondern auch, wer wann was geändert
     hat. Die Spur schreibt die Datenbank, nicht die App. */

  const spur = (await db()).pruefspur || [];
  const spurAb = spur.filter(s => s.vorgang_id === ab.id);
  ok('Zu dieser Abnahme steht eine Prüfspur da', spurAb.length > 8, String(spurAb.length));
  ok('Alle Einträge tragen Bereich und Projekt',
     spurAb.every(s => s.bereich === 'abnahme' && s.projekt_id === 'p1'));
  ok('Wer es war, steht mit Kennung und Namen daneben',
     spurAb.every(s => s.wer === 'u1' && s.wer_name === 'Jonas Zemp'));

  const erstellt = spurAb.filter(s => s.was === 'erstellt');
  ok('Angelegt wurden Abnahme, zwei Pläne und drei Mängel',
     erstellt.filter(s => s.tabelle === 'abnahmen').length === 1
     && erstellt.filter(s => s.tabelle === 'abnahme_plaene').length === 2
     && erstellt.filter(s => s.tabelle === 'maengel').length === 3,
     erstellt.map(s => s.tabelle).join(','));
  ok('Der Bezug ist ohne Verknüpfung lesbar',
     erstellt.some(s => s.bezug === 'Mangel 1: Türzarge Wohnung 1.02 verkratzt'),
     erstellt.map(s => s.bezug).join(' | '));

  const erledigt = spurAb.find(s => s.was === 'geaendert' && s.aenderungen?.erledigt_am);
  ok('Der Haken auf erledigt steht als eigener Eintrag mit vorher und nachher',
     !!erledigt && erledigt.aenderungen.erledigt_am.vorher === null
     && typeof erledigt.aenderungen.erledigt_am.nachher === 'string',
     JSON.stringify(erledigt?.aenderungen?.erledigt_am));

  const geloescht = spurAb.filter(s => s.was === 'geloescht');
  ok('Gelöschte Mängel und Pläne bleiben in der Spur stehen',
     geloescht.filter(s => s.tabelle === 'maengel').length === 2
     && geloescht.filter(s => s.tabelle === 'abnahme_plaene').length === 1,
     geloescht.map(s => `${s.tabelle}/${s.bezug}`).join(' | '));

  const abschluss = spurAb.find(s => s.tabelle === 'abnahmen' && s.aenderungen?.abgeschlossen_am);
  ok('Der Abschluss steht mit Unterschrift und Gegenseite drin',
     !!abschluss && abschluss.aenderungen.gast_name.nachher === 'Res Steiger (Steiger Baucontrol AG)');
  /* Die gemalte Unterschrift ist ein paar Kilobyte gross. Ungekürzt
     wäre die Prüfspur nach zwei Abnahmen grösser als alles andere. */
  const echt = (await db()).abnahmen[0].unterschrift_gast;
  ok('Lange Werte stehen gekürzt da, nicht in voller Länge',
     echt.length > 1000 && abschluss.aenderungen.unterschrift_gast.nachher.length === 201,
     `${echt.length} → ${abschluss.aenderungen.unterschrift_gast.nachher.length}`);
  ok('Und nirgends in der Spur steht ein längerer Wert',
     spurAb.every(s => Object.values(s.aenderungen || {}).every(v =>
       ['vorher', 'nachher'].every(k => String(v[k] ?? '').length <= 201))));

  const spurVersuche = await p.evaluate(async id => {
    const r1 = await sb.from('pruefspur').insert({
      bereich: 'abnahme', vorgang_id: id, tabelle: 'maengel', zeile_id: id, was: 'erstellt' });
    const r2 = await sb.from('pruefspur').update({ wer_name: 'jemand anders' }).eq('vorgang_id', id).select();
    const r3 = await sb.from('pruefspur').delete().eq('vorgang_id', id).select();
    const { data: lesen } = await sb.from('pruefspur').select('*').eq('vorgang_id', id);
    return { r1: r1.error?.message || 'durchgelassen',
             r2: (r2.data || []).length, r3: (r3.data || []).length, gelesen: (lesen || []).length };
  }, ab.id);
  ok('Von Hand schreibt niemand in die Prüfspur',
     /row-level security/.test(spurVersuche.r1), spurVersuche.r1);
  ok('Ändern trifft keine Zeile', spurVersuche.r2 === 0, String(spurVersuche.r2));
  ok('Löschen auch nicht', spurVersuche.r3 === 0, String(spurVersuche.r3));
  ok('Lesen dagegen geht — darum geht es',
     spurVersuche.gelesen === spurAb.length, `${spurVersuche.gelesen} statt ${spurAb.length}`);

  /* --- 8. Der Weg dorthin vom Projekt ------------------------------------------ */

  await p.goto(`${SERVER}/projekt-detail.html?projekt=p1`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(1200);
  ok('Die Projektseite hat einen Bauabnahme-Block',
     (await p.textContent('#abnahmen')).includes('Bauabnahme'));
  ok('Und zeigt die abgeschlossene Abnahme',
     (await p.textContent('#abnahmen')).includes('Erdgeschoss')
     && (await p.textContent('#abnahmen')).includes('Abgeschlossen'));

  await ctx.close();
}

await lauf('handy', 390);
await lauf('desktop', 1440);
await browser.close();

console.log('\n=== Fehler im Browser ===');
console.log(fehler.length ? fehler.join('\n') : 'keine');
