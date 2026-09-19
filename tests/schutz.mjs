/* Schreibschutz auf mitarbeiter.
   Zwei Sitzungen: einmal mit erweiterter Stufe, einmal ohne. Geprüft wird
   nicht nur, was die Oberfläche anbietet, sondern was ein direkter Aufruf
   gegen die API ausrichtet. */
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import fs from 'node:fs';
const HIER = '/tmp/claude-0/-home-user-baujournal-triga/ad655f9d-451a-55b0-aac9-986e124c8f6f/scratchpad';
const OUT = `${HIER}/shots-schutz`;
fs.rmSync(OUT, { recursive:true, force:true }); fs.mkdirSync(OUT, { recursive:true });
const STUB = fs.readFileSync(`${HIER}/stub.js`,'utf8');
const BASIS = JSON.parse(fs.readFileSync(`${HIER}/saat.json`,'utf8'));
const browser = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const fehler = [];
let gut = 0, schlecht = 0;
const ok = (n, b, zusatz='') => { b ? gut++ : schlecht++; console.log(`  ${b ? '✓' : '✗ FEHLER'}  ${n}${zusatz ? '  → ' + zusatz : ''}`); };

/* Dieselben Testdaten, nur die Stufe der angemeldeten Person wechselt. */
function saat(stufe) {
  const d = structuredClone(BASIS);
  d.mitarbeiter.find(m => m.user_id === 'u1').berechtigung = stufe;
  return d;
}

async function anmelden(breite, stufe) {
  const ctx = await browser.newContext({
    viewport:{ width:breite, height: breite>=1024?900:844 },
    locale:'de-CH', serviceWorkers:'block'
  });
  await ctx.route('**/vendor/supabase-js-2.58.0.js', r => r.fulfill({status:200,contentType:'application/javascript',body:STUB}));
  await ctx.addInitScript(s => {
    sessionStorage.setItem('__stub_db', JSON.stringify(s));
    try { localStorage.removeItem('bj_meine_stufe'); localStorage.removeItem('bj_cache_mitarbeiter'); } catch {}
  }, saat(stufe));
  const p = await ctx.newPage();
  p.on('console', m => { if (m.type()==='error') fehler.push(`${stufe}: ${m.text()}`); });
  p.on('pageerror', e => fehler.push(`${stufe}: ${e.message}`));
  await p.goto('http://127.0.0.1:8123/index.html', { waitUntil:'networkidle' });
  await p.fill('#email','test.durchlauf@triga.ch'); await p.fill('#pw','TestDurchlauf!2026');
  await p.click('#btn'); await p.waitForURL('**/start.html'); await p.waitForTimeout(800);
  return { ctx, p };
}

/* Ein direkter Aufruf an die API, wie ihn jemand mit der Konsole absetzt. */
const direkt = (p, tabelle, felder, filter) => p.evaluate(async ([t, f, w]) => {
  let q = sb.from(t).update(f);
  for (const [sp, wert] of Object.entries(w)) q = q.eq(sp, wert);
  const { data, error } = await q.select();
  return { fehler: error?.message || null, zeilen: data?.length ?? 0 };
}, [tabelle, felder, filter]);

/* ===== Mit erweiterter Stufe ============================================= */

for (const stufe of ['entwickler', 'geschaeftsleitung']) {
  console.log(`\n=== Stufe ${stufe}: darf verwalten ===`);
  const { ctx, p } = await anmelden(1440, stufe);
  await p.goto('http://127.0.0.1:8123/mitarbeiter.html', { waitUntil:'networkidle' });
  await p.waitForTimeout(1100);

  ok('Knopf zum Anlegen ist da', await p.locator('[data-neu]').first().isVisible());
  await p.click('#liste .br-zeile:nth-child(2)');
  await p.waitForTimeout(700);
  ok('Bearbeiten ist da', await p.locator('#ma-bearbeiten').isVisible());
  ok('Papierkorb ist da', await p.locator('#ma-weg').isVisible());

  const fremd = await direkt(p, 'mitarbeiter', { rolle: 'Von der GL geändert' }, { id: 'm2' });
  ok('Fremde Funktion ändern ist erlaubt', !fremd.fehler && fremd.zeilen === 1, fremd.fehler || '');

  const stufeSetzen = await direkt(p, 'mitarbeiter', { berechtigung: 'geschaeftsleitung' }, { id: 'm2' });
  ok('Stufe vergeben ist erlaubt', !stufeSetzen.fehler && stufeSetzen.zeilen === 1, stufeSetzen.fehler || '');

  await p.goto('http://127.0.0.1:8123/papierkorb-bereich.html?bereich=mitarbeiter', { waitUntil:'networkidle' });
  await p.waitForTimeout(1100);
  ok('Wiederherstellen ist da', (await p.$$('.pk-zurueck')).length > 0);

  await ctx.close();
}

/* ===== Ohne erweiterte Stufe ============================================= */

for (const breite of [390, 1440]) {
  console.log(`\n=== Stufe mitarbeiter (${breite}px) ===`);
  const { ctx, p } = await anmelden(breite, 'mitarbeiter');

  // --- Was die Datenbank dazu sagt ----------------------------------------
  const eigeneNummer = await direkt(p, 'mitarbeiter',
    { telefon: '079 555 44 33' }, { user_id: 'u1' });
  ok('Eigene Nummer ändern bleibt erlaubt',
     !eigeneNummer.fehler && eigeneNummer.zeilen === 1, eigeneNummer.fehler || '');

  const eigeneMail = await direkt(p, 'mitarbeiter',
    { email: 'neu@triga.ch' }, { user_id: 'u1' });
  ok('Eigene E-Mail ändern bleibt erlaubt',
     !eigeneMail.fehler && eigeneMail.zeilen === 1, eigeneMail.fehler || '');

  const eigeneUS = await direkt(p, 'mitarbeiter',
    { unterschrift: 'data:image/png;base64,AAA' }, { user_id: 'u1' });
  ok('Eigene Unterschrift bleibt erlaubt',
     !eigeneUS.fehler && eigeneUS.zeilen === 1, eigeneUS.fehler || '');

  const hochstufen = await direkt(p, 'mitarbeiter',
    { berechtigung: 'entwickler' }, { user_id: 'u1' });
  ok('Sich selbst hochstufen wird abgewiesen',
     !!hochstufen.fehler && hochstufen.zeilen === 0, hochstufen.fehler || 'DURCHGELASSEN');
  ok('Die Meldung nennt die Spalte',
     (hochstufen.fehler || '').includes('berechtigung'), hochstufen.fehler || '');

  const eigenerName = await direkt(p, 'mitarbeiter',
    { name: 'Chef' }, { user_id: 'u1' });
  ok('Den eigenen Namen ändern wird abgewiesen',
     !!eigenerName.fehler, eigenerName.fehler || 'DURCHGELASSEN');

  const eigeneFunktion = await direkt(p, 'mitarbeiter',
    { rolle: 'Geschäftsleitung' }, { user_id: 'u1' });
  ok('Die eigene Funktion ändern wird abgewiesen',
     !!eigeneFunktion.fehler, eigeneFunktion.fehler || 'DURCHGELASSEN');

  const fremdeZeile = await direkt(p, 'mitarbeiter',
    { telefon: '000' }, { id: 'm2' });
  ok('Eine fremde Zeile schreiben trifft nichts',
     fremdeZeile.zeilen === 0, `${fremdeZeile.zeilen} Zeilen, ${fremdeZeile.fehler || 'kein Fehler'}`);

  const fremdeStufe = await direkt(p, 'mitarbeiter',
    { berechtigung: 'entwickler' }, { id: 'm2' });
  ok('Eine fremde Stufe setzen trifft nichts',
     fremdeStufe.zeilen === 0, `${fremdeStufe.zeilen} Zeilen, ${fremdeStufe.fehler || 'kein Fehler'}`);

  const papierkorb = await direkt(p, 'mitarbeiter',
    { geloescht_am: new Date().toISOString() }, { user_id: 'u1' });
  ok('Sich selbst in den Papierkorb legen wird abgewiesen',
     !!papierkorb.fehler, papierkorb.fehler || 'DURCHGELASSEN');

  const anlegen = await p.evaluate(async () => {
    const { error } = await sb.from('mitarbeiter').insert({ name: 'Eingeschleust' }).select();
    return error?.message || null;
  });
  ok('Eine Person anlegen wird abgewiesen', !!anlegen, anlegen || 'DURCHGELASSEN');

  const bestand = await p.evaluate(() => {
    const d = JSON.parse(sessionStorage.getItem('__stub_db'));
    const ich = d.mitarbeiter.find(m => m.user_id === 'u1');
    return {
      anzahl: d.mitarbeiter.length,
      stufe: ich.berechtigung, name: ich.name, telefon: ich.telefon,
      fremd: d.mitarbeiter.find(m => m.id === 'm2')
    };
  });
  ok('Die Stufe steht unverändert in der Tabelle', bestand.stufe === 'mitarbeiter', bestand.stufe);
  ok('Der eigene Name steht unverändert da', bestand.name === 'Jonas Zemp', bestand.name);
  ok('Die erlaubte Änderung ist angekommen', bestand.telefon === '079 555 44 33', bestand.telefon);
  ok('Die fremde Zeile ist unberührt',
     bestand.fremd.telefon === '079 548 63 01' && bestand.fremd.berechtigung === 'mitarbeiter',
     `${bestand.fremd.telefon} / ${bestand.fremd.berechtigung}`);
  ok('Keine eingeschleuste Person', bestand.anzahl === 4, String(bestand.anzahl));

  // --- Was die Oberfläche dazu zeigt ---------------------------------------
  await p.goto('http://127.0.0.1:8123/mitarbeiter.html', { waitUntil:'networkidle' });
  await p.waitForTimeout(1100);
  ok('Kein Knopf zum Anlegen',
     (await p.$$eval('[data-neu]', e => e.filter(x => !x.hidden).length)) === 0);
  ok('Die Liste steht trotzdem vollständig da', (await p.$$('#liste .br-zeile')).length === 3);

  const fremdNr = await p.$$eval('#liste .br-zeile', els =>
    els.findIndex(e => e.querySelector('.titel').textContent.trim() === 'Silvia Weber'));
  await p.click(`#liste .br-zeile:nth-child(${fremdNr + 1})`);
  await p.waitForTimeout(700);
  ok('Kein Bearbeiten bei einer fremden Person', (await p.$$('#ma-bearbeiten')).length === 0);
  ok('Kein Papierkorb bei einer fremden Person', (await p.$$('#ma-weg')).length === 0);
  ok('Dafür ein Satz, der sagt warum',
     (await p.textContent('#ma-ansicht')).includes('Geschäftsleitung'));

  await p.goto('http://127.0.0.1:8123/mitarbeiter.html', { waitUntil:'networkidle' });
  await p.waitForTimeout(1000);
  const eigenNr = await p.$$eval('#liste .br-zeile', els =>
    els.findIndex(e => e.querySelector('.titel').textContent.trim() === 'Jonas Zemp'));
  await p.click(`#liste .br-zeile:nth-child(${eigenNr + 1})`);
  await p.waitForTimeout(700);
  ok('Die eigene Zeile verweist auf Mein Profil',
     (await p.getAttribute('#ma-ansicht a[href="profil.html"]', 'href')) === 'profil.html');
  await p.screenshot({ path:`${OUT}/${breite}-mitarbeiter-ohne-rechte.png`, fullPage:true });

  await p.goto('http://127.0.0.1:8123/papierkorb-bereich.html?bereich=mitarbeiter', { waitUntil:'networkidle' });
  await p.waitForTimeout(1100);
  ok('Kein Wiederherstellen im Papierkorb', (await p.$$('.pk-zurueck')).length === 0);
  ok('Der Papierkorb sagt, wer es darf',
     (await p.textContent('#inhalt')).includes('Zurückholen darf die Geschäftsleitung'));

  // --- Mein Profil geht weiterhin ------------------------------------------
  await p.goto('http://127.0.0.1:8123/profil.html', { waitUntil:'networkidle' });
  await p.waitForTimeout(1000);
  await p.fill('#p-telefon', '079 222 33 44');
  await p.fill('#p-email', 'jonas@triga.ch');
  await p.click('#p-speichern');
  await p.waitForTimeout(1000);
  ok('Mein Profil speichert weiterhin', await p.locator('#p-fehler').isHidden());
  const nachher = await p.evaluate(() => {
    const d = JSON.parse(sessionStorage.getItem('__stub_db'));
    return d.mitarbeiter.find(m => m.user_id === 'u1');
  });
  ok('Die Nummer ist in der Tabelle angekommen', nachher.telefon === '079 222 33 44', nachher.telefon);
  ok('Die Stufe ist dabei unverändert', nachher.berechtigung === 'mitarbeiter', nachher.berechtigung);

  // Die Unterschrift auch.
  await p.click('#p-unterschreiben');
  await p.waitForSelector('#us-feld', { state:'visible' });
  await p.waitForTimeout(400);
  const k = await p.locator('#us-feld').boundingBox();
  await p.mouse.move(k.x + k.width * 0.3, k.y + k.height * 0.4);
  await p.mouse.down();
  await p.mouse.move(k.x + k.width * 0.7, k.y + k.height * 0.6);
  await p.mouse.up();
  await p.click('#us-ja');
  await p.waitForTimeout(1000);
  ok('Unterschreiben geht ohne erweiterte Stufe', (await p.$$('.pr-unterschrift img')).length === 1);

  await ctx.close();
}


/* ===== Eintraege: nur noch über die drei Funktionen ======================= */

/* Die Lücke, die beim Beweis zur Wetterspalte auffiel: die
   UPDATE-Policy auf eintraege stand auf `true` und das Spaltenrecht lag
   bei authenticated. Damit konnte jedes angemeldete Konto mit einem
   direkten Aufruf an PostgREST jede Spalte jedes Eintrags umschreiben —
   an der Erlaubnisliste vorbei, am Korrekturprotokoll vorbei.

   Geprüft wird beides: dass der direkte Weg zu ist, und dass der Weg
   der App unverändert funktioniert. Das zweite ist das Wichtigere —
   eine Tür, die niemand mehr durchkommt, ist keine Lösung. */

console.log('\n=== Eintraege: nur über korrigiere_eintrag und Co. ===');
{
  const { ctx, p } = await anmelden(1440, 'entwickler');
  await p.goto('http://127.0.0.1:8123/start.html', { waitUntil:'networkidle' });
  await p.waitForTimeout(600);

  const eintrag = await p.evaluate(() =>
    JSON.parse(sessionStorage.getItem('__stub_db')).eintraege[0]);
  ok('Es gibt einen Eintrag zum Prüfen', !!eintrag, JSON.stringify(eintrag)?.slice(0, 60));

  /* --- Der direkte Weg ist zu ----------------------------------------- */

  const direkt = await p.evaluate(async id =>
    (await sb.from('eintraege').update({ feststellungen: 'Still umgeschrieben' }).eq('id', id))
      .error?.message || 'durchgelassen', eintrag.id);
  ok('Ein direktes UPDATE auf eintraege wird abgewiesen',
     /permission denied/.test(direkt), direkt);
  ok('Und nicht bloss stillschweigend ignoriert',
     direkt !== 'durchgelassen', direkt);

  const nachher = await p.evaluate(id =>
    JSON.parse(sessionStorage.getItem('__stub_db')).eintraege.find(e => e.id === id), eintrag.id);
  ok('Der Eintrag steht unverändert da',
     nachher.feststellungen === eintrag.feststellungen,
     `${eintrag.feststellungen} → ${nachher.feststellungen}`);

  /* Auch die Wetterspalten: eine Abfrage von Hand nachzutragen war
     genau das, was der Schutz verhindern soll. */
  const wetter = await p.evaluate(async id =>
    (await sb.from('eintraege')
      .update({ wetter_grad: 99, wetter_quelle: 'erfunden' }).eq('id', id))
      .error?.message || 'durchgelassen', eintrag.id);
  ok('Eine Wetterabfrage lässt sich nicht von Hand nachtragen',
     /permission denied/.test(wetter), wetter);

  /* Und am Papierkorb vorbei löschen geht auch nicht. */
  const weg = await p.evaluate(async id =>
    (await sb.from('eintraege').update({ geloescht_am: new Date().toISOString() }).eq('id', id))
      .error?.message || 'durchgelassen', eintrag.id);
  ok('Am Papierkorb vorbei löschen geht ebenfalls nicht',
     /permission denied/.test(weg), weg);

  /* --- Der Weg der App geht weiter ------------------------------------ */

  const korrigiert = await p.evaluate(async id => {
    const { error } = await sb.rpc('korrigiere_eintrag', {
      p_id: id, p_neu: { feststellungen: 'Über die Funktion korrigiert' },
      p_log: [{ feld: 'feststellungen', alter_wert: 'x', neuer_wert: 'Über die Funktion korrigiert' }]
    });
    const d = JSON.parse(sessionStorage.getItem('__stub_db'));
    return { fehler: error?.message || null,
             text: d.eintraege.find(e => e.id === id).feststellungen,
             spuren: d.eintraege_korrekturen.filter(k => k.eintrag_id === id).length };
  }, eintrag.id);
  ok('korrigiere_eintrag() arbeitet weiterhin',
     !korrigiert.fehler && korrigiert.text === 'Über die Funktion korrigiert',
     JSON.stringify(korrigiert));
  ok('Und schreibt dabei ins Korrekturprotokoll',
     korrigiert.spuren >= 1, String(korrigiert.spuren));

  const gefegt = await p.evaluate(async id => {
    const { error } = await sb.rpc('loesche_eintrag', { p_id: id });
    const d = JSON.parse(sessionStorage.getItem('__stub_db'));
    return { fehler: error?.message || null, weg: !!d.eintraege.find(e => e.id === id).geloescht_am };
  }, eintrag.id);
  ok('loesche_eintrag() legt weiterhin in den Papierkorb',
     !gefegt.fehler && gefegt.weg, JSON.stringify(gefegt));

  const zurueck = await p.evaluate(async id => {
    const { error } = await sb.rpc('stelle_eintrag_wieder_her', { p_id: id });
    const d = JSON.parse(sessionStorage.getItem('__stub_db'));
    return { fehler: error?.message || null, da: !d.eintraege.find(e => e.id === id).geloescht_am };
  }, eintrag.id);
  ok('stelle_eintrag_wieder_her() holt ihn weiterhin zurück',
     !zurueck.fehler && zurueck.da, JSON.stringify(zurueck));

  /* --- Die Erlaubnisliste hält auch über die Funktion ----------------- */

  const gemogelt = await p.evaluate(async id => {
    await sb.rpc('korrigiere_eintrag', {
      p_id: id,
      p_neu: { feststellungen: 'noch eine Korrektur', wetter_grad: 42, wetter_quelle: 'erfunden' },
      p_log: [{ feld: 'feststellungen', alter_wert: 'x', neuer_wert: 'noch eine Korrektur' }]
    });
    const e = JSON.parse(sessionStorage.getItem('__stub_db')).eintraege.find(x => x.id === id);
    return { grad: e.wetter_grad ?? null, quelle: e.wetter_quelle ?? null, text: e.feststellungen };
  }, eintrag.id);
  ok('Auch über die Funktion kommt keine erfundene Wetterabfrage hinein',
     gemogelt.grad === null && gemogelt.quelle === null, JSON.stringify(gemogelt));
  ok('Die erlaubte Spalte wird dabei trotzdem gesetzt',
     gemogelt.text === 'noch eine Korrektur', gemogelt.text);

  /* --- Ein Konto ohne Adressbuchzeile darf gar nichts ----------------- */

  const fremd = await p.evaluate(async id => {
    /* Dieselbe Person, aber ihre Zeile im Adressbuch ist weg — genau
       der Fall, den darf_eintrag_aendern() abfängt. */
    const d = JSON.parse(sessionStorage.getItem('__stub_db'));
    const merk = d.mitarbeiter;
    d.mitarbeiter = d.mitarbeiter.filter(m => m.user_id !== 'u1');
    sessionStorage.setItem('__stub_db', JSON.stringify(d));

    const a = (await sb.rpc('korrigiere_eintrag', {
      p_id: id, p_neu: { feststellungen: 'von aussen' },
      p_log: [{ feld: 'feststellungen', alter_wert: 'x', neuer_wert: 'von aussen' }]
    })).error?.message || 'durchgelassen';
    const b = (await sb.rpc('loesche_eintrag', { p_id: id })).error?.message || 'durchgelassen';
    const c = (await sb.rpc('stelle_eintrag_wieder_her', { p_id: id })).error?.message || 'durchgelassen';

    const zurueckD = JSON.parse(sessionStorage.getItem('__stub_db'));
    zurueckD.mitarbeiter = merk;
    sessionStorage.setItem('__stub_db', JSON.stringify(zurueckD));
    return { a, b, c, text: zurueckD.eintraege.find(e => e.id === id).feststellungen };
  }, eintrag.id);
  ok('Ohne Zeile im Adressbuch korrigiert niemand',
     /Adressbuch/.test(fremd.a), fremd.a);
  ok('Und löscht niemand', /Adressbuch/.test(fremd.b), fremd.b);
  ok('Und stellt niemand wieder her', /Adressbuch/.test(fremd.c), fremd.c);
  ok('Der Eintrag bleibt dabei, wie er war',
     fremd.text === 'noch eine Korrektur', fremd.text);

  await ctx.close();
}

await browser.close();
console.log(`\n=== ${gut} von ${gut+schlecht} Prüfungen bestanden ===`);
console.log('=== Fehler im Browser ===');
console.log(fehler.length ? [...new Set(fehler)].join('\n') : 'keine');
