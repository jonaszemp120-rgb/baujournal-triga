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
      /* Ab hier gilt die eigene Wahl, und damit verfaellt der Abruf —
         die Zeile darunter genauso wie der Wert, der mit dem Eintrag
         gespeichert wuerde. Sonst stuende spaeter "um 11:42 Uhr
         automatisch abgefragt: Sonnig" an einem Eintrag, bei dem Regen
         angetippt ist. */
      abrufVergessen();
      entwurfSichern();
    }));
  }

  function chipWert(wrap) {
    const b = $('button[aria-pressed="true"]', wrap);
    return b ? b.dataset.wert : null;
  }

  /* --- Wetter jetzt abrufen ---------------------------------------------

     Ein Angebot, kein Weg. Wer den Knopf nicht antippt, merkt nichts
     davon; wer ihn antippt und den Standort nicht freigibt, bekommt eine
     Zeile Text und waehlt wie bisher von Hand. Der Eintrag haengt an
     keiner Stelle daran — es gibt keinen Zustand, in dem das Formular
     auf die Abfrage wartet. */

  /* Der Abruf, solange er gilt: { grad, gemessen_am, quelle, rohwerte }.
     Er wandert mit dem Eintrag in die Datenbank und macht dort den
     Unterschied zwischen einer Angabe, die jemand angetippt hat, und
     einer, die ein Dienst geliefert hat. Null heisst: von Hand. */
  let abruf = null;

  function wetterHinweis(text, warn) {
    const el = $('#wetter-hinweis');
    if (!el) return;
    el.textContent = text || '';
    el.classList.toggle('warn', !!warn);
    el.hidden = !text;
  }

  function abrufVergessen() {
    abruf = null;
    wetterHinweis('');
  }

  /* Wie die Zeile lautet — einmal beim Erfassen, einmal beim Ansehen des
     gespeicherten Eintrags. Damit steht dort später wirklich dasselbe und
     nicht zweimal etwas Ähnliches. */
  function abrufZeile(lage, stufe, grad, wann, quelle, roh) {
    return wetterAbrufText(lage, stufe, grad, wann, quelle, roh)
         + ' Ein Tipp auf einen Chip ändert die Auswahl.';
  }

  function wetterKnopfBinden() {
    const knopf = $('#wetter-jetzt');
    if (!knopf) return;

    /* Fehlt das Modul — etwa weil ein Geraet noch eine aeltere Fassung im
       Cache hat —, verschwindet der Knopf einfach. Ein Knopf, der nichts
       tut, ist schlimmer als keiner. */
    if (typeof WETTER_JETZT === 'undefined') { knopf.hidden = true; return; }

    const ruhe = knopf.innerHTML;
    knopf.addEventListener('click', async () => {
      wetterHinweis('');
      knopf.disabled = true;
      knopf.innerHTML = '<span class="spin"></span><span>Wird geholt …</span>';
      try {
        const w = await WETTER_JETZT.abrufen();
        if (w.lage) chipSetzen($('#wetter'), w.lage);
        if (w.stufe) chipSetzen($('#temperatur'), w.stufe);

        /* Der gelieferte Wert selbst, und nicht nur die Stufe daraus,
           dazu der Dienst und alles, was die Station sonst noch gemeldet
           hat. Alles wandert mit dem Eintrag in die Datenbank; ohne das
           liesse sich später nicht mehr sagen, ob jemand «10–20°C»
           abgefragt oder geschätzt hat, wer gefragt wurde und woraus die
           Lage entstanden ist. Kam keine Gradzahl, gibt es auch nichts
           festzuhalten.

           Der Zeitpunkt kommt von der Messung und nicht von der Uhr
           dieses Geräts: massgebend ist, wann gemessen wurde. */
        abruf = Number.isFinite(w.grad)
          ? { grad: Math.round(w.grad * 10) / 10,
              gemessen_am: w.gemessen_am || new Date().toISOString(),
              quelle: w.quelle || WETTER_JETZT.QUELLE,
              rohwerte: w.rohwerte || null }
          : null;
        entwurfSichern();

        wetterHinweis(abruf
          ? abrufZeile(w.lage, w.stufe, abruf.grad, abruf.gemessen_am, abruf.quelle, abruf.rohwerte)
          : `Gesetzt: ${[w.lage, w.stufe].filter(Boolean).join(' · ')}. `
            + 'Ein Tipp auf einen Chip ändert die Auswahl.');
      } catch (e) {
        /* Jeder Fehlschlag endet hier und nirgends sonst. Kein Dialog,
           keine Sperre, nur die Zeile unter den Chips. */
        abruf = null;
        const text = e && e.message ? e.message : WETTER_JETZT.TEXTE.unbekannt;
        wetterHinweis(e && e.grund === 'verweigert'
          ? `${text} Die Freigabe lässt sich in den Einstellungen des Geräts wieder erteilen.`
          : text, true);
      } finally {
        knopf.disabled = false;
        knopf.innerHTML = ruhe;
      }
    });
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
      /* Nur gesetzt, wenn die Angabe daneben wirklich abgefragt wurde.
         Die Datenbank verlangt Gradzahl, Zeitpunkt und Quelle zusammen
         oder keines davon. */
      wetter_grad: abruf ? abruf.grad : null,
      wetter_gemessen_am: abruf ? abruf.gemessen_am : null,
      wetter_quelle: abruf ? abruf.quelle : null,
      wetter_rohwerte: abruf ? abruf.rohwerte : null,
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

    /* Ein Abruf überlebt den Absturz genauso wie der getippte Text:
       sonst stünde nach dem Wiederherstellen dieselbe Auswahl da, aber
       ohne den Wert, die Quelle und die Rohwerte, die sie zum Abruf
       machen. */
    abruf = e.wetter_gemessen_am
      ? { grad: e.wetter_grad, gemessen_am: e.wetter_gemessen_am,
          quelle: e.wetter_quelle, rohwerte: e.wetter_rohwerte || null }
      : null;
    if (abruf) {
      wetterHinweis(abrufZeile(e.wetter, e.temperatur, abruf.grad, abruf.gemessen_am,
                               abruf.quelle, abruf.rohwerte));
    }

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
    /* Übernommen wird immer nur der Chip, nie der Abruf des letzten
       Eintrags — der galt an jenem Tag und nicht heute. Und wer hier
       etwas übernimmt, hebt damit einen eigenen Abruf auf: er beschriebe
       sonst eine Auswahl, die inzwischen von woanders kommt. */
    if (letzter.wetter && !chipWert($('#wetter'))) { chipSetzen($('#wetter'), letzter.wetter); uebernommen.push('Wetter'); }
    if (letzter.temperatur && !chipWert($('#temperatur'))) { chipSetzen($('#temperatur'), letzter.temperatur); uebernommen.push('Temperatur'); }
    if (uebernommen.includes('Wetter') || uebernommen.includes('Temperatur')) abrufVergessen();

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
  document.title = `${projekt.name} · Baujournal · TRIGA App`;

  const p = await profil();
  $('#f-bauleiter').textContent = p?.name || '–';
  $('#f-datum').value = heute();
  datumAnzeigen();

  chips($('#wetter'), WETTER, '', true);
  chips($('#temperatur'), TEMPERATUR, 'temp', false);
  wetterKnopfBinden();

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
