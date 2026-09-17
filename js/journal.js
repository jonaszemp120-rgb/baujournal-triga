/* Baujournal-Formular samt Verlauf.
   Der Formularinhalt wird laufend in localStorage gesichert, damit ein
   Absturz, ein Tab-Wechsel oder ein leerer Akku nichts kostet. */

(async () => {
  if (!await verlangeLogin()) return;

  const projektId = new URLSearchParams(location.search).get('projekt');
  if (!projektId) { location.replace('projekte.html'); return; }

  const ENTWURF = `bj_entwurf_${projektId}`;
  const HAKEN = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';

  let projekt = null;
  let punkte = [];
  let eintraege = [];
  let hatGebaeude = false;

  /* --- Kopfzeile und Netzstatus ---------------------------------------- */

  $('#p-edit').href = `projekt.html?id=${encodeURIComponent(projektId)}`;
  $('#zurueck').href = `projekt-start.html?projekt=${encodeURIComponent(projektId)}`;

  beiStatuswechsel(() => {
    const on = istOnline();
    $('#netz-punkt').style.background = on ? 'var(--ok)' : 'var(--mute)';
    $('#netz-text').textContent = on ? 'Online' : 'Offline';
    $('#netz-text').style.color = on ? 'var(--text-dim)' : 'var(--red)';
  });

  function syncAnzeige() {
    const n = offen();
    const el = $('#sync-zahl');
    el.hidden = !n;
    el.textContent = n;
  }
  document.addEventListener('queue', syncAnzeige);

  $('#sync').addEventListener('click', async () => {
    const n = offen();
    if (!n) return toast(istOnline() ? 'Alles übertragen' : 'Offline, nichts in der Warteschlange');
    if (!istOnline()) return toast(`${n} ${n === 1 ? 'Eintrag wartet' : 'Einträge warten'} auf Empfang`, true);
    toast('Übertrage …');
    const r = await syncWarteschlange();
    syncAnzeige();
    toast(r.offen ? `${r.offen} noch offen` : 'Alles übertragen', !!r.offen);
    if (r.erledigt) ladeVerlauf();
  });

  /* --- Chips ------------------------------------------------------------ */

  function chips(wrap, werte, klasse, mitIcon) {
    wrap.innerHTML = werte.map(w => `
      <button type="button" class="chip ${klasse} pressable" data-wert="${esc(w)}" aria-pressed="false">
        ${mitIcon && WETTER_ICON[w] ? `<span aria-hidden="true">${WETTER_ICON[w]}</span>` : ''}${esc(w)}
      </button>`).join('');
    $$('button', wrap).forEach(b => b.addEventListener('click', () => {
      const an = b.getAttribute('aria-pressed') === 'true';
      $$('button', wrap).forEach(x => x.setAttribute('aria-pressed', 'false'));
      b.setAttribute('aria-pressed', an ? 'false' : 'true');   // nochmals tippen hebt auf
      entwurfSichern();
    }));
  }

  function chipWert(wrap) {
    const b = $('button[aria-pressed="true"]', wrap);
    return b ? b.dataset.wert : null;
  }

  /* Gebaeude-Chips erlauben Mehrfachauswahl. "Alle" ist der Gegensatz
     zur Einzelauswahl: wer Alle tippt, verliert die Einzelnen und
     umgekehrt. Gespeichert wird genau das, was angetippt wurde. */
  function gebaeudeChips(wrap, namen) {
    wrap.innerHTML = [ALLE, ...namen].map(w => `
      <button type="button" class="chip pressable" data-wert="${esc(w)}" aria-pressed="false">${esc(w)}</button>`).join('');
    $$('button', wrap).forEach(b => b.addEventListener('click', () => {
      const an = b.getAttribute('aria-pressed') === 'true';
      if (b.dataset.wert === ALLE) {
        $$('button', wrap).forEach(x => x.setAttribute('aria-pressed', 'false'));
        b.setAttribute('aria-pressed', an ? 'false' : 'true');
      } else {
        $(`button[data-wert="${CSS.escape(ALLE)}"]`, wrap)?.setAttribute('aria-pressed', 'false');
        b.setAttribute('aria-pressed', an ? 'false' : 'true');
      }
      entwurfSichern();
    }));
  }

  function chipWerte(wrap) {
    return $$('button[aria-pressed="true"]', wrap).map(b => b.dataset.wert);
  }
  function chipeSetzen(wrap, werte) {
    const gesetzt = new Set(werte || []);
    $$('button', wrap).forEach(b => b.setAttribute('aria-pressed', String(gesetzt.has(b.dataset.wert))));
  }
  function chipSetzen(wrap, wert) {
    $$('button', wrap).forEach(b => b.setAttribute('aria-pressed', String(b.dataset.wert === wert)));
  }

  /* --- Checkliste ------------------------------------------------------- */

  function zeichneKontrolle() {
    $('#kontrolle').innerHTML = punkte.map((p, i) => `
      <div class="kp" data-i="${i}" data-ok="${p.ok ? 1 : 0}" role="checkbox" aria-checked="${!!p.ok}" tabindex="0">
        <div class="box">${HAKEN}</div>
        <div class="label" style="overflow-wrap:anywhere; min-width:0;">${esc(p.label)}</div>
      </div>`).join('');

    $$('#kontrolle .kp').forEach(el => {
      const um = () => {
        const i = +el.dataset.i;
        punkte[i].ok = !punkte[i].ok;
        el.dataset.ok = punkte[i].ok ? 1 : 0;
        el.setAttribute('aria-checked', String(punkte[i].ok));
        standAnzeigen();
        entwurfSichern();
      };
      el.addEventListener('click', um);
      el.addEventListener('keydown', e => {
        if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); um(); }
      });
    });
    standAnzeigen();
  }

  function standAnzeigen() {
    $('#kp-stand').textContent = `${punkte.filter(p => p.ok).length}/${punkte.length}`;
  }

  /* Fotos-Hinweis verhält sich wie ein Kontrollpunkt. */
  const fotos = $('#fotos');
  const fotosUm = () => {
    const an = fotos.dataset.ok !== '1';
    fotos.dataset.ok = an ? 1 : 0;
    fotos.setAttribute('aria-checked', String(an));
    entwurfSichern();
  };
  fotos.addEventListener('click', fotosUm);
  fotos.addEventListener('keydown', e => {
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); fotosUm(); }
  });

  /* --- Entwurf ---------------------------------------------------------- */

  function formular() {
    return {
      datum: $('#f-datum').value || heute(),
      wetter: chipWert($('#wetter')),
      temperatur: chipWert($('#temperatur')),
      kontrolle: { punkte },
      betrifft_gebaeude: hatGebaeude ? chipWerte($('#betrifft')) : null,
      firmen: $('#f-firmen').value.trim() || null,
      fortschritt: $('#f-fortschritt').value.trim() || null,
      feststellungen: $('#f-feststellungen').value.trim() || null,
      anweisungen: $('#f-anweisungen').value.trim() || null,
      fotos_hinweis: fotos.dataset.ok === '1'
    };
  }

  /* Eine reine Gebaeudeauswahl ist noch kein Rundgang, die zaehlt hier
     bewusst nicht mit. */
  function istLeer(f) {
    return !f.wetter && !f.temperatur && !f.firmen && !f.fortschritt &&
           !f.feststellungen && !f.anweisungen && !f.fotos_hinweis &&
           !f.kontrolle.punkte.some(p => p.ok);
  }

  let sichernTimer;
  function entwurfSichern() {
    clearTimeout(sichernTimer);
    sichernTimer = setTimeout(() => {
      const f = formular();
      if (istLeer(f)) { localStorage.removeItem(ENTWURF); return; }
      try { localStorage.setItem(ENTWURF, JSON.stringify({ ...f, gesichert: Date.now() })); } catch {}
    }, 250);
  }

  function entwurfLaden() {
    let e;
    try { e = JSON.parse(localStorage.getItem(ENTWURF) || 'null'); } catch { return false; }
    if (!e) return false;
    $('#f-datum').value = e.datum || heute();
    datumAnzeigen();
    chipSetzen($('#wetter'), e.wetter);
    chipSetzen($('#temperatur'), e.temperatur);
    $('#f-firmen').value = e.firmen || '';
    $('#f-fortschritt').value = e.fortschritt || '';
    $('#f-feststellungen').value = e.feststellungen || '';
    $('#f-anweisungen').value = e.anweisungen || '';
    fotos.dataset.ok = e.fotos_hinweis ? 1 : 0;
    fotos.setAttribute('aria-checked', String(!!e.fotos_hinweis));
    if (hatGebaeude) chipeSetzen($('#betrifft'), e.betrifft_gebaeude);

    // Gespeicherte Haken auf die aktuelle Punkteliste uebertragen. Punkte,
    // die das Projekt seither verloren hat, fallen dabei weg.
    const gesetzt = new Map((e.kontrolle?.punkte || []).map(p => [p.label, !!p.ok]));
    punkte.forEach(p => { if (gesetzt.has(p.label)) p.ok = gesetzt.get(p.label); });
    return true;
  }

  /* Der Datumswaehler liegt unsichtbar ueber der fetten Zeile, die
     Anzeige wird deshalb von Hand nachgefuehrt, in Schweizer
     Schreibweise statt im Format des Browsers. */
  function datumAnzeigen() {
    $('#datum-text').textContent = fmtDatum($('#f-datum').value || heute());
  }

  $$('#f-firmen, #f-fortschritt, #f-feststellungen, #f-anweisungen')
    .forEach(el => el.addEventListener('input', entwurfSichern));
  $('#f-datum').addEventListener('input', () => { datumAnzeigen(); entwurfSichern(); });

  /* --- frühere Einträge -------------------------------------------------

     Die Liste selbst steht auf der Projekt-Startseite. Hier werden die
     Einträge nur geladen, damit der Knopf "Angaben von letztem Eintrag
     übernehmen" weiss, was es zu übernehmen gibt. */

  async function ladeVerlauf() {
    eintraege = await ladeEintraege(projektId);
  }

  /* --- Angaben vom letzten Eintrag -------------------------------------- */

  /* Uebernimmt nur, was aktuell leer ist. Ein schon getippter Text wird
     nie ueberschrieben, sonst waere der Knopf gefaehrlich. */
  $('#uebernehmen').addEventListener('click', () => {
    const letzter = eintraege.find(e => e.datum !== ($('#f-datum').value || heute())) || eintraege[0];
    if (!letzter) return toast('Es gibt noch keinen früheren Eintrag', true);

    const uebernommen = [];
    const setzeText = (sel, wert, name) => {
      const el = $(sel);
      if (wert && !el.value.trim()) { el.value = wert; uebernommen.push(name); }
    };
    setzeText('#f-firmen', letzter.firmen, 'Firmen');
    setzeText('#f-fortschritt', letzter.fortschritt, 'Baufortschritt');
    if (letzter.wetter && !chipWert($('#wetter'))) { chipSetzen($('#wetter'), letzter.wetter); uebernommen.push('Wetter'); }
    if (letzter.temperatur && !chipWert($('#temperatur'))) { chipSetzen($('#temperatur'), letzter.temperatur); uebernommen.push('Temperatur'); }

    entwurfSichern();
    toast(uebernommen.length
      ? `Übernommen vom ${fmtDatum(letzter.datum)}: ${uebernommen.join(', ')}`
      : 'Nichts zu übernehmen, die Felder sind schon ausgefüllt');
  });

  /* --- Speichern -------------------------------------------------------- */

  $('#speichern').addEventListener('click', async () => {
    const f = formular();
    if (istLeer(f)) return toast('Der Eintrag ist noch leer', true);

    const btn = $('#speichern');
    btn.disabled = true;
    btn.innerHTML = '<span class="spin"></span>';

    const r = await speichereEintrag({ ...f, projekt_id: projektId });

    localStorage.removeItem(ENTWURF);
    syncAnzeige();
    toast(r.wartet ? 'Offline gespeichert, wird später übertragen' : 'Eintrag gespeichert');

    // Zurueck auf die Projekt-Startseite, dort steht der frische Eintrag
    // in der Liste der abgeschlossenen Eintraege.
    setTimeout(() => location.replace(`projekt-start.html?projekt=${encodeURIComponent(projektId)}`), 700);
  });

  /* --- Start ------------------------------------------------------------ */

  projekt = await ladeProjekt(projektId);
  if (!projekt) { toast('Projekt nicht gefunden', true); setTimeout(() => location.replace('projekte.html'), 1400); return; }

  $('#p-name').textContent = projekt.name;
  $('#p-standort').textContent = [projekt.standort, projekt.bauherrschaft].filter(Boolean).join(' · ');
  document.title = `${projekt.name} · Baujournal`;

  const p = await profil();
  $('#f-bauleiter').textContent = p?.name || '–';
  $('#f-datum').value = heute();
  datumAnzeigen();

  chips($('#wetter'), WETTER, '', true);
  chips($('#temperatur'), TEMPERATUR, 'temp', false);

  // Fuehrt das Projekt keine Gebaeude, faellt die ganze Zeile weg.
  hatGebaeude = Array.isArray(projekt.gebaeude) && projekt.gebaeude.length > 0;
  if (hatGebaeude) {
    gebaeudeChips($('#betrifft'), projekt.gebaeude);
    $('#betrifft-karte').hidden = false;
  }

  punkte = kontrollpunkte(projekt);

  const wiederhergestellt = entwurfLaden();
  zeichneKontrolle();
  syncAnzeige();
  if (wiederhergestellt) toast('Nicht gespeicherter Entwurf wiederhergestellt');

  await syncWarteschlange();
  syncAnzeige();
  await ladeVerlauf();
})();
