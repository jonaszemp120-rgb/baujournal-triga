import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import * as child_process from 'node:child_process';
const HIER = '/tmp/claude-0/-home-user-baujournal-triga/ad655f9d-451a-55b0-aac9-986e124c8f6f/scratchpad';
const OUT = `${HIER}/shots-fp`;
fs.rmSync(OUT, { recursive:true, force:true }); fs.mkdirSync(OUT, { recursive:true });
const STUB = fs.readFileSync(`${HIER}/stub.js`,'utf8');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const fehler = [];
let gut = 0, schlecht = 0;
const ok = (n, b) => { b ? gut++ : schlecht++; console.log(`  ${b ? '✓' : '✗ FEHLER'}  ${n}`); };

/* Ein xlsx ist ein ZIP. Statt die Bibliothek auch hier zu laden, reicht
   es, den gesamten XML-Inhalt auszupacken und darin zu suchen. SheetJS
   schreibt die Texte direkt ins Arbeitsblatt, nicht in sharedStrings. */
function texteAus(pfad) {
  const { execFileSync } = child_process;
  return execFileSync('unzip', ['-p', pfad, 'xl/*.xml'], { encoding:'utf8' });
}

const SAAT = {
  profile: [{ id:'u1', name:'Jonas Zemp' }],
  projekte: [], eintraege: [], eintraege_korrekturen: [],
  bkp_liste: [
    { id:'k1', code:'211', bezeichnung:'Baumeisterarbeiten', erstellt_am:'2026-01-01T08:00:00.000Z' },
    { id:'k2', code:'230', bezeichnung:'Elektroanlagen',     erstellt_am:'2026-01-01T08:00:00.000Z' },
    { id:'k3', code:'271', bezeichnung:'Gipserarbeiten',     erstellt_am:'2026-01-01T08:00:00.000Z' }
  ],
  firmen: [
    { id:'f1', name:'Steiger Baucontrol AG', adresse:'Sarnerstrasse 1', plz_ort:'6060 Sarnen',
      telefon:'+41 (41) 660 12 34', email:'info@steiger-baucontrol.ch', bkp_codes:['211'], erstellt_am:'2026-01-01T08:00:00.000Z' },
    { id:'f2', name:'Keller+Steiner AG', adresse:'Dorfstrasse 4', plz_ort:'6060 Sarnen',
      telefon:'041 660 99 99', email:'mail@keller-steiner.ch', bkp_codes:['271'], erstellt_am:'2026-01-01T08:00:00.000Z' },
    { id:'f3', name:'Trigonet AG', adresse:'Industriestrasse 8', plz_ort:'6064 Kerns',
      telefon:null, email:null, bkp_codes:['230','211'], erstellt_am:'2026-01-01T08:00:00.000Z' }
  ],
  ansprechpersonen: [], notizen: []
};

async function lauf(name, breite) {
  const ctx = await browser.newContext({
    viewport:{ width:breite, height: breite>=1024?900:844 },
    deviceScaleFactor:1, locale:'de-CH', serviceWorkers:'block', acceptDownloads:true
  });
  await ctx.route('**/vendor/supabase-js-2.58.0.js', r => r.fulfill({status:200,contentType:'application/javascript',body:STUB}));
  await ctx.addInitScript(saat => {
    if (!sessionStorage.getItem('__stub_db')) sessionStorage.setItem('__stub_db', JSON.stringify(saat));
  }, SAAT);

  const p = await ctx.newPage();
  p.on('console', m => { if (m.type()==='error') fehler.push(`${name}: ${m.text()}`); });
  p.on('pageerror', e => fehler.push(`${name}: ${e.message}`));
  console.log(`\n=== ${name} (${breite}px) ===`);

  await p.goto('http://127.0.0.1:8123/index.html', { waitUntil:'networkidle' });
  await p.fill('#email','test.durchlauf@triga.ch'); await p.fill('#pw','TestDurchlauf!2026');
  await p.click('#btn'); await p.waitForURL('**/start.html'); await p.waitForTimeout(800);

  ok('Startseite zählt die Firmen', (await p.textContent('#raster')).includes('3'));
  await p.click('#raster a[href="firmenpool.html"]');
  await p.waitForURL('**/firmenpool.html'); await p.waitForTimeout(900);

  // --- Liste ---------------------------------------------------------------
  const gruppen = await p.$$eval('#gruppen .fp-gruppe', e => e.map(x => x.textContent.trim()));
  ok('nach Ortschaft gruppiert, alphabetisch', gruppen.join('|') === 'KERNS — 1 FIRMA|SARNEN — 2 FIRMEN');
  ok('alle drei Firmen sichtbar', (await p.$$('#gruppen [data-firma]')).length === 3);
  ok('Metazeile nennt BKP und Ort',
     (await p.textContent('#gruppen')).includes('211 · Baumeisterarbeiten · Sarnen'));
  ok('mehrere Codes werden gezählt', (await p.textContent('#gruppen')).includes('+1 weitere'));
  ok('ohne Notiz ist die Ampel grau', (await p.$$('#gruppen .punkt.grau')).length === 3);

  if (breite >= 1024) {
    ok('Kategorienleiste 280px', Math.round(await p.$eval('.fp-kategorien', e => e.getBoundingClientRect().width)) === 280);
    ok('alle vier Zeilen (Alle + 3)', (await p.$$('#kat-desktop .fp-kat')).length === 4);
    ok('Zähler pro Kategorie', (await p.textContent('#kat-desktop')).includes('211 Baumeisterarbeiten'));
    ok('Karten statt Zeilen', (await p.$$('#gruppen .fp-karte')).length === 3);
  } else {
    ok('Chipzeile mit Kategorien', (await p.$$('#kat-chips .fp-chip[data-code]')).length === 4);
    ok('Chip zum Anlegen', await p.locator('#chip-kat-neu').isVisible());
    ok('Zeilen statt Karten', (await p.$$('#gruppen .fp-zeile')).length === 3);
    ok('Hinweis auf langes Drücken', (await p.textContent('.fp-hilfe')).includes('lang gedrückt'));
  }
  await p.screenshot({ path:`${OUT}/${name}-liste.png`, fullPage:true });

  // --- Filter --------------------------------------------------------------
  const katKlick = async code => {
    if (breite >= 1024) await p.click(`#kat-desktop .fp-kat[data-code="${code}"]`);
    else await p.click(`#kat-chips .fp-chip[data-code="${code}"]`);
    await p.waitForTimeout(300);
  };
  await katKlick('211');
  ok('BKP-Filter greift', (await p.$$('#gruppen [data-firma]')).length === 2);
  await katKlick('271');
  ok('anderer BKP-Filter greift', (await p.$$('#gruppen [data-firma]')).length === 1);
  await katKlick('');
  ok('zurück auf Alle', (await p.$$('#gruppen [data-firma]')).length === 3);

  await p.fill('#suche','kerns'); await p.waitForTimeout(300);
  ok('Suche findet über den Ort', (await p.$$('#gruppen [data-firma]')).length === 1);
  await p.fill('#suche','gipser'); await p.waitForTimeout(300);
  ok('Suche findet über die BKP-Bezeichnung', (await p.$$('#gruppen [data-firma]')).length === 1);
  await p.fill('#suche',''); await p.waitForTimeout(300);

  await p.click('#ampel-chips .fp-chip[data-ampel="rot"]'); await p.waitForTimeout(300);
  ok('Ampelfilter Rot ist leer', (await p.textContent('#gruppen')).includes('Keine Firma passt'));
  await p.click('#ampel-chips .fp-chip[data-ampel="ohne"]'); await p.waitForTimeout(300);
  ok('Ampelfilter Ohne zeigt alle drei', (await p.$$('#gruppen [data-firma]')).length === 3);
  await p.click('#ampel-chips .fp-chip[data-ampel="alle"]'); await p.waitForTimeout(300);

  // --- Firma erfassen ------------------------------------------------------
  await p.locator(breite>=1024 ? '#firma-neu' : '#m-firma-neu').click();
  await p.waitForTimeout(500);
  await p.fill('#ff-name','Muster Holzbau AG');
  await p.fill('#ff-adresse','Werkstrasse 3');
  await p.fill('#ff-plz_ort','6064 Kerns');
  await p.fill('#ff-telefon','041 660 55 55');
  await p.click('#ff-codes .fp-chip[data-code="230"]');
  await p.click('#ff-speichern'); await p.waitForTimeout(1200);
  ok('neue Firma landet direkt im Detail', (await p.textContent('#firma-links')).includes('230 Elektroanlagen'));
  ok('Titel zeigt den Firmennamen', (await p.textContent(breite>=1024 ? '#d-titel' : '#m-titel')) === 'Muster Holzbau AG');

  // zurück zur Liste
  await p.locator(breite>=1024 ? '#d-zurueck' : '#m-zurueck').click(); await p.waitForTimeout(600);
  ok('vier Firmen nach dem Anlegen', (await p.$$('#gruppen [data-firma]')).length === 4);

  // --- Detail --------------------------------------------------------------
  await p.locator('#gruppen [data-firma="f1"]').click(); await p.waitForTimeout(900);
  ok('Ampel grau, noch keine Erfahrung', (await p.textContent('.fp-ampel')).includes('noch keine Erfahrung'));
  ok('Telefonlink ohne Sonderzeichen',
     (await p.locator('#firma-links a[href^="tel:"]').getAttribute('href')) === 'tel:+41416601234');
  ok('Mailto-Link stimmt',
     (await p.locator('#firma-links a[href^="mailto:"]').getAttribute('href')) === 'mailto:info@steiger-baucontrol.ch');
  ok('Adresse steht im Kontaktblock', (await p.textContent('.fp-kontakt')).includes('Sarnerstrasse 1, 6060 Sarnen'));

  // --- Ansprechpersonen ----------------------------------------------------
  await p.click('#person-neu'); await p.waitForTimeout(500);
  await p.fill('#fs-name','Res Steiger');
  await p.fill('#fs-funktion','Geschäftsführer');
  await p.fill('#fs-telefon','041 660 12 35');
  await p.fill('#fs-email','res@steiger-baucontrol.ch');
  await p.click('#fs-ja'); await p.waitForTimeout(1100);
  ok('Ansprechperson angelegt', (await p.$$('#firma-links .fp-person')).length === 1);
  ok('Funktion und Telefon in der Zeile', (await p.textContent('.fp-person .prolle')).includes('Geschäftsführer · 041 660 12 35'));
  ok('Telefon der Person antippbar', await p.locator('.fp-person a[href^="tel:"]').isVisible());

  await p.click('.fp-person [data-person-bearbeiten]'); await p.waitForTimeout(500);
  await p.fill('#fs-funktion','Inhaber');
  await p.click('#fs-ja'); await p.waitForTimeout(1100);
  ok('Ansprechperson bearbeitet', (await p.textContent('.fp-person .prolle')).includes('Inhaber'));

  // --- Notizen -------------------------------------------------------------
  await p.fill('#notiz-text','Offerten kommen immer termingerecht.');
  await p.click('#firma-rechts .fp-farbe[data-farbe="gruen"]');
  await p.click('#notiz-speichern'); await p.waitForTimeout(1200);
  ok('Notiz erfasst', (await p.$$('#notiz-liste .fp-notiz')).length === 1);
  ok('Autor sichtbar', (await p.textContent('#notiz-liste .autor')) === 'Jonas Zemp');
  ok('Datum sichtbar', /^\d{2}\.\d{2}\.\d{4}$/.test((await p.textContent('#notiz-liste .wann')).trim()));
  ok('Ampel wird grün', (await p.textContent('.fp-ampel')).includes('Grün'));

  await p.waitForTimeout(1100);
  await p.fill('#notiz-text','Trockenbau zweimal zu spät geliefert.');
  await p.click('#firma-rechts .fp-farbe[data-farbe="rot"]');
  await p.click('#notiz-speichern'); await p.waitForTimeout(1200);
  ok('zweite Notiz oben', (await p.textContent('#notiz-liste .fp-notiz')).includes('Trockenbau'));
  ok('jüngste Notiz bestimmt die Ampel', (await p.textContent('.fp-ampel')).includes('Rot'));
  await p.screenshot({ path:`${OUT}/${name}-firma.png`, fullPage:true });

  await p.click('#notiz-liste .fp-notiz [data-notiz-bearbeiten]'); await p.waitForTimeout(500);
  await p.fill('#fs-text','Trockenbau dreimal zu spät geliefert.');
  await p.click('.sheet .fp-farbe[data-farbe="gelb"]');
  await p.click('#fs-ja'); await p.waitForTimeout(1200);
  ok('Notiz bearbeitet', (await p.textContent('#notiz-liste')).includes('dreimal'));
  ok('Farbwechsel zieht die Ampel nach', (await p.textContent('.fp-ampel')).includes('Gelb'));

  await p.click('#notiz-liste .fp-notiz [data-notiz-weg]'); await p.waitForTimeout(500);
  ok('Rückfrage vor dem Löschen', (await p.locator('.sheet').last().textContent()).includes('endgültig entfernt'));
  await p.click('#f-ja'); await p.waitForTimeout(1300);
  ok('Notiz gelöscht', (await p.$$('#notiz-liste .fp-notiz')).length === 1);
  ok('vorherige Notiz bestimmt wieder die Ampel', (await p.textContent('.fp-ampel')).includes('Grün'));

  // --- vCard ---------------------------------------------------------------
  const [vcard] = await Promise.all([ p.waitForEvent('download'), p.click('#vcard') ]);
  const vpfad = `${OUT}/${name}.vcf`;
  await vcard.saveAs(vpfad);
  const vtext = fs.readFileSync(vpfad,'utf8');
  ok('vCard heisst nach der Firma', vcard.suggestedFilename() === 'Steiger Baucontrol AG.vcf');
  ok('vCard enthält Firma und Person', vtext.includes('ORG:Steiger Baucontrol AG') && vtext.includes('FN:Res Steiger'));
  ok('vCard trägt Telefon und Adresse', vtext.includes('TEL;TYPE=WORK,VOICE:+41 (41) 660 12 34') && vtext.includes('ADR;TYPE=WORK:;;Sarnerstrasse 1;Sarnen;;6060;'));

  // Ansprechperson wieder weg
  await p.click('.fp-person [data-person-weg]'); await p.waitForTimeout(500);
  ok('Rückfrage nennt den fehlenden Papierkorb', (await p.locator('.sheet').last().textContent()).includes('keinen Papierkorb'));
  await p.click('#f-ja'); await p.waitForTimeout(1300);
  ok('Ansprechperson gelöscht', (await p.$$('#firma-links .fp-person')).length === 0);

  // --- Excel-Export --------------------------------------------------------
  await p.locator(breite>=1024 ? '#d-zurueck' : '#m-zurueck').click(); await p.waitForTimeout(600);
  if (breite >= 1024) await p.click('#w-export');
  else { await p.click('#m-mehr'); await p.waitForTimeout(400); await p.click('#s-export'); }
  await p.waitForTimeout(500);
  ok('Export nennt die Anzahl', (await p.locator('.sheet').last().textContent()).includes('4 Firmen'));
  ok('Notizen standardmässig draussen', !(await p.isChecked('#ex-notizen')));
  const [xlsx] = await Promise.all([ p.waitForEvent('download'), p.click('#ex-los') ]);
  const xpfad = `${OUT}/${name}.xlsx`;
  await xlsx.saveAs(xpfad);
  ok('Datei heisst nach dem Bereich', /^Firmenpool_\d{4}-\d{2}-\d{2}\.xlsx$/.test(xlsx.suggestedFilename()));
  ok('Datei ist ein echtes xlsx', fs.readFileSync(xpfad).subarray(0,2).toString('latin1') === 'PK');
  const ohneNotizen = texteAus(xpfad);
  ok('Export enthält die Firmen', ohneNotizen.includes('Steiger Baucontrol AG'));
  ok('Export enthält die Einstufung', ohneNotizen.includes('Grün — bewährt'));
  ok('Export lässt die Notizen draussen', !ohneNotizen.includes('Offerten kommen'));

  // zweiter Lauf, diesmal mit angehakter Checkbox
  await p.waitForTimeout(600);
  if (breite >= 1024) await p.click('#w-export');
  else { await p.click('#m-mehr'); await p.waitForTimeout(400); await p.click('#s-export'); }
  await p.waitForTimeout(500);
  await p.check('#ex-notizen');
  const [xlsx2] = await Promise.all([ p.waitForEvent('download'), p.click('#ex-los') ]);
  const xpfad2 = `${OUT}/${name}-mit-notizen.xlsx`;
  await xlsx2.saveAs(xpfad2);
  const mitNotizen = texteAus(xpfad2);
  ok('mit Haken sind die Notizen drin', mitNotizen.includes('Offerten kommen'));
  ok('Notiz im Export nennt Autor und Farbe',
     /Jonas Zemp/.test(mitNotizen) && /gruen/.test(mitNotizen));

  // --- Kategorie anlegen, bearbeiten, in den Papierkorb --------------------
  await p.locator(breite>=1024 ? '#kat-neu' : '#chip-kat-neu').click(); await p.waitForTimeout(500);
  await p.fill('#fs-code','285');
  await p.fill('#fs-bezeichnung','Malerarbeiten');
  await p.click('#fs-ja'); await p.waitForTimeout(1200);
  const katAnzahl = breite>=1024 ? '#kat-desktop .fp-kat' : '#kat-chips .fp-chip[data-code]';
  ok('Kategorie angelegt', (await p.$$(katAnzahl)).length === 5);

  if (breite >= 1024) {
    await p.click('#kat-desktop .fp-kat[data-code="285"] [data-kat-bearbeiten]'); await p.waitForTimeout(500);
    await p.fill('#fs-bezeichnung','Maler- und Tapeziererarbeiten');
    await p.click('#fs-ja'); await p.waitForTimeout(1200);
    ok('Kategorie bearbeitet', (await p.textContent('#kat-desktop')).includes('Maler- und Tapeziererarbeiten'));
    await p.click('#kat-desktop .fp-kat[data-code="285"] [data-kat-weg]'); await p.waitForTimeout(500);
    await p.click('#f-ja'); await p.waitForTimeout(1300);
    ok('Kategorie im Papierkorb', (await p.$$('#kat-desktop .fp-kat')).length === 4);
  } else {
    const chip = p.locator('#kat-chips .fp-chip[data-code="285"]');
    await chip.dispatchEvent('mousedown'); await p.waitForTimeout(800);
    ok('langes Drücken öffnet das Menü', (await p.locator('.sheet').last().textContent()).includes('285 Malerarbeiten'));
    await p.click('#k-weg'); await p.waitForTimeout(500);
    await p.click('#f-ja'); await p.waitForTimeout(1300);
    ok('Kategorie im Papierkorb', (await p.$$('#kat-chips .fp-chip[data-code]')).length === 4);
  }

  // --- Firma in den Papierkorb und zurück ---------------------------------
  await p.locator('#gruppen [data-firma="f2"]').click(); await p.waitForTimeout(900);
  await p.locator(breite>=1024 ? '#w-firma-weg' : '#m-firma-weg').click(); await p.waitForTimeout(500);
  ok('Rückfrage erklärt den Papierkorb', (await p.locator('.sheet').last().textContent()).includes('Wiederherstellen'));
  await p.click('#f-ja'); await p.waitForTimeout(1400);
  ok('zurück in der Liste', (await p.$$('#gruppen [data-firma]')).length === 3);

  await p.locator('a[href*="papierkorb-bereich"]:visible').first().click();
  await p.waitForURL('**/papierkorb-bereich.html**'); await p.waitForTimeout(1000);
  ok('Papierkorb zeigt Firma und Kategorie', (await p.$$('#inhalt .pk-zeile')).length === 2);
  ok('beide Abschnitte benannt', (await p.textContent('#inhalt')).includes('Firmen')
      && (await p.textContent('#inhalt')).includes('BKP-Kategorien'));
  ok('Kategorie mit Bezeichnung', (await p.textContent('#inhalt')).includes('285 Maler'));
  ok('Löscher steht dabei', (await p.textContent('#inhalt')).includes('Jonas Zemp'));
  ok('kein endgültiges Löschen', (await p.locator('text=endgültig').count()) === 0);
  await p.click('#inhalt button[data-id]'); await p.waitForTimeout(1500);
  await p.click('#inhalt button[data-id]'); await p.waitForTimeout(1500);
  ok('Papierkorb wieder leer', (await p.textContent('#inhalt')).includes('Papierkorb ist leer'));

  await p.goto('http://127.0.0.1:8123/firmenpool.html', { waitUntil:'networkidle' });
  await p.waitForTimeout(1000);
  ok('Firma ist zurück', (await p.$$('#gruppen [data-firma]')).length === 4);
  ok('Kategorie ist zurück', (await p.$$(breite>=1024 ? '#kat-desktop .fp-kat' : '#kat-chips .fp-chip[data-code]')).length === 5);
  ok('Ampel von Steiger ist grün', (await p.$$('#gruppen .punkt.gruen')).length === 1);

  // --- Import mit Spaltenzuordnung ----------------------------------------
  if (breite >= 1024) await p.click('#w-import');
  else { await p.click('#m-mehr'); await p.waitForTimeout(400); await p.click('#s-import'); }
  await p.setInputFiles('#import-datei', `${HIER}/import-test.csv`);
  await p.waitForTimeout(1200);
  ok('Zuordnung nennt die Zeilen', (await p.locator('.sheet').last().textContent()).includes('2 Zeilen'));
  ok('Namensspalte vorgeschlagen', (await p.inputValue('#im-name')) === '0');
  ok('Adressspalte vorgeschlagen', (await p.inputValue('#im-adresse')) === '1');
  ok('BKP-Spalte vorgeschlagen', (await p.inputValue('#im-bkp_codes')) === '5');
  ok('neue Kategorien standardmässig an', await p.isChecked('#im-neue-kat'));
  await p.click('#im-los'); await p.waitForTimeout(1800);
  const bericht = await p.locator('.sheet').last().textContent();
  ok('Bericht: eine Firma angelegt', /Neu angelegt\s*1/.test(bericht));
  ok('Bericht: eine Dublette übersprungen', /schon vorhanden\s*1/.test(bericht));
  ok('Bericht: eine neue Kategorie', /Neue BKP-Kategorien\s*1/.test(bericht));
  await p.click('#b-ok'); await p.waitForTimeout(600);
  ok('fünf Firmen nach dem Import', (await p.$$('#gruppen [data-firma]')).length === 5);
  ok('Kategorie 250 ist da',
     (await p.$$eval(breite>=1024 ? '#kat-desktop .fp-kat' : '#kat-chips .fp-chip[data-code]',
       e => e.map(x => x.dataset.code))).includes('250'));
  await p.screenshot({ path:`${OUT}/${name}-nach-import.png`, fullPage:true });

  await ctx.close();
}

await lauf('handy', 390);
await lauf('desktop', 1440);
await browser.close();
console.log(`\n=== ${gut} von ${gut+schlecht} Prüfungen bestanden ===`);
console.log('=== Fehler im Browser ===');
console.log(fehler.length ? fehler.join('\n') : 'keine');
