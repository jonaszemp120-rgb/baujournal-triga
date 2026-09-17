/* Detailansicht eines Eintrags: lesen, exportieren, korrigieren.
   Eine Korrektur überschreibt nie still: die Datenbankfunktion
   korrigiere_eintrag schreibt in derselben Transaktion das
   Korrekturprotokoll und die neuen Werte. Das Protokoll steht unten
   im Screen, mit altem und neuem Wert. */

(async () => {
  if (!await verlangeLogin()) return;

  const id = new URLSearchParams(location.search).get('id');
  if (!id) { location.replace('projekte.html'); return; }

  const HAKEN = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';

  /* Feldname in der Anzeige, Spaltenname in der Datenbank. */
  const TEXTFELDER = [
    ['firmen', 'Firmen / Mannschaft vor Ort', 'Welche Unternehmer mit wie vielen Leuten …'],
    ['fortschritt', 'Baufortschritt', 'Welche Arbeiten sind gelaufen …'],
    ['feststellungen', 'Feststellungen / Mängel', 'Abweichungen, Mängel, Schäden …'],
    ['anweisungen', 'Erteilte Anweisungen', 'Mündliche Anweisungen an Unternehmer vor Ort …']
  ];

  let eintrag = null, projekt = null, korrekturen = [];
  let modus = 'lesen';
  let entwurf = null;   // Arbeitskopie im Korrekturmodus

  const inhalt = $('#inhalt');

  /* --- Bausteine -------------------------------------------------------- */

  const karte = (titel, koerper, extra = '') =>
    `<div class="karte"><div class="kartentitel">${esc(titel)}</div>${koerper}${extra}</div>`;

  const wert = t => String(t ?? '').trim()
    ? `<div class="werttext">${esc(t)}</div>`
    : '<div class="werttext leer">keine Angabe</div>';

  const paar = (k, v) => `
    <div style="display:flex; align-items:baseline; justify-content:space-between; gap:12px; padding:7px 0;">
      <div style="font-size:11px; color:var(--text-dim); font-weight:600; text-transform:uppercase; letter-spacing:.04em; flex-shrink:0;">${esc(k)}</div>
      <div style="font-size:14px; font-weight:700; color:var(--text); text-align:right; overflow-wrap:anywhere;">${esc(v || '–')}</div>
    </div>`;

  const chipAnzeige = (w, rot) => w
    ? `<span class="chip${rot ? ' temp' : ''}" aria-pressed="true" style="display:inline-flex;">${esc(rot ? '' : (WETTER_ICON[w] || ''))}${esc(w)}</span>`
    : '<span class="werttext leer">keine Angabe</span>';

  function kontrollListe(punkte, klickbar) {
    if (!punkte.length) return '<div class="werttext leer">keine Punkte erfasst</div>';
    return punkte.map((p, i) => `
      <div class="kp" data-i="${i}" data-ok="${p.ok ? 1 : 0}"${klickbar ? ' role="checkbox" tabindex="0" aria-checked="' + !!p.ok + '"' : ''}>
        <div class="box">${HAKEN}</div>
        <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap; min-width:0;">
          <div class="label" style="overflow-wrap:anywhere;">${esc(p.label)}</div>
          ${p.projektspezifisch ? '<div style="font-size:10px; font-weight:700; letter-spacing:.03em; color:#b20000; background:rgba(178,0,0,0.08); border-radius:999px; padding:3px 8px; text-transform:uppercase; flex-shrink:0;">Projektspezifisch</div>' : ''}
        </div>
      </div>`).join('');
  }

  /* --- Leseansicht ------------------------------------------------------ */

  function zeichneLesen() {
    const { erfuellt, total } = kontrollStand(eintrag.kontrolle);
    const p = eintrag.kontrolle?.punkte || [];

    const teile = [
      karte('Rundgang',
        paar('Datum', fmtDatum(eintrag.datum)) +
        paar('Bauleiter', eintrag.ersteller_name || 'Unbekannt') +
        paar('Erfasst am', eintrag.erstellt_am ? new Date(eintrag.erstellt_am).toLocaleString('de-CH') : '–') +
        (eintrag._offen ? '<div style="margin-top:8px; font-size:12px; font-weight:700; color:var(--red);">Noch nicht übertragen, liegt in der Warteschlange.</div>' : '')),

      karte('Wetter',
        `<div style="display:flex; flex-wrap:wrap; gap:8px;">${chipAnzeige(eintrag.wetter, false)}${chipAnzeige(eintrag.temperatur, true)}</div>`),

      `<div class="karte">
        <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; margin-bottom:6px;">
          <div class="kartentitel" style="margin:0;">Allgemeine Kontrolle</div>
          <div style="font-size:12px; font-weight:700; color:var(--text-dim);">${erfuellt}/${total}</div>
        </div>
        ${kontrollListe(p, false)}
      </div>`,

      ...TEXTFELDER.map(([feld, titel]) => karte(titel, wert(eintrag[feld]))),

      `<div class="kp hinweis karte" data-ok="${eintrag.fotos_hinweis ? 1 : 0}" style="gap:12px;">
        <div class="box">${HAKEN}</div>
        <div class="label" style="font-size:13.5px; font-weight:500;">Fotos gemacht, separat auf Server ablegen</div>
      </div>`
    ];

    if (korrekturen.length) teile.push(korrekturKarte());
    inhalt.dataset.modus = 'lesen';
    inhalt.innerHTML = teile.join('');
  }

  function korrekturKarte() {
    const zeilen = korrekturen.map((k, i) => `
      <div style="padding:11px 0; ${i === korrekturen.length - 1 ? '' : 'border-bottom:1px solid var(--border);'}">
        <div style="font-size:13px; font-weight:700; color:var(--text); overflow-wrap:anywhere;">${esc(k.feld)}</div>
        <div style="font-size:12.5px; color:var(--text-dim); margin-top:4px; line-height:1.5; overflow-wrap:anywhere;">
          <span style="text-decoration:line-through;">${esc(k.alter_wert || 'leer')}</span>
          <span style="color:var(--text-dim);"> → </span>
          <span style="color:var(--text); font-weight:600;">${esc(k.neuer_wert || 'leer')}</span>
        </div>
        <div style="font-size:11.5px; color:var(--text-dim); margin-top:5px; font-weight:600;">
          ${esc(k.geaendert_name || 'Unbekannt')} · ${esc(new Date(k.geaendert_am).toLocaleString('de-CH'))}
        </div>
      </div>`).join('');
    return `<div class="karte">
      <div class="kartentitel">Nachträgliche Korrekturen</div>
      <div style="font-size:12.5px; color:var(--text-dim); line-height:1.5; margin-bottom:6px;">Das Baujournal dient im Streitfall als Beweismittel. Jede Änderung bleibt hier mit altem und neuem Wert stehen.</div>
      ${zeilen}
    </div>`;
  }

  /* --- Korrekturansicht ------------------------------------------------- */

  function zeichneKorrigieren() {
    inhalt.dataset.modus = 'korrigieren';
    inhalt.innerHTML = [
      `<div class="karte" style="background:rgba(178,0,0,0.05); border-color:rgba(178,0,0,0.2);">
        <div class="kartentitel">Korrektur</div>
        <div style="font-size:12.5px; color:var(--text-dim); line-height:1.5;">Jede Änderung wird zusätzlich protokolliert, mit altem Wert, neuem Wert, Name und Zeitpunkt. Der ursprüngliche Eintrag bleibt nachvollziehbar.</div>
      </div>`,

      karte('Rundgang', `
        <div style="display:flex; flex-direction:column; gap:6px;">
          <label for="e-datum" style="font-size:11px; font-weight:700; letter-spacing:.04em; text-transform:uppercase; color:var(--text-dim);">Datum</label>
          <input id="e-datum" type="date" value="${esc(String(entwurf.datum).slice(0, 10))}" style="height:44px; border-radius:10px; border:1.5px solid var(--border); padding:0 13px; font-size:14px; color:var(--text); box-sizing:border-box;">
        </div>`),

      karte('Wetter', '<div id="e-wetter" style="display:flex; flex-wrap:wrap; gap:8px; margin-bottom:14px;"></div><div id="e-temp" style="display:flex; flex-wrap:wrap; gap:8px;"></div>'),

      `<div class="karte">
        <div class="kartentitel">Allgemeine Kontrolle</div>
        <div id="e-kontrolle">${kontrollListe(entwurf.kontrolle.punkte, true)}</div>
      </div>`,

      ...TEXTFELDER.map(([feld, titel, platzhalter]) =>
        karte(titel, `<textarea id="e-${feld}" class="feld" placeholder="${esc(platzhalter)}">${esc(entwurf[feld] || '')}</textarea>`)),

      `<div id="e-fotos" class="kp hinweis karte" data-ok="${entwurf.fotos_hinweis ? 1 : 0}" role="checkbox" tabindex="0" aria-checked="${!!entwurf.fotos_hinweis}" style="gap:12px;">
        <div class="box">${HAKEN}</div>
        <div class="label" style="font-size:13.5px; font-weight:500;">Fotos gemacht, separat auf Server ablegen</div>
      </div>`
    ].join('');

    chipsBauen($('#e-wetter'), WETTER, false, entwurf.wetter, w => entwurf.wetter = w);
    chipsBauen($('#e-temp'), TEMPERATUR, true, entwurf.temperatur, w => entwurf.temperatur = w);

    $$('#e-kontrolle .kp').forEach(el => {
      const um = () => {
        const i = +el.dataset.i;
        entwurf.kontrolle.punkte[i].ok = !entwurf.kontrolle.punkte[i].ok;
        el.dataset.ok = entwurf.kontrolle.punkte[i].ok ? 1 : 0;
        el.setAttribute('aria-checked', String(entwurf.kontrolle.punkte[i].ok));
      };
      el.addEventListener('click', um);
      el.addEventListener('keydown', e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); um(); } });
    });

    const f = $('#e-fotos');
    const fUm = () => {
      entwurf.fotos_hinweis = !entwurf.fotos_hinweis;
      f.dataset.ok = entwurf.fotos_hinweis ? 1 : 0;
      f.setAttribute('aria-checked', String(entwurf.fotos_hinweis));
    };
    f.addEventListener('click', fUm);
    f.addEventListener('keydown', e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); fUm(); } });
  }

  function chipsBauen(wrap, werte, temp, aktiv, beiWahl) {
    wrap.innerHTML = werte.map(w => `
      <button type="button" class="chip${temp ? ' temp' : ''} pressable" data-wert="${esc(w)}" aria-pressed="${w === aktiv}">
        ${!temp && WETTER_ICON[w] ? `<span aria-hidden="true">${WETTER_ICON[w]}</span>` : ''}${esc(w)}
      </button>`).join('');
    $$('button', wrap).forEach(b => b.addEventListener('click', () => {
      const an = b.getAttribute('aria-pressed') === 'true';
      $$('button', wrap).forEach(x => x.setAttribute('aria-pressed', 'false'));
      b.setAttribute('aria-pressed', an ? 'false' : 'true');
      beiWahl(an ? null : b.dataset.wert);
    }));
  }

  /* --- Aktionsleiste ---------------------------------------------------- */

  const BTN_ROT = 'flex:1; display:flex; align-items:center; justify-content:center; gap:8px; height:52px; border:none; border-radius:14px; background:#b20000; color:#fff; font-weight:700; font-size:15px; box-shadow:0 10px 24px rgba(178,0,0,0.28);';
  const BTN_GRAU = 'flex:1; display:flex; align-items:center; justify-content:center; gap:8px; height:52px; border-radius:14px; background:var(--card); border:1.5px solid var(--border); color:var(--navy); font-weight:700; font-size:15px;';

  function zeichneAktionen() {
    const bar = $('#aktionen');
    if (modus === 'lesen') {
      bar.innerHTML = `
        <button id="pdf" class="btn-primary pressable" style="${BTN_ROT}">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          Als PDF
        </button>
        <button id="word" class="pressable" style="${BTN_GRAU}">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="var(--navy)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          Als Word
        </button>`;
      $('#pdf').addEventListener('click', () => exportieren('pdf'));
      $('#word').addEventListener('click', () => exportieren('word'));
    } else {
      bar.innerHTML = `
        <button id="abbrechen" class="pressable" style="${BTN_GRAU}">Abbrechen</button>
        <button id="uebernehmen" class="btn-primary pressable" style="${BTN_ROT}">Korrektur speichern</button>`;
      $('#abbrechen').addEventListener('click', () => setzeModus('lesen'));
      $('#uebernehmen').addEventListener('click', korrekturSpeichern);
    }
  }

  async function exportieren(art) {
    const btn = $(art === 'pdf' ? '#pdf' : '#word');
    const alt = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="spin" style="border-color:rgba(0,35,63,.25); border-top-color:var(--navy);"></span>';
    try {
      if (art === 'pdf') await exportPDF([eintrag], projekt);
      else await exportWord([eintrag], projekt);
    } catch (e) {
      toast(e.message || 'Export hat nicht geklappt', true);
    } finally {
      btn.disabled = false;
      btn.innerHTML = alt;
    }
  }

  function setzeModus(neu) {
    modus = neu;
    if (neu === 'korrigieren') {
      entwurf = JSON.parse(JSON.stringify({
        datum: eintrag.datum, wetter: eintrag.wetter, temperatur: eintrag.temperatur,
        kontrolle: eintrag.kontrolle || { punkte: [] },
        firmen: eintrag.firmen, fortschritt: eintrag.fortschritt,
        feststellungen: eintrag.feststellungen, anweisungen: eintrag.anweisungen,
        fotos_hinweis: eintrag.fotos_hinweis
      }));
      zeichneKorrigieren();
    } else {
      zeichneLesen();
    }
    $('#stift').setAttribute('aria-label', neu === 'lesen' ? 'Eintrag korrigieren' : 'Korrektur abbrechen');
    $('#stift').style.background = neu === 'lesen' ? 'rgba(255,255,255,0.08)' : 'var(--red)';
    zeichneAktionen();
    scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* --- Korrektur speichern ---------------------------------------------- */

  function unterschiede() {
    const log = [], neu = {};
    const jetzt = {
      datum: $('#e-datum').value || eintrag.datum,
      wetter: entwurf.wetter,
      temperatur: entwurf.temperatur,
      firmen: $('#e-firmen').value.trim() || null,
      fortschritt: $('#e-fortschritt').value.trim() || null,
      feststellungen: $('#e-feststellungen').value.trim() || null,
      anweisungen: $('#e-anweisungen').value.trim() || null,
      fotos_hinweis: !!entwurf.fotos_hinweis
    };

    if (String(jetzt.datum) !== String(eintrag.datum).slice(0, 10)) {
      log.push({ feld: 'Datum', alter_wert: fmtDatum(eintrag.datum), neuer_wert: fmtDatum(jetzt.datum) });
      neu.datum = jetzt.datum;
    }
    for (const [feld, titel] of [['wetter', 'Wetter'], ['temperatur', 'Temperatur'],
                                 ...TEXTFELDER.map(([f, t]) => [f, t])]) {
      if ((jetzt[feld] || null) !== (eintrag[feld] || null)) {
        log.push({ feld: titel, alter_wert: eintrag[feld] || null, neuer_wert: jetzt[feld] || null });
        neu[feld] = jetzt[feld];
      }
    }
    if (jetzt.fotos_hinweis !== !!eintrag.fotos_hinweis) {
      log.push({ feld: 'Fotos-Hinweis', alter_wert: eintrag.fotos_hinweis ? 'ja' : 'nein', neuer_wert: jetzt.fotos_hinweis ? 'ja' : 'nein' });
      neu.fotos_hinweis = jetzt.fotos_hinweis;
    }

    // Checkliste punktweise vergleichen, damit im Protokoll steht,
    // welcher Punkt sich geaendert hat und nicht nur "Kontrolle".
    const vorher = new Map((eintrag.kontrolle?.punkte || []).map(p => [p.label, !!p.ok]));
    let kontrolleGeaendert = false;
    for (const p of entwurf.kontrolle.punkte) {
      const alt = vorher.get(p.label);
      if (alt !== undefined && alt !== !!p.ok) {
        log.push({ feld: `Kontrolle: ${p.label}`, alter_wert: alt ? 'erfüllt' : 'offen', neuer_wert: p.ok ? 'erfüllt' : 'offen' });
        kontrolleGeaendert = true;
      }
    }
    if (kontrolleGeaendert) neu.kontrolle = entwurf.kontrolle;

    return { log, neu, jetzt };
  }

  async function korrekturSpeichern() {
    const { log, neu, jetzt } = unterschiede();
    if (!log.length) { toast('Nichts geändert'); setzeModus('lesen'); return; }

    if (eintrag._offen) {
      toast('Dieser Eintrag ist noch nicht übertragen, korrigieren geht erst danach', true);
      return;
    }

    const btn = $('#uebernehmen');
    btn.disabled = true;
    btn.innerHTML = '<span class="spin"></span>';

    const r = await korrigiereEintrag(eintrag.id, neu, log);

    Object.assign(eintrag, jetzt);
    if (neu.kontrolle) eintrag.kontrolle = neu.kontrolle;
    korrekturen = await ladeKorrekturen(eintrag.id);

    setzeModus('lesen');
    toast(r.wartet
      ? 'Offline erfasst, Korrektur wird später übertragen'
      : `${r.geaendert} ${r.geaendert === 1 ? 'Änderung' : 'Änderungen'} protokolliert`);
  }

  $('#stift').addEventListener('click', () => setzeModus(modus === 'lesen' ? 'korrigieren' : 'lesen'));

  /* --- Start ------------------------------------------------------------ */

  eintrag = await ladeEintrag(id);
  if (!eintrag) { toast('Eintrag nicht gefunden', true); setTimeout(() => location.replace('projekte.html'), 1400); return; }

  projekt = eintrag.projekt || await ladeProjekt(eintrag.projekt_id);
  $('#zurueck').href = `journal.html?projekt=${encodeURIComponent(eintrag.projekt_id)}`;
  $('#k-titel').textContent = `Rundgang ${fmtDatum(eintrag.datum)}`;
  $('#k-sub').textContent = projekt?.name || '';
  document.title = `${fmtDatum(eintrag.datum)} · Baujournal`;

  korrekturen = await ladeKorrekturen(id);
  zeichneLesen();
  zeichneAktionen();
})();
