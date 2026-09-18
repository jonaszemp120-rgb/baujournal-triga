/* Ein Sitzungsprotokoll: Kopfdaten, Teilnehmende, Traktanden.
 *
 * Der Weg: die Traktandenliste steht vor der Sitzung, in der Sitzung
 * kommt zu jedem Punkt der Text dazu, ein Foto, ein Beschluss oder eine
 * Pendenz. Am Schluss entsteht ein PDF, das im Bereich Dokumente des
 * Projekts landet und über die Teilen-Funktion des Geräts weitergeht.
 * Ab dann ist das Protokoll zu: das hält nicht diese Datei fest, sondern
 * der Trigger protokoll_gesperrt() in der Datenbank.
 *
 * Der Status wechselt von "Vorbereitet" auf "Entwurf" ohne Knopf. Sobald
 * zum ersten Mal etwas festgehalten wird — Text, Beschluss, Foto,
 * Pendenz oder die Anwesenheit einer Person —, hat die Sitzung
 * offensichtlich stattgefunden. Ein eigener Schalter dafür wäre ein
 * Knopf, den man vergisst, und dann stünde im Protokoll "noch nicht
 * durchgeführt", während es voller Text ist.
 *
 * Eine Pendenz aus einem Traktandum geht in dieselbe Pendenzenliste des
 * Projekts wie alles andere. Hier steht nur der Verweis darauf.
 */

(() => {
  const IKON = {
    plus: '<path d="M12 5v14M5 12h14"/>',
    haken: '<path d="M20 6 9 17l-5-5"/>',
    weg: '<path d="M18 6 6 18M6 6l12 12"/>',
    hoch: '<path d="m18 15-6-6-6 6"/>',
    runter: '<path d="m6 9 6 6 6-6"/>',
    bild: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>',
    teilen: '<path d="M12 16V4"/><path d="m7 9 5-5 5 5"/><path d="M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5"/>',
    papierkorb: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M6 6v14a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V6"/>'
  };
  const svg = (d, g = 16) => `<svg viewBox="0 0 24 24" width="${g}" height="${g}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;

  const protokollId = new URLSearchParams(location.search).get('protokoll') || '';

  let ich = null;
  let protokoll = null;
  let projekt = null;
  let pdfDatei = null;
  let teilnehmer = [];
  let traktanden = [];
  let mitarbeiter = [];
  let ansprech = [];
  let firmen = [];
  let tab = 'traktanden';

  const zu = () => protokoll?.status === 'abgeschlossen';
  const titelVon = () => `${protokoll.bezeichnung} Nr. ${protokoll.nummer}`;

  /* Vorsitz ist navy und nicht grün: in der Referenz tragen Vorsitz und
     Anwesend denselben Ton, und dann sieht man den Unterschied nicht.
     Wer die Sitzung leitet, soll auf einen Blick erkennbar sein. */
  const T_STATUS = {
    vorsitz:   { titel: 'Vorsitz',   farbe: 'navy' },
    anwesend:  { titel: 'Anwesend',  farbe: 'gruen' },
    abwesend:  { titel: 'Abwesend',  farbe: 'gelb' },
    verteiler: { titel: 'Verteiler', farbe: 'grau' }
  };
  const REIHUM = ['vorsitz', 'anwesend', 'abwesend', 'verteiler'];

  const P_STATUS = {
    vorbereitet:   { titel: 'Vorbereitet',   farbe: 'grau' },
    entwurf:       { titel: 'Entwurf',       farbe: 'gelb' },
    abgeschlossen: { titel: 'Abgeschlossen', farbe: 'gruen' }
  };

  /* --- Laden ---------------------------------------------------------------- */

  async function ladeAlles() {
    const { data: p, error } = await sb.from('protokolle')
      .select('*').eq('id', protokollId).maybeSingle();
    if (error || !p) return false;
    protokoll = p;

    const [pj, tn, tr, ma, ei] = await Promise.all([
      PJ.projekt(p.projekt_id),
      sb.from('protokoll_teilnehmer').select('*').eq('protokoll_id', protokollId)
        .order('erstellt_am', { ascending: true }),
      sb.from('protokoll_traktanden').select('*').eq('protokoll_id', protokollId)
        .order('reihenfolge', { ascending: true }).order('erstellt_am', { ascending: true }),
      sb.from('mitarbeiter').select('id, name, rolle').is('geloescht_am', null).order('name'),
      PJ.einsaetze(p.projekt_id)
    ]);
    projekt = pj;
    teilnehmer = tn.data || [];
    traktanden = tr.data || [];
    mitarbeiter = ma.data || [];
    firmen = (ei || []).map(e => e.firmen).filter(Boolean);

    /* Die Ansprechpersonen kommen aus den Firmen dieses Projekts und
       nicht aus dem ganzen Pool: an einer Baubesprechung sitzt, wer auf
       dieser Baustelle arbeitet. */
    ansprech = [];
    if (firmen.length) {
      const { data } = await sb.from('ansprechpersonen')
        .select('id, firma_id, name, funktion').in('firma_id', firmen.map(f => f.id)).order('name');
      ansprech = data || [];
    }

    pdfDatei = null;
    if (p.pdf_datei_id) {
      const { data } = await sb.from('dateien')
        .select('id, name, pfad').eq('id', p.pdf_datei_id).maybeSingle();
      pdfDatei = data;
    }
    return true;
  }

  async function traktandenNachladen() {
    const { data } = await sb.from('protokoll_traktanden')
      .select('*').eq('protokoll_id', protokollId)
      .order('reihenfolge', { ascending: true }).order('erstellt_am', { ascending: true });
    traktanden = data || [];
  }

  /* Vorbereitet heisst: die Liste steht, die Sitzung war noch nicht.
     Sobald jemand zum ersten Mal etwas festhält, ist es ein Entwurf. */
  async function entwurfWennNoetig() {
    if (protokoll.status !== 'vorbereitet') return;
    const { data, error } = await sb.from('protokolle')
      .update({ status: 'entwurf' }).eq('id', protokollId).select().single();
    if (error) return;
    protokoll = data;
    zeichneKopf();
  }

  /* --- Kopfzeile ------------------------------------------------------------ */

  function zeichneKopf() {
    const t = titelVon();
    document.title = `${t} · ${projekt?.name || 'Projekt'} · TRIGA App`;
    $('#d-titel').textContent = t;
    $('#m-titel').textContent = t;

    const s = P_STATUS[protokoll.status] || P_STATUS.vorbereitet;
    $('#d-status').innerHTML = `<span class="pj-marke ${s.farbe}">${esc(s.titel)}</span>`;

    const zurueck = `protokolle.html?projekt=${encodeURIComponent(protokoll.projekt_id)}`;
    $('#d-zurueck').href = zurueck;
    $('#m-zurueck').href = zurueck;

    if (zu()) {
      $('#d-werkzeuge').innerHTML =
        `<button type="button" class="pj-primaer pressable" data-teilen>${svg(IKON.teilen, 15)}<span>Protokoll teilen</span></button>`;
      $('#m-werkzeuge').innerHTML =
        `<button type="button" class="br-knopf voll pressable" data-teilen aria-label="Protokoll teilen" style="background:var(--red); color:#fff;">${svg(IKON.teilen, 17)}</button>`;
      $('#fuss').hidden = true;
    } else {
      const loeschen = `<button type="button" class="br-knopf pressable" data-weg aria-label="Protokoll löschen" title="Protokoll löschen">${svg(IKON.papierkorb, 17)}</button>`;
      $('#d-werkzeuge').innerHTML = loeschen +
        `<button type="button" class="pj-primaer pressable" data-abschluss>${svg(IKON.teilen, 15)}<span>Protokoll abschliessen und teilen</span></button>`;
      $('#m-werkzeuge').innerHTML = loeschen;
      $('#fuss').hidden = false;
    }

    $$('[data-teilen]').forEach(el => el.addEventListener('click', teilen));
    $$('[data-abschluss]').forEach(el => el.addEventListener('click', abschlussFragen));
    $$('[data-weg]').forEach(el => el.addEventListener('click', protokollLoeschen));
  }

  function zeichneTabs() {
    $('#tabs').innerHTML = `
      <div class="pk-tabs">
        <button type="button" data-tab="traktanden" aria-pressed="${tab === 'traktanden'}">Traktanden</button>
        <button type="button" data-tab="teilnehmer" aria-pressed="${tab === 'teilnehmer'}">Teilnehmer · ${teilnehmer.length}</button>
      </div>`;
    $$('#tabs [data-tab]').forEach(el => el.addEventListener('click', () => {
      tab = el.dataset.tab;
      $('#flaeche').dataset.tab = tab;
      zeichneTabs();
    }));
    $('#flaeche').dataset.tab = tab;
  }

  /* --- Kopfdaten und Teilnehmende ------------------------------------------- */

  function zeichneLinks() {
    $('#links').innerHTML = `
      <div class="pk-kopfdaten">
        <input id="k-datum" type="date" value="${esc(protokoll.datum || '')}" aria-label="Datum der Sitzung"${zu() ? ' disabled' : ''}>
        <input id="k-ort" type="text" value="${esc(protokoll.ort || '')}" maxlength="120" placeholder="Ort" aria-label="Ort der Sitzung"${zu() ? ' disabled' : ''}>
      </div>

      <!-- Auf dem Handy steht "Teilnehmer" schon auf dem Reiter; die
           Überschrift hier wäre dasselbe Wort zweimal untereinander. -->
      <div class="pk-kopfzeile nur-desktop" style="margin-top:26px;">
        <h2>Teilnehmer</h2>
        ${zu() ? '' : `<button type="button" data-tdazu class="pk-dazu" style="margin:0;">${svg(IKON.plus, 15)}<span>hinzufügen</span></button>`}
      </div>
      <div id="t-liste" style="margin-top:8px;">${teilnehmer.length
        ? teilnehmer.map(personZeile).join('')
        : '<div class="pj-leer">Noch niemand auf der Liste. Teilnehmende kommen aus den Mitarbeitenden oder aus den Ansprechpersonen der Unternehmerliste.</div>'}</div>
      ${zu() ? '' : `<button type="button" data-tdazu class="pk-dazu pressable nur-mobil">${svg(IKON.plus, 17)}<span>Teilnehmende hinzufügen</span></button>`}`;

    if (!zu()) {
      /* Ohne Datum geht es nicht — die Spalte lässt kein Leer zu. Wer das
         Feld leert, bekommt deshalb den alten Wert zurück statt einer
         Fehlermeldung aus der Datenbank. */
      $('#k-datum').addEventListener('change', e => {
        if (!e.target.value) { e.target.value = protokoll.datum || ''; return; }
        if (e.target.value !== protokoll.datum) kopfSpeichern({ datum: e.target.value });
      });
      $('#k-ort').addEventListener('blur', e => {
        const wert = e.target.value.trim() || null;
        if (wert !== (protokoll.ort || null)) kopfSpeichern({ ort: wert });
      });
      $$('#links [data-tdazu]').forEach(el => el.addEventListener('click', personenWaehlen));
      $$('#t-liste [data-status]').forEach(el => el.addEventListener('click',
        () => statusWeiter(teilnehmer.find(p => p.id === el.dataset.status))));
      $$('#t-liste [data-pweg]').forEach(el => el.addEventListener('click',
        () => personEntfernen(teilnehmer.find(p => p.id === el.dataset.pweg))));
    }
  }

  function personZeile(p) {
    const s = T_STATUS[p.status] || T_STATUS.anwesend;
    const marke = zu()
      ? `<span class="pj-marke klein ${s.farbe}">${esc(s.titel)}</span>`
      : `<button type="button" class="pk-status pj-marke klein ${s.farbe}" data-status="${esc(p.id)}"
                 aria-label="Status von ${esc(p.name)} wechseln, aktuell ${esc(s.titel)}">${esc(s.titel)}</button>`;
    return `
      <div class="pk-person">
        <span class="pj-avatar">${esc(initialen(p.name))}</span>
        <span class="wer">
          <span class="name">${esc(p.name)}</span>
          ${p.firma ? `<span class="firma">${esc(p.firma)}</span>` : ''}
        </span>
        ${marke}
        ${zu() ? '' : `<button type="button" class="weg pressable" data-pweg="${esc(p.id)}" aria-label="${esc(p.name)} von der Liste nehmen">${svg(IKON.weg, 15)}</button>`}
      </div>`;
  }

  async function kopfSpeichern(felder) {
    if (!istOnline()) return toast('Dafür braucht es eine Verbindung', true);
    const { data, error } = await sb.from('protokolle')
      .update(felder).eq('id', protokollId).select().single();
    if (error) return toast(error.message, true);
    protokoll = data;
    toast('Gespeichert');
  }

  /* Ein Tipp auf den Status geht zum nächsten der vier. Vier Schritte im
     Kreis sind schneller als ein Auswahlfeld, und die Liste ist kurz. */
  async function statusWeiter(p) {
    if (!p) return;
    if (!istOnline()) return toast('Dafür braucht es eine Verbindung', true);
    const neu = REIHUM[(REIHUM.indexOf(p.status) + 1) % REIHUM.length];
    const { data, error } = await sb.from('protokoll_teilnehmer')
      .update({ status: neu }).eq('id', p.id).select().single();
    if (error) return toast(error.message, true);
    Object.assign(p, data);
    await entwurfWennNoetig();
    zeichneLinks();
  }

  async function personEntfernen(p) {
    if (!p) return;
    if (!istOnline()) return toast('Dafür braucht es eine Verbindung', true);
    const { error } = await sb.from('protokoll_teilnehmer').delete().eq('id', p.id);
    if (error) return toast(error.message, true);
    teilnehmer = teilnehmer.filter(x => x.id !== p.id);
    zeichneTabs();
    zeichneLinks();
  }

  /* Mehrere auf einmal: an einer Baubesprechung sitzen vier Leute, und
     vier Dialoge nacheinander wären vier zu viel. */
  function personenWaehlen() {
    const drinMa = new Set(teilnehmer.map(p => p.mitarbeiter_id).filter(Boolean));
    const drinAp = new Set(teilnehmer.map(p => p.ansprechperson_id).filter(Boolean));
    const firmaVon = id => firmen.find(f => f.id === id)?.name || '';

    const auswahl = [
      ...mitarbeiter.filter(m => !drinMa.has(m.id)).map(m => ({
        schluessel: `m:${m.id}`, name: m.name, unter: m.rolle || 'TRIGA Baumanagement AG',
        zeile: { mitarbeiter_id: m.id, name: m.name, firma: 'TRIGA Baumanagement AG' }
      })),
      ...ansprech.filter(a => !drinAp.has(a.id)).map(a => ({
        schluessel: `a:${a.id}`, name: a.name,
        unter: [a.funktion, firmaVon(a.firma_id)].filter(Boolean).join(' · '),
        zeile: { ansprechperson_id: a.id, name: a.name, firma: firmaVon(a.firma_id) || null }
      }))
    ];

    const gewaehlt = new Set();
    let suche = '';

    const s = sheet(`
      <div style="font-size:18px; font-weight:800; color:var(--navy); margin-bottom:16px;">Teilnehmende hinzufügen</div>
      <div class="br-suche" style="padding:0 0 10px;">
        <input id="pw-suche" type="search" placeholder="Name oder Firma suchen…" aria-label="Person suchen">
      </div>
      <div id="pw-liste" style="max-height:44dvh; overflow-y:auto; border:1px solid var(--border); border-radius:12px;"></div>
      <button type="button" id="pw-ja" class="btn-primary pressable" style="width:100%; height:50px; border:none; border-radius:13px; background:var(--red); color:#fff; font-weight:700; font-size:15px; margin-top:18px;">Hinzufügen</button>
    `);
    s.el.style.maxHeight = '88dvh';
    s.el.style.overflowY = 'auto';

    function zeichneAuswahl() {
      const q = suche.trim().toLowerCase();
      const treffer = auswahl.filter(a => !q || `${a.name} ${a.unter}`.toLowerCase().includes(q));
      $('#pw-liste', s.el).innerHTML = treffer.length ? treffer.map(a => `
        <button type="button" class="pressable" data-wahl="${esc(a.schluessel)}"
                style="display:flex; align-items:center; gap:10px; width:100%; padding:11px 12px; border:none; border-bottom:1px solid var(--border); background:${gewaehlt.has(a.schluessel) ? 'var(--bg)' : 'transparent'}; text-align:left;">
          <span style="width:18px; height:18px; border-radius:5px; flex-shrink:0; border:2px solid ${gewaehlt.has(a.schluessel) ? 'var(--navy)' : 'var(--border)'}; background:${gewaehlt.has(a.schluessel) ? 'var(--navy)' : 'transparent'}; color:#fff; display:flex; align-items:center; justify-content:center;">${gewaehlt.has(a.schluessel) ? svg(IKON.haken, 12) : ''}</span>
          <span style="min-width:0;">
            <span style="display:block; font-weight:700; font-size:13.5px;">${esc(a.name)}</span>
            <span style="display:block; color:var(--text-dim); font-size:11.5px;">${esc(a.unter || '')}</span>
          </span>
        </button>`).join('')
        : `<div style="padding:16px 12px; font-size:13px; color:var(--text-dim); line-height:1.5;">${
            auswahl.length ? 'Niemand gefunden.'
            : 'Alle in Frage kommenden Personen stehen schon auf der Liste. Weitere kommen über den Bereich Mitarbeiter oder als Ansprechperson einer Firma der Unternehmerliste dazu.'}</div>`;
      $$('#pw-liste [data-wahl]', s.el).forEach(el => el.addEventListener('click', () => {
        const k = el.dataset.wahl;
        if (gewaehlt.has(k)) gewaehlt.delete(k); else gewaehlt.add(k);
        zeichneAuswahl();
      }));
    }
    zeichneAuswahl();
    $('#pw-suche', s.el).addEventListener('input', e => { suche = e.target.value; zeichneAuswahl(); });

    $('#pw-ja', s.el).addEventListener('click', async () => {
      if (!gewaehlt.size) return s.schliessen();
      if (!istOnline()) return toast('Dafür braucht es eine Verbindung', true);
      const knopf = $('#pw-ja', s.el);
      knopf.disabled = true;
      knopf.innerHTML = '<span class="spin"></span>';

      /* Die erste Person führt den Vorsitz, sofern noch niemand ihn hat.
         In aller Regel legt die Bauleitung das Protokoll an und leitet
         auch die Sitzung; ändern lässt es sich mit einem Tipp. */
      const hatVorsitz = teilnehmer.some(p => p.status === 'vorsitz');
      const zeilen = auswahl.filter(a => gewaehlt.has(a.schluessel)).map((a, i) => ({
        ...a.zeile, protokoll_id: protokollId,
        status: (!hatVorsitz && i === 0) ? 'vorsitz' : 'anwesend'
      }));
      const { data, error } = await sb.from('protokoll_teilnehmer').insert(zeilen).select();
      if (error) {
        knopf.disabled = false;
        knopf.textContent = 'Hinzufügen';
        return toast(error.message, true);
      }
      teilnehmer = [...teilnehmer, ...(data || [])];
      s.schliessen();
      zeichneTabs();
      zeichneLinks();
      toast(zeilen.length === 1 ? 'Hinzugefügt' : `${zeilen.length} Personen hinzugefügt`);
    });
  }

  /* --- Traktanden ----------------------------------------------------------- */

  function zeichneRechts() {
    const fertig = zu() ? `
      <div class="pk-fertig">${svg(IKON.haken, 17)}
        <span>Abgeschlossen am ${esc(fmtDatum(protokoll.abgeschlossen_am))}. Das PDF liegt im Bereich Dokumente des Projekts; hier lässt sich nichts mehr ändern.</span>
      </div>` : '';

    $('#rechts').innerHTML = `
      ${fertig}
      <!-- Wie bei den Teilnehmenden: auf dem Handy steht das Wort schon
           auf dem Reiter darüber. -->
      <div class="pk-kopfzeile nur-desktop">
        <h2>Traktanden</h2>
        ${zu() ? '' : `<button type="button" id="tr-neu" class="pj-umriss pressable">${svg(IKON.plus, 15)}<span>Traktandum</span></button>`}
      </div>
      ${traktanden.length ? traktanden.map(karte).join('')
        : '<div class="pj-leer">Noch kein Traktandum. Die Liste lässt sich vor der Sitzung vorbereiten und in der Sitzung ergänzen.</div>'}
      ${zu() ? '' : `<button type="button" id="tr-dazu" class="pk-dazu pressable nur-mobil">${svg(IKON.plus, 17)}<span>Traktandum hinzufügen</span></button>
      <input id="tr-datei" type="file" accept="image/*" hidden>`}`;

    if (!zu()) {
      $('#tr-neu')?.addEventListener('click', traktandumAnlegen);
      $('#tr-dazu')?.addEventListener('click', traktandumAnlegen);
      $('#tr-datei').addEventListener('change', fotoAbgeben);
      binde();
    }
    fotosNachladen();
  }

  function karte(t, i) {
    const letzter = i === traktanden.length - 1;
    const chips = zu()
      ? [
          t.beschluss ? `<span class="pk-chip an">${svg(IKON.haken, 15)}Beschluss</span>` : '',
          t.pendenz_id ? `<span class="pk-chip pendenz-da">${svg(IKON.plus, 15)}Pendenz erstellt</span>` : ''
        ].filter(Boolean).join('')
      : `
        <button type="button" class="pk-chip pressable" data-beschluss="${esc(t.id)}" aria-pressed="${!!t.beschluss}">${svg(IKON.haken, 15)}Beschluss</button>
        ${t.pendenz_id
          ? `<span class="pk-chip pendenz-da">${svg(IKON.plus, 15)}Pendenz erstellt</span>`
          : `<button type="button" class="pk-chip pressable" data-pendenz="${esc(t.id)}">${svg(IKON.plus, 15)}Pendenz erstellen</button>`}
        <button type="button" class="pk-chip pressable" data-foto="${esc(t.id)}">${svg(IKON.bild, 15)}Foto</button>`;

    return `
      <div class="pk-traktandum" data-t="${esc(t.id)}">
        <div class="oben">
          <span class="zahl">${i + 1}</span>
          <input class="titel" value="${esc(t.titel)}" maxlength="200" aria-label="Titel des Traktandums ${i + 1}"${zu() ? ' disabled' : ''}>
          ${zu() ? '' : `
          <span class="tasten">
            <button type="button" data-hoch="${esc(t.id)}" aria-label="Nach oben schieben"${i === 0 ? ' disabled' : ''}>${svg(IKON.hoch, 15)}</button>
            <button type="button" data-runter="${esc(t.id)}" aria-label="Nach unten schieben"${letzter ? ' disabled' : ''}>${svg(IKON.runter, 15)}</button>
            <button type="button" class="rot" data-tweg="${esc(t.id)}" aria-label="Traktandum löschen">${svg(IKON.weg, 15)}</button>
          </span>`}
        </div>
        <textarea data-text="${esc(t.id)}" placeholder="Was wurde besprochen?" aria-label="Text zum Traktandum ${i + 1}"${zu() ? ' disabled' : ''}>${esc(t.text || '')}</textarea>
        ${t.foto_pfad ? `<img class="foto" data-bild="${esc(t.foto_pfad)}" alt="Foto zum Traktandum ${i + 1}">` : ''}
        ${chips ? `<div class="pk-chips">${chips}</div>` : ''}
      </div>`;
  }

  /* Gespeichert wird beim Verlassen des Feldes und nicht bei jedem
     Tastendruck: die Liste wird am Stück neu gezeichnet, und das mitten
     im Tippen nähme einem den Cursor weg. */
  function binde() {
    const finde = id => traktanden.find(x => x.id === id);

    $$('#rechts input.titel').forEach(el => el.addEventListener('blur', () => {
      const t = finde(el.closest('[data-t]').dataset.t);
      const wert = el.value.trim();
      if (!t || !wert || wert === t.titel) { el.value = t?.titel || ''; return; }
      traktandumSpeichern(t, { titel: wert });
    }));

    $$('#rechts textarea[data-text]').forEach(el => el.addEventListener('blur', () => {
      const t = finde(el.dataset.text);
      const wert = el.value.trim() || null;
      if (!t || wert === (t.text || null)) return;
      traktandumSpeichern(t, { text: wert }, true);
    }));

    $$('#rechts [data-beschluss]').forEach(el => el.addEventListener('click', async () => {
      const t = finde(el.dataset.beschluss);
      if (!t) return;
      await traktandumSpeichern(t, { beschluss: !t.beschluss }, true);
      zeichneRechts();
    }));

    $$('#rechts [data-pendenz]').forEach(el => el.addEventListener('click',
      () => pendenzAus(finde(el.dataset.pendenz))));
    $$('#rechts [data-foto]').forEach(el => el.addEventListener('click',
      () => fotoWaehlen(finde(el.dataset.foto))));
    $$('#rechts [data-hoch]').forEach(el => el.addEventListener('click',
      () => schieben(finde(el.dataset.hoch), true)));
    $$('#rechts [data-runter]').forEach(el => el.addEventListener('click',
      () => schieben(finde(el.dataset.runter), false)));
    $$('#rechts [data-tweg]').forEach(el => el.addEventListener('click',
      () => traktandumLoeschen(finde(el.dataset.tweg))));
  }

  async function fotosNachladen() {
    await Promise.all($$('#rechts [data-bild]').map(async el => {
      const { data } = await sb.storage.from('protokoll').createSignedUrl(el.dataset.bild, 3600);
      if (data?.signedUrl) el.src = data.signedUrl;
    }));
  }

  async function traktandumSpeichern(t, felder, inhalt = false) {
    if (!istOnline()) { toast('Dafür braucht es eine Verbindung', true); return false; }
    const { data, error } = await sb.from('protokoll_traktanden')
      .update(felder).eq('id', t.id).select().single();
    if (error) { toast(error.message, true); return false; }
    Object.assign(t, data);
    if (inhalt) await entwurfWennNoetig();
    toast('Gespeichert');
    return true;
  }

  function traktandumAnlegen() {
    const s = sheet(`
      <div style="font-size:18px; font-weight:800; color:var(--navy); margin-bottom:16px;">Traktandum hinzufügen</div>
      <div class="pk-label" style="margin-top:0;">Titel</div>
      <input id="tn-titel" type="text" maxlength="200" placeholder="z. B. Stand Rohbau Haus Lilly" aria-label="Titel des Traktandums"
             style="width:100%; height:48px; border-radius:11px; border:1.5px solid var(--border); padding:0 14px; font-size:15px; box-sizing:border-box;">
      <div id="tn-fehler" hidden style="font-size:12.5px; color:var(--red); font-weight:600; margin-top:14px;"></div>
      <button type="button" id="tn-ja" class="btn-primary pressable" style="width:100%; height:50px; border:none; border-radius:13px; background:var(--red); color:#fff; font-weight:700; font-size:15px; margin-top:18px;">Hinzufügen</button>
    `);
    setTimeout(() => $('#tn-titel', s.el).focus(), 200);

    const fehler = $('#tn-fehler', s.el);
    $('#tn-ja', s.el).addEventListener('click', async () => {
      fehler.hidden = true;
      const titel = $('#tn-titel', s.el).value.trim();
      if (!titel) {
        fehler.textContent = 'Ohne Titel geht es nicht.';
        fehler.hidden = false;
        return;
      }
      if (!istOnline()) {
        fehler.textContent = 'Dafür braucht es eine Verbindung.';
        fehler.hidden = false;
        return;
      }
      const knopf = $('#tn-ja', s.el);
      knopf.disabled = true;
      knopf.innerHTML = '<span class="spin"></span>';
      const reihenfolge = traktanden.reduce((m, x) => Math.max(m, x.reihenfolge), 0) + 1;
      const { data, error } = await sb.from('protokoll_traktanden')
        .insert({ protokoll_id: protokollId, reihenfolge, titel, erstellt_von: ich })
        .select().single();
      if (error) {
        knopf.disabled = false;
        knopf.textContent = 'Hinzufügen';
        fehler.textContent = error.message;
        fehler.hidden = false;
        return;
      }
      traktanden = [...traktanden, data];
      s.schliessen();
      zeichneRechts();
    });
  }

  /* Getauscht wird in der Datenbank und in einem Zug. Zwei einzelne
     Aufrufe von hier aus könnten dazwischen abbrechen, und dann stünde
     die Liste krumm da. */
  async function schieben(t, hoch) {
    if (!t) return;
    if (!istOnline()) return toast('Dafür braucht es eine Verbindung', true);
    const { error } = await sb.rpc('traktandum_schieben', { p_traktandum: t.id, p_hoch: hoch });
    if (error) return toast(error.message, true);
    await traktandenNachladen();
    zeichneRechts();
  }

  async function traktandumLoeschen(t) {
    if (!t) return;
    const ja = await frage({
      titel: 'Traktandum löschen?',
      text: `„${t.titel}" wird entfernt, samt Text und Foto. Für Traktanden gibt es keinen Papierkorb. Eine bereits erstellte Pendenz bleibt in der Pendenzenliste des Projekts stehen.`,
      knopf: 'Löschen'
    });
    if (!ja) return;
    if (!istOnline()) return toast('Dafür braucht es eine Verbindung', true);

    if (t.foto_pfad) {
      const { error } = await sb.storage.from('protokoll').remove([t.foto_pfad]);
      if (error) return toast(error.message, true);
    }
    const { error } = await sb.from('protokoll_traktanden').delete().eq('id', t.id);
    if (error) return toast(error.message, true);
    traktanden = traktanden.filter(x => x.id !== t.id);
    zeichneRechts();
    toast('Gelöscht');
  }

  /* Ein einziges verstecktes Dateifeld für alle Traktanden, statt eines
     pro Karte. Welches gemeint war, merkt sich fotoFuer. */
  let fotoFuer = null;

  function fotoWaehlen(t) {
    if (!t) return;
    fotoFuer = t.id;
    $('#tr-datei').click();
  }

  async function fotoAbgeben(e) {
    const datei = e.target.files?.[0];
    e.target.value = '';
    const t = traktanden.find(x => x.id === fotoFuer);
    if (!datei || !t) return;
    if (!/^image\//.test(datei.type)) return toast('Das ist kein Bild', true);
    if (datei.size > 10 * 1024 * 1024) return toast('Das Bild ist grösser als 10 MB', true);
    if (!istOnline()) return toast('Dafür braucht es eine Verbindung', true);

    const endung = (datei.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
    const pfad = `${protokollId}/${crypto.randomUUID()}.${endung}`;
    const { error } = await sb.storage.from('protokoll')
      .upload(pfad, datei, { contentType: datei.type });
    if (error) return toast(error.message, true);

    const alt = t.foto_pfad;
    if (!await traktandumSpeichern(t, { foto_pfad: pfad }, true)) return;
    if (alt) await sb.storage.from('protokoll').remove([alt]);
    zeichneRechts();
  }

  /* Die Pendenz geht in die Liste des Projekts, nicht in eine zweite
     daneben. Hier bleibt nur der Verweis, damit das Protokoll am Schluss
     sagen kann, was aus der Sitzung an Arbeit hervorgegangen ist. */
  async function pendenzAus(t) {
    if (!t) return;
    const vorschlag = (t.text || '').trim() || t.titel;
    const pendenz = await PJ.pendenzFormular({
      projektId: protokoll.projekt_id, firmen, vorschlag
    });
    if (!pendenz) return;
    await traktandumSpeichern(t, { pendenz_id: pendenz.id }, true);
    zeichneRechts();
    toast('Pendenz erfasst und verknüpft');
  }

  /* --- Abschliessen, PDF und Teilen ----------------------------------------- */

  function abschlussFragen() {
    const beschluesse = traktanden.filter(t => t.beschluss).length;
    const pendenzen = traktanden.filter(t => t.pendenz_id).length;
    const anwesend = teilnehmer.filter(p => p.status === 'vorsitz' || p.status === 'anwesend').length;

    const s = sheet(`
      <div style="font-size:18px; font-weight:800; color:var(--navy); margin-bottom:14px;">Protokoll abschliessen?</div>
      <div style="background:var(--bg); border-radius:12px; padding:14px 16px; font-size:14px; line-height:1.6; color:var(--text-dim);">
        ${esc(titelVon())}, ${esc(fmtDatum(protokoll.datum))}${protokoll.ort ? `, ${esc(protokoll.ort)}` : ''}<br>
        ${traktanden.length} ${traktanden.length === 1 ? 'Traktandum' : 'Traktanden'},
        ${beschluesse} ${beschluesse === 1 ? 'Beschluss' : 'Beschlüsse'},
        ${pendenzen} ${pendenzen === 1 ? 'neue Pendenz' : 'neue Pendenzen'}<br>
        ${anwesend} anwesend, ${teilnehmer.length - anwesend} übrige auf der Liste
      </div>
      <div style="font-size:13px; color:var(--text-dim); line-height:1.55; margin-top:14px;">
        Daraus entsteht ein PDF, das im Bereich Dokumente des Projekts abgelegt wird. Danach lässt sich am Protokoll nichts mehr ändern.
      </div>
      <div id="ab-fehler" hidden style="font-size:12.5px; color:var(--red); font-weight:600; margin-top:14px;"></div>
      <div class="pk-tasten">
        <button type="button" id="ab-nein" class="nein pressable">Zurück</button>
        <button type="button" id="ab-ja" class="ja btn-primary pressable">Abschliessen und teilen</button>
      </div>
    `);
    s.el.style.maxHeight = '88dvh';
    s.el.style.overflowY = 'auto';

    const fehler = $('#ab-fehler', s.el);
    $('#ab-nein', s.el).addEventListener('click', s.schliessen);
    $('#ab-ja', s.el).addEventListener('click', async () => {
      fehler.hidden = true;
      if (!traktanden.length) {
        fehler.textContent = 'Ohne ein einziges Traktandum gibt es nichts zu protokollieren.';
        fehler.hidden = false;
        return;
      }
      if (!istOnline()) {
        fehler.textContent = 'Dafür braucht es eine Verbindung.';
        fehler.hidden = false;
        return;
      }
      const knopf = $('#ab-ja', s.el);
      knopf.disabled = true;
      knopf.innerHTML = '<span class="spin"></span>';
      try {
        await abschliessen();
        s.schliessen();
        await teilen();
      } catch (e) {
        knopf.disabled = false;
        knopf.textContent = 'Abschliessen und teilen';
        fehler.textContent = e.message || 'Das hat nicht geklappt.';
        fehler.hidden = false;
      }
    });
  }

  /* Bilder fürs PDF werden heruntergeladen und als Data-URL eingesetzt,
     nicht über ihre Adresse eingebunden — genau wie beim
     Abnahmeprotokoll. */
  async function alsDatenUrl(pfad) {
    if (!pfad) return null;
    const { data, error } = await sb.storage.from('protokoll').download(pfad);
    if (error || !data) return null;
    return new Promise(ok => {
      const leser = new FileReader();
      leser.onload = () => ok(leser.result);
      leser.onerror = () => ok(null);
      leser.readAsDataURL(data);
    });
  }

  async function ordnerFuerProtokoll() {
    const { data } = await sb.from('ordner')
      .select('id, name').eq('projekt_id', protokoll.projekt_id)
      .is('geloescht_am', null).order('name');
    if (data?.length) return data.find(o => /protokoll|sitzung/i.test(o.name)) || data[0];
    const { data: neu, error } = await sb.from('ordner')
      .insert({ name: `${projekt?.name || 'Projekt'} — Protokolle`, projekt_id: protokoll.projekt_id, erstellt_von: ich })
      .select().single();
    if (error) throw new Error(`Der Ordner für das Protokoll liess sich nicht anlegen: ${error.message}`);
    return neu;
  }

  /* Erst das PDF, dann der Abschluss. In dieser Reihenfolge, weil die
     Datenbank ein abgeschlossenes Protokoll sperrt — die Kennung der
     Datei liesse sich danach nicht mehr eintragen. */
  async function abschliessen() {
    const jetzt = new Date();

    const fotos = {};
    await Promise.all(traktanden.filter(t => t.foto_pfad).map(async t => {
      fotos[t.id] = await alsDatenUrl(t.foto_pfad);
    }));

    /* Die Pendenzen stehen in ihrer eigenen Tabelle; fürs Protokoll wird
       ihr Text geholt, damit die Liste am Schluss lesbar ist und nicht
       aus Kennungen besteht. */
    const ids = traktanden.map(t => t.pendenz_id).filter(Boolean);
    let pendenzen = [];
    if (ids.length) {
      const { data } = await sb.from('pendenzen')
        .select('id, beschrieb, firmen(name)').in('id', ids);
      pendenzen = data || [];
    }

    const blob = await sitzungsProtokoll({
      projekt, protokoll,
      titel: titelVon(),
      teilnehmer: teilnehmer.map(p => ({ ...p, status_titel: (T_STATUS[p.status] || {}).titel || p.status })),
      traktanden: traktanden.map((t, i) => {
        const p = pendenzen.find(x => x.id === t.pendenz_id);
        return {
          ...t, nummer: i + 1,
          pendenz_text: p?.beschrieb || null,
          pendenz_firma: p?.firmen?.name || null
        };
      }),
      fotos, wann: jetzt
    });

    const ordner = await ordnerFuerProtokoll();
    const pfad = `${ordner.id}/${crypto.randomUUID()}.pdf`;
    const { error: hoch } = await sb.storage.from('dokumente')
      .upload(pfad, blob, { contentType: 'application/pdf' });
    if (hoch) throw new Error(hoch.message);

    const sauber = s => String(s || '').replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_+|_+$/g, '').slice(0, 40);
    const name = `${sauber(titelVon())}_${sauber(projekt?.name)}_${String(protokoll.datum).slice(0, 10)}.pdf`;
    const { data: datei, error } = await sb.from('dateien').insert({
      ordner_id: ordner.id, name, pfad,
      groesse: blob.size, typ: 'application/pdf', hochgeladen_von: ich
    }).select().single();
    if (error) throw new Error(error.message);

    const { data, error: schliessen } = await sb.from('protokolle').update({
      status: 'abgeschlossen',
      abgeschlossen_am: jetzt.toISOString(),
      pdf_datei_id: datei.id
    }).eq('id', protokollId).select().single();
    if (schliessen) throw schliessen;

    protokoll = data;
    pdfDatei = datei;
    zeichneKopf();
    zeichneLinks();
    zeichneRechts();
    toast('Abgeschlossen, das PDF liegt unter Dokumente');
  }

  /* Es gibt bewusst keinen eingebauten Mailversand: der bräuchte eine
     bezahlte Infrastruktur, und das Gerät kann es ohnehin besser. Die
     Teilen-Funktion reicht das PDF an jede App weiter, auch ans
     Mailprogramm. Wo es sie nicht gibt — mancher Browser am Schreibtisch
     kennt sie nicht —, wird die Datei heruntergeladen. */
  async function teilen() {
    if (!pdfDatei) return toast('Zu diesem Protokoll liegt noch kein PDF bereit', true);
    if (!istOnline()) return toast('Dafür braucht es eine Verbindung', true);

    const { data, error } = await sb.storage.from('dokumente').download(pdfDatei.pfad);
    if (error || !data) return toast('Das PDF liess sich nicht laden', true);

    const datei = new File([data], pdfDatei.name, { type: 'application/pdf' });
    if (navigator.canShare?.({ files: [datei] })) {
      try {
        await navigator.share({
          files: [datei],
          title: titelVon(),
          text: `${titelVon()} — ${projekt?.name || 'Projekt'}, ${fmtDatum(protokoll.datum)}`
        });
        return;
      } catch (e) {
        // Abbrechen ist kein Fehler, alles andere fällt auf den Download zurück.
        if (e.name === 'AbortError') return;
      }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(data);
    a.download = pdfDatei.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast('PDF heruntergeladen');
  }

  async function protokollLoeschen() {
    const ja = await frage({
      titel: 'Protokoll löschen?',
      text: `${titelVon()} wird mit allen Traktanden und Teilnehmenden entfernt. Für Protokolle gibt es keinen Papierkorb; ein abgeschlossenes lässt sich gar nicht mehr löschen. Bereits erstellte Pendenzen bleiben in der Liste des Projekts stehen.`,
      knopf: 'Löschen'
    });
    if (!ja) return;
    if (!istOnline()) return toast('Dafür braucht es eine Verbindung', true);

    const bilder = traktanden.map(t => t.foto_pfad).filter(Boolean);
    if (bilder.length) await sb.storage.from('protokoll').remove(bilder);

    const { error } = await sb.from('protokolle').delete().eq('id', protokollId);
    if (error) return toast(error.message, true);
    location.replace(`protokolle.html?projekt=${encodeURIComponent(protokoll.projekt_id)}`);
  }

  /* --- Start ---------------------------------------------------------------- */

  (async () => {
    if (!await verlangeLogin()) return;
    if (!protokollId) { location.replace('projekte-bereich.html'); return; }

    const s = await session();
    ich = s.user.id;

    function hinweisZeigen() {
      const el = $('#hinweis');
      el.hidden = istOnline();
      if (!istOnline()) el.textContent = 'Offline. Ein Sitzungsprotokoll braucht eine Verbindung.';
    }
    beiStatuswechsel(hinweisZeigen);

    if (!istOnline()) {
      $('#rechts').innerHTML = '<div class="br-leer">Ohne Verbindung lässt sich das Protokoll nicht laden.</div>';
      beiStatuswechsel(() => { if (istOnline()) location.reload(); });
      return;
    }

    $('#rechts').innerHTML = '<div class="br-leer">Wird geladen…</div>';
    if (!await ladeAlles()) {
      $('#rechts').innerHTML = '<div class="br-leer">Dieses Protokoll gibt es nicht mehr.</div>';
      return;
    }

    $('#m-abschluss').addEventListener('click', abschlussFragen);
    zeichneKopf();
    zeichneTabs();
    zeichneLinks();
    zeichneRechts();
  })();
})();
