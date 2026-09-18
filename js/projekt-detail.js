/* Die Projektseite: alles zu einem Projekt an einem Ort.
 *
 * Stammdaten, Unternehmerliste, zuständige Mitarbeiter, die letzten
 * Baujournal-Einträge und die zugeordneten Ordner. Jeder Block zeigt nur
 * den Auszug und verlinkt in den Bereich, der die volle Ansicht hat.
 *
 * Gepflegt werden die Zuordnungen ausschliesslich hier. Der Firmenpool
 * zeigt dieselben Zuordnungen, aber nur zum Lesen: zwei Orte zum
 * Bearbeiten wären zwei Orte, an denen etwas schiefgehen kann.
 */

(() => {
  const projektId = new URLSearchParams(location.search).get('projekt');

  let projekt = null;
  let einsaetze = [];
  let personen = [];
  let ordner = [];
  let journal = [];
  let pendenzen = [];
  let feed = [];
  let abnahmen = [];
  let protokolle = [];
  let firmen = [];
  let mitarbeiter = [];
  let bkp = [];

  const IKON = {
    ort: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/>',
    person: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>',
    ordner: '<path d="M4 4h5l2 3h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z"/>',
    protokoll: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="m9 15 2 2 4-4"/>',
    stift: '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/>',
    weg: '<path d="M18 6 6 18M6 6l12 12"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    haken: '<path d="M20 6 9 17l-5-5"/>',
    archiv: '<rect x="2" y="4" width="20" height="5" rx="1"/><path d="M4 9v10a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9"/><path d="M10 13h4"/>'
  };
  const svg = (d, g = 16) => `<svg viewBox="0 0 24 24" width="${g}" height="${g}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;

  const bkpText = code => {
    if (!code) return '—';
    const b = bkp.find(x => x.code === code);
    return b && b.bezeichnung ? `${code} · ${b.bezeichnung}` : String(code);
  };

  /* --- Laden --------------------------------------------------------------- */

  async function ladeJournal() {
    if (!istOnline()) return [];
    const { data, error } = await sb.from('eintraege')
      .select('id, datum, fortschritt, feststellungen, anweisungen')
      .eq('projekt_id', projektId).is('geloescht_am', null)
      .order('datum', { ascending: false }).limit(5);
    if (meckern('Baujournal laden', error)) return [];
    return data || [];
  }

  /* Der Auszug aus dem Feed: die Beiträge, die jemand diesem Projekt
     zugeordnet hat. Umfragen können das nicht sein, die tragen kein
     Projekt — siehe die Prüfregel in der Migration. */
  async function ladeFeed() {
    if (!istOnline()) return [];
    const { data, error } = await sb.from('feed_beitraege')
      .select('id, kategorie, text, bild_ablauf, erstellt_von, erstellt_am')
      .eq('projekt_id', projektId)
      .order('erstellt_am', { ascending: false }).limit(5);
    /* Kein meckern(): wer keinen Eintrag im Bereich Mitarbeiter hat, sieht
       den Feed nicht, und das ist kein Fehler, sondern die Regel. Der
       Block sagt dann einfach, dass nichts da ist. */
    if (error) return [];
    return data || [];
  }

  async function ladeAbnahmen() {
    if (!istOnline()) return [];
    const { data, error } = await sb.from('abnahmen')
      .select('id, titel, abgeschlossen_am, erstellt_am')
      .eq('projekt_id', projektId).order('erstellt_am', { ascending: false });
    if (error) return [];
    return data || [];
  }

  async function ladeProtokolle() {
    if (!istOnline()) return [];
    const { data, error } = await sb.from('protokolle')
      .select('id, status').eq('projekt_id', projektId);
    if (error) return [];
    return data || [];
  }

  async function ladeAuswahllisten() {
    if (!istOnline()) return;
    const [f, m, b] = await Promise.all([
      sb.from('firmen').select('id, name, plz_ort, bkp_codes').is('geloescht_am', null).order('name'),
      sb.from('mitarbeiter').select('id, name, rolle, user_id').is('geloescht_am', null).order('name'),
      sb.from('bkp_liste').select('code, bezeichnung').is('geloescht_am', null).order('code')
    ]);
    meckern('Firmen laden', f.error);
    meckern('Mitarbeiter laden', m.error);
    meckern('BKP laden', b.error);
    firmen = f.data || [];
    mitarbeiter = m.data || [];
    bkp = b.data || [];
  }

  async function allesLaden() {
    [projekt, einsaetze, personen, ordner, journal, pendenzen, feed, abnahmen, protokolle] = await Promise.all([
      PJ.projekt(projektId), PJ.einsaetze(projektId), PJ.personen(projektId),
      PJ.ordner(projektId), ladeJournal(), PJ.pendenzen(projektId), ladeFeed(), ladeAbnahmen(),
      ladeProtokolle()
    ]);
  }

  /* --- Kopfzeile ----------------------------------------------------------- */

  function zeichneKopf() {
    const titel = projekt?.name || 'Projekt';
    document.title = `${titel} · Projekte · TRIGA App`;
    $('#d-name').textContent = titel;
    $('#m-name').textContent = titel;
    $('#d-status').innerHTML = projekt?.archiviert
      ? '<span class="pj-marke grau">Archiviert</span>'
      : PJ.statusChip(projekt?.status);

    const knoepfe = ziel => `
      <button type="button" id="${ziel}-bearbeiten" class="br-knopf pressable" aria-label="Stammdaten bearbeiten" title="Stammdaten bearbeiten">${svg(IKON.stift, 17)}</button>
      <button type="button" id="${ziel}-archiv" class="br-knopf pressable" aria-label="${projekt?.archiviert ? 'Aus dem Archiv holen' : 'Projekt archivieren'}" title="${projekt?.archiviert ? 'Aus dem Archiv holen' : 'Projekt archivieren'}">${svg(IKON.archiv, 17)}</button>`;
    $('#d-werkzeuge').innerHTML = knoepfe('d');
    $('#m-werkzeuge').innerHTML = knoepfe('m');
    ['d', 'm'].forEach(x => {
      $(`#${x}-bearbeiten`).addEventListener('click', bearbeiten);
      $(`#${x}-archiv`).addEventListener('click', archivieren);
    });
  }

  async function bearbeiten() {
    const neu = await PJ.formular(projekt);
    if (!neu) return;
    projekt = neu;
    zeichneKopf();
    zeichneStammdaten();
    toast('Gespeichert');
  }

  async function archivieren() {
    const rein = !projekt.archiviert;
    const ja = await frage({
      titel: rein ? 'Projekt archivieren?' : 'Aus dem Archiv holen?',
      text: rein
        ? `${projekt.name} verschwindet aus der Hauptliste und bleibt über den Archivfilter erreichbar. Gelöscht wird nichts, wegen der Garantie- und Verjährungsfristen.`
        : `${projekt.name} taucht wieder in der Hauptliste auf.`,
      knopf: rein ? 'Archivieren' : 'Zurückholen',
      gefahr: rein
    });
    if (!ja) return;
    try {
      projekt = await PJ.speichere({ archiviert: rein }, projekt.id);
      zeichneKopf();
      toast(rein ? 'Archiviert' : 'Wieder aktiv');
    } catch (e) {
      toast(e.message, true);
    }
  }

  /* --- Stammdaten ---------------------------------------------------------- */

  function zeichneStammdaten() {
    const adr = PJ.adresse(projekt);
    const bh = (projekt?.bauherrschaft || '').trim();
    const nr = [projekt?.projekt_nr && `Nr. ${projekt.projekt_nr}`, projekt?.parzelle && `Parzelle ${projekt.parzelle}`]
      .filter(Boolean).join(' · ');
    $('#stammdaten').innerHTML = `
      <div class="nur-mobil" style="margin-bottom:12px;">${projekt?.archiviert
        ? '<span class="pj-marke grau">Archiviert</span>' : PJ.statusChip(projekt?.status)}</div>
      <div class="pj-stammdaten">
        <div>${svg(IKON.ort, 17)}<span class="wert">${adr ? esc(adr) : '<span style="color:var(--text-dim); font-weight:500;">Keine Adresse erfasst</span>'}</span></div>
        <div>${svg(IKON.person, 17)}<span class="wert">${bh ? esc(bh) : '<span style="color:var(--text-dim); font-weight:500;">Keine Bauherrschaft erfasst</span>'}</span></div>
        ${nr ? `<div style="padding-top:2px;"><span style="width:17px;"></span><span style="color:var(--text-dim); font-size:12.5px;">${esc(nr)}</span></div>` : ''}
        ${projekt?.beschrieb ? `<span class="beschrieb">${esc(projekt.beschrieb)}</span>` : ''}
      </div>`;
  }

  /* --- Unternehmerliste ----------------------------------------------------- */

  function zeichneUnternehmer() {
    const reihe = e => {
      const f = e.firmen || {};
      return `
        <div class="reihe">
          <a class="sp-firma" href="firmenpool.html?firma=${encodeURIComponent(e.firma_id)}">${esc(f.name || 'Unbekannte Firma')}</a>
          <span class="sp-gewerk">${esc(bkpText(e.gewerk))}</span>
          <span class="sp-status">${PJ.einsatzChip(e.status)}</span>
          <span class="sp-summe">${esc(PJ.franken(e.auftragssumme))}</span>
          <span class="sp-tasten">
            <button type="button" class="pressable" data-e-bearbeiten="${esc(e.id)}" aria-label="Eintrag bearbeiten" style="width:28px; height:28px; border:none; border-radius:7px; background:transparent; color:var(--text-dim); display:flex; align-items:center; justify-content:center;">${svg(IKON.stift, 14)}</button>
            <button type="button" class="pressable" data-e-weg="${esc(e.id)}" aria-label="Aus der Unternehmerliste entfernen" style="width:28px; height:28px; border:none; border-radius:7px; background:transparent; color:var(--red); display:flex; align-items:center; justify-content:center;">${svg(IKON.weg, 14)}</button>
          </span>
        </div>`;
    };

    const handyZeile = e => {
      const f = e.firmen || {};
      return `
        <div class="pj-zeile">
          <span class="wer">
            <a class="titel" style="display:block;" href="firmenpool.html?firma=${encodeURIComponent(e.firma_id)}">${esc(f.name || 'Unbekannte Firma')}</a>
            <span class="unter" style="display:block;">${esc(bkpText(e.gewerk))}${e.auftragssumme ? ' · ' + esc(PJ.franken(e.auftragssumme)) : ''}</span>
          </span>
          ${PJ.einsatzChip(e.status)}
          <span class="tasten">
            <button type="button" class="pressable" data-e-bearbeiten="${esc(e.id)}" aria-label="Eintrag bearbeiten">${svg(IKON.stift, 14)}</button>
            <button type="button" class="rot pressable" data-e-weg="${esc(e.id)}" aria-label="Aus der Unternehmerliste entfernen">${svg(IKON.weg, 14)}</button>
          </span>
        </div>`;
    };

    $('#unternehmer').innerHTML = `
      <div class="kopf">
        <h2>Unternehmerliste${einsaetze.length ? ` · ${einsaetze.length}` : ''}</h2>
        <button type="button" id="firma-dazu" class="pj-umriss pressable">${svg(IKON.plus, 15)}<span>Firma hinzufügen</span></button>
      </div>
      ${einsaetze.length ? `
        <div class="pj-tabelle pj-flach">
          <div class="kopfzeile">
            <span class="sp-firma">Firma</span><span class="sp-gewerk">Gewerk</span>
            <span class="sp-status">Status</span><span class="sp-summe">Summe</span>
            <span class="sp-tasten"></span>
          </div>
          ${einsaetze.map(reihe).join('')}
        </div>
        <div class="pj-unternehmer-handy">${einsaetze.map(handyZeile).join('')}</div>`
      : '<div class="pj-leer">Noch keine Firma auf diesem Projekt.</div>'}`;

    $('#firma-dazu').addEventListener('click', () => einsatzFormular(null));
    $$('#unternehmer [data-e-bearbeiten]').forEach(el => el.addEventListener('click',
      () => einsatzFormular(einsaetze.find(e => e.id === el.dataset.eBearbeiten))));
    $$('#unternehmer [data-e-weg]').forEach(el => el.addEventListener('click',
      () => einsatzEntfernen(einsaetze.find(e => e.id === el.dataset.eWeg))));
  }

  /* Ein Dialog für beides: hinzufügen und bearbeiten. Beim Bearbeiten
     steht die Firma schon fest, dann entfällt die Auswahlliste. */
  function einsatzFormular(vorhanden) {
    const schonDrin = new Set(einsaetze.map(e => e.firma_id));
    let firmaId = vorhanden?.firma_id || null;
    let status = vorhanden?.status || 'angefragt';
    let gewerk = vorhanden?.gewerk || '';
    let suche = '';

    const s = sheet(`
      <div style="font-size:16px; font-weight:800; color:var(--navy); margin-bottom:16px;">${vorhanden ? 'Eintrag bearbeiten' : 'Firma zur Unternehmerliste hinzufügen'}</div>
      ${vorhanden ? '' : `
        <div class="br-suche" style="padding:0 0 10px;">
          <input id="ef-suche" type="search" placeholder="Firma aus dem Pool suchen…" aria-label="Firma suchen">
        </div>
        <div id="ef-liste" style="max-height:210px; overflow-y:auto; border:1px solid var(--border); border-radius:12px; margin-bottom:16px;"></div>`}
      ${vorhanden ? `<div style="font-weight:700; font-size:15px; margin-bottom:16px;">${esc(vorhanden.firmen?.name || '')}</div>` : ''}

      <div style="display:flex; flex-direction:column; gap:6px; margin-bottom:14px;">
        <label for="ef-gewerk" style="font-size:11px; font-weight:700; letter-spacing:.04em; text-transform:uppercase; color:var(--text-dim);">Gewerk</label>
        <select id="ef-gewerk" style="height:44px; border-radius:10px; border:1.5px solid var(--border); padding:0 10px; font-size:14px; color:var(--text); background:var(--card); box-sizing:border-box;"></select>
      </div>

      <div style="display:flex; flex-direction:column; gap:8px; margin-bottom:14px;">
        <span style="font-size:11px; font-weight:700; letter-spacing:.04em; text-transform:uppercase; color:var(--text-dim);">Status</span>
        <div id="ef-status" style="display:flex; gap:8px; flex-wrap:wrap;">
          ${PJ.EINSATZ.map(x => `<button type="button" class="pj-chip pressable" data-status="${x.id}" aria-pressed="${x.id === status}">${esc(x.titel)}</button>`).join('')}
        </div>
      </div>

      <div style="display:flex; flex-direction:column; gap:6px; margin-bottom:16px;">
        <label for="ef-summe" style="font-size:11px; font-weight:700; letter-spacing:.04em; text-transform:uppercase; color:var(--text-dim);">Auftragssumme (optional)</label>
        <input id="ef-summe" type="text" inputmode="decimal" value="${vorhanden?.auftragssumme ?? ''}" placeholder="CHF" style="height:44px; border-radius:10px; border:1.5px solid var(--border); padding:0 13px; font-size:14px; color:var(--text); box-sizing:border-box;">
      </div>

      <div id="ef-fehler" hidden style="font-size:12.5px; color:var(--red); font-weight:600; margin-bottom:12px;"></div>
      <div style="display:flex; gap:10px;">
        <button type="button" id="ef-ja" class="btn-primary pressable" style="flex:1; height:48px; border:none; border-radius:12px; background:var(--red); color:#fff; font-weight:700; font-size:15px;">${vorhanden ? 'Speichern' : 'Hinzufügen'}</button>
        <button type="button" id="ef-nein" class="pressable" style="flex:1; height:48px; border-radius:12px; background:var(--card); border:1.5px solid var(--border); color:var(--navy); font-weight:700; font-size:15px;">Abbrechen</button>
      </div>
    `);
    s.el.style.maxHeight = '88dvh';
    s.el.style.overflowY = 'auto';

    /* Das Gewerk kommt aus der Firma: trägt sie genau einen BKP-Code, ist
       er vorbelegt. Ändern lässt er sich immer, eine Firma kann auf einem
       Projekt auch ausserhalb ihrer üblichen Kategorie arbeiten. */
    function zeichneGewerk() {
      const f = firmen.find(x => x.id === firmaId);
      const eigene = Array.isArray(f?.bkp_codes) ? f.bkp_codes : [];
      if (!gewerk && eigene.length === 1) gewerk = eigene[0];
      const uebrige = bkp.map(b => b.code).filter(c => !eigene.includes(c));
      const option = c => `<option value="${esc(c)}"${c === gewerk ? ' selected' : ''}>${esc(bkpText(c))}</option>`;
      $('#ef-gewerk', s.el).innerHTML = `
        <option value=""${gewerk ? '' : ' selected'}>— kein Gewerk —</option>
        ${eigene.length ? `<optgroup label="Kategorien dieser Firma">${eigene.map(option).join('')}</optgroup>` : ''}
        ${uebrige.length ? `<optgroup label="Übrige Kategorien">${uebrige.map(option).join('')}</optgroup>` : ''}`;
    }

    function zeichneFirmen() {
      const q = suche.trim().toLowerCase();
      const treffer = firmen
        .filter(f => !schonDrin.has(f.id))
        .filter(f => !q || `${f.name} ${f.plz_ort || ''}`.toLowerCase().includes(q))
        .slice(0, 40);
      $('#ef-liste', s.el).innerHTML = treffer.length ? treffer.map(f => `
        <button type="button" class="pressable" data-firma="${esc(f.id)}"
                style="display:flex; align-items:center; gap:10px; width:100%; padding:10px 12px; border:none; border-bottom:1px solid var(--border); background:${f.id === firmaId ? 'var(--bg)' : 'transparent'}; text-align:left;">
          <span style="width:16px; height:16px; border-radius:50%; flex-shrink:0; border:2px solid ${f.id === firmaId ? 'var(--navy)' : 'var(--border)'}; background:${f.id === firmaId ? 'var(--navy)' : 'transparent'};"></span>
          <span style="min-width:0;">
            <span style="display:block; font-weight:700; font-size:13.5px;">${esc(f.name)}</span>
            <span style="display:block; color:var(--text-dim); font-size:11.5px;">${esc([(Array.isArray(f.bkp_codes) ? f.bkp_codes : []).join(', '), f.plz_ort].filter(Boolean).join(' · ') || 'Keine Angaben')}</span>
          </span>
        </button>`).join('')
        : `<div style="padding:16px 12px; font-size:13px; color:var(--text-dim);">${
            firmen.length ? 'Keine Firma gefunden, die noch nicht auf der Liste steht.' : 'Der Firmenpool ist noch leer.'}</div>`;
      $$('#ef-liste [data-firma]', s.el).forEach(el => el.addEventListener('click', () => {
        firmaId = el.dataset.firma;
        gewerk = '';
        zeichneFirmen();
        zeichneGewerk();
      }));
    }

    if (!vorhanden) {
      $('#ef-suche', s.el).addEventListener('input', e => { suche = e.target.value; zeichneFirmen(); });
      zeichneFirmen();
    }
    zeichneGewerk();

    $('#ef-gewerk', s.el).addEventListener('change', e => { gewerk = e.target.value; });
    $$('#ef-status .pj-chip', s.el).forEach(el => el.addEventListener('click', () => {
      status = el.dataset.status;
      $$('#ef-status .pj-chip', s.el).forEach(x => x.setAttribute('aria-pressed', String(x === el)));
    }));
    $('#ef-nein', s.el).addEventListener('click', s.schliessen);

    $('#ef-ja', s.el).addEventListener('click', async () => {
      const fehler = $('#ef-fehler', s.el);
      fehler.hidden = true;
      if (!firmaId) {
        fehler.textContent = 'Bitte zuerst eine Firma auswählen.';
        fehler.hidden = false;
        return;
      }
      /* "480'000", "480000.50" und "CHF 480 000" sollen alle gehen, und
         auch das, was die App selbst anzeigt: de-CH trennt Tausender mit
         dem typografischen Apostroph U+2019, nicht mit dem geraden. Wer
         einen angezeigten Betrag zurückkopiert, soll nicht anstehen. */
      const roh = $('#ef-summe', s.el).value
        .replace(/[’'\s\u00a0]/g, '')
        .replace(/[^\d.,-]/g, '')
        .replace(',', '.');
      const summe = roh === '' ? null : Number(roh);
      if (summe !== null && !isFinite(summe)) {
        fehler.textContent = 'Die Auftragssumme ist keine Zahl.';
        fehler.hidden = false;
        return;
      }
      const btn = $('#ef-ja', s.el);
      btn.disabled = true;
      btn.innerHTML = '<span class="spin"></span>';
      try {
        if (!istOnline()) throw new Error('Die Unternehmerliste lässt sich nur online ändern');
        const felder = { gewerk: gewerk || null, status, auftragssumme: summe };
        if (vorhanden) {
          const { error } = await sb.from('projekteinsaetze').update(felder).eq('id', vorhanden.id);
          if (error) throw error;
        } else {
          const sitzung = await session();
          const { error } = await sb.from('projekteinsaetze')
            .insert({ ...felder, projekt_id: projektId, firma_id: firmaId, erstellt_von: sitzung.user.id });
          if (error) throw error;
        }
        s.schliessen();
        einsaetze = await PJ.einsaetze(projektId);
        zeichneUnternehmer();
        toast(vorhanden ? 'Gespeichert' : 'Firma hinzugefügt');
      } catch (e) {
        fehler.textContent = e.message || 'Speichern hat nicht geklappt.';
        fehler.hidden = false;
        btn.disabled = false;
        btn.textContent = vorhanden ? 'Speichern' : 'Hinzufügen';
      }
    });
  }

  async function einsatzEntfernen(e) {
    if (!e) return;
    const ja = await frage({
      titel: 'Firma von diesem Projekt entfernen?',
      text: `${e.firmen?.name || 'Die Firma'} verschwindet aus der Unternehmerliste. Die Firma selbst bleibt im Firmenpool. Für diese Zuordnung gibt es keinen Papierkorb, sie ist mit zwei Klicks wieder gesetzt.`,
      knopf: 'Entfernen'
    });
    if (!ja) return;
    try {
      await PJ.loeschen('projekteinsaetze', e.id);
      einsaetze = await PJ.einsaetze(projektId);
      zeichneUnternehmer();
      toast('Entfernt');
    } catch (f) {
      toast(f.message, true);
    }
  }

  /* --- Zuständige Mitarbeiter ------------------------------------------------ */

  function zeichnePersonen() {
    $('#personen').innerHTML = `
      <div class="kopf"><h2>Zuständige Mitarbeiter</h2></div>
      ${personen.length ? personen.map(z => `
        <div class="pj-zeile">
          <span class="pj-avatar">${esc(initialen(z.mitarbeiter.name))}</span>
          <span class="wer">
            <span class="titel" style="display:block;">${esc(z.mitarbeiter.name)}</span>
            ${z.mitarbeiter.rolle ? `<span class="unter" style="display:block;">${esc(z.mitarbeiter.rolle)}</span>` : ''}
          </span>
          ${z.rolle ? `<span class="pj-marke klein grau">${esc(z.rolle)}</span>` : ''}
          <span class="tasten">
            <button type="button" class="pressable" data-p-bearbeiten="${esc(z.id)}" aria-label="Rolle ändern">${svg(IKON.stift, 14)}</button>
            <button type="button" class="rot pressable" data-p-weg="${esc(z.id)}" aria-label="Vom Projekt entfernen">${svg(IKON.weg, 14)}</button>
          </span>
        </div>`).join('')
      : '<div class="pj-leer">Noch niemand zugeordnet.</div>'}
      <button type="button" id="person-dazu" class="pj-dazu pressable">${svg(IKON.plus, 16)}<span>Mitarbeiter zuordnen</span></button>`;

    $('#person-dazu').addEventListener('click', () => personFormular(null));
    $$('#personen [data-p-bearbeiten]').forEach(el => el.addEventListener('click',
      () => personFormular(personen.find(z => z.id === el.dataset.pBearbeiten))));
    $$('#personen [data-p-weg]').forEach(el => el.addEventListener('click',
      () => personEntfernen(personen.find(z => z.id === el.dataset.pWeg))));
  }

  function personFormular(vorhanden) {
    const schonDrin = new Set(personen.map(z => z.mitarbeiter.id));
    let wer = vorhanden?.mitarbeiter?.id || null;
    let rolle = vorhanden?.rolle || '';

    const auswahl = mitarbeiter.filter(m => vorhanden ? m.id === wer : !schonDrin.has(m.id));

    const s = sheet(`
      <div style="font-size:16px; font-weight:800; color:var(--navy); margin-bottom:16px;">${vorhanden ? 'Rolle ändern' : 'Mitarbeiter zuordnen'}</div>
      ${vorhanden
        ? `<div style="font-weight:700; font-size:15px; margin-bottom:16px;">${esc(vorhanden.mitarbeiter.name)}</div>`
        : `<div id="mf-liste" style="max-height:230px; overflow-y:auto; border:1px solid var(--border); border-radius:12px; margin-bottom:16px;"></div>`}
      <div style="display:flex; flex-direction:column; gap:8px; margin-bottom:8px;">
        <label for="mf-rolle" style="font-size:11px; font-weight:700; letter-spacing:.04em; text-transform:uppercase; color:var(--text-dim);">Rolle auf diesem Projekt</label>
        <div style="display:flex; gap:8px; flex-wrap:wrap;" id="mf-vorschlag">
          ${PJ.ROLLEN.map(r => `<button type="button" class="pj-chip pressable" data-rolle="${esc(r)}" aria-pressed="${r === rolle}">${esc(r)}</button>`).join('')}
        </div>
        <input id="mf-rolle" type="text" value="${esc(rolle)}" placeholder="oder frei eintippen" style="height:44px; border-radius:10px; border:1.5px solid var(--border); padding:0 13px; font-size:14px; color:var(--text); box-sizing:border-box;">
      </div>
      <div id="mf-fehler" hidden style="font-size:12.5px; color:var(--red); font-weight:600; margin:8px 0 12px;"></div>
      <div style="display:flex; gap:10px; margin-top:12px;">
        <button type="button" id="mf-ja" class="btn-primary pressable" style="flex:1; height:48px; border:none; border-radius:12px; background:var(--red); color:#fff; font-weight:700; font-size:15px;">${vorhanden ? 'Speichern' : 'Zuordnen'}</button>
        <button type="button" id="mf-nein" class="pressable" style="flex:1; height:48px; border-radius:12px; background:var(--card); border:1.5px solid var(--border); color:var(--navy); font-weight:700; font-size:15px;">Abbrechen</button>
      </div>
    `);
    s.el.style.maxHeight = '88dvh';
    s.el.style.overflowY = 'auto';

    function zeichneAuswahl() {
      $('#mf-liste', s.el).innerHTML = auswahl.length ? auswahl.map(m => `
        <button type="button" class="pressable" data-wer="${esc(m.id)}"
                style="display:flex; align-items:center; gap:10px; width:100%; padding:10px 12px; border:none; border-bottom:1px solid var(--border); background:${m.id === wer ? 'var(--bg)' : 'transparent'}; text-align:left;">
          <span class="pj-avatar">${esc(initialen(m.name))}</span>
          <span style="min-width:0;">
            <span style="display:block; font-weight:700; font-size:13.5px;">${esc(m.name)}</span>
            <span style="display:block; color:var(--text-dim); font-size:11.5px;">${esc(m.rolle || 'Keine Funktion erfasst')}</span>
          </span>
        </button>`).join('')
        : '<div style="padding:16px 12px; font-size:13px; color:var(--text-dim);">Alle Teammitglieder sind diesem Projekt schon zugeordnet.</div>';
      $$('#mf-liste [data-wer]', s.el).forEach(el => el.addEventListener('click', () => {
        wer = el.dataset.wer;
        zeichneAuswahl();
      }));
    }
    if (!vorhanden) zeichneAuswahl();

    $$('#mf-vorschlag .pj-chip', s.el).forEach(el => el.addEventListener('click', () => {
      rolle = el.dataset.rolle;
      $('#mf-rolle', s.el).value = rolle;
      $$('#mf-vorschlag .pj-chip', s.el).forEach(x => x.setAttribute('aria-pressed', String(x === el)));
    }));
    $('#mf-nein', s.el).addEventListener('click', s.schliessen);

    $('#mf-ja', s.el).addEventListener('click', async () => {
      const fehler = $('#mf-fehler', s.el);
      fehler.hidden = true;
      if (!wer) {
        fehler.textContent = 'Bitte zuerst jemanden auswählen.';
        fehler.hidden = false;
        return;
      }
      const felder = { rolle: $('#mf-rolle', s.el).value.trim() || null };
      const btn = $('#mf-ja', s.el);
      btn.disabled = true;
      btn.innerHTML = '<span class="spin"></span>';
      try {
        if (!istOnline()) throw new Error('Zuordnungen lassen sich nur online ändern');
        if (vorhanden) {
          const { error } = await sb.from('projekt_mitarbeiter').update(felder).eq('id', vorhanden.id);
          if (error) throw error;
        } else {
          const sitzung = await session();
          const { error } = await sb.from('projekt_mitarbeiter')
            .insert({ ...felder, projekt_id: projektId, mitarbeiter_id: wer, erstellt_von: sitzung.user.id });
          if (error) throw error;
        }
        s.schliessen();
        personen = await PJ.personen(projektId);
        zeichnePersonen();
        toast(vorhanden ? 'Gespeichert' : 'Zugeordnet');
      } catch (e) {
        fehler.textContent = e.message || 'Speichern hat nicht geklappt.';
        fehler.hidden = false;
        btn.disabled = false;
        btn.textContent = vorhanden ? 'Speichern' : 'Zuordnen';
      }
    });
  }

  async function personEntfernen(z) {
    if (!z) return;
    const ja = await frage({
      titel: 'Vom Projekt entfernen?',
      text: `${z.mitarbeiter.name} ist danach auf diesem Projekt nicht mehr als zuständig geführt. Der Mitarbeiter-Eintrag selbst bleibt unberührt.`,
      knopf: 'Entfernen'
    });
    if (!ja) return;
    try {
      await PJ.loeschen('projekt_mitarbeiter', z.id);
      personen = await PJ.personen(projektId);
      zeichnePersonen();
      toast('Entfernt');
    } catch (e) {
      toast(e.message, true);
    }
  }

  /* --- Pendenzen -------------------------------------------------------------- */

  /* Der Auszug auf der Projektseite: nur die offenen Punkte, der Rest
     steht in der vollständigen Liste. Der Zähler nennt genau das, was
     man hier sieht. */
  function zeichnePendenzen() {
    const offen = pendenzen.filter(p => !p.erledigt_am);
    const erledigt = pendenzen.length - offen.length;
    $('#pendenzen').innerHTML = `
      <div class="kopf">
        <h2>Pendenzen${pendenzen.length ? ` · ${offen.length} offen` : ''}</h2>
        ${pendenzen.length ? `<a class="pj-mehr" href="pendenzen.html?projekt=${encodeURIComponent(projektId)}">Alle ansehen →</a>` : ''}
      </div>
      ${offen.length ? offen.map(pendenzZeile).join('')
        : `<div class="pj-leer">${erledigt
            ? `Nichts offen. ${erledigt} ${erledigt === 1 ? 'Punkt ist' : 'Punkte sind'} erledigt.`
            : 'Keine Pendenzen auf diesem Projekt.'}</div>`}
      <button type="button" id="pendenz-dazu" class="pj-dazu pressable">${svg(IKON.plus, 16)}<span>Pendenz erfassen</span></button>`;

    $('#pendenz-dazu').addEventListener('click', pendenzErfassen);
    bindePendenzen($('#pendenzen'));
  }

  function pendenzZeile(p) {
    const erledigt = !!p.erledigt_am;
    return `
      <div class="pj-pendenz" data-erledigt="${erledigt ? 1 : 0}">
        <button type="button" class="haken pressable" data-p-haken="${esc(p.id)}"
                role="checkbox" aria-checked="${erledigt}"
                aria-label="${esc(p.beschrieb)} ${erledigt ? 'wieder öffnen' : 'erledigen'}">${svg(IKON.haken, 14)}</button>
        <span class="was">
          <span class="text">${esc(p.beschrieb)}</span>
          ${p.firmen ? `<span class="wer">${esc(p.firmen.name)}</span>` : ''}
        </span>
        <span class="tasten">
          <button type="button" class="pressable" data-p-bearb="${esc(p.id)}" aria-label="Pendenz bearbeiten">${svg(IKON.stift, 14)}</button>
          <button type="button" class="rot pressable" data-p-fort="${esc(p.id)}" aria-label="Pendenz löschen">${svg(IKON.weg, 14)}</button>
        </span>
      </div>`;
  }

  function bindePendenzen(wurzel) {
    $$('[data-p-haken]', wurzel).forEach(el => el.addEventListener('click',
      () => pendenzHaken(pendenzen.find(p => p.id === el.dataset.pHaken))));
    $$('[data-p-bearb]', wurzel).forEach(el => el.addEventListener('click',
      () => pendenzErfassen(pendenzen.find(p => p.id === el.dataset.pBearb))));
    $$('[data-p-fort]', wurzel).forEach(el => el.addEventListener('click',
      () => pendenzLoeschen(pendenzen.find(p => p.id === el.dataset.pFort))));
  }

  async function pendenzErfassen(vorhanden = null) {
    const gemacht = await PJ.pendenzFormular({
      projektId,
      firmen: einsaetze.map(e => e.firmen).filter(Boolean),
      vorhanden: vorhanden && vorhanden.id ? vorhanden : null
    });
    if (!gemacht) return;
    pendenzen = await PJ.pendenzen(projektId);
    zeichnePendenzen();
    toast(vorhanden && vorhanden.id ? 'Gespeichert' : 'Pendenz erfasst');
  }

  async function pendenzHaken(p) {
    if (!p) return;
    try {
      await PJ.pendenzHaken(p, !p.erledigt_am);
      pendenzen = await PJ.pendenzen(projektId);
      zeichnePendenzen();
      toast(p.erledigt_am ? 'Wieder offen' : 'Erledigt');
    } catch (e) {
      toast(e.message, true);
    }
  }

  async function pendenzLoeschen(p) {
    if (!p) return;
    const ja = await frage({
      titel: 'Pendenz löschen?',
      text: `„${p.beschrieb}" wird endgültig entfernt. Für Pendenzen gibt es keinen Papierkorb; wer einen Punkt nur abhaken will, nimmt die Checkbox — erledigte bleiben in der Liste stehen.`,
      knopf: 'Löschen'
    });
    if (!ja) return;
    try {
      await PJ.loeschen('pendenzen', p.id);
      pendenzen = await PJ.pendenzen(projektId);
      zeichnePendenzen();
      toast('Gelöscht');
    } catch (e) {
      toast(e.message, true);
    }
  }

  /* --- Baujournal und Dokumente ---------------------------------------------- */

  function zeichneJournal() {
    const text = e => e.fortschritt || e.feststellungen || e.anweisungen || 'Ohne Text erfasst.';
    $('#journal').innerHTML = `
      <div class="kopf">
        <h2>Baujournal — letzte Einträge</h2>
        <a class="pj-mehr" href="projekt-start.html?projekt=${encodeURIComponent(projektId)}">Alle ansehen →</a>
      </div>
      ${journal.length ? `<div class="pj-flach">${journal.map(e => `
        <a class="pj-eintrag" href="eintrag.html?id=${encodeURIComponent(e.id)}">
          <span class="wann">${esc(fmtDatum(e.datum))}</span>
          <span class="was">${esc(text(e))}</span>
        </a>`).join('')}</div>`
      : '<div class="pj-leer">Noch kein Eintrag im Baujournal.</div>'}`;
  }

  /* Derselbe Auszug wie beim Baujournal darunter: Datum links, Text
     rechts, alles Weitere im Bereich selbst. Ein Beitrag ohne Text ist
     einer mit Foto. */
  function zeichneFeed() {
    const nameVon = u => mitarbeiter.find(m => m.user_id === u)?.name || 'Jemand';
    /* Ohne die Klammern einer Erwähnung: hier steht ein Auszug, keine
       Verknüpfung, und "@[Thomas Zürcher](…)" wäre nur Krimskrams. */
    const kurz = b => {
      const t = erwaehnungKlartext(b.text || '').trim();
      if (t) return t;
      return b.bild_ablauf ? 'Foto gepostet.' : 'Ohne Text gepostet.';
    };
    $('#feed').innerHTML = `
      <div class="kopf">
        <h2>Feed — Beiträge zu diesem Projekt</h2>
        <a class="pj-mehr" href="feed.html">Zum Feed →</a>
      </div>
      ${feed.length ? `<div class="pj-flach">${feed.map(b => `
        <a class="pj-eintrag" href="feed.html">
          <span class="wann">${esc(fmtDatum(b.erstellt_am))}</span>
          <span class="was">
            ${b.kategorie === 'wichtig' ? '<span class="pj-marke klein" style="background:#fdeaea; color:var(--red); margin-right:6px;">Wichtig</span>' : ''}
            ${esc(nameVon(b.erstellt_von))}: ${esc(kurz(b))}
          </span>
        </a>`).join('')}</div>`
      : '<div class="pj-leer">Noch kein Beitrag zu diesem Projekt. Im Feed lässt sich beim Schreiben ein Projekt zuordnen.</div>'}`;
  }

  /* Die Bauabnahmen dieses Projekts. Eine offene führt weiter, wo man
     aufgehört hat; eine abgeschlossene ist ein Nachweis und lässt sich nur
     noch ansehen. */
  function zeichneAbnahmen() {
    const ziel = `abnahme.html?projekt=${encodeURIComponent(projektId)}`;
    $('#abnahmen').innerHTML = `
      <div class="kopf">
        <h2>Bauabnahme${abnahmen.length ? ` · ${abnahmen.length}` : ''}</h2>
        <a class="pj-mehr" href="${ziel}">${abnahmen.some(a => !a.abgeschlossen_am) ? 'Weiterführen →' : 'Zur Bauabnahme →'}</a>
      </div>
      ${abnahmen.length ? abnahmen.map(a => `
        <a class="pj-zeile" href="abnahme.html?projekt=${encodeURIComponent(projektId)}&abnahme=${encodeURIComponent(a.id)}">
          <span class="wer">
            <span class="titel" style="display:block;">${esc(a.titel)}</span>
            <span class="unter" style="display:block;">${esc(fmtDatum(a.erstellt_am))}</span>
          </span>
          <span class="pj-marke klein ${a.abgeschlossen_am ? 'gruen' : 'gelb'}">${a.abgeschlossen_am ? 'Abgeschlossen' : 'Offen'}</span>
        </a>`).join('')
      : '<div class="pj-leer">Noch keine Abnahme. Dafür braucht es einen Grundriss als PDF in den Dokumenten dieses Projekts.</div>'}`;
  }

  /* Eine Zeile, kein Block mit Auszug: was in einer Sitzung besprochen
     wurde, lässt sich nicht in zwei Worten anreissen, und die Liste der
     Protokolle steht einen Klick weiter ohnehin vollständig da. */
  function zeichneProtokolle() {
    const n = protokolle.length;
    $('#protokolle').innerHTML = `
      <a class="pj-zeile pressable" href="protokolle.html?projekt=${encodeURIComponent(projektId)}"
         style="border:1px solid var(--border); border-radius:14px; padding:15px 16px; background:var(--card);">
        <span style="color:var(--navy); display:flex;">${svg(IKON.protokoll, 18)}</span>
        <span class="wer"><span class="titel" style="font-size:15px;">Sitzungsprotokolle${n ? ` · ${n}` : ''}</span></span>
        <span class="pj-mehr">Ansehen →</span>
      </a>`;
  }

  function zeichneDokumente() {
    $('#dokumente').innerHTML = `
      <div class="kopf">
        <h2>Dokumente</h2>
        <a class="pj-mehr" href="dokumente.html">Alle ansehen →</a>
      </div>
      ${ordner.length ? ordner.map(o => `
        <a class="pj-zeile" href="dokumente.html?ordner=${encodeURIComponent(o.id)}">
          ${svg(IKON.ordner, 16)}
          <span class="wer"><span class="titel">${esc(o.name)}</span></span>
        </a>`).join('')
      : '<div class="pj-leer">Noch kein Ordner diesem Projekt zugeordnet. Die Zuordnung setzt man im Bereich Dokumente am Ordner.</div>'}`;
  }

  /* --- Start ------------------------------------------------------------------ */

  (async () => {
    if (!await verlangeLogin()) return;
    if (!projektId) { location.replace('projekte-bereich.html'); return; }

    function hinweisZeigen() {
      const el = $('#hinweis');
      el.hidden = istOnline();
      if (!istOnline()) el.textContent = 'Offline. Angezeigt wird der zuletzt geladene Stand, Änderungen sind erst wieder mit Verbindung möglich.';
    }
    beiStatuswechsel(hinweisZeigen);

    await Promise.all([allesLaden(), ladeAuswahllisten()]);
    if (!projekt) {
      $('#stammdaten').innerHTML = '<div class="br-leer">Dieses Projekt gibt es nicht mehr.</div>';
      return;
    }
    zeichneKopf();
    zeichneStammdaten();
    zeichneUnternehmer();
    zeichnePersonen();
    zeichnePendenzen();
    zeichneAbnahmen();
    zeichneJournal();
    zeichneProtokolle();
    zeichneFeed();
    zeichneDokumente();
  })();
})();
