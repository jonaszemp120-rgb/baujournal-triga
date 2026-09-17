/* Bereich Firmenpool.
 *
 * Navigation BKP zuerst: links (Desktop) beziehungsweise oben (Handy)
 * die Kategorien, daneben die Firmen, gruppiert nach Ortschaft. Ein
 * Klick auf eine Firma wechselt in die Detailansicht mit Kontakt,
 * Ansprechpersonen und Notizen.
 *
 * Die Ampelfarbe einer Firma ist nicht gespeichert, sondern abgeleitet:
 * sie ist die Farbe der jüngsten Notiz. Ohne Notiz bleibt sie grau,
 * "noch keine Erfahrung". Damit gibt es keine zweite Wahrheit, die
 * irgendwann von den Notizen abweicht.
 *
 * Firmen und BKP-Kategorien wandern beim Löschen in den Papierkorb.
 * Ansprechpersonen und Notizen sind Unterdetails einer Firma und werden
 * wirklich gelöscht, das ist so abgesprochen.
 */

(() => {
  const CACHE_FIRMEN = 'bj_cache_firmen';
  const CACHE_BKP = 'bj_cache_bkp';
  const CACHE_AMPEL = 'bj_cache_ampel';

  const AMPELN = {
    rot:   { punkt: 'rot',   text: 'Rot — Klärung offen' },
    gelb:  { punkt: 'gelb',  text: 'Gelb — mit Vorbehalt' },
    gruen: { punkt: 'gruen', text: 'Grün — bewährt' },
    grau:  { punkt: 'grau',  text: 'Grau — noch keine Erfahrung' }
  };

  let bkp = [];            // [{id, code, bezeichnung}]
  let firmen = [];         // [{id, name, adresse, plz_ort, telefon, email, bkp_codes}]
  let ampel = {};          // firma_id -> 'rot' | 'gelb' | 'gruen'
  let wer = {};            // user_id -> Anzeigename
  let gewaehlteKat = null; // null = Alle, sonst ein BKP-Code
  let ampelFilter = 'alle';
  let offeneFirma = null;

  const breit = () => matchMedia('(min-width:1024px)').matches;

  /* --- Icons -------------------------------------------------------------- */

  const IKON = {
    zurueck: '<path d="M19 12H5"/><path d="m12 19-7-7 7-7"/>',
    telefon: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/>',
    mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 6-10 7L2 6"/>',
    stift: '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/>',
    eimer: '<path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    pfeil: '<path d="m9 18 6-6-6-6"/>',
    ort: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/>',
    marke: '<path d="M20.59 13.41 13.42 20.6a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><circle cx="7" cy="7" r="1.2"/>',
    runter: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
    rauf: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/>',
    kontakt: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/>',
    lupe: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    mehr: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>'
  };
  const svg = (d, g = 18) => `<svg viewBox="0 0 24 24" width="${g}" height="${g}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;

  /* --- Kleinkram ---------------------------------------------------------- */

  /* Damit "+41 (41) 660 56 00" auch wirklich wählt. */
  const telLink = t => 'tel:' + String(t).replace(/[^\d+]/g, '');

  /* "6060 Sarnen" -> "Sarnen". Ohne Angabe eine eigene Gruppe, die Firma
     verschwindet sonst aus der Liste, nur weil der Ort fehlt. */
  function ortschaft(plzOrt) {
    const s = String(plzOrt || '').trim();
    if (!s) return 'Ohne Ortsangabe';
    const m = s.match(/^\d{4,6}\s+(.+)$/);
    return (m ? m[1] : s).trim();
  }

  const codesVon = f => Array.isArray(f.bkp_codes) ? f.bkp_codes : [];
  const bezeichnungVon = code => (bkp.find(b => b.code === code) || {}).bezeichnung || '';

  function katText(code) {
    const b = bezeichnungVon(code);
    return b ? `${code} ${b}` : code;
  }

  /* Die Zeile unter dem Firmennamen: erster BKP-Code mit Bezeichnung,
     Hinweis auf weitere, dann die Ortschaft. */
  function metaZeile(f) {
    const c = codesVon(f);
    const teile = [];
    if (c.length) {
      teile.push(c[0]);
      const b = bezeichnungVon(c[0]);
      if (b) teile.push(b);
      if (c.length > 1) teile.push(`+${c.length - 1} weitere`);
    }
    const o = ortschaft(f.plz_ort);
    if (o) teile.push(o);
    return teile.join(' · ') || 'Keine Angaben';
  }

  const ampelVon = f => ampel[f.id] || 'grau';

  function datumKurz(iso) {
    return new Date(iso).toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  function herunterladen(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  /* SheetJS wiegt 250 KB und wird nur für Export und Import gebraucht.
     Deshalb erst beim Klick nachladen, nicht auf jeder Seite. */
  let xlsxLaedt = null;
  function ladeXlsx() {
    if (!xlsxLaedt) {
      xlsxLaedt = new Promise((ok, fehler) => {
        const s = document.createElement('script');
        s.src = 'vendor/xlsx-0.18.5.mini.min.js';
        s.onload = () => ok(window.XLSX);
        s.onerror = () => { xlsxLaedt = null; fehler(new Error('Die Excel-Bibliothek liess sich nicht laden.')); };
        document.head.appendChild(s);
      });
    }
    return xlsxLaedt;
  }

  /* --- Daten laden -------------------------------------------------------- */

  async function ladeBkp() {
    if (!istOnline()) return lies(CACHE_BKP, []);
    const { data, error } = await sb.from('bkp_liste')
      .select('id, code, bezeichnung').is('geloescht_am', null).order('code', { ascending: true });
    if (meckern('BKP-Kategorien laden', error)) return lies(CACHE_BKP, []);
    schreib(CACHE_BKP, data || []);
    return data || [];
  }

  async function ladeFirmen() {
    if (!istOnline()) return lies(CACHE_FIRMEN, []);
    const { data, error } = await sb.from('firmen')
      .select('id, name, adresse, plz_ort, telefon, email, bkp_codes')
      .is('geloescht_am', null).order('name', { ascending: true });
    if (meckern('Firmen laden', error)) return lies(CACHE_FIRMEN, []);
    schreib(CACHE_FIRMEN, data || []);
    return data || [];
  }

  /* Die Ampel ist abgeleitet: jüngste Notiz gewinnt. Absteigend sortiert
     heisst, der erste Treffer pro Firma ist der richtige. */
  async function ladeAmpel() {
    /* Auch die Einstufung kommt offline aus dem Spiegel. Ohne das waere
       ohne Empfang jede Firma grau, und grau heisst hier "noch keine
       Erfahrung" — eine Aussage, die dann schlicht falsch waere. */
    if (!istOnline()) return lies(CACHE_AMPEL, {});
    const { data, error } = await sb.from('notizen')
      .select('firma_id, farbe, erstellt_am').order('erstellt_am', { ascending: false });
    if (meckern('Einstufungen laden', error)) return lies(CACHE_AMPEL, {});
    const karte = {};
    (data || []).forEach(n => { if (!karte[n.firma_id]) karte[n.firma_id] = n.farbe; });
    schreib(CACHE_AMPEL, karte);
    return karte;
  }

  async function ladeAlles() {
    [bkp, firmen, ampel, wer] = await Promise.all([ladeBkp(), ladeFirmen(), ladeAmpel(), namen()]);
  }

  /* --- Kopfzeile ---------------------------------------------------------- */

  function knopf(id, ikon, beschriftung, klasse = '') {
    return `<button type="button" id="${id}" class="br-knopf pressable ${klasse}" aria-label="${esc(beschriftung)}" title="${esc(beschriftung)}">${svg(ikon)}</button>`;
  }

  function zeichneKopf() {
    const inFirma = !!offeneFirma;
    const papierkorb = `<a class="br-knopf pressable" href="papierkorb-bereich.html?bereich=firmen" aria-label="Papierkorb" title="Papierkorb">${svg(IKON.eimer)}</a>`;

    $('#d-titel').textContent = inFirma ? offeneFirma.name : 'Firmenpool';
    $('#m-titel').textContent = inFirma ? offeneFirma.name : 'Firmenpool';
    document.title = `${inFirma ? offeneFirma.name : 'Firmenpool'} · TRIGA App`;

    const zurueckD = $('#d-zurueck');
    zurueckD.hidden = !inFirma;
    zurueckD.innerHTML = svg(IKON.zurueck);

    $('#d-werkzeuge').innerHTML = inFirma
      ? knopf('w-firma-bearbeiten', IKON.stift, 'Firma bearbeiten') +
        knopf('w-firma-weg', IKON.eimer, 'Firma in den Papierkorb', 'rot')
      : papierkorb +
        knopf('w-export', IKON.runter, 'Als Excel exportieren') +
        knopf('w-import', IKON.rauf, 'Liste importieren');

    $('#m-werkzeuge').innerHTML = inFirma
      ? knopf('m-firma-bearbeiten', IKON.stift, 'Firma bearbeiten') +
        knopf('m-firma-weg', IKON.eimer, 'Firma in den Papierkorb', 'rot')
      : papierkorb +
        knopf('m-mehr', IKON.mehr, 'Mehr') +
        knopf('m-firma-neu', IKON.plus, 'Firma erfassen');

    const zurueckM = $('#m-zurueck');
    zurueckM.setAttribute('href', inFirma ? '#' : 'start.html');
    zurueckM.setAttribute('aria-label', inFirma ? 'Zurück zur Firmenliste' : 'Zur Startseite');

    if (inFirma) {
      $('#w-firma-bearbeiten').addEventListener('click', () => firmaFormular(offeneFirma));
      $('#m-firma-bearbeiten').addEventListener('click', () => firmaFormular(offeneFirma));
      $('#w-firma-weg').addEventListener('click', () => firmaInPapierkorb(offeneFirma));
      $('#m-firma-weg').addEventListener('click', () => firmaInPapierkorb(offeneFirma));
    } else {
      $('#w-export').addEventListener('click', exportSheet);
      $('#w-import').addEventListener('click', () => $('#import-datei').click());
      $('#m-firma-neu').addEventListener('click', () => firmaFormular(null));
      $('#m-mehr').addEventListener('click', mehrSheet);
    }
  }

  function mehrSheet() {
    const s = sheet(`
      <div style="font-size:12px; font-weight:700; letter-spacing:.06em; text-transform:uppercase; color:var(--red); margin-bottom:14px;">Liste</div>
      <button type="button" id="s-export" class="fp-umriss pressable" style="margin-bottom:10px;">${svg(IKON.runter, 16)}<span>Als Excel exportieren</span></button>
      <button type="button" id="s-import" class="fp-umriss pressable">${svg(IKON.rauf, 16)}<span>Liste importieren</span></button>
    `);
    $('#s-export', s.el).addEventListener('click', () => { s.schliessen(); exportSheet(); });
    $('#s-import', s.el).addEventListener('click', () => { s.schliessen(); $('#import-datei').click(); });
  }

  /* --- Kategorien --------------------------------------------------------- */

  function firmenZuKategorie(code) {
    return code === null ? firmen.length : firmen.filter(f => codesVon(f).includes(code)).length;
  }

  function zeichneKategorien() {
    /* Desktop: eine Zeile pro Kategorie mit Stift und Papierkorb. */
    $('#kat-desktop').innerHTML = [
      `<button type="button" class="fp-kat pressable" data-code="" aria-current="${gewaehlteKat === null}">
         <span class="was">Alle</span>
         <span style="display:flex; align-items:center; gap:8px;"><span class="wieviele">${firmen.length}</span></span>
       </button>`,
      ...bkp.map(b => `
        <button type="button" class="fp-kat pressable" data-code="${esc(b.code)}" aria-current="${gewaehlteKat === b.code}">
          <span class="was">${esc(katText(b.code))}</span>
          <span style="display:flex; align-items:center; gap:8px;">
            <span class="wieviele">${firmenZuKategorie(b.code)}</span>
            <span class="werkzeug">
              <span class="fp-mini" role="button" tabindex="0" data-kat-bearbeiten="${esc(b.id)}" aria-label="${esc(b.code)} bearbeiten">${svg(IKON.stift, 14)}</span>
              <span class="fp-mini rot" role="button" tabindex="0" data-kat-weg="${esc(b.id)}" aria-label="${esc(b.code)} in den Papierkorb">${svg(IKON.eimer, 14)}</span>
            </span>
          </span>
        </button>`)
    ].join('');

    /* Handy: eine Chipzeile, Bearbeiten und Löschen über langes Drücken. */
    $('#kat-chips').innerHTML = [
      `<button type="button" class="fp-chip pressable" data-code="" aria-pressed="${gewaehlteKat === null}">Alle</button>`,
      ...bkp.map(b => `<button type="button" class="fp-chip pressable" data-code="${esc(b.code)}" data-id="${esc(b.id)}" aria-pressed="${gewaehlteKat === b.code}">${esc(katText(b.code))}</button>`),
      `<button type="button" class="fp-chip gestrichelt pressable" id="chip-kat-neu">${svg(IKON.plus, 13)}<span>Kategorie</span></button>`
    ].join('');

    $$('#kat-desktop .fp-kat').forEach(el => el.addEventListener('click', e => {
      const bearbeiten = e.target.closest('[data-kat-bearbeiten]');
      if (bearbeiten) { e.stopPropagation(); return katFormular(bkp.find(b => b.id === bearbeiten.dataset.katBearbeiten)); }
      const weg = e.target.closest('[data-kat-weg]');
      if (weg) { e.stopPropagation(); return katInPapierkorb(bkp.find(b => b.id === weg.dataset.katWeg)); }
      waehleKategorie(el.dataset.code || null);
    }));

    $('#kat-neu').innerHTML = `${svg(IKON.plus, 16)}<span>Kategorie anlegen</span>`;
    $('#firma-neu').innerHTML = `${svg(IKON.plus, 16)}<span>Firma erfassen</span>`;
    $('#chip-kat-neu').addEventListener('click', () => katFormular(null));

    $$('#kat-chips .fp-chip[data-code]').forEach(el => {
      let timer = null, langGedrueckt = false;
      const start = () => {
        langGedrueckt = false;
        if (!el.dataset.id) return;
        timer = setTimeout(() => {
          langGedrueckt = true;
          katSheet(bkp.find(b => b.id === el.dataset.id));
        }, 550);
      };
      const stopp = () => clearTimeout(timer);
      el.addEventListener('touchstart', start, { passive: true });
      el.addEventListener('touchend', stopp);
      el.addEventListener('touchmove', stopp);
      el.addEventListener('mousedown', start);
      el.addEventListener('mouseup', stopp);
      el.addEventListener('mouseleave', stopp);
      el.addEventListener('contextmenu', e => e.preventDefault());
      el.addEventListener('click', () => {
        if (langGedrueckt) { langGedrueckt = false; return; }
        waehleKategorie(el.dataset.code || null);
      });
    });
  }

  function waehleKategorie(code) {
    gewaehlteKat = code;
    zeichneKategorien();
    zeichneListe();
  }

  function katSheet(b) {
    if (!b) return;
    const s = sheet(`
      <div style="font-size:16px; font-weight:800; color:var(--navy); margin-bottom:4px;">${esc(katText(b.code))}</div>
      <div style="font-size:13px; color:var(--text-dim); margin-bottom:18px;">${firmenZuKategorie(b.code)} Firmen in dieser Kategorie.</div>
      <button type="button" id="k-bearbeiten" class="fp-umriss pressable" style="margin-bottom:10px;">${svg(IKON.stift, 16)}<span>Bearbeiten</span></button>
      <button type="button" id="k-weg" class="fp-umriss pressable" style="border-color:var(--red); color:var(--red);">${svg(IKON.eimer, 16)}<span>In den Papierkorb</span></button>
    `);
    $('#k-bearbeiten', s.el).addEventListener('click', () => { s.schliessen(); katFormular(b); });
    $('#k-weg', s.el).addEventListener('click', () => { s.schliessen(); katInPapierkorb(b); });
  }

  async function katFormular(b) {
    const werte = await formularSheet({
      titel: b ? 'Kategorie bearbeiten' : 'Neue BKP-Kategorie',
      felder: [
        { id: 'code', label: 'BKP-Code', wert: b?.code, platzhalter: 'z.B. 211' },
        { id: 'bezeichnung', label: 'Bezeichnung', wert: b?.bezeichnung, platzhalter: 'z.B. Baumeisterarbeiten' }
      ],
      pflicht: ['code']
    });
    if (!werte) return;
    try {
      if (!istOnline()) throw new Error('Kategorien lassen sich nur online bearbeiten');
      const felder = { code: werte.code, bezeichnung: werte.bezeichnung || null };
      if (b) {
        const { error } = await sb.from('bkp_liste').update(felder).eq('id', b.id);
        if (error) throw error;
        if (gewaehlteKat === b.code) gewaehlteKat = werte.code;
        /* Die Firmen tragen den Code, nicht die Id. Wird der Code
           umbenannt, muss er auch dort nachgezogen werden, sonst zeigt
           die Kategorie plötzlich auf nichts. */
        if (b.code !== werte.code) await codeUmbenennen(b.code, werte.code);
      } else {
        const s = await session();
        const { error } = await sb.from('bkp_liste').insert({ ...felder, erstellt_von: s.user.id });
        if (error) throw error;
      }
      await ladeAlles();
      zeichneKategorien();
      zeichneListe();
      toast(b ? 'Kategorie gespeichert' : 'Kategorie angelegt');
    } catch (e) {
      toast(e.message || 'Speichern hat nicht geklappt.', true);
    }
  }

  async function codeUmbenennen(alt, neu) {
    const betroffen = firmen.filter(f => codesVon(f).includes(alt));
    for (const f of betroffen) {
      const neueCodes = codesVon(f).map(c => (c === alt ? neu : c));
      const { error } = await sb.from('firmen').update({ bkp_codes: neueCodes }).eq('id', f.id);
      if (meckern('BKP-Code nachziehen', error)) break;
    }
  }

  async function katInPapierkorb(b) {
    if (!b) return;
    const anzahl = firmenZuKategorie(b.code);
    const ja = await frage({
      titel: 'Kategorie in den Papierkorb?',
      text: anzahl
        ? `${katText(b.code)} verschwindet aus der Navigation. Die ${anzahl} Firmen bleiben erhalten und behalten den Code, sie sind nur nicht mehr über diese Kategorie erreichbar. Wiederherstellen ist jederzeit möglich.`
        : `${katText(b.code)} verschwindet aus der Navigation und lässt sich jederzeit wiederherstellen.`,
      knopf: 'In den Papierkorb'
    });
    if (!ja) return;
    try {
      if (!istOnline()) throw new Error('Löschen geht nur online');
      const { error } = await sb.from('bkp_liste')
        .update({ geloescht_am: new Date().toISOString() }).eq('id', b.id);
      if (error) throw error;
      if (gewaehlteKat === b.code) gewaehlteKat = null;
      await ladeAlles();
      zeichneKategorien();
      zeichneListe();
      toast('In den Papierkorb verschoben');
    } catch (e) {
      toast(e.message, true);
    }
  }

  /* --- Ampelfilter -------------------------------------------------------- */

  function zeichneAmpelChips() {
    const eintraege = [
      ['alle', 'Alle', null],
      ['rot', 'Rot', 'rot'],
      ['gelb', 'Gelb', 'gelb'],
      ['gruen', 'Grün', 'gruen'],
      ['ohne', 'Ohne', 'grau']
    ];
    $('#ampel-chips').innerHTML = eintraege.map(([id, text, punkt]) => `
      <button type="button" class="fp-chip klein pressable" data-ampel="${id}" aria-pressed="${ampelFilter === id}">
        ${punkt ? `<span class="punkt ${punkt}"></span>` : ''}<span>${esc(text)}</span>
      </button>`).join('');
    $$('#ampel-chips .fp-chip').forEach(el => el.addEventListener('click', () => {
      ampelFilter = el.dataset.ampel;
      zeichneAmpelChips();
      zeichneListe();
    }));
  }

  /* --- Firmenliste -------------------------------------------------------- */

  function sichtbareFirmen() {
    const q = ($('#suche').value || '').trim().toLowerCase();
    return firmen.filter(f => {
      if (gewaehlteKat !== null && !codesVon(f).includes(gewaehlteKat)) return false;
      const a = ampelVon(f);
      if (ampelFilter === 'ohne' && a !== 'grau') return false;
      if (ampelFilter !== 'alle' && ampelFilter !== 'ohne' && a !== ampelFilter) return false;
      if (!q) return true;
      const heuhaufen = [f.name, f.adresse, f.plz_ort, f.telefon, f.email,
        ...codesVon(f), ...codesVon(f).map(bezeichnungVon)].join(' ').toLowerCase();
      return heuhaufen.includes(q);
    });
  }

  function zeichneListe() {
    const sichtbar = sichtbareFirmen();

    if (!sichtbar.length) {
      $('#gruppen').innerHTML = `<div class="br-leer">${
        firmen.length ? 'Keine Firma passt zu dieser Auswahl.' : 'Noch keine Firma erfasst.'
      }</div>`;
      return;
    }

    const nachOrt = new Map();
    sichtbar.forEach(f => {
      const o = ortschaft(f.plz_ort);
      if (!nachOrt.has(o)) nachOrt.set(o, []);
      nachOrt.get(o).push(f);
    });
    const orte = [...nachOrt.keys()].sort((a, b) => a.localeCompare(b, 'de-CH'));

    $('#gruppen').innerHTML = orte.map(o => {
      const liste = nachOrt.get(o).sort((a, b) => a.name.localeCompare(b.name, 'de-CH'));
      return `
        <div class="fp-gruppe">${esc(o.toUpperCase())} — ${liste.length} ${liste.length === 1 ? 'FIRMA' : 'FIRMEN'}</div>
        <div class="fp-gruppe-inhalt" style="margin-bottom:26px;">
          ${breit() ? `<div class="fp-raster">${liste.map(karte).join('')}</div>` : liste.map(zeile).join('')}
        </div>`;
    }).join('');

    $$('#gruppen [data-firma]').forEach(el => el.addEventListener('click', e => {
      if (e.target.closest('[data-stopp]')) return;
      zeigeFirma(firmen.find(f => f.id === el.dataset.firma));
    }));
  }

  function karte(f) {
    return `
      <button type="button" class="fp-karte pressable" data-firma="${esc(f.id)}">
        <span class="oben">
          <span class="fname">${esc(f.name)}</span>
          <span class="punkt ${ampelVon(f)}" title="${esc(AMPELN[ampelVon(f)].text)}"></span>
        </span>
        <span class="meta">${esc(metaZeile(f))}</span>
        <span class="knoepfe">
          ${f.telefon ? `<a href="${esc(telLink(f.telefon))}" data-stopp aria-label="${esc(f.name)} anrufen">${svg(IKON.telefon, 16)}</a>` : ''}
          ${f.email ? `<a href="mailto:${esc(f.email)}" data-stopp aria-label="${esc(f.name)} anschreiben">${svg(IKON.mail, 16)}</a>` : ''}
        </span>
      </button>`;
  }

  function zeile(f) {
    return `
      <button type="button" class="fp-zeile pressable" data-firma="${esc(f.id)}">
        <span style="flex:1; min-width:0;">
          <span class="fname" style="display:block;">${esc(f.name)}</span>
          <span class="meta" style="display:block;">${esc(metaZeile(f))}</span>
        </span>
        <span class="punkt ${ampelVon(f)}" title="${esc(AMPELN[ampelVon(f)].text)}"></span>
        <span style="color:var(--mute); display:flex;">${svg(IKON.pfeil, 16)}</span>
      </button>`;
  }

  /* --- Firmendetail ------------------------------------------------------- */

  function zeigeListe() {
    offeneFirma = null;
    $('#ansicht-firma').hidden = true;
    $('#ansicht-liste').hidden = false;
    zeichneKopf();
    zeichneListe();
    window.scrollTo(0, 0);
  }

  async function zeigeFirma(f) {
    if (!f) return;
    offeneFirma = f;
    $('#ansicht-liste').hidden = true;
    $('#ansicht-firma').hidden = false;
    zeichneKopf();
    window.scrollTo(0, 0);

    $('#firma-links').innerHTML = `<div class="br-leer">Wird geladen …</div>`;
    $('#firma-rechts').innerHTML = '';

    const [personen, notizen] = await Promise.all([ladePersonen(f.id), ladeNotizen(f.id)]);
    if (offeneFirma?.id !== f.id) return;
    zeichneFirma(f, personen, notizen);
  }

  async function ladePersonen(firmaId) {
    if (!istOnline()) return [];
    const { data, error } = await sb.from('ansprechpersonen')
      .select('*').eq('firma_id', firmaId).order('name', { ascending: true });
    meckern('Ansprechpersonen laden', error);
    return data || [];
  }

  async function ladeNotizen(firmaId) {
    if (!istOnline()) return [];
    const { data, error } = await sb.from('notizen')
      .select('*').eq('firma_id', firmaId).order('erstellt_am', { ascending: false });
    meckern('Notizen laden', error);
    return data || [];
  }

  function zeichneFirma(f, personen, notizen) {
    const stand = notizen.length ? notizen[0].farbe : 'grau';
    const codes = codesVon(f);
    const adresse = [f.adresse, f.plz_ort].filter(Boolean).join(', ');

    $('#firma-links').innerHTML = `
      <div class="fp-ampel ${stand}"><span class="punkt ${stand}"></span><span>${esc(AMPELN[stand].text)}</span></div>

      <div class="fp-kontakt">
        ${f.telefon ? `<div><span style="color:var(--navy);">${svg(IKON.telefon, 17)}</span><a href="${esc(telLink(f.telefon))}">${esc(f.telefon)}</a></div>` : ''}
        ${f.email ? `<div><span style="color:var(--navy);">${svg(IKON.mail, 17)}</span><a href="mailto:${esc(f.email)}">${esc(f.email)}</a></div>` : ''}
        ${adresse ? `<div><span style="color:var(--text-dim);">${svg(IKON.ort, 17)}</span><span class="ruhig">${esc(adresse)}</span></div>` : ''}
        <div><span style="color:var(--text-dim);">${svg(IKON.marke, 17)}</span><span class="ruhig">${esc(codes.length ? codes.map(katText).join(' · ') : 'Keiner BKP-Kategorie zugeordnet')}</span></div>
        ${!f.telefon && !f.email && !adresse ? '<div><span class="ruhig">Keine Kontaktangaben erfasst.</span></div>' : ''}
      </div>

      <button type="button" id="vcard" class="fp-umriss pressable">${svg(IKON.kontakt, 16)}<span>In Kontakte speichern</span></button>

      <div>
        <div class="fp-ueberschrift">Ansprechpersonen</div>
        ${personen.length ? personen.map(personZeile).join('')
          : '<div style="padding:12px 2px; font-size:13px; color:var(--text-dim);">Noch keine Ansprechperson erfasst.</div>'}
        <button type="button" id="person-neu" class="fp-dazu pressable">${svg(IKON.plus, 16)}<span>Ansprechperson hinzufügen</span></button>
      </div>`;

    $('#firma-rechts').innerHTML = `
      <div class="fp-notizfeld">
        <input id="notiz-text" type="text" placeholder="Neue Notiz zu dieser Firma…" aria-label="Neue Notiz">
        <div class="fp-farben" role="group" aria-label="Einstufung der Notiz">
          ${['rot', 'gelb', 'gruen'].map(k => `
            <button type="button" class="fp-farbe pressable" data-farbe="${k}" aria-pressed="${k === 'gruen'}" aria-label="${esc(AMPELN[k].text)}" title="${esc(AMPELN[k].text)}"><span class="punkt ${k}"></span></button>`).join('')}
        </div>
        <button type="button" id="notiz-speichern" class="fp-notizspeichern pressable">Speichern</button>
      </div>
      <div class="fp-ueberschrift" style="font-size:14.5px;">Notizen-Verlauf</div>
      <div id="notiz-liste">
        ${notizen.length ? notizen.map(notizZeile).join('')
          : '<div style="padding:12px 0; font-size:13px; color:var(--text-dim); line-height:1.5;">Noch keine Notiz. Die erste Notiz bestimmt die Einstufung dieser Firma.</div>'}
      </div>`;

    $('#vcard').addEventListener('click', () => vcardHerunterladen(f, personen));
    $('#person-neu').addEventListener('click', () => personFormular(f, null));

    $$('#firma-links [data-person-bearbeiten]').forEach(el => el.addEventListener('click',
      () => personFormular(f, personen.find(p => p.id === el.dataset.personBearbeiten))));
    $$('#firma-links [data-person-weg]').forEach(el => el.addEventListener('click',
      () => personLoeschen(f, personen.find(p => p.id === el.dataset.personWeg))));

    let farbe = 'gruen';
    $$('#firma-rechts .fp-farbe').forEach(el => el.addEventListener('click', () => {
      farbe = el.dataset.farbe;
      $$('#firma-rechts .fp-farbe').forEach(x => x.setAttribute('aria-pressed', String(x === el)));
    }));

    const speichern = () => notizAnlegen(f, $('#notiz-text').value.trim(), farbe);
    $('#notiz-speichern').addEventListener('click', speichern);
    $('#notiz-text').addEventListener('keydown', e => { if (e.key === 'Enter') speichern(); });

    $$('#notiz-liste [data-notiz-bearbeiten]').forEach(el => el.addEventListener('click',
      () => notizFormular(f, notizen.find(n => n.id === el.dataset.notizBearbeiten))));
    $$('#notiz-liste [data-notiz-weg]').forEach(el => el.addEventListener('click',
      () => notizLoeschen(f, notizen.find(n => n.id === el.dataset.notizWeg))));
  }

  function personZeile(p) {
    const unter = [p.funktion, p.telefon].filter(Boolean).join(' · ');
    return `
      <div class="fp-person">
        <div class="wer">
          <div class="pname">${esc(p.name)}</div>
          ${unter ? `<div class="prolle">${esc(unter)}</div>` : ''}
        </div>
        <div class="tasten">
          ${p.telefon ? `<a href="${esc(telLink(p.telefon))}" aria-label="${esc(p.name)} anrufen">${svg(IKON.telefon, 15)}</a>` : ''}
          ${p.email ? `<a href="mailto:${esc(p.email)}" aria-label="${esc(p.name)} anschreiben">${svg(IKON.mail, 15)}</a>` : ''}
          <button type="button" class="schlicht" data-person-bearbeiten="${esc(p.id)}" aria-label="${esc(p.name)} bearbeiten">${svg(IKON.stift, 15)}</button>
          <button type="button" class="rot" data-person-weg="${esc(p.id)}" aria-label="${esc(p.name)} löschen">${svg(IKON.eimer, 15)}</button>
        </div>
      </div>`;
  }

  function notizZeile(n) {
    return `
      <div class="fp-notiz">
        <div style="padding-top:4px;"><span class="punkt ${esc(n.farbe)}" style="width:11px; height:11px;"></span></div>
        <div style="flex:1; min-width:0;">
          <div class="kopf">
            <span class="autor">${esc(wer[n.autor_id] || 'Unbekannt')}</span>
            <span class="wann">${esc(datumKurz(n.erstellt_am))}</span>
          </div>
          <div class="text">${esc(n.text)}</div>
        </div>
        <div class="tasten">
          <button type="button" class="fp-mini" data-notiz-bearbeiten="${esc(n.id)}" aria-label="Notiz bearbeiten">${svg(IKON.stift, 14)}</button>
          <button type="button" class="fp-mini rot" data-notiz-weg="${esc(n.id)}" aria-label="Notiz löschen">${svg(IKON.eimer, 14)}</button>
        </div>
      </div>`;
  }

  async function neuLaden(f) {
    ampel = await ladeAmpel();
    const [personen, notizen] = await Promise.all([ladePersonen(f.id), ladeNotizen(f.id)]);
    zeichneFirma(f, personen, notizen);
  }

  /* --- Ansprechpersonen --------------------------------------------------- */

  async function personFormular(f, p) {
    const werte = await formularSheet({
      titel: p ? 'Ansprechperson bearbeiten' : 'Neue Ansprechperson',
      felder: [
        { id: 'name', label: 'Name', wert: p?.name, platzhalter: 'Vorname Nachname' },
        { id: 'funktion', label: 'Funktion', wert: p?.funktion, platzhalter: 'z.B. Geschäftsführer' },
        { id: 'telefon', label: 'Telefon', wert: p?.telefon, typ: 'tel', platzhalter: '041 000 00 00' },
        { id: 'email', label: 'E-Mail', wert: p?.email, typ: 'email', platzhalter: 'name@firma.ch' }
      ],
      pflicht: ['name']
    });
    if (!werte) return;
    try {
      if (!istOnline()) throw new Error('Ansprechpersonen lassen sich nur online bearbeiten');
      const felder = {
        name: werte.name,
        funktion: werte.funktion || null,
        telefon: werte.telefon || null,
        email: werte.email || null
      };
      if (p) {
        const { error } = await sb.from('ansprechpersonen').update(felder).eq('id', p.id);
        if (error) throw error;
      } else {
        const s = await session();
        const { error } = await sb.from('ansprechpersonen')
          .insert({ ...felder, firma_id: f.id, erstellt_von: s.user.id });
        if (error) throw error;
      }
      await neuLaden(f);
      toast(p ? 'Gespeichert' : 'Ansprechperson angelegt');
    } catch (e) {
      toast(e.message || 'Speichern hat nicht geklappt.', true);
    }
  }

  /* Hier wird wirklich gelöscht, kein Papierkorb: so abgesprochen, eine
     Ansprechperson ist ein Unterdetail einer Firma. */
  async function personLoeschen(f, p) {
    if (!p) return;
    const ja = await frage({
      titel: 'Ansprechperson löschen?',
      text: `${p.name} wird endgültig aus dieser Firma entfernt. Für Ansprechpersonen gibt es keinen Papierkorb.`,
      knopf: 'Löschen'
    });
    if (!ja) return;
    try {
      if (!istOnline()) throw new Error('Löschen geht nur online');
      const { error } = await sb.from('ansprechpersonen').delete().eq('id', p.id);
      if (error) throw error;
      await neuLaden(f);
      toast('Gelöscht');
    } catch (e) {
      toast(e.message, true);
    }
  }

  /* --- Notizen ------------------------------------------------------------ */

  async function notizAnlegen(f, text, farbe) {
    if (!text) return toast('Ohne Text keine Notiz.', true);
    try {
      if (!istOnline()) throw new Error('Notizen lassen sich nur online erfassen');
      const s = await session();
      const { error } = await sb.from('notizen')
        .insert({ firma_id: f.id, text, farbe, autor_id: s.user.id });
      if (error) throw error;
      await neuLaden(f);
      toast('Notiz gespeichert');
    } catch (e) {
      toast(e.message || 'Speichern hat nicht geklappt.', true);
    }
  }

  async function notizFormular(f, n) {
    if (!n) return;
    const werte = await formularSheet({
      titel: 'Notiz bearbeiten',
      felder: [{ id: 'text', label: 'Notiz', wert: n.text, mehrzeilig: true }],
      pflicht: ['text'],
      farbe: n.farbe
    });
    if (!werte) return;
    try {
      if (!istOnline()) throw new Error('Notizen lassen sich nur online bearbeiten');
      const { error } = await sb.from('notizen')
        .update({ text: werte.text, farbe: werte.farbe }).eq('id', n.id);
      if (error) throw error;
      await neuLaden(f);
      toast('Notiz gespeichert');
    } catch (e) {
      toast(e.message || 'Speichern hat nicht geklappt.', true);
    }
  }

  async function notizLoeschen(f, n) {
    if (!n) return;
    const ja = await frage({
      titel: 'Notiz löschen?',
      text: 'Die Notiz wird endgültig entfernt. Ist es die jüngste, bestimmt danach die nächstältere die Einstufung dieser Firma.',
      knopf: 'Löschen'
    });
    if (!ja) return;
    try {
      if (!istOnline()) throw new Error('Löschen geht nur online');
      const { error } = await sb.from('notizen').delete().eq('id', n.id);
      if (error) throw error;
      await neuLaden(f);
      toast('Gelöscht');
    } catch (e) {
      toast(e.message, true);
    }
  }

  /* --- Firma anlegen, bearbeiten, in den Papierkorb ----------------------- */

  function firmaFormular(f) {
    let codes = f ? [...codesVon(f)] : [];
    const feld = (id, label, wert, typ = 'text', platzhalter = '') => `
      <div style="display:flex; flex-direction:column; gap:6px;">
        <label for="ff-${id}" style="font-size:11px; font-weight:700; letter-spacing:.04em; text-transform:uppercase; color:var(--text-dim);">${esc(label)}</label>
        <input id="ff-${id}" type="${typ}" value="${esc(wert || '')}" placeholder="${esc(platzhalter)}"
               style="height:44px; border-radius:10px; border:1.5px solid var(--border); padding:0 13px; font-size:14px; color:var(--text); box-sizing:border-box;">
      </div>`;

    const s = sheet(`
      <div style="font-size:12px; font-weight:700; letter-spacing:.06em; text-transform:uppercase; color:var(--red); margin-bottom:14px;">${f ? 'Firma bearbeiten' : 'Neue Firma'}</div>
      <div style="display:flex; flex-direction:column; gap:14px;">
        ${feld('name', 'Name', f?.name, 'text', 'Firmenname')}
        <button type="button" id="ff-suchen" class="fp-umriss pressable" style="height:38px; font-size:12.5px;">${svg(IKON.lupe, 15)}<span>Adresse bei search.ch suchen</span></button>
        <div id="ff-treffer"></div>
        ${feld('adresse', 'Adresse', f?.adresse, 'text', 'Strasse und Nummer')}
        ${feld('plz_ort', 'PLZ und Ort', f?.plz_ort, 'text', 'z.B. 6060 Sarnen')}
        ${feld('telefon', 'Telefon', f?.telefon, 'tel', '041 000 00 00')}
        ${feld('email', 'E-Mail', f?.email, 'email', 'info@firma.ch')}
        <div style="display:flex; flex-direction:column; gap:8px;">
          <span style="font-size:11px; font-weight:700; letter-spacing:.04em; text-transform:uppercase; color:var(--text-dim);">BKP-Kategorien</span>
          <div id="ff-codes" style="display:flex; flex-wrap:wrap; gap:6px;"></div>
        </div>
        <div id="ff-fehler" hidden style="font-size:12.5px; color:var(--red); font-weight:600;"></div>
        <div style="display:flex; gap:10px; margin-top:4px;">
          <button type="button" id="ff-speichern" class="btn-primary pressable" style="flex:1; height:48px; border:none; border-radius:12px; background:var(--red); color:#fff; font-weight:700; font-size:15px;">Speichern</button>
          <button type="button" id="ff-abbrechen" class="pressable" style="flex:1; height:48px; border-radius:12px; background:var(--card); border:1.5px solid var(--border); color:var(--navy); font-weight:700; font-size:15px;">Abbrechen</button>
        </div>
      </div>
    `);
    s.el.style.maxHeight = '86dvh';
    s.el.style.overflowY = 'auto';

    function zeichneCodes() {
      $('#ff-codes', s.el).innerHTML = bkp.length
        ? bkp.map(b => `<button type="button" class="fp-chip klein pressable" data-code="${esc(b.code)}" aria-pressed="${codes.includes(b.code)}">${esc(katText(b.code))}</button>`).join('')
        : '<span style="font-size:12.5px; color:var(--text-dim);">Noch keine Kategorien angelegt.</span>';
      $$('#ff-codes .fp-chip', s.el).forEach(el => el.addEventListener('click', () => {
        const c = el.dataset.code;
        codes = codes.includes(c) ? codes.filter(x => x !== c) : [...codes, c];
        zeichneCodes();
      }));
    }
    zeichneCodes();

    $('#ff-abbrechen', s.el).addEventListener('click', s.schliessen);

    $('#ff-suchen', s.el).addEventListener('click', async () => {
      const q = $('#ff-name', s.el).value.trim();
      const kasten = $('#ff-treffer', s.el);
      if (q.length < 2) { kasten.innerHTML = '<div style="font-size:12.5px; color:var(--text-dim);">Bitte zuerst den Firmennamen eintippen.</div>'; return; }
      kasten.innerHTML = '<div style="font-size:12.5px; color:var(--text-dim);">Wird gesucht …</div>';
      try {
        const antwort = await fetch('api/search-ch?q=' + encodeURIComponent(q));
        const daten = await antwort.json().catch(() => ({}));
        if (!antwort.ok) throw new Error(daten.fehler || 'search.ch antwortet nicht.');
        const treffer = daten.treffer || [];
        if (!treffer.length) { kasten.innerHTML = '<div style="font-size:12.5px; color:var(--text-dim);">Nichts gefunden.</div>'; return; }
        kasten.innerHTML = treffer.map((t, i) => `
          <button type="button" class="fp-person pressable" data-treffer="${i}" style="width:100%; background:none; border:none; border-bottom:1px solid var(--border); text-align:left;">
            <span class="wer">
              <span class="pname" style="display:block;">${esc(t.name || '—')}</span>
              <span class="prolle" style="display:block;">${esc([t.adresse, t.plz_ort, t.telefon].filter(Boolean).join(' · ') || 'Keine weiteren Angaben')}</span>
            </span>
          </button>`).join('');
        $$('#ff-treffer [data-treffer]', s.el).forEach(el => el.addEventListener('click', () => {
          const t = treffer[Number(el.dataset.treffer)];
          if (t.name) $('#ff-name', s.el).value = t.name;
          if (t.adresse) $('#ff-adresse', s.el).value = t.adresse;
          if (t.plz_ort) $('#ff-plz_ort', s.el).value = t.plz_ort;
          if (t.telefon) $('#ff-telefon', s.el).value = t.telefon;
          if (t.email) $('#ff-email', s.el).value = t.email;
          kasten.innerHTML = '';
        }));
      } catch (e) {
        kasten.innerHTML = `<div style="font-size:12.5px; color:var(--red); font-weight:600;">${esc(e.message)}</div>`;
      }
    });

    $('#ff-speichern', s.el).addEventListener('click', async () => {
      const fehler = $('#ff-fehler', s.el);
      fehler.hidden = true;
      const felder = {
        name: $('#ff-name', s.el).value.trim(),
        adresse: $('#ff-adresse', s.el).value.trim() || null,
        plz_ort: $('#ff-plz_ort', s.el).value.trim() || null,
        telefon: $('#ff-telefon', s.el).value.trim() || null,
        email: $('#ff-email', s.el).value.trim() || null,
        bkp_codes: codes
      };
      if (!felder.name) {
        fehler.textContent = 'Ohne Namen geht es nicht.';
        fehler.hidden = false;
        $('#ff-name', s.el).focus();
        return;
      }
      const btn = $('#ff-speichern', s.el);
      btn.disabled = true;
      btn.innerHTML = '<span class="spin"></span>';
      try {
        if (!istOnline()) throw new Error('Firmen lassen sich nur online bearbeiten');
        let id = f?.id;
        if (f) {
          const { error } = await sb.from('firmen').update(felder).eq('id', f.id);
          if (error) throw error;
        } else {
          const sitzung = await session();
          const { data, error } = await sb.from('firmen')
            .insert({ ...felder, erstellt_von: sitzung.user.id }).select().single();
          if (error) throw error;
          id = data.id;
        }
        s.schliessen();
        await ladeAlles();
        zeichneKategorien();
        const frisch = firmen.find(x => x.id === id);
        if (offeneFirma && frisch) zeigeFirma(frisch);
        else { zeichneListe(); if (frisch) zeigeFirma(frisch); }
        toast(f ? 'Gespeichert' : 'Firma angelegt');
      } catch (e) {
        fehler.textContent = e.message || 'Speichern hat nicht geklappt.';
        fehler.hidden = false;
        btn.disabled = false;
        btn.textContent = 'Speichern';
      }
    });
  }

  async function firmaInPapierkorb(f) {
    if (!f) return;
    const ja = await frage({
      titel: 'Firma in den Papierkorb?',
      text: `${f.name} verschwindet aus dem Pool. Ansprechpersonen und Notizen bleiben an der Firma hängen und sind nach dem Wiederherstellen wieder da.`,
      knopf: 'In den Papierkorb'
    });
    if (!ja) return;
    try {
      if (!istOnline()) throw new Error('Löschen geht nur online');
      const { error } = await sb.from('firmen')
        .update({ geloescht_am: new Date().toISOString() }).eq('id', f.id);
      if (error) throw error;
      await ladeAlles();
      zeichneKategorien();
      zeigeListe();
      toast('In den Papierkorb verschoben');
    } catch (e) {
      toast(e.message, true);
    }
  }

  /* --- vCard -------------------------------------------------------------- */

  /* Nach RFC 6350 sind Komma, Semikolon, Backslash und Zeilenumbruch in
     einem Wert zu maskieren, sonst zerfällt der Kontakt beim Import. */
  const vc = s => String(s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\;');

  function vcardHerunterladen(f, personen) {
    const ort = ortschaft(f.plz_ort);
    const plz = (String(f.plz_ort || '').match(/^(\d{4,6})/) || [])[1] || '';
    const bkpText = codesVon(f).map(katText).join(' · ');

    const karten = [];
    karten.push([
      'BEGIN:VCARD', 'VERSION:3.0',
      `N:;${vc(f.name)};;;`,
      `FN:${vc(f.name)}`,
      `ORG:${vc(f.name)}`,
      f.telefon ? `TEL;TYPE=WORK,VOICE:${vc(f.telefon)}` : null,
      f.email ? `EMAIL;TYPE=INTERNET,WORK:${vc(f.email)}` : null,
      (f.adresse || f.plz_ort) ? `ADR;TYPE=WORK:;;${vc(f.adresse)};${vc(ort)};;${vc(plz)};` : null,
      bkpText ? `NOTE:BKP ${vc(bkpText)}` : null,
      'END:VCARD'
    ].filter(Boolean).join('\r\n'));

    personen.forEach(p => karten.push([
      'BEGIN:VCARD', 'VERSION:3.0',
      `N:;${vc(p.name)};;;`,
      `FN:${vc(p.name)}`,
      `ORG:${vc(f.name)}`,
      p.funktion ? `TITLE:${vc(p.funktion)}` : null,
      p.telefon ? `TEL;TYPE=WORK,VOICE:${vc(p.telefon)}` : null,
      p.email ? `EMAIL;TYPE=INTERNET,WORK:${vc(p.email)}` : null,
      'END:VCARD'
    ].filter(Boolean).join('\r\n')));

    const datei = karten.join('\r\n') + '\r\n';
    herunterladen(new Blob([datei], { type: 'text/vcard;charset=utf-8' }),
      `${f.name.replace(/[^\w\dÄÖÜäöü .-]/g, '_')}.vcf`);
    toast(personen.length ? `Kontakt und ${personen.length} Ansprechperson${personen.length === 1 ? '' : 'en'} exportiert` : 'Kontakt exportiert');
  }

  /* --- Excel-Export ------------------------------------------------------- */

  function exportSheet() {
    const anzahl = sichtbareFirmen().length;
    const s = sheet(`
      <div style="font-size:16px; font-weight:800; color:var(--navy); margin-bottom:8px;">Excel-Export</div>
      <div style="font-size:13.5px; color:var(--text-dim); line-height:1.55; margin-bottom:16px;">Exportiert wird genau das, was gerade in der Liste steht: ${anzahl} ${anzahl === 1 ? 'Firma' : 'Firmen'}.</div>
      <label style="display:flex; align-items:flex-start; gap:10px; padding:12px 0 18px; font-size:13.5px; line-height:1.45;">
        <input type="checkbox" id="ex-notizen" style="width:20px; height:20px; flex-shrink:0; margin:0;">
        <span>Interne Notizen mitexportieren<br><span style="color:var(--text-dim); font-size:12.5px;">Standardmässig bleiben sie draussen — die Datei geht oft nach aussen.</span></span>
      </label>
      <button type="button" id="ex-los" class="btn-primary pressable" style="width:100%; height:50px; border:none; border-radius:14px; background:var(--red); color:#fff; font-weight:700; font-size:15px; margin-bottom:10px;">Datei erstellen</button>
      <button type="button" id="ex-nein" class="pressable" style="width:100%; height:50px; border-radius:14px; background:var(--card); border:1.5px solid var(--border); color:var(--navy); font-weight:700; font-size:15px;">Abbrechen</button>
    `);
    $('#ex-nein', s.el).addEventListener('click', s.schliessen);
    $('#ex-los', s.el).addEventListener('click', async () => {
      const mitNotizen = $('#ex-notizen', s.el).checked;
      const btn = $('#ex-los', s.el);
      btn.disabled = true;
      btn.innerHTML = '<span class="spin"></span>';
      try {
        await exportieren(mitNotizen);
        s.schliessen();
      } catch (e) {
        toast(e.message || 'Der Export hat nicht geklappt.', true);
        btn.disabled = false;
        btn.textContent = 'Datei erstellen';
      }
    });
  }

  async function exportieren(mitNotizen) {
    const XLSX = await ladeXlsx();
    const liste = sichtbareFirmen();

    let notizenNach = {};
    if (mitNotizen) {
      if (!istOnline()) throw new Error('Für die Notizen braucht es eine Verbindung.');
      const { data, error } = await sb.from('notizen')
        .select('firma_id, text, farbe, autor_id, erstellt_am').order('erstellt_am', { ascending: false });
      if (error) throw error;
      (data || []).forEach(n => {
        (notizenNach[n.firma_id] ||= []).push(
          `${datumKurz(n.erstellt_am)} · ${wer[n.autor_id] || 'Unbekannt'} · ${n.farbe}: ${n.text}`);
      });
    }

    const zeilen = liste.map(f => {
      const z = {
        'Name': f.name,
        'Adresse': f.adresse || '',
        'PLZ und Ort': f.plz_ort || '',
        'Telefon': f.telefon || '',
        'E-Mail': f.email || '',
        'BKP-Codes': codesVon(f).join('; '),
        'BKP-Bezeichnungen': codesVon(f).map(bezeichnungVon).filter(Boolean).join('; '),
        'Einstufung': AMPELN[ampelVon(f)].text
      };
      if (mitNotizen) z['Notizen'] = (notizenNach[f.id] || []).join('\n');
      return z;
    });

    const blatt = XLSX.utils.json_to_sheet(zeilen);
    blatt['!cols'] = [{ wch: 34 }, { wch: 26 }, { wch: 20 }, { wch: 19 }, { wch: 30 },
      { wch: 16 }, { wch: 30 }, { wch: 26 }, { wch: 60 }];
    const mappe = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(mappe, blatt, 'Firmenpool');
    const roh = XLSX.write(mappe, { bookType: 'xlsx', type: 'array' });
    herunterladen(new Blob([roh], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
      `Firmenpool_${heute()}.xlsx`);
    toast(`${zeilen.length} ${zeilen.length === 1 ? 'Firma' : 'Firmen'} exportiert`);
  }

  /* --- Import ------------------------------------------------------------- */

  const ZIELE = [
    { id: 'name', label: 'Name', pflicht: true, hinweise: ['name', 'firma', 'unternehmen'] },
    { id: 'adresse', label: 'Adresse', hinweise: ['adresse', 'strasse', 'street'] },
    { id: 'plz_ort', label: 'PLZ und Ort', hinweise: ['plz', 'ort', 'city'] },
    { id: 'telefon', label: 'Telefon', hinweise: ['telefon', 'tel', 'phone'] },
    { id: 'email', label: 'E-Mail', hinweise: ['mail', 'email'] },
    { id: 'bkp_codes', label: 'BKP-Codes', hinweise: ['bkp', 'code', 'kategorie'] }
  ];

  function vorschlag(ziel, spalten) {
    const treffer = spalten.findIndex(s =>
      ziel.hinweise.some(h => String(s).toLowerCase().includes(h)));
    return treffer;
  }

  async function importDatei(datei) {
    let spalten, zeilen;
    try {
      const XLSX = await ladeXlsx();
      const mappe = XLSX.read(await datei.arrayBuffer(), { type: 'array' });
      const blatt = mappe.Sheets[mappe.SheetNames[0]];
      const roh = XLSX.utils.sheet_to_json(blatt, { header: 1, blankrows: false, defval: '' });
      if (roh.length < 2) throw new Error('Die Datei enthält keine Zeilen unter der Kopfzeile.');
      spalten = roh[0].map(s => String(s).trim());
      zeilen = roh.slice(1);
    } catch (e) {
      return toast(e.message || 'Die Datei liess sich nicht lesen.', true);
    }

    const s = sheet(`
      <div style="font-size:16px; font-weight:800; color:var(--navy); margin-bottom:6px;">Spalten zuordnen</div>
      <div style="font-size:13px; color:var(--text-dim); line-height:1.5; margin-bottom:16px;">${zeilen.length} ${zeilen.length === 1 ? 'Zeile' : 'Zeilen'} gefunden. Ordne zu, welche Spalte der Datei in welches Feld gehört.</div>
      <div style="display:flex; flex-direction:column; gap:12px; margin-bottom:16px;">
        ${ZIELE.map(z => `
          <div style="display:flex; align-items:center; gap:10px;">
            <label for="im-${z.id}" style="flex:1; font-size:13.5px; font-weight:600;">${esc(z.label)}${z.pflicht ? ' *' : ''}</label>
            <select id="im-${z.id}" style="flex:1; min-width:0; height:40px; border-radius:10px; border:1.5px solid var(--border); background:var(--card); font-size:13px; padding:0 8px;">
              <option value="-1">— keine —</option>
              ${spalten.map((sp, i) => `<option value="${i}" ${vorschlag(z, spalten) === i ? 'selected' : ''}>${esc(sp || `Spalte ${i + 1}`)}</option>`).join('')}
            </select>
          </div>`).join('')}
      </div>
      <label style="display:flex; align-items:flex-start; gap:10px; padding-bottom:16px; font-size:13px; line-height:1.45;">
        <input type="checkbox" id="im-neue-kat" checked style="width:20px; height:20px; flex-shrink:0; margin:0;">
        <span>Unbekannte BKP-Codes als neue Kategorie anlegen</span>
      </label>
      <div id="im-fehler" hidden style="font-size:12.5px; color:var(--red); font-weight:600; margin-bottom:12px;"></div>
      <button type="button" id="im-los" class="btn-primary pressable" style="width:100%; height:50px; border:none; border-radius:14px; background:var(--red); color:#fff; font-weight:700; font-size:15px; margin-bottom:10px;">Importieren</button>
      <button type="button" id="im-nein" class="pressable" style="width:100%; height:50px; border-radius:14px; background:var(--card); border:1.5px solid var(--border); color:var(--navy); font-weight:700; font-size:15px;">Abbrechen</button>
    `);
    s.el.style.maxHeight = '86dvh';
    s.el.style.overflowY = 'auto';

    $('#im-nein', s.el).addEventListener('click', s.schliessen);
    $('#im-los', s.el).addEventListener('click', async () => {
      const fehler = $('#im-fehler', s.el);
      fehler.hidden = true;
      const zuordnung = {};
      ZIELE.forEach(z => { zuordnung[z.id] = Number($(`#im-${z.id}`, s.el).value); });
      if (zuordnung.name < 0) {
        fehler.textContent = 'Ohne Namensspalte geht es nicht.';
        fehler.hidden = false;
        return;
      }
      const btn = $('#im-los', s.el);
      btn.disabled = true;
      btn.innerHTML = '<span class="spin"></span>';
      try {
        const bericht = await importieren(zeilen, zuordnung, $('#im-neue-kat', s.el).checked);
        s.schliessen();
        await ladeAlles();
        zeichneKategorien();
        zeichneListe();
        berichtSheet(bericht);
      } catch (e) {
        fehler.textContent = e.message || 'Der Import hat nicht geklappt.';
        fehler.hidden = false;
        btn.disabled = false;
        btn.textContent = 'Importieren';
      }
    });
  }

  async function importieren(zeilen, zuordnung, neueKategorien) {
    if (!istOnline()) throw new Error('Importieren geht nur online.');
    const sitzung = await session();
    const hol = (zeile, ziel) => zuordnung[ziel] < 0 ? '' : String(zeile[zuordnung[ziel]] ?? '').trim();
    const bekannt = new Set(bkp.map(b => b.code));
    const schonDa = new Set(firmen.map(f => `${f.name}||${f.adresse || ''}`.toLowerCase()));

    const neu = [];
    const uebersprungen = [];
    const unbekannteCodes = new Set();

    zeilen.forEach(z => {
      const name = hol(z, 'name');
      if (!name) return;
      const adresse = hol(z, 'adresse');
      const schluessel = `${name}||${adresse}`.toLowerCase();
      if (schonDa.has(schluessel)) { uebersprungen.push(name); return; }
      schonDa.add(schluessel);

      const codes = hol(z, 'bkp_codes').split(/[;,]/).map(c => c.trim()).filter(Boolean);
      codes.forEach(c => { if (!bekannt.has(c)) unbekannteCodes.add(c); });

      neu.push({
        name,
        adresse: adresse || null,
        plz_ort: hol(z, 'plz_ort') || null,
        telefon: hol(z, 'telefon') || null,
        email: hol(z, 'email') || null,
        bkp_codes: codes,
        erstellt_von: sitzung.user.id
      });
    });

    if (!neu.length) {
      return { angelegt: 0, uebersprungen: uebersprungen.length, kategorien: 0, offeneCodes: [] };
    }

    let kategorien = 0;
    if (neueKategorien && unbekannteCodes.size) {
      const { error } = await sb.from('bkp_liste')
        .insert([...unbekannteCodes].map(code => ({ code, erstellt_von: sitzung.user.id })));
      if (error) throw error;
      kategorien = unbekannteCodes.size;
    }

    /* In Häppchen, damit auch eine Liste mit tausend Zeilen durchgeht. */
    for (let i = 0; i < neu.length; i += 200) {
      const { error } = await sb.from('firmen').insert(neu.slice(i, i + 200));
      if (error) throw error;
    }

    return {
      angelegt: neu.length,
      uebersprungen: uebersprungen.length,
      kategorien,
      offeneCodes: neueKategorien ? [] : [...unbekannteCodes]
    };
  }

  function berichtSheet(b) {
    const zeile = (was, wert) => `<div style="display:flex; justify-content:space-between; gap:12px; padding:9px 0; border-bottom:1px solid var(--border); font-size:13.5px;"><span>${esc(was)}</span><span style="font-weight:700;">${esc(String(wert))}</span></div>`;
    const s = sheet(`
      <div style="font-size:16px; font-weight:800; color:var(--navy); margin-bottom:14px;">Import abgeschlossen</div>
      ${zeile('Neu angelegt', b.angelegt)}
      ${zeile('Übersprungen, schon vorhanden', b.uebersprungen)}
      ${b.kategorien ? zeile('Neue BKP-Kategorien', b.kategorien) : ''}
      ${b.offeneCodes.length ? `<div style="font-size:12.5px; color:var(--text-dim); line-height:1.5; padding:12px 0;">Diese Codes kennt der Pool noch nicht, die Firmen tragen sie trotzdem: ${esc(b.offeneCodes.join(', '))}. Lege die Kategorien an, dann tauchen die Firmen dort auf.</div>` : ''}
      <button type="button" id="b-ok" class="pressable" style="width:100%; height:50px; border-radius:14px; background:var(--navy); border:none; color:#fff; font-weight:700; font-size:15px; margin-top:18px;">Fertig</button>
    `);
    $('#b-ok', s.el).addEventListener('click', s.schliessen);
  }

  /* --- Ein Formular als Sheet, für die kleinen Dialoge -------------------- */

  function formularSheet({ titel, felder, knopf = 'Speichern', pflicht = [], farbe = null }) {
    return new Promise(ok => {
      const eingabe = f => f.mehrzeilig
        ? `<textarea id="fs-${f.id}" rows="4" placeholder="${esc(f.platzhalter || '')}" style="border-radius:10px; border:1.5px solid var(--border); padding:11px 13px; font-size:14px; color:var(--text); box-sizing:border-box; resize:vertical;">${esc(f.wert || '')}</textarea>`
        : `<input id="fs-${f.id}" type="${f.typ || 'text'}" value="${esc(f.wert || '')}" placeholder="${esc(f.platzhalter || '')}" style="height:44px; border-radius:10px; border:1.5px solid var(--border); padding:0 13px; font-size:14px; color:var(--text); box-sizing:border-box;">`;

      const s = sheet(`
        <div style="font-size:12px; font-weight:700; letter-spacing:.06em; text-transform:uppercase; color:var(--red); margin-bottom:14px;">${esc(titel)}</div>
        <div style="display:flex; flex-direction:column; gap:14px;">
          ${felder.map(f => `
            <div style="display:flex; flex-direction:column; gap:6px;">
              <label for="fs-${f.id}" style="font-size:11px; font-weight:700; letter-spacing:.04em; text-transform:uppercase; color:var(--text-dim);">${esc(f.label)}</label>
              ${eingabe(f)}
            </div>`).join('')}
          ${farbe ? `
            <div style="display:flex; flex-direction:column; gap:8px;">
              <span style="font-size:11px; font-weight:700; letter-spacing:.04em; text-transform:uppercase; color:var(--text-dim);">Einstufung</span>
              <div class="fp-farben" role="group" aria-label="Einstufung">
                ${['rot', 'gelb', 'gruen'].map(k => `<button type="button" class="fp-farbe pressable" data-farbe="${k}" aria-pressed="${k === farbe}" aria-label="${esc(AMPELN[k].text)}"><span class="punkt ${k}"></span></button>`).join('')}
              </div>
            </div>` : ''}
          <div id="fs-fehler" hidden style="font-size:12.5px; color:var(--red); font-weight:600;"></div>
          <div style="display:flex; gap:10px; margin-top:4px;">
            <button type="button" id="fs-ja" class="btn-primary pressable" style="flex:1; height:48px; border:none; border-radius:12px; background:var(--red); color:#fff; font-weight:700; font-size:15px;">${esc(knopf)}</button>
            <button type="button" id="fs-nein" class="pressable" style="flex:1; height:48px; border-radius:12px; background:var(--card); border:1.5px solid var(--border); color:var(--navy); font-weight:700; font-size:15px;">Abbrechen</button>
          </div>
        </div>
      `);
      s.el.style.maxHeight = '86dvh';
      s.el.style.overflowY = 'auto';

      let gewaehlteFarbe = farbe;
      $$('.fp-farbe', s.el).forEach(el => el.addEventListener('click', () => {
        gewaehlteFarbe = el.dataset.farbe;
        $$('.fp-farbe', s.el).forEach(x => x.setAttribute('aria-pressed', String(x === el)));
      }));

      $('#fs-nein', s.el).addEventListener('click', () => { s.schliessen(); ok(null); });
      $('#fs-ja', s.el).addEventListener('click', () => {
        const werte = {};
        felder.forEach(f => { werte[f.id] = $(`#fs-${f.id}`, s.el).value.trim(); });
        const leer = pflicht.find(id => !werte[id]);
        if (leer) {
          const fehler = $('#fs-fehler', s.el);
          fehler.textContent = `${felder.find(f => f.id === leer).label} ist ein Pflichtfeld.`;
          fehler.hidden = false;
          $(`#fs-${leer}`, s.el).focus();
          return;
        }
        if (farbe) werte.farbe = gewaehlteFarbe;
        s.schliessen();
        ok(werte);
      });
      setTimeout(() => $(`#fs-${felder[0].id}`, s.el)?.focus(), 260);
    });
  }

  /* --- Start -------------------------------------------------------------- */

  (async () => {
    if (!await verlangeLogin()) return;

    $('#d-zurueck').addEventListener('click', zeigeListe);
    $('#m-zurueck').addEventListener('click', e => {
      if (offeneFirma) { e.preventDefault(); zeigeListe(); }
    });
    $('#kat-neu').addEventListener('click', () => katFormular(null));
    $('#firma-neu').addEventListener('click', () => firmaFormular(null));
    $('#suche').addEventListener('input', zeichneListe);
    $('#import-datei').addEventListener('change', e => {
      const datei = e.target.files?.[0];
      e.target.value = '';
      if (datei) importDatei(datei);
    });

    /* Karten auf dem Desktop, Zeilen auf dem Handy: beim Wechsel der
       Breite muss die Liste neu gezeichnet werden. */
    matchMedia('(min-width:1024px)').addEventListener('change', () => { if (!offeneFirma) zeichneListe(); });

    function hinweisZeigen() {
      const el = $('#hinweis');
      el.hidden = istOnline();
      if (!istOnline()) el.textContent = 'Offline. Angezeigt wird der zuletzt geladene Stand, Änderungen sind erst wieder mit Verbindung möglich.';
    }
    beiStatuswechsel(hinweisZeigen);

    await ladeAlles();
    zeichneKopf();
    zeichneKategorien();
    zeichneAmpelChips();
    zeichneListe();
  })();
})();
