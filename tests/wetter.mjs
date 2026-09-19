/* Live-Wetter-Abfrage im Baujournal.

   Zwei Teile. Zuerst die Zuordnung für sich: welcher WMO-Schlüssel und
   welche Gradzahl auf welchen Chip führen — das ist reine Rechnung und
   lässt sich ohne Browserdrumherum durchgehen. Danach der Knopf im
   Formular, und zwar vor allem in den Fällen, in denen er nichts
   liefert: verweigerter Standort, stummes Gerät, kaputter Dienst,
   offline. Der Eintrag darf in keinem davon hängen bleiben.

   Der Wetterdienst wird abgefangen und nicht angerufen. Erstens ist er
   aus diesem Container nicht erreichbar, zweitens soll eine Suite nicht
   davon abhängen, wie das Wetter über Sarnen gerade ist. */

import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import fs from 'node:fs';

const HIER = '/tmp/claude-0/-home-user-baujournal-triga/ad655f9d-451a-55b0-aac9-986e124c8f6f/scratchpad';
const OUT = `${HIER}/shots-wetter`;
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
const STUB = fs.readFileSync(`${HIER}/stub.js`, 'utf8');
const SAAT = JSON.parse(fs.readFileSync(`${HIER}/saat.json`, 'utf8'));

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const fehler = [];
let gut = 0, schlecht = 0;
const ok = (n, b, zusatz = '') => {
  b ? gut++ : schlecht++;
  console.log(`  ${b ? '✓' : '✗ FEHLER'}  ${n}${zusatz ? '  → ' + zusatz : ''}`);
};

/* Ein Projekt mit Baujournal, mehr braucht es hier nicht. Die Saat der
   anderen Suiten hat keines, also wird eines danebengelegt. */
const PROJEKT = {
  id: 'pw', name: 'Garten Mille Fiori', standort: 'Sarnen',
  bauherrschaft: 'StImmobilia GmbH', status: 'laufend', archiviert: false,
  kontrollpunkte: ['Gerüste (Zustand, Verankerung)', 'Absturzsicherungen'],
  gebaeude: []
};

async function baueKontext({ breite = 390, ortErlaubt = true } = {}) {
  const ctx = await browser.newContext({
    viewport: { width: breite, height: breite >= 1024 ? 900 : 844 },
    locale: 'de-CH', serviceWorkers: 'block',
    /* Die Freigabe des Standorts wird hier gesetzt statt angeklickt:
       einen Berechtigungsdialog des Betriebssystems kann kein Test
       bedienen, und genau das ist auf dem iPhone der Fall. Erteilt oder
       verweigert ist beides Zustand, und beides wird durchgespielt. */
    permissions: ortErlaubt ? ['geolocation'] : [],
    geolocation: ortErlaubt ? { latitude: 46.8959, longitude: 8.2456 } : undefined
  });
  await ctx.route('**/vendor/supabase-js-2.58.0.js', r =>
    r.fulfill({ status: 200, contentType: 'application/javascript', body: STUB }));
  await ctx.addInitScript(saat => {
    try { localStorage.setItem('bj_push_gefragt', '1'); } catch {}
    if (!sessionStorage.getItem('__stub_db')) sessionStorage.setItem('__stub_db', JSON.stringify(saat));
  }, { ...SAAT, projekte: [...(SAAT.projekte || []), PROJEKT] });
  return ctx;
}

async function anmelden(ctx) {
  const p = await ctx.newPage();
  /* Die absichtlich kaputten Antworten des Wetterdienstes meldet der
     Browser als Ladefehler. Genau das wird hier ja geprüft — sie sind
     kein Befund. */
  const erwartet = t => /503|ERR_FAILED|ERR_INTERNET_DISCONNECTED|Failed to load resource/.test(t);
  p.on('console', m => { if (m.type() === 'error' && !erwartet(m.text())) fehler.push(m.text()); });
  p.on('pageerror', e => { if (!erwartet(e.message)) fehler.push(e.message); });
  await p.goto('http://127.0.0.1:8123/index.html', { waitUntil: 'networkidle' });
  await p.fill('#email', 'test.durchlauf@triga.ch');
  await p.fill('#pw', 'TestDurchlauf!2026');
  await p.click('#btn');
  await p.waitForURL('**/start.html', { timeout: 20000 });
  return p;
}

const journal = async p => {
  await p.goto('http://127.0.0.1:8123/journal.html?projekt=pw', { waitUntil: 'networkidle' });
  await p.waitForSelector('#wetter .chip', { timeout: 15000 });
  await p.waitForTimeout(400);
};

/* Die Antwort im Format von /api/wetter. Die Function dahinter holt sie
   bei MeteoSchweiz; hier wird sie gestellt, damit die Suite nicht davon
   abhaengt, wie das Wetter ueber Sarnen gerade ist — und weil der
   Container ohnehin nicht ins Netz darf.

   Der Zeitpunkt liegt bewusst am hellen Mittag: die Ableitung der Lage
   aus der Sonnenscheindauer gilt nur bei Tageslicht, und ein Testlauf um
   zwei Uhr nachts soll nicht an der Uhr scheitern. */
const MITTAG = () => {
  const d = new Date();
  d.setUTCHours(11, 30, 0, 0);
  return d.toISOString();
};

const antwort = ({ sonne = 0, regen = 0, boe = 5, grad = 12, wann = null,
                   station = 'Giswil', km = 6.2, hoehe = 471 } = {}) => ({
  quelle: 'MeteoSchweiz',
  station: { kennung: station.toLowerCase().slice(0, 3), name: station,
             hoehe_m: hoehe, abstand_km: km },
  gemessen_am: wann || MITTAG(),
  grad,
  boe_kmh: boe,
  wind_kmh: Math.round(boe * 0.55 * 10) / 10,
  regen_mm: regen,
  sonne_min: sonne,
  feuchte_prozent: 62,
  strahlung_wm2: sonne * 60,
  roh: { tre200s0: grad, fkl010z1: Math.round(boe / 3.6 * 10) / 10,
         rre150z0: regen, sre000z0: sonne, ure200s0: 62 }
});

/* Der Wert und nicht der Text: vor der Wetterlage steht im Chip noch
   ihr Zeichen, "☁Bewölkt" statt "Bewölkt". */
const gewaehlt = async (p, wo) => {
  const b = await p.$(`${wo} .chip[aria-pressed="true"]`);
  return b ? await b.getAttribute('data-wert') : null;
};

/* ===== 1. Die Zuordnung für sich ========================================= */

/* MeteoSchweiz misst, es beurteilt nicht: einen Wetterschlüssel gibt es
   dort nicht. Die Lage wird deshalb aus Böe, Niederschlag und
   Sonnenscheindauer abgeleitet — und nur, wo die Messwerte sie wirklich
   hergeben. Genau das wird hier durchgerechnet, ohne Netz und ohne
   Formular. */

console.log('\n=== Zuordnung: Messwerte auf Chips ===');
{
  const ctx = await baueKontext();
  const p = await anmelden(ctx);
  await journal(p);

  const L = (o) => p.evaluate(x => WETTER_JETZT.lageAus(x), { tag: true, ...o });

  ok('Sonnenschein fast durchgehend ist sonnig',
     await L({ sonne_min: 10, grad: 18 }) === 'Sonnig');
  ok('Sieben von zehn Minuten reichen dafür',
     await L({ sonne_min: 7, grad: 18 }) === 'Sonnig');
  ok('Knapp darunter wird es wechselhaft',
     await L({ sonne_min: 6.9, grad: 18 }) === 'Wechselhaft');
  ok('Zwei Minuten sind noch wechselhaft',
     await L({ sonne_min: 2, grad: 18 }) === 'Wechselhaft');
  ok('Darunter heisst es bewölkt',
     await L({ sonne_min: 1.9, grad: 18 }) === 'Bewölkt');
  ok('Gar keine Sonne ebenso',
     await L({ sonne_min: 0, grad: 18 }) === 'Bewölkt');

  ok('Niederschlag bei fünf Grad ist Regen',
     await L({ sonne_min: 0, regen_mm: 0.2, grad: 5 }) === 'Regen');
  ok('Bei einem Grad ist es Schnee',
     await L({ sonne_min: 0, regen_mm: 0.2, grad: 1 }) === 'Schnee');
  ok('Knapp darüber wieder Regen',
     await L({ sonne_min: 0, regen_mm: 0.2, grad: 1.1 }) === 'Regen');
  ok('Niederschlag schlägt die Sonnenscheindauer',
     await L({ sonne_min: 9, regen_mm: 0.4, grad: 12 }) === 'Regen');

  ok('Eine Böe ab 60 km/h heisst Sturm/Wind, auch bei blauem Himmel',
     await L({ sonne_min: 10, boe_kmh: 60, grad: 18 }) === 'Sturm/Wind');
  ok('Sie schlägt auch den Regen',
     await L({ sonne_min: 0, regen_mm: 2, boe_kmh: 72, grad: 8 }) === 'Sturm/Wind');
  ok('Knapp darunter übersteuert sie nicht',
     await L({ sonne_min: 10, boe_kmh: 59.9, grad: 18 }) === 'Sonnig');
  ok('Und der frühere Wert am Mittelwind tut es erst recht nicht',
     await L({ sonne_min: 10, boe_kmh: 40, grad: 18 }) === 'Sonnig');

  ok('Nachts sagt die Sonnenscheindauer nichts, also wird nichts gesetzt',
     await p.evaluate(() => WETTER_JETZT.lageAus({ sonne_min: 0, grad: 3, tag: false })) === null);
  ok('Niederschlag gilt nachts trotzdem',
     await p.evaluate(() => WETTER_JETZT.lageAus({ sonne_min: 0, regen_mm: 1, grad: 3, tag: false })) === 'Regen');
  ok('Eine Böe nachts auch',
     await p.evaluate(() => WETTER_JETZT.lageAus({ boe_kmh: 80, grad: 3, tag: false })) === 'Sturm/Wind');

  ok('Ohne Sonnenwert kommt nichts heraus',
     await L({ sonne_min: null, grad: 18 }) === null);
  ok('Ein leerer Aufruf ebenso',
     await p.evaluate(() => WETTER_JETZT.lageAus()) === null);

  /* Der Kern der Sache: was die Messwerte nicht belegen, wird nicht
     behauptet. Nebel und Gewitter setzt die App nie von selbst. */
  const nie = await p.evaluate(() => {
    const faelle = [];
    for (const sonne of [0, 1, 3, 5, 8, 10]) {
      for (const regen of [0, 0.1, 1, 5]) {
        for (const boe of [0, 20, 59, 60, 90]) {
          for (const grad of [-10, -1, 0, 1, 5, 15, 25, 35]) {
            for (const tag of [true, false]) {
              faelle.push(WETTER_JETZT.lageAus({ sonne_min: sonne, regen_mm: regen,
                                                 boe_kmh: boe, grad, tag }));
            }
          }
        }
      }
    }
    return { gesamt: faelle.length,
             nebel: faelle.filter(x => x === 'Nebel').length,
             gewitter: faelle.filter(x => x === 'Gewitter').length };
  });
  ok(`Über ${nie.gesamt} Messwert-Kombinationen kommt nie Nebel heraus`,
     nie.nebel === 0, String(nie.nebel));
  ok('Und nie ein Gewitter — dafür gibt es keinen Messwert',
     nie.gewitter === 0, String(nie.gewitter));

  const stufen = await p.evaluate(() => [-12, -0.1, 0, 4, 10, 10.1, 20, 25, 30, 30.1, 41, NaN, null]
    .map(t => WETTER_JETZT.stufeAus(t)));
  ok('Unter null ist "< 0°C"', stufen[0] === '< 0°C' && stufen[1] === '< 0°C', JSON.stringify(stufen));
  ok('Null bis zehn gehört in "0–10°C"',
     stufen[2] === '0–10°C' && stufen[3] === '0–10°C' && stufen[4] === '0–10°C');
  ok('Knapp über zehn springt auf "10–20°C"',
     stufen[5] === '10–20°C' && stufen[6] === '10–20°C');
  ok('Fünfundzwanzig und dreissig sind "20–30°C"',
     stufen[7] === '20–30°C' && stufen[8] === '20–30°C');
  ok('Erst über dreissig kommt "> 30°C"',
     stufen[9] === '> 30°C' && stufen[10] === '> 30°C');
  ok('Ohne Zahl kommt nichts heraus', stufen[11] === null && stufen[12] === null);

  ok('Jede abgeleitete Lage steht wirklich als Chip da', await p.evaluate(() => {
    const da = [...document.querySelectorAll('#wetter .chip')].map(c => c.dataset.wert);
    const raus = new Set();
    for (const sonne of [0, 3, 8, 10]) {
      for (const regen of [0, 1]) {
        for (const boe of [0, 70]) {
          for (const grad of [-5, 0, 10, 25]) {
            const l = WETTER_JETZT.lageAus({ sonne_min: sonne, regen_mm: regen, boe_kmh: boe, grad, tag: true });
            if (l) raus.add(l);
          }
        }
      }
    }
    return [...raus].every(l => da.includes(l));
  }));
  ok('Und alle Stufen ebenso', await p.evaluate(() => {
    const da = [...document.querySelectorAll('#temperatur .chip')].map(c => c.dataset.wert);
    return [-20, -1, 0, 5, 10, 15, 20, 25, 30, 35].every(t => da.includes(WETTER_JETZT.stufeAus(t)));
  }));

  /* --- Der Sonnenstand ---------------------------------------------------
     Nachts ist die Sonnenscheindauer immer null. Daraus "bedeckt" zu
     machen waere falsch, also rechnet die App den Sonnenstand aus. Gegen
     die Lehrbuchwerte fuer Sarnen geprueft. */
  const LAT = 46.896, LON = 8.246;
  const hoechst = await p.evaluate(([lat, lon]) => {
    const messen = (monat, tag) => {
      let beste = -99;
      for (let m = 0; m < 1440; m++) {
        const d = new Date(Date.UTC(2026, monat - 1, tag, 0, m));
        beste = Math.max(beste, WETTER_JETZT.sonnenhoehe(d, lat, lon));
      }
      return Math.round(beste * 10) / 10;
    };
    return { sommer: messen(6, 21), winter: messen(12, 21), fruehling: messen(3, 20) };
  }, [LAT, LON]);

  ok('Sonnenhöchststand zur Sommersonnenwende trifft das Lehrbuch',
     Math.abs(hoechst.sommer - (90 - LAT + 23.44)) < 1, `${hoechst.sommer}°`);
  ok('Zur Wintersonnenwende ebenso',
     Math.abs(hoechst.winter - (90 - LAT - 23.44)) < 1, `${hoechst.winter}°`);
  ok('Und zur Tagundnachtgleiche',
     Math.abs(hoechst.fruehling - (90 - LAT)) < 1.5, `${hoechst.fruehling}°`);

  const tagnacht = await p.evaluate(([lat, lon]) => ({
    mittagSommer: WETTER_JETZT.istTag('2026-06-21T11:30:00Z', lat, lon),
    mitternacht:  WETTER_JETZT.istTag('2026-06-21T22:00:00Z', lat, lon),
    winterabend:  WETTER_JETZT.istTag('2026-12-21T16:30:00Z', lat, lon),
    wintermittag: WETTER_JETZT.istTag('2026-12-21T11:00:00Z', lat, lon)
  }), [LAT, LON]);
  ok('Mittags ist Tag, mitternachts nicht',
     tagnacht.mittagSommer === true && tagnacht.mitternacht === false);
  ok('Der Dezemberabend um halb sechs gilt als Nacht',
     tagnacht.winterabend === false);
  ok('Der Dezembermittag als Tag', tagnacht.wintermittag === true);

  await ctx.close();
}

/* ===== 2. Der Knopf, wenn alles klappt =================================== */

for (const breite of [390, 1024, 1440]) {
  console.log(`\n=== Abruf mit freigegebenem Standort (${breite}px) ===`);
  const ctx = await baueKontext({ breite });

  let gefragt = null;
  await ctx.route('**/api/wetter*', async r => {
    gefragt = r.request().url();
    await r.fulfill({ status: 200, contentType: 'application/json',
                      body: JSON.stringify(antwort({ sonne: 0, grad: 12.4 })) });
  });

  const p = await anmelden(ctx);
  await journal(p);

  ok('Der Knopf steht in der Wetter-Karte', await p.locator('#wetter-jetzt').isVisible());
  ok('Und heisst, was er tut',
     (await p.textContent('#wetter-jetzt')).includes('Wetter jetzt abrufen'));
  ok('Vorher ist nichts ausgewählt',
     await gewaehlt(p, '#wetter') === null && await gewaehlt(p, '#temperatur') === null);
  ok('Und keine Hinweiszeile da', await p.locator('#wetter-hinweis').isVisible() === false);

  await p.click('#wetter-jetzt');
  await p.waitForSelector('#wetter-hinweis:not([hidden])', { timeout: 15000 });
  await p.waitForTimeout(300);

  ok('Die Wetterlage steht automatisch da', await gewaehlt(p, '#wetter') === 'Bewölkt',
     await gewaehlt(p, '#wetter'));
  ok('Der Temperaturbereich ebenso', await gewaehlt(p, '#temperatur') === '10–20°C',
     await gewaehlt(p, '#temperatur'));
  const zeile = await p.textContent('#wetter-hinweis');
  ok('Die Zeile darunter nennt beides und die genaue Gradzahl',
     zeile.includes('Bewölkt') && zeile.includes('10–20°C') && zeile.includes('12,4°C'), zeile);
  ok('Sie sagt nicht "gemessen", sondern automatisch abgefragt',
     zeile.includes('automatisch abgefragt') && !zeile.includes('gemessen'), zeile);
  ok('Und nennt den Dienst, der geantwortet hat',
     zeile.includes('MeteoSchweiz'), zeile);
  ok('Und die Station samt Abstand, damit niemand die Baustelle meint',
     zeile.includes('Giswil, 6,2 km'), zeile);
  ok('Und sagt, dass sich das ändern lässt', zeile.includes('ändert die Auswahl'), zeile);
  ok('Die Zeile ist kein Fehler',
     !(await p.$eval('#wetter-hinweis', e => e.classList.contains('warn'))));
  ok('Der Knopf ist wieder bedienbar',
     await p.locator('#wetter-jetzt').isEnabled()
     && (await p.textContent('#wetter-jetzt')).includes('Wetter jetzt abrufen'));

  ok('Abgefragt wird die eigene Function, ohne Schlüssel im Aufruf',
     /\/api\/wetter\?/.test(gefragt || '') && !/key|token|appid/i.test(gefragt || ''), gefragt);
  ok('Der Standort geht auf drei Nachkommastellen gerundet hinaus',
     /lat=46\.896&lon=8\.246$/.test(gefragt || ''), gefragt);
  ok('Und sonst nichts — die Stationssuche liegt hinter der Function',
     (gefragt || '').split('?')[1] === 'lat=46.896&lon=8.246', gefragt);

  await p.screenshot({ path: `${OUT}/${breite}-gesetzt.png`, fullPage: true });

  /* --- Die Auswahl bleibt eine Auswahl ---------------------------------- */

  await p.click('#wetter .chip[data-wert="Regen"]');
  await p.waitForTimeout(300);
  ok('Ein Tipp überschreibt die gesetzte Lage', await gewaehlt(p, '#wetter') === 'Regen',
     await gewaehlt(p, '#wetter'));
  ok('Der Vermerk der Abfrage verschwindet dabei',
     await p.locator('#wetter-hinweis').isVisible() === false);
  ok('Die Temperatur bleibt stehen, bis jemand sie anfasst',
     await gewaehlt(p, '#temperatur') === '10–20°C');

  await p.click('#temperatur .chip[data-wert="> 30°C"]');
  await p.waitForTimeout(300);
  ok('Auch der Bereich lässt sich überschreiben',
     await gewaehlt(p, '#temperatur') === '> 30°C', await gewaehlt(p, '#temperatur'));

  await p.click('#temperatur .chip[data-wert="> 30°C"]');
  await p.waitForTimeout(300);
  ok('Und nochmals tippen hebt ihn auf, wie bei jedem Chip',
     await gewaehlt(p, '#temperatur') === null);

  /* Ein zweiter Abruf setzt wieder, was der Dienst sagt. */
  await ctx.unroute('**/api/wetter*');
  await ctx.route('**/api/wetter*', r =>
    r.fulfill({ status: 200, contentType: 'application/json',
                body: JSON.stringify(antwort({ regen: 0.6, grad: -3.2 })) }));
  await p.click('#wetter-jetzt');
  await p.waitForSelector('#wetter-hinweis:not([hidden])', { timeout: 15000 });
  await p.waitForTimeout(300);
  ok('Ein zweiter Abruf setzt neu', await gewaehlt(p, '#wetter') === 'Schnee'
     && await gewaehlt(p, '#temperatur') === '< 0°C',
     `${await gewaehlt(p, '#wetter')} / ${await gewaehlt(p, '#temperatur')}`);

  /* --- Und der Eintrag lässt sich speichern ----------------------------- */

  await p.fill('#f-fortschritt', 'Decke über EG betoniert');
  await p.click('#speichern');
  await p.waitForURL('**/projekt-start.html**', { timeout: 20000 });
  const gespeichert = await p.evaluate(() =>
    JSON.parse(sessionStorage.getItem('__stub_db')).eintraege.find(e => e.projekt_id === 'pw'));
  ok('Das abgerufene Wetter landet im Eintrag',
     gespeichert?.wetter === 'Schnee' && gespeichert?.temperatur === '< 0°C',
     JSON.stringify({ w: gespeichert?.wetter, t: gespeichert?.temperatur }));

  /* Und der Messwert dazu. Ohne ihn liesse sich spaeter nicht mehr
     sagen, ob "< 0°C" abgefragt oder geschaetzt wurde. */
  ok('Die gelieferte Gradzahl steht am Eintrag, nicht nur der Bereich',
     gespeichert?.wetter_grad === -3.2, String(gespeichert?.wetter_grad));
  /* Der Zeitpunkt ist der der Messung und nicht der der Uhr dieses
     Geraets: massgebend ist, wann MeteoSchweiz gemessen hat. */
  ok('Mit dem Zeitpunkt der Messung, nicht dem des Geraets',
     gespeichert?.wetter_gemessen_am === (await p.evaluate(() => {
       const d = new Date(); d.setUTCHours(11, 30, 0, 0); return d.toISOString();
     })), String(gespeichert?.wetter_gemessen_am));
  ok('Und mit den Rohwerten, aus denen die Lage entstanden ist',
     gespeichert?.wetter_rohwerte?.station?.name === 'Giswil'
     && gespeichert.wetter_rohwerte.regen_mm === 0.6
     && typeof gespeichert.wetter_rohwerte.sonne_am_himmel === 'boolean',
     JSON.stringify(gespeichert?.wetter_rohwerte?.station));
  ok('Und mit dem Namen des Dienstes als eigener Wert',
     gespeichert?.wetter_quelle === 'MeteoSchweiz', String(gespeichert?.wetter_quelle));

  /* Der eigentliche Punkt: nach dem Speichern wieder oeffnen. */
  await p.goto(`http://127.0.0.1:8123/eintrag.html?id=${gespeichert.id}`, { waitUntil: 'networkidle' });
  await p.waitForSelector('.karte', { timeout: 15000 });
  await p.waitForTimeout(600);

  const mess = p.locator('.karte', { hasText: 'Wetter' }).locator('.wt-hinweis');
  ok('Beim Wiederoeffnen steht die Abruf-Zeile wieder da', await mess.count() === 1);
  const text = await mess.first().textContent();
  ok('Mit Uhrzeit, Quelle, beiden Stufen und der genauen Gradzahl',
     /^Um \d{2}:\d{2} Uhr automatisch abgefragt \(MeteoSchweiz · Giswil, 6,2 km\): Schnee · < 0°C \(-3,2°C\)\.$/
       .test(text.trim()), text);
  ok('Die Chips stehen weiterhin daneben',
     await p.locator('.karte', { hasText: 'Wetter' }).locator('.chip[aria-pressed="true"]').count() === 2);
  await p.screenshot({ path: `${OUT}/${breite}-detail-gemessen.png`, fullPage: true });

  /* Im Export steht er ebenfalls: ein Journal, das im Streitfall zaehlt,
     verliert seinen Messwert nicht beim Ausdrucken. */
  const zeilen = await p.evaluate(() => {
    const e = JSON.parse(sessionStorage.getItem('__stub_db')).eintraege.find(x => x.projekt_id === 'pw');
    return typeof hatWetterAbruf === 'function' && hatWetterAbruf(e)
      ? wetterAbrufKurz(e.wetter_grad, e.wetter_gemessen_am, e.wetter_quelle, e.wetter_rohwerte) : null;
  });
  ok('Der Kurztext fuer den Export nennt Uhrzeit, Quelle und Grad',
     !!zeilen && /^MeteoSchweiz · Giswil, 6,2 km · um \d{2}:\d{2} Uhr abgefragt · -3,2°C$/.test(zeilen),
     String(zeilen));

  await ctx.close();
}

/* ===== 2b. Der Messwert haelt, und nur wo er hingehoert ================== */

/* Der Kern der Sache: nach dem Speichern muss noch erkennbar sein, ob
   eine Angabe abgefragt oder angetippt wurde, und bei wem. Vier Faelle
   nebeneinander — abgefragt, von Hand, abgefragt dann ueberschrieben,
   und ein alter Eintrag ohne die Spalten. */

console.log('\n=== Messwert ueberlebt das Speichern ===');
{
  const ctx = await baueKontext({ breite: 1440 });
  await ctx.route('**/api/wetter*', r =>
    r.fulfill({ status: 200, contentType: 'application/json',
                body: JSON.stringify(antwort({ sonne: 9, grad: 17.2 })) }));

  const p = await anmelden(ctx);

  /* --- a) Mit Abruf ----------------------------------------------------- */
  await journal(p);
  await p.click('#wetter-jetzt');
  await p.waitForSelector('#wetter-hinweis:not([hidden])', { timeout: 15000 });
  await p.waitForTimeout(300);
  const imFormular = (await p.textContent('#wetter-hinweis')).trim();
  ok('Im Formular steht die Abruf-Zeile in der neuen Fassung',
     /^Um \d{2}:\d{2} Uhr automatisch abgefragt \(MeteoSchweiz · Giswil, 6,2 km\): Sonnig · 10–20°C \(17,2°C\)\./
       .test(imFormular), imFormular);

  await p.fill('#f-fortschritt', 'Mit Abruf erfasst');
  await p.click('#speichern');
  await p.waitForURL('**/projekt-start.html**', { timeout: 20000 });

  const mitMessung = await p.evaluate(() => JSON.parse(sessionStorage.getItem('__stub_db'))
    .eintraege.find(e => e.fortschritt === 'Mit Abruf erfasst'));
  ok('Gradzahl, Zeitpunkt und Quelle liegen in der Datenbank',
     mitMessung?.wetter_grad === 17.2 && !!mitMessung?.wetter_gemessen_am
     && mitMessung?.wetter_quelle === 'MeteoSchweiz',
     JSON.stringify({ g: mitMessung?.wetter_grad, z: mitMessung?.wetter_gemessen_am, q: mitMessung?.wetter_quelle }));
  ok('Die Quelle steht als eigener Wert und nicht nur im Text',
     Object.keys(mitMessung).includes('wetter_quelle'));

  await p.goto(`http://127.0.0.1:8123/eintrag.html?id=${mitMessung.id}`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(700);
  const imDetail = (await p.locator('.wt-hinweis').first().textContent()).trim();
  ok('Beim Wiederoeffnen steht dieselbe Zeile wie beim Erfassen',
     imDetail === imFormular.replace(' Ein Tipp auf einen Chip ändert die Auswahl.', ''),
     `${imDetail}  ≠  ${imFormular}`);
  ok('Sie nennt die genaue Temperatur und nicht nur den Bereich',
     imDetail.includes('17,2°C'), imDetail);
  ok('Und die Uhrzeit der Abfrage samt Dienst',
     /Um \d{2}:\d{2} Uhr automatisch abgefragt \(MeteoSchweiz · Giswil, 6,2 km\)/.test(imDetail), imDetail);
  ok('Nirgends steht mehr "gemessen"', !imDetail.includes('gemessen'), imDetail);

  /* --- b) Von Hand gewaehlt --------------------------------------------- */
  await journal(p);
  await p.click('#wetter .chip[data-wert="Nebel"]');
  await p.click('#temperatur .chip[data-wert="0–10°C"]');
  await p.fill('#f-fortschritt', 'Von Hand erfasst');
  await p.click('#speichern');
  await p.waitForURL('**/projekt-start.html**', { timeout: 20000 });

  const vonHand = await p.evaluate(() => JSON.parse(sessionStorage.getItem('__stub_db'))
    .eintraege.find(e => e.fortschritt === 'Von Hand erfasst'));
  ok('Ohne Abruf bleiben beide Spalten leer',
     (vonHand?.wetter_grad ?? null) === null && (vonHand?.wetter_gemessen_am ?? null) === null
     && (vonHand?.wetter_quelle ?? null) === null,
     JSON.stringify({ g: vonHand?.wetter_grad, z: vonHand?.wetter_gemessen_am, q: vonHand?.wetter_quelle }));

  await p.goto(`http://127.0.0.1:8123/eintrag.html?id=${vonHand.id}`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(700);
  ok('Und die Detailseite zeigt keine Abruf-Zeile',
     await p.locator('.wt-hinweis').count() === 0);
  ok('Die Chips stehen trotzdem da',
     await p.locator('.karte', { hasText: 'Wetter' }).locator('.chip[aria-pressed="true"]').count() === 2);

  /* --- c) Abruf, danach von Hand ueberschrieben ------------------------- */
  await journal(p);
  await p.click('#wetter-jetzt');
  await p.waitForSelector('#wetter-hinweis:not([hidden])', { timeout: 15000 });
  await p.waitForTimeout(300);
  await p.click('#wetter .chip[data-wert="Regen"]');
  await p.waitForTimeout(400);
  ok('Ein Tipp auf einen Chip laesst die Zeile verschwinden',
     await p.locator('#wetter-hinweis').isVisible() === false);
  await p.fill('#f-fortschritt', 'Abruf dann von Hand');
  await p.click('#speichern');
  await p.waitForURL('**/projekt-start.html**', { timeout: 20000 });

  const gemischt = await p.evaluate(() => JSON.parse(sessionStorage.getItem('__stub_db'))
    .eintraege.find(e => e.fortschritt === 'Abruf dann von Hand'));
  ok('Wer von Hand nachbessert, speichert keinen Abruf mehr',
     (gemischt?.wetter_grad ?? null) === null && (gemischt?.wetter_gemessen_am ?? null) === null
     && (gemischt?.wetter_quelle ?? null) === null && gemischt?.wetter === 'Regen',
     JSON.stringify({ w: gemischt?.wetter, g: gemischt?.wetter_grad, q: gemischt?.wetter_quelle }));

  /* --- d) Ein alter Eintrag ohne die Spalten ---------------------------- */
  const alt = await p.evaluate(() => {
    const d = JSON.parse(sessionStorage.getItem('__stub_db'));
    const e = {
      id: crypto.randomUUID(), projekt_id: 'pw', datum: '2026-03-04',
      ersteller_id: 'u1', wetter: 'Bewölkt', temperatur: '10–20°C',
      kontrolle: { punkte: [] }, fotos_hinweis: false,
      fortschritt: 'Alter Eintrag von damals',
      erstellt_am: '2026-03-04T09:00:00.000Z'
    };
    d.eintraege.push(e);
    sessionStorage.setItem('__stub_db', JSON.stringify(d));
    return e.id;
  });
  await p.goto(`http://127.0.0.1:8123/eintrag.html?id=${alt}`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(700);
  ok('Ein Eintrag von frueher zeigt nur die Chips, nichts wird nachgeruestet',
     await p.locator('.wt-hinweis').count() === 0
     && await p.locator('.karte', { hasText: 'Wetter' }).locator('.chip[aria-pressed="true"]').count() === 2);

  await ctx.close();
}

console.log('\n=== Korrektur hebt die Abfrage auf ===');
{
  const ctx = await baueKontext({ breite: 1440 });
  await ctx.route('**/api/wetter*', r =>
    r.fulfill({ status: 200, contentType: 'application/json',
                body: JSON.stringify(antwort({ sonne: 9, grad: 21.4 })) }));
  const p = await anmelden(ctx);

  await journal(p);
  await p.click('#wetter-jetzt');
  await p.waitForSelector('#wetter-hinweis:not([hidden])', { timeout: 15000 });
  await p.waitForTimeout(300);
  await p.fill('#f-fortschritt', 'Wird nachher korrigiert');
  await p.click('#speichern');
  await p.waitForURL('**/projekt-start.html**', { timeout: 20000 });

  const e = await p.evaluate(() => JSON.parse(sessionStorage.getItem('__stub_db'))
    .eintraege.find(x => x.fortschritt === 'Wird nachher korrigiert'));
  await p.goto(`http://127.0.0.1:8123/eintrag.html?id=${e.id}`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(700);
  ok('Vor der Korrektur steht die Abruf-Zeile da', await p.locator('.wt-hinweis').count() === 1);

  await p.click('#stift');
  await p.waitForSelector('#e-wetter .chip', { timeout: 10000 });
  await p.waitForTimeout(300);
  ok('Im Korrekturmodus steht dabei, was eine Aenderung bewirkt',
     (await p.textContent('.wt-hinweis')).includes('hebt die Abfrage auf'),
     await p.textContent('.wt-hinweis'));

  await p.click('#e-wetter .chip[data-wert="Regen"]');
  await p.click('#uebernehmen');
  await p.waitForTimeout(1200);

  const danach = await p.evaluate(id => JSON.parse(sessionStorage.getItem('__stub_db'))
    .eintraege.find(x => x.id === id), e.id);
  ok('Nach der Korrektur ist die Abfrage weg, samt Quelle',
     danach?.wetter === 'Regen'
     && (danach.wetter_grad ?? null) === null && (danach.wetter_gemessen_am ?? null) === null
     && (danach.wetter_quelle ?? null) === null,
     JSON.stringify({ w: danach?.wetter, g: danach?.wetter_grad, q: danach?.wetter_quelle }));
  ok('Und die Zeile verschwindet aus der Ansicht',
     await p.locator('.wt-hinweis').count() === 0);
  ok('Die Korrektur steht trotzdem im Protokoll',
     (await p.textContent('#inhalt')).includes('Regen'));

  await ctx.close();
}

console.log('\n=== Entwurf haelt den Abruf ===');
{
  const ctx = await baueKontext({ breite: 390 });
  await ctx.route('**/api/wetter*', r =>
    r.fulfill({ status: 200, contentType: 'application/json',
                body: JSON.stringify(antwort({ sonne: 0, grad: 8.7 })) }));
  const p = await anmelden(ctx);
  await journal(p);

  await p.click('#wetter-jetzt');
  await p.waitForSelector('#wetter-hinweis:not([hidden])', { timeout: 15000 });
  await p.waitForTimeout(600);
  const vorher = (await p.textContent('#wetter-hinweis')).trim();

  const entwurf = await p.evaluate(() => JSON.parse(localStorage.getItem('bj_entwurf_pw') || 'null'));
  ok('Der Entwurf traegt Wert und Quelle mit',
     entwurf?.wetter_grad === 8.7 && !!entwurf?.wetter_gemessen_am
     && entwurf?.wetter_quelle === 'MeteoSchweiz',
     JSON.stringify({ g: entwurf?.wetter_grad, q: entwurf?.wetter_quelle }));

  // Neu laden, wie nach einem Absturz oder einem Tab-Wechsel.
  await journal(p);
  await p.waitForTimeout(600);
  ok('Nach dem Wiederherstellen steht die Zeile wieder da',
     (await p.textContent('#wetter-hinweis')).trim() === vorher,
     `${await p.textContent('#wetter-hinweis')}  ≠  ${vorher}`);

  await p.fill('#f-fortschritt', 'Nach Wiederherstellung gespeichert');
  await p.click('#speichern');
  await p.waitForURL('**/projekt-start.html**', { timeout: 20000 });
  const e = await p.evaluate(() => JSON.parse(sessionStorage.getItem('__stub_db'))
    .eintraege.find(x => x.fortschritt === 'Nach Wiederherstellung gespeichert'));
  ok('Und Wert wie Quelle gehen mit in den Eintrag',
     e?.wetter_grad === 8.7 && !!e?.wetter_gemessen_am && e?.wetter_quelle === 'MeteoSchweiz',
     JSON.stringify({ g: e?.wetter_grad, q: e?.wetter_quelle }));

  await ctx.close();
}

/* ===== 3. Verweigerter Standort ========================================== */

console.log('\n=== Standort nicht freigegeben ===');
{
  const ctx = await baueKontext({ ortErlaubt: false });
  let angefragt = false;
  await ctx.route('**/api/wetter*', async r => {
    angefragt = true;
    await r.fulfill({ status: 200, contentType: 'application/json',
                      body: JSON.stringify(antwort({ sonne: 9, grad: 22 })) });
  });

  const p = await anmelden(ctx);
  await journal(p);

  await p.click('#wetter-jetzt');
  await p.waitForSelector('#wetter-hinweis:not([hidden])', { timeout: 20000 });
  await p.waitForTimeout(300);

  const zeile = await p.textContent('#wetter-hinweis');
  ok('Die Zeile sagt, dass der Standort fehlt',
     zeile.includes('Standort nicht freigegeben'), zeile);
  ok('Und nennt den Weg von Hand', zeile.includes('von Hand'), zeile);
  ok('Sowie den Weg zurück über die Einstellungen',
     zeile.includes('Einstellungen des Geräts'), zeile);
  ok('Sie ist als Warnung gekennzeichnet',
     await p.$eval('#wetter-hinweis', e => e.classList.contains('warn')));
  ok('Der Wetterdienst wird gar nicht erst angerufen', angefragt === false);
  ok('Es ist nichts ausgewählt',
     await gewaehlt(p, '#wetter') === null && await gewaehlt(p, '#temperatur') === null);
  ok('Der Knopf steht wieder bereit', await p.locator('#wetter-jetzt').isEnabled());
  await p.screenshot({ path: `${OUT}/verweigert.png`, fullPage: true });

  /* Der wichtigste Teil: von Hand geht weiter wie eh und je. */
  await p.click('#wetter .chip[data-wert="Sonnig"]');
  await p.click('#temperatur .chip[data-wert="20–30°C"]');
  await p.fill('#f-fortschritt', 'Von Hand erfasst');
  await p.click('#speichern');
  await p.waitForURL('**/projekt-start.html**', { timeout: 20000 });
  const e = await p.evaluate(() =>
    JSON.parse(sessionStorage.getItem('__stub_db')).eintraege.find(x => x.projekt_id === 'pw'));
  ok('Der Eintrag lässt sich trotzdem ganz normal speichern',
     e?.wetter === 'Sonnig' && e?.temperatur === '20–30°C' && e?.fortschritt === 'Von Hand erfasst',
     JSON.stringify({ w: e?.wetter, t: e?.temperatur }));

  await ctx.close();
}

/* ===== 4. Offline ======================================================== */

console.log('\n=== Offline ===');
{
  const ctx = await baueKontext();
  let angefragt = false;
  await ctx.route('**/api/wetter*', async r => { angefragt = true; await r.abort(); });

  const p = await anmelden(ctx);
  await journal(p);
  await ctx.setOffline(true);
  await p.waitForTimeout(300);

  await p.click('#wetter-jetzt');
  await p.waitForSelector('#wetter-hinweis:not([hidden])', { timeout: 15000 });
  const zeile = await p.textContent('#wetter-hinweis');
  ok('Offline sagt die Zeile genau das', zeile.includes('Offline'), zeile);
  ok('Und verweist auf die Auswahl von Hand', zeile.includes('von Hand'), zeile);
  ok('Ohne Netz wird weder Standort noch Dienst bemüht', angefragt === false);
  ok('Es ist nichts ausgewählt', await gewaehlt(p, '#wetter') === null);

  /* Erfassen geht ohne Empfang weiter, das ist der Alltag im Rohbau.
     Geprüft wird hier der Entwurf und nicht das Speichern: der Test
     blockt den Service Worker, also käme die Seite nach dem Speichern
     offline gar nicht mehr zurück. Dass ein Eintrag ohne Empfang in die
     Warteschlange geht, steht in der Offline-Suite. */
  await p.click('#wetter .chip[data-wert="Nebel"]');
  await p.click('#temperatur .chip[data-wert="0–10°C"]');
  await p.fill('#f-fortschritt', 'Ohne Empfang erfasst');
  await p.waitForTimeout(500);
  ok('Von Hand wählen geht ohne Empfang unverändert',
     await gewaehlt(p, '#wetter') === 'Nebel' && await gewaehlt(p, '#temperatur') === '0–10°C');
  const entwurf = await p.evaluate(() => JSON.parse(localStorage.getItem('bj_entwurf_pw') || 'null'));
  ok('Und der Entwurf hält die Angaben fest',
     entwurf?.wetter === 'Nebel' && entwurf?.fortschritt === 'Ohne Empfang erfasst',
     JSON.stringify(entwurf && { w: entwurf.wetter, f: entwurf.fortschritt }));

  // Zurück im Netz speichert derselbe Eintrag ganz normal.
  await ctx.setOffline(false);
  await p.waitForTimeout(300);
  await p.click('#speichern');
  await p.waitForURL('**/projekt-start.html**', { timeout: 20000 });
  const e = await p.evaluate(() =>
    JSON.parse(sessionStorage.getItem('__stub_db')).eintraege.find(x => x.projekt_id === 'pw'));
  ok('Nach dem misslungenen Abruf lässt sich der Eintrag speichern',
     e?.wetter === 'Nebel' && e?.fortschritt === 'Ohne Empfang erfasst',
     JSON.stringify({ w: e?.wetter, f: e?.fortschritt }));

  await ctx.close();
}

/* ===== 5. Der Dienst antwortet nicht oder falsch ========================= */

for (const [name, erfuellen] of [
  ['Serverfehler', r => r.fulfill({ status: 503, contentType: 'text/plain', body: 'nope' })],
  ['abgebrochene Verbindung', r => r.abort()],
  ['unbrauchbare Antwort', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"was":"anderes"}' })],
  ['kein Text statt JSON', r => r.fulfill({ status: 200, contentType: 'text/html', body: '<html>Wartung</html>' })]
]) {
  console.log(`\n=== Wetterdienst: ${name} ===`);
  const ctx = await baueKontext();
  await ctx.route('**/api/wetter*', erfuellen);

  const p = await anmelden(ctx);
  await journal(p);
  await p.click('#wetter-jetzt');
  await p.waitForSelector('#wetter-hinweis:not([hidden])', { timeout: 20000 });
  const zeile = await p.textContent('#wetter-hinweis');

  ok('Die Zeile nennt den Dienst und nicht einen Programmfehler',
     zeile.includes('MeteoSchweiz') && zeile.includes('von Hand'), zeile);
  ok('Als Warnung gekennzeichnet',
     await p.$eval('#wetter-hinweis', e => e.classList.contains('warn')));
  ok('Nichts wird auf Verdacht gesetzt',
     await gewaehlt(p, '#wetter') === null && await gewaehlt(p, '#temperatur') === null);
  ok('Der Knopf bleibt bedienbar', await p.locator('#wetter-jetzt').isEnabled());
  ok('Das Formular nimmt weiter Eingaben an', await p.evaluate(async () => {
    document.querySelector('#wetter .chip[data-wert="Regen"]').click();
    return document.querySelector('#wetter .chip[aria-pressed="true"]')?.dataset.wert === 'Regen';
  }));

  await ctx.close();
}

/* ===== 5b. Eine halbe Antwort ============================================ */

/* Eine Station kann einzelne Messwerte nicht liefern — Sonnenschein
   misst nicht jede, und eine Heizung an der Temperaturmessung faellt
   auch einmal aus. Dann wird gesetzt, was da ist, und der Rest bleibt
   fuer die Hand. Eine Zeile mit "NaN°C" waere schlimmer als gar keine
   Zahl. */

console.log('\n=== MeteoSchweiz liefert nur die halbe Antwort ===');
{
  const halb = zusatz => ({
    quelle: 'MeteoSchweiz',
    station: { kennung: 'gis', name: 'Giswil', hoehe_m: 471, abstand_km: 6.2 },
    gemessen_am: MITTAG(),
    ...zusatz
  });

  const ctx = await baueKontext();
  // Niederschlag, aber keine Temperatur von dieser Station.
  await ctx.route('**/api/wetter*', r =>
    r.fulfill({ status: 200, contentType: 'application/json',
                body: JSON.stringify(halb({ regen_mm: 0.5, sonne_min: 0, boe_kmh: 8 })) }));

  const p = await anmelden(ctx);
  await journal(p);
  await p.click('#wetter-jetzt');
  await p.waitForSelector('#wetter-hinweis:not([hidden])', { timeout: 15000 });
  await p.waitForTimeout(300);

  ok('Die Lage wird aus dem Niederschlag gesetzt',
     await gewaehlt(p, '#wetter') === 'Regen', await gewaehlt(p, '#wetter'));
  ok('Die Temperatur bleibt offen', await gewaehlt(p, '#temperatur') === null);
  const zeile = await p.textContent('#wetter-hinweis');
  ok('Und in der Zeile steht kein NaN', !/NaN/.test(zeile), zeile);
  ok('Sie nennt nur, was wirklich kam',
     zeile.includes('Regen') && !zeile.includes('°C)'), zeile);

  /* Ohne Gradzahl gibt es nichts festzuhalten: die Datenbank nimmt eine
     Abfrage nur mit wetter_grad an. Also wird auch keine behauptet —
     kein Dienst, keine Station, kein Zeitpunkt in der Zeile, sondern
     nur die kurze Notiz, was gesetzt wurde. Stuende die Station dort,
     verspraeche die Zeile eine Herkunft, die der gespeicherte Eintrag
     nachher nicht mehr zeigt. */
  ok('Ohne Gradzahl nennt die Zeile weder Dienst noch Station',
     !zeile.includes('Giswil') && !zeile.includes('MeteoSchweiz'), zeile);
  ok('Sie bleibt die kurze Notiz', zeile.includes('Gesetzt:'), zeile);

  /* Umgekehrt: eine Temperatur, aber nichts, woraus sich die Lage
     ableiten liesse. Genau der Fall, fuer den Nebel und Gewitter als
     Chips bereitstehen. */
  await ctx.unroute('**/api/wetter*');
  await ctx.route('**/api/wetter*', r =>
    r.fulfill({ status: 200, contentType: 'application/json',
                body: JSON.stringify(halb({ grad: 24.6 })) }));
  await p.click('#wetter .chip[data-wert="Regen"]');   // Lage wieder freigeben
  await p.click('#wetter-jetzt');
  await p.waitForSelector('#wetter-hinweis:not([hidden])', { timeout: 15000 });
  await p.waitForTimeout(300);
  ok('Umgekehrt genauso: nur der Bereich, die Lage bleibt offen',
     await gewaehlt(p, '#temperatur') === '20–30°C' && await gewaehlt(p, '#wetter') === null,
     `${await gewaehlt(p, '#wetter')} / ${await gewaehlt(p, '#temperatur')}`);
  ok('Und die Gradzahl steht in der Zeile',
     (await p.textContent('#wetter-hinweis')).includes('24,6°C'),
     await p.textContent('#wetter-hinweis'));

  await ctx.close();
}

/* ===== 5c. Ausserhalb des Messnetzes ===================================== */

/* SwissMetNet endet an der Grenze. Wer die App im Ausland aufmacht,
   bekommt keinen erfundenen Wert von einer Station 300 Kilometer weiter,
   sondern einen klaren Satz. */

console.log('\n=== Standort ausserhalb des Messnetzes ===');
{
  const ctx = await baueKontext();
  await ctx.route('**/api/wetter*', r =>
    r.fulfill({ status: 400, contentType: 'application/json',
                body: JSON.stringify({ fehler: 'Für diesen Standort gibt es keine Messstation von MeteoSchweiz.' }) }));

  const p = await anmelden(ctx);
  await journal(p);
  await p.click('#wetter-jetzt');
  await p.waitForSelector('#wetter-hinweis:not([hidden])', { timeout: 15000 });
  const zeile = await p.textContent('#wetter-hinweis');

  ok('Die Zeile sagt, dass es dort keine Station gibt',
     zeile.includes('keine Messstation'), zeile);
  ok('Und klingt nicht nach einem Ausfall',
     !zeile.includes('antwortet gerade nicht'), zeile);
  ok('Nichts wird gesetzt',
     await gewaehlt(p, '#wetter') === null && await gewaehlt(p, '#temperatur') === null);
  ok('Von Hand geht es weiter', await p.evaluate(async () => {
    document.querySelector('#wetter .chip[data-wert="Nebel"]').click();
    return document.querySelector('#wetter .chip[aria-pressed="true"]')?.dataset.wert === 'Nebel';
  }));

  await ctx.close();
}

/* ===== 6. Das Gerät meldet sich gar nicht ================================ */

/* Auf dem iPhone kommt in der zum Startbildschirm hinzugefügten App
   gelegentlich weder Erfolg noch Fehler zurück, und auch das eigene
   timeout der Browserfunktion läuft dann nicht ab. Dagegen steht eine
   eigene Uhr. Hier wird genau dieser Zustand nachgestellt: eine
   Standortabfrage, die nie antwortet. */

console.log('\n=== Standortabfrage bleibt stumm (iOS-Fall) ===');
{
  const ctx = await baueKontext();
  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: { getCurrentPosition() { /* nie */ }, watchPosition() {}, clearWatch() {} }
    });
  });
  const p = await anmelden(ctx);
  await journal(p);

  const start = Date.now();
  await p.click('#wetter-jetzt');
  ok('Der Knopf zeigt, dass er arbeitet',
     (await p.textContent('#wetter-jetzt')).includes('Wird geholt')
     && await p.locator('#wetter-jetzt').isDisabled());

  await p.waitForSelector('#wetter-hinweis:not([hidden])', { timeout: 25000 });
  const dauer = Date.now() - start;
  const zeile = await p.textContent('#wetter-hinweis');
  ok('Die eigene Uhr beendet das Warten', zeile.includes('nicht rechtzeitig'), zeile);
  ok('Und zwar nach spätestens fünfzehn Sekunden', dauer < 18000, `${dauer} ms`);
  ok('Der Knopf ist danach wieder bereit', await p.locator('#wetter-jetzt').isEnabled());
  ok('Nichts ist gesetzt', await gewaehlt(p, '#wetter') === null);

  await ctx.close();
}

/* ===== 7. Ohne Standortfunktion überhaupt ================================ */

console.log('\n=== Geraet ohne Standortfunktion ===');
{
  const ctx = await baueKontext();
  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: undefined });
  });
  const p = await anmelden(ctx);
  await journal(p);
  await p.click('#wetter-jetzt');
  await p.waitForSelector('#wetter-hinweis:not([hidden])', { timeout: 15000 });
  const zeile = await p.textContent('#wetter-hinweis');
  ok('Die Zeile sagt es und bleibt ruhig',
     zeile.includes('keinen Standort') && zeile.includes('von Hand'), zeile);
  ok('Nichts gesetzt, Knopf wieder bereit',
     await gewaehlt(p, '#wetter') === null && await p.locator('#wetter-jetzt').isEnabled());
  await ctx.close();
}

/* ===== 8. Ohne das Modul bleibt alles beim Alten ========================= */

/* Ein Geraet mit einer aelteren Fassung im Cache hat js/wetter.js
   vielleicht noch nicht. Dann soll der Knopf verschwinden statt
   danebenzustehen und nichts zu tun. */

console.log('\n=== Ohne js/wetter.js ===');
{
  const ctx = await baueKontext();
  await ctx.route('**/js/wetter.js', r =>
    r.fulfill({ status: 200, contentType: 'application/javascript', body: '/* nicht da */' }));
  const p = await anmelden(ctx);
  await journal(p);

  ok('Der Knopf ist weg', await p.locator('#wetter-jetzt').isVisible() === false);
  ok('Die Chips stehen unverändert da',
     (await p.$$('#wetter .chip')).length === 7 && (await p.$$('#temperatur .chip')).length === 5);
  await p.click('#wetter .chip[data-wert="Sonnig"]');
  await p.click('#temperatur .chip[data-wert="10–20°C"]');
  await p.fill('#f-fortschritt', 'Ohne Wettermodul');
  await p.click('#speichern');
  await p.waitForURL('**/projekt-start.html**', { timeout: 20000 });
  const e = await p.evaluate(() =>
    JSON.parse(sessionStorage.getItem('__stub_db')).eintraege.find(x => x.projekt_id === 'pw'));
  ok('Und der Eintrag entsteht wie bisher',
     e?.wetter === 'Sonnig' && e?.temperatur === '10–20°C');
  await ctx.close();
}

/* ===== 9. Als installierte App auf iPhone und iPad ======================= */

/* Was sich hier nachstellen lässt und was nicht, offen gesagt: in diesem
   Container gibt es nur Chromium, kein WebKit. Die Maschinerie hinter der
   Standortfreigabe von iOS ist damit nicht prüfbar — ein Freigabe-Dialog
   des Betriebssystems ist ohnehin für keinen Test erreichbar.
   Prüfbar ist alles, was in unserem Code steht: dass der Aufruf an einem
   Fingertipp hängt (iOS fragt sonst nicht), dass der Knopf im schmalen
   Fenster mit Kerbe und Homeleiste erreichbar bleibt, dass eine stumme
   Standortabfrage nach eigener Uhr endet und dass eine Verweigerung nur
   eine Textzeile erzeugt. Genau diese vier Dinge gehen hier durch, mit
   iOS-Kennung, Touch-Bedienung und im Anzeigemodus der installierten
   App. */

const GERAETE = [
  ['iPhone 14', 390, 844, 'iPhone', 47, 34],
  ['iPhone 15 Pro Max', 430, 932, 'iPhone', 59, 34],
  ['iPad Air', 820, 1180, 'iPad', 24, 20]
];

for (const [name, breite, hoch, art, oben, unten] of GERAETE) {
  console.log(`\n=== Installierte App: ${name} ===`);
  const ctx = await browser.newContext({
    viewport: { width: breite, height: hoch },
    deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'de-CH',
    serviceWorkers: 'block',
    userAgent: art === 'iPhone'
      ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
      : 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    permissions: ['geolocation'],
    geolocation: { latitude: 46.8959, longitude: 8.2456 }
  });
  await ctx.route('**/vendor/supabase-js-2.58.0.js', r =>
    r.fulfill({ status: 200, contentType: 'application/javascript', body: STUB }));
  await ctx.route('**/api/wetter*', r =>
    r.fulfill({ status: 200, contentType: 'application/json',
                body: JSON.stringify(antwort({ regen: 0.8, grad: 7.5 })) }));

  /* Der Anzeigemodus der installierten App und die Kerbe. navigator.standalone
     ist die Kennung, an der sich iOS erkennen lässt; env(safe-area-inset-*)
     setzt hier ein, was auf dem Geraet das System liefert. */
  await ctx.addInitScript(([saat, o, u]) => {
    try { localStorage.setItem('bj_push_gefragt', '1'); } catch {}
    if (!sessionStorage.getItem('__stub_db')) sessionStorage.setItem('__stub_db', JSON.stringify(saat));
    Object.defineProperty(navigator, 'standalone', { configurable: true, value: true });
    const echt = window.matchMedia.bind(window);
    window.matchMedia = q => /display-mode:\s*standalone/.test(q)
      ? { matches: true, media: q, addEventListener() {}, removeEventListener() {},
          addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }
      : echt(q);
    addEventListener('DOMContentLoaded', () => {
      const s = document.createElement('style');
      s.textContent = `:root{ --sat:${o}px; --sab:${u}px; }
        html{ padding:env(safe-area-inset-top,${o}px) 0 env(safe-area-inset-bottom,${u}px); }`;
      document.head.appendChild(s);
    });
  }, [{ ...SAAT, projekte: [...(SAAT.projekte || []), PROJEKT] }, oben, unten]);

  const p = await ctx.newPage();
  p.on('pageerror', e => fehler.push(`${name}: ${e.message}`));
  await p.goto('http://127.0.0.1:8123/index.html', { waitUntil: 'networkidle' });
  await p.fill('#email', 'test.durchlauf@triga.ch');
  await p.fill('#pw', 'TestDurchlauf!2026');
  await p.tap('#btn');
  await p.waitForURL('**/start.html', { timeout: 20000 });
  await journal(p);

  ok('Die App läuft im Anzeigemodus der installierten App',
     await p.evaluate(() => navigator.standalone === true
       && matchMedia('(display-mode: standalone)').matches));

  const kasten = await p.locator('#wetter-jetzt').boundingBox();
  ok('Der Knopf ist da und gross genug für einen Daumen',
     !!kasten && kasten.height >= 30 && kasten.width >= 120,
     JSON.stringify(kasten));
  ok('Er steht vollständig im Fenster, nichts ragt hinaus',
     kasten.x >= 0 && kasten.x + kasten.width <= breite,
     `${Math.round(kasten.x)} + ${Math.round(kasten.width)} von ${breite}`);
  ok('Die Wetter-Karte scrollt nicht seitlich',
     await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));

  /* iOS fragt nur nach, wenn der Aufruf an einem Fingertipp hängt.
     Deshalb hier wirklich tippen und nicht klicken. */
  await p.tap('#wetter-jetzt');
  await p.waitForSelector('#wetter-hinweis:not([hidden])', { timeout: 15000 });
  await p.waitForTimeout(300);
  ok('Ein Fingertipp genügt für den ganzen Ablauf',
     await gewaehlt(p, '#wetter') === 'Regen' && await gewaehlt(p, '#temperatur') === '0–10°C',
     `${await gewaehlt(p, '#wetter')} / ${await gewaehlt(p, '#temperatur')}`);
  ok('Die Zeile darunter bleibt im Fenster lesbar',
     await p.evaluate(() => {
       const r = document.querySelector('#wetter-hinweis').getBoundingClientRect();
       return r.left >= 0 && r.right <= innerWidth + 1 && r.height > 0;
     }));

  await p.screenshot({ path: `${OUT}/pwa-${breite}.png`, fullPage: true });

  await p.tap('#wetter .chip[data-wert="Sonnig"]');
  await p.waitForTimeout(250);
  ok('Und die Auswahl bleibt mit dem Finger überschreibbar',
     await gewaehlt(p, '#wetter') === 'Sonnig'
     && await p.locator('#wetter-hinweis').isVisible() === false);
  await ctx.close();
}

/* Und derselbe Ablauf auf dem iPhone ohne Freigabe: das ist der Fall,
   der auf iOS dauerhaft bleibt, denn wer einmal ablehnt, wird nicht noch
   einmal gefragt. */
console.log('\n=== Installierte App auf dem iPhone, Standort abgelehnt ===');
{
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2,
    isMobile: true, hasTouch: true, locale: 'de-CH', serviceWorkers: 'block',
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    permissions: []
  });
  await ctx.route('**/vendor/supabase-js-2.58.0.js', r =>
    r.fulfill({ status: 200, contentType: 'application/javascript', body: STUB }));
  await ctx.addInitScript(saat => {
    try { localStorage.setItem('bj_push_gefragt', '1'); } catch {}
    if (!sessionStorage.getItem('__stub_db')) sessionStorage.setItem('__stub_db', JSON.stringify(saat));
    Object.defineProperty(navigator, 'standalone', { configurable: true, value: true });
  }, { ...SAAT, projekte: [...(SAAT.projekte || []), PROJEKT] });

  const p = await ctx.newPage();
  p.on('pageerror', e => fehler.push(`iPhone abgelehnt: ${e.message}`));
  await p.goto('http://127.0.0.1:8123/index.html', { waitUntil: 'networkidle' });
  await p.fill('#email', 'test.durchlauf@triga.ch');
  await p.fill('#pw', 'TestDurchlauf!2026');
  await p.tap('#btn');
  await p.waitForURL('**/start.html', { timeout: 20000 });
  await journal(p);

  await p.tap('#wetter-jetzt');
  await p.waitForSelector('#wetter-hinweis:not([hidden])', { timeout: 20000 });
  const zeile = await p.textContent('#wetter-hinweis');
  ok('Auch hier nur eine Zeile Text', zeile.includes('Standort nicht freigegeben'), zeile);
  ok('Mit dem Weg über die Einstellungen des Geräts',
     zeile.includes('Einstellungen des Geräts'), zeile);
  ok('Kein Dialog, der den Weg versperrt',
     await p.locator('.sheet-bg.show').count() === 0);
  await p.screenshot({ path: `${OUT}/pwa-abgelehnt.png`, fullPage: true });

  /* Zweimal antippen bleibt zweimal dasselbe. Auf iOS kommt nach einer
     Ablehnung keine Nachfrage mehr, der Fehler kommt sofort zurück. */
  await p.tap('#wetter-jetzt');
  await p.waitForTimeout(1500);
  ok('Ein zweiter Versuch endet gleich ruhig',
     (await p.textContent('#wetter-hinweis')).includes('Standort nicht freigegeben')
     && await p.locator('#wetter-jetzt').isEnabled());

  await p.tap('#wetter .chip[data-wert="Bewölkt"]');
  await p.tap('#temperatur .chip[data-wert="10–20°C"]');
  await p.fill('#f-fortschritt', 'Auf dem iPhone von Hand');
  await p.tap('#speichern');
  await p.waitForURL('**/projekt-start.html**', { timeout: 20000 });
  const e = await p.evaluate(() =>
    JSON.parse(sessionStorage.getItem('__stub_db')).eintraege.find(x => x.projekt_id === 'pw'));
  ok('Der Eintrag entsteht wie immer',
     e?.wetter === 'Bewölkt' && e?.temperatur === '10–20°C',
     JSON.stringify({ w: e?.wetter, t: e?.temperatur }));
  await ctx.close();
}

await browser.close();
console.log(`\n=== ${gut} von ${gut + schlecht} Prüfungen bestanden ===`);
console.log('=== Fehler im Browser ===');
console.log(fehler.length ? fehler.join('\n') : 'keine');
