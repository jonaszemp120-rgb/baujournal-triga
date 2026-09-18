/* Bereich Formulare: Spesen- und Ferienanträge.
 *
 * Ein Antrag geht einen Weg und nur einen: eingereicht, dann genehmigt
 * oder abgelehnt. Solange niemand entschieden hat, lässt er sich
 * zurückziehen; danach ist er ein Nachweis und bleibt stehen.
 *
 * Spesen und Ferien stehen in derselben Tabelle, unterschieden durch art.
 * Sie durchlaufen denselben Weg und stehen in derselben Liste — zwei
 * Tabellen hiessen zwei Abfragen für eine Liste.
 *
 * Wer entscheiden darf, entscheidet die Datenbank: die Policy lässt ein
 * Update nur mit der erweiterten Stufe zu, und der Trigger antrag_schutz()
 * lässt dabei nur den Entscheid durch, nicht den Inhalt. Hier wird der
 * Abschnitt nur weggelassen, wo er ohnehin nichts bewirkte.
 *
 * Das Formular liegt auf dem Handy in einem Blatt von unten und auf dem
 * Desktop fest in der linken Spalte. Gezeichnet wird es von einer
 * einzigen Funktion — zwei Fassungen desselben Formulars liefen früher
 * oder später auseinander.
 */

(() => {
  const IKON = {
    plus: '<path d="M12 5v14M5 12h14"/>',
    weg: '<path d="M18 6 6 18M6 6l12 12"/>',
    bild: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>',
    beleg: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>'
  };
  const svg = (d, g = 16) => `<svg viewBox="0 0 24 24" width="${g}" height="${g}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;

  const breit = () => matchMedia('(min-width:1024px)').matches;

  const STATUS = {
    eingereicht: { titel: 'Eingereicht', farbe: 'grau' },
    genehmigt:   { titel: 'Genehmigt',   farbe: 'gruen' },
    abgelehnt:   { titel: 'Abgelehnt',   farbe: 'rot' }
  };

  let ich = null;
  let leute = [];
  let antraege = [];
  let darfEntscheiden = false;

  const nameVon = u => leute.find(l => l.user_id === u)?.name || 'Unbekannt';

  /* --- Texte ---------------------------------------------------------------- */

  const franken = b => 'CHF ' + Number(b || 0).toLocaleString('de-CH',
    { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const kurzDatum = d => {
    if (!d) return '';
    const [, m, t] = String(d).slice(0, 10).split('-');
    return `${t}.${m}.`;
  };

  /* Wie viele Tage ein Ferienantrag umfasst, beide Enden mitgezählt:
     vom Montag bis zum Freitag sind es fünf Tage und nicht vier. */
  const tage = a => Math.round(
    (new Date(a.bis + 'T00:00:00') - new Date(a.von + 'T00:00:00')) / 86400000) + 1;

  function titelVon(a) {
    if (a.art === 'spesen') return `Spesen — ${a.beschrieb}`;
    return `Ferien — ${kurzDatum(a.von)}–${kurzDatum(a.bis)}`;
  }

  function unterVon(a) {
    const eingereicht = `eingereicht ${kurzDatum(a.erstellt_am)}`;
    if (a.art === 'spesen') return `${franken(a.betrag)} · ${eingereicht}`;
    const n = tage(a);
    return `${n} ${n === 1 ? 'Tag' : 'Tage'} · ${eingereicht}`;
  }

  /* Die Kurzform in der Genehmigen-Karte, so wie im Design: was beantragt
     wird, in einer Zeile. */
  function knappVon(a) {
    if (a.art === 'spesen') return `Spesen, ${franken(a.betrag)} · ${a.beschrieb}`;
    const n = tage(a);
    return `Ferien, ${kurzDatum(a.von)}–${kurzDatum(a.bis)} · ${n} ${n === 1 ? 'Tag' : 'Tage'}`;
  }

  /* --- Laden ---------------------------------------------------------------- */

  async function ladeAlles() {
    if (!istOnline()) return;
    const [ma, an] = await Promise.all([
      sb.from('mitarbeiter').select('user_id, name').not('user_id', 'is', null).is('geloescht_am', null).order('name'),
      sb.from('antraege')
        .select('id, art, betrag, beschrieb, beleg_pfad, von, bis, bemerkung, status, entschieden_von, entschieden_am, erstellt_von, erstellt_am')
        .order('erstellt_am', { ascending: false })
    ]);
    meckern('Team laden', ma.error);
    meckern('Anträge laden', an.error);
    leute = ma.data || [];
    antraege = an.data || [];
  }

  /* --- Zeichnen ------------------------------------------------------------- */

  function zeichneOffene() {
    const el = $('#offene');
    if (!darfEntscheiden) { el.innerHTML = ''; return; }

    /* Die eigenen Anträge stehen unten bei "Meine Anträge" und nicht auch
       noch hier oben — sonst stünde derselbe Antrag zweimal auf dem
       Bildschirm. Entscheiden lässt er sich dort. */
    const offen = antraege.filter(a => a.status === 'eingereicht' && a.erstellt_von !== ich);
    if (!offen.length) {
      el.innerHTML = `
        <div class="fm-label">Zur Genehmigung — Geschäftsleitung</div>
        <div class="pj-leer">Nichts offen.</div>`;
      return;
    }

    el.innerHTML = `
      <div class="fm-label">Zur Genehmigung — Geschäftsleitung</div>
      ${offen.map(a => `
        <div class="fm-karte" data-offen="${esc(a.id)}">
          <div class="wer">${esc(nameVon(a.erstellt_von))}</div>
          <div class="was">${esc(knappVon(a))}</div>
          ${a.bemerkung ? `<div class="was">${esc(a.bemerkung)}</div>` : ''}
          ${a.beleg_pfad ? `<button type="button" class="fm-beleg pressable" data-beleg="${esc(a.id)}">${svg(IKON.beleg, 14)} Beleg ansehen</button>` : ''}
          <div class="fm-entscheid">
            <button type="button" class="nein pressable" data-nein="${esc(a.id)}">Ablehnen</button>
            <button type="button" class="ja pressable" data-ja="${esc(a.id)}">Genehmigen</button>
          </div>
        </div>`).join('')}`;
  }

  function zeichneMeine() {
    const meine = antraege.filter(a => a.erstellt_von === ich);
    $('#meine').innerHTML = meine.length
      ? `<div class="fm-liste">${meine.map(a => {
          const s = STATUS[a.status] || STATUS.eingereicht;
          return `
            <div class="fm-zeile" data-antrag="${esc(a.id)}">
              <span class="mitte">
                <span class="titel">${esc(titelVon(a))}</span>
                <span class="unter">${esc(unterVon(a))}</span>
                ${a.beleg_pfad ? `<button type="button" class="fm-beleg pressable" data-beleg="${esc(a.id)}">${svg(IKON.beleg, 14)} Beleg ansehen</button>` : ''}
              </span>
              <span class="rechts">
                <span class="pj-marke klein ${s.farbe}">${esc(s.titel)}</span>
                ${a.status === 'eingereicht'
                  ? `<button type="button" class="zurueck pressable" data-zurueck="${esc(a.id)}" aria-label="Antrag zurückziehen">${svg(IKON.weg, 15)}</button>`
                  : ''}
              </span>
            </div>`;
        }).join('')}</div>`
      : '<div class="br-leer">Noch kein Antrag eingereicht.</div>';
  }

  function zeichne() {
    zeichneOffene();
    zeichneMeine();
    binde();
  }

  function binde() {
    $$('[data-ja]').forEach(el => el.addEventListener('click', () => entscheiden(el.dataset.ja, 'genehmigt')));
    $$('[data-nein]').forEach(el => el.addEventListener('click', () => entscheiden(el.dataset.nein, 'abgelehnt')));
    $$('[data-zurueck]').forEach(el => el.addEventListener('click', () => zurueckziehen(el.dataset.zurueck)));
    $$('[data-beleg]').forEach(el => el.addEventListener('click', () => belegZeigen(el.dataset.beleg)));
  }

  /* --- Entscheiden ----------------------------------------------------------- */

  async function entscheiden(id, status) {
    const a = antraege.find(x => x.id === id);
    if (!a) return;
    if (!istOnline()) return toast('Dafür braucht es eine Verbindung', true);

    const ja = await frage({
      titel: status === 'genehmigt' ? 'Antrag genehmigen?' : 'Antrag ablehnen?',
      text: `${knappVon(a)} von ${nameVon(a.erstellt_von)}. Ein Entscheid lässt sich nachträglich nicht mehr ändern.`,
      knopf: status === 'genehmigt' ? 'Genehmigen' : 'Ablehnen',
      gefahr: status === 'abgelehnt'
    });
    if (!ja) return;

    /* entschieden_von und entschieden_am setzt der Trigger in der
       Datenbank. Hier steht nur der Status — was daran hängt, soll nicht
       davon abhängen, dass diese Zeile es richtig mitschickt. */
    const { data, error } = await sb.from('antraege')
      .update({ status }).eq('id', id).select().single();
    if (error) return toast(error.message, true);

    Object.assign(a, data);
    zeichne();
    toast(status === 'genehmigt' ? 'Genehmigt' : 'Abgelehnt');

    pushSenden({
      antrag: id,
      titel: status === 'genehmigt' ? 'Antrag genehmigt' : 'Antrag abgelehnt',
      text: knappVon(a),
      ziel: 'formulare.html'
    });
  }

  /* --- Zurückziehen ---------------------------------------------------------- */

  async function zurueckziehen(id) {
    const a = antraege.find(x => x.id === id);
    if (!a) return;
    const ja = await frage({
      titel: 'Antrag zurückziehen?',
      text: `${knappVon(a)} verschwindet. Für Anträge gibt es keinen Papierkorb; ein zurückgezogener lässt sich neu einreichen.`,
      knopf: 'Zurückziehen'
    });
    if (!ja) return;
    if (!istOnline()) return toast('Dafür braucht es eine Verbindung', true);

    /* Erst der Beleg, dann die Zeile. Andersherum wäre der Antrag weg und
       mit ihm die Erlaubnis, die Datei zu entfernen — sie läge für immer
       im Bucket, ohne dass noch etwas darauf zeigte. */
    if (a.beleg_pfad) {
      const { error } = await sb.storage.from('antrag-belege').remove([a.beleg_pfad]);
      if (error) return toast(error.message, true);
    }
    const { error } = await sb.from('antraege').delete().eq('id', id);
    if (error) return toast(error.message, true);

    antraege = antraege.filter(x => x.id !== id);
    zeichne();
    toast('Zurückgezogen');
  }

  /* --- Beleg ansehen ---------------------------------------------------------- */

  async function belegZeigen(id) {
    const a = antraege.find(x => x.id === id);
    if (!a?.beleg_pfad) return;
    if (!istOnline()) return toast('Dafür braucht es eine Verbindung', true);

    const { data, error } = await sb.storage.from('antrag-belege')
      .createSignedUrl(a.beleg_pfad, 600);
    if (error || !data?.signedUrl) return toast(error?.message || 'Der Beleg lässt sich nicht laden', true);

    const s = sheet(`
      <div style="font-size:16px; font-weight:800; color:var(--navy); margin-bottom:12px;">Beleg</div>
      <img src="${esc(data.signedUrl)}" alt="Beleg zum Antrag" style="width:100%; height:auto; border-radius:12px; display:block;">
    `);
    s.el.style.maxHeight = '88dvh';
    s.el.style.overflowY = 'auto';
  }

  /* --- Das Formular ------------------------------------------------------------ */

  const FORMULAR = `
    <div class="fm-umschalter" role="group" aria-label="Art des Antrags">
      <button type="button" data-art="spesen" aria-pressed="true">Spesen</button>
      <button type="button" data-art="ferien" aria-pressed="false">Ferien</button>
    </div>

    <div data-teil="spesen">
      <div class="fm-feld">
        <div class="fm-label" style="margin-top:0;">Betrag (CHF)</div>
        <input class="fm-eingabe" data-feld="betrag" type="text" inputmode="decimal" placeholder="0.00" aria-label="Betrag in Franken">
      </div>
      <div class="fm-feld">
        <div class="fm-label" style="margin-top:0;">Beschrieb</div>
        <input class="fm-eingabe" data-feld="beschrieb" type="text" placeholder="z. B. Parkgebühren Baustelle Sarnen" aria-label="Beschrieb" maxlength="120">
      </div>
      <button type="button" class="fm-ablage pressable" data-foto>
        ICONBILD<span>Beleg fotografieren/hochladen</span>
      </button>
      <input data-datei type="file" accept="image/*" hidden>
    </div>

    <div data-teil="ferien" hidden>
      <div class="fm-feld">
        <div class="fm-label" style="margin-top:0;">Von</div>
        <input class="fm-eingabe" data-feld="von" type="date" aria-label="Erster Ferientag">
      </div>
      <div class="fm-feld">
        <div class="fm-label" style="margin-top:0;">Bis</div>
        <input class="fm-eingabe" data-feld="bis" type="date" aria-label="Letzter Ferientag">
      </div>
      <div class="fm-feld">
        <div class="fm-label" style="margin-top:0;">Bemerkung (optional)</div>
        <textarea class="fm-eingabe" data-feld="bemerkung" placeholder="z. B. Stellvertretung ist geregelt" aria-label="Bemerkung" maxlength="500"></textarea>
      </div>
    </div>

    <div data-fehler hidden style="font-size:12.5px; color:var(--red); font-weight:600; margin-bottom:12px;"></div>
    <button type="button" class="fm-senden btn-primary pressable" data-einreichen>Antrag einreichen</button>`;

  /* Ein Formular, zwei Orte. wurzel ist entweder die feste Spalte auf dem
     Desktop oder das Blatt auf dem Handy; alles darin wird über
     data-Attribute gefunden statt über IDs, damit beides gleichzeitig im
     Dokument stehen darf. */
  function baueFormular(wurzel, fertig) {
    wurzel.innerHTML = FORMULAR.replace('ICONBILD', svg(IKON.bild, 22));

    let art = 'spesen';
    let foto = null;
    let vorschau = null;

    const fehler = $('[data-fehler]', wurzel);
    const zeigeFehler = t => { fehler.textContent = t; fehler.hidden = false; };

    $$('[data-art]', wurzel).forEach(el => el.addEventListener('click', () => {
      art = el.dataset.art;
      $$('[data-art]', wurzel).forEach(x => x.setAttribute('aria-pressed', String(x.dataset.art === art)));
      $('[data-teil="spesen"]', wurzel).hidden = art !== 'spesen';
      $('[data-teil="ferien"]', wurzel).hidden = art !== 'ferien';
      fehler.hidden = true;
    }));

    const wahl = $('[data-datei]', wurzel);
    $('[data-foto]', wurzel).addEventListener('click', () => wahl.click());
    wahl.addEventListener('change', e => {
      const datei = e.target.files?.[0];
      e.target.value = '';
      if (!datei) return;
      if (!/^image\//.test(datei.type)) return zeigeFehler('Das ist kein Bild.');
      if (datei.size > 10 * 1024 * 1024) return zeigeFehler('Das Bild ist grösser als 10 MB.');
      foto = datei;
      if (vorschau) URL.revokeObjectURL(vorschau);
      vorschau = URL.createObjectURL(datei);
      $('[data-foto]', wurzel).innerHTML = `<img src="${vorschau}" alt="Vorschau"><span>Anderen Beleg wählen</span>`;
      fehler.hidden = true;
    });

    const knopf = $('[data-einreichen]', wurzel);
    knopf.addEventListener('click', async () => {
      fehler.hidden = true;
      const wert = f => ($(`[data-feld="${f}"]`, wurzel)?.value || '').trim();

      let zeile;
      if (art === 'spesen') {
        /* "24", "24.50" und "24,50" sollen alle gehen — auf der Baustelle
           tippt niemand darüber nach, welches Zeichen gerade gilt. */
        const roh = wert('betrag').replace(/[’'\s ]/g, '').replace(',', '.');
        const betrag = roh === '' ? NaN : Number(roh);
        if (!isFinite(betrag) || betrag <= 0) return zeigeFehler('Bitte einen Betrag grösser als null eintragen.');
        if (!wert('beschrieb')) return zeigeFehler('Wofür war die Ausgabe? Bitte kurz beschreiben.');
        zeile = { art, betrag: Math.round(betrag * 100) / 100, beschrieb: wert('beschrieb') };
      } else {
        if (!wert('von') || !wert('bis')) return zeigeFehler('Bitte den Zeitraum angeben.');
        if (wert('bis') < wert('von')) return zeigeFehler('Das Ende liegt vor dem Anfang.');
        zeile = { art, von: wert('von'), bis: wert('bis'), bemerkung: wert('bemerkung') || null };
      }
      if (!istOnline()) return zeigeFehler('Dafür braucht es eine Verbindung.');

      const alt = knopf.textContent;
      knopf.disabled = true;
      knopf.innerHTML = '<span class="spin"></span>';
      const zurueck = () => { knopf.disabled = false; knopf.textContent = alt; };

      /* Die Kennung wird hier gewürfelt: der Beleg liegt unter ihr im
         Bucket und muss vor der Zeile hochgeladen werden. Geht danach
         etwas schief, wird die Datei gleich wieder entfernt. */
      const id = crypto.randomUUID();
      let pfad = null;
      if (art === 'spesen' && foto) {
        const endung = (foto.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
        pfad = `${id}/${crypto.randomUUID()}.${endung}`;
        const { error } = await sb.storage.from('antrag-belege')
          .upload(pfad, foto, { contentType: foto.type });
        if (error) { zurueck(); return zeigeFehler(error.message); }
      }

      const { data, error } = await sb.from('antraege')
        .insert({ id, ...zeile, beleg_pfad: pfad, erstellt_von: ich }).select().single();
      if (error) {
        if (pfad) await sb.storage.from('antrag-belege').remove([pfad]);
        zurueck();
        return zeigeFehler(error.message);
      }

      antraege = [data, ...antraege];
      if (vorschau) URL.revokeObjectURL(vorschau);
      zeichne();
      toast('Antrag eingereicht');
      fertig?.();
      if (wurzel === $('#form-fest')) baueFormular(wurzel, fertig);  // leeres Formular für den nächsten
    });
  }

  function neuerAntrag() {
    const s = sheet('<div style="font-size:18px; font-weight:800; color:var(--navy); margin-bottom:16px;">Neuer Antrag</div><div data-inhalt></div>');
    s.el.style.maxHeight = '90dvh';
    s.el.style.overflowY = 'auto';
    baueFormular($('[data-inhalt]', s.el), () => s.schliessen());
  }

  /* --- Start -------------------------------------------------------------------- */

  (async () => {
    if (!await verlangeLogin()) return;

    const sitzung = await session();
    ich = sitzung.user.id;
    darfEntscheiden = await darfVerwalten();

    function hinweisZeigen() {
      const el = $('#hinweis');
      el.hidden = istOnline();
      if (!istOnline()) el.textContent = 'Offline. Anträge brauchen eine Verbindung.';
    }
    beiStatuswechsel(hinweisZeigen);

    if (!istOnline()) {
      $('#meine').innerHTML = '<div class="br-leer">Ohne Verbindung lassen sich keine Anträge laden. Sobald das Gerät wieder online ist, steht hier alles.</div>';
      $$('[data-neu]').forEach(b => b.hidden = true);
      beiStatuswechsel(() => { if (istOnline()) location.reload(); });
      return;
    }

    await ladeAlles();

    if (!leute.some(l => l.user_id === ich)) {
      $('#meine').innerHTML = '<div class="br-leer">Ihr Konto ist mit keinem Eintrag im Bereich Mitarbeiter verknüpft. Anträge sind dem TRIGA-Team vorbehalten.</div>';
      $$('[data-neu]').forEach(b => b.hidden = true);
      return;
    }

    zeichne();
    baueFormular($('#form-fest'));
    $$('[data-neu]').forEach(b => b.addEventListener('click', neuerAntrag));

    pushFragen({
      grund: 'Damit Sie es mitbekommen, wenn ein Antrag entschieden wird, und wenn im Feed oder im Chat etwas Wichtiges kommt. Ohne funktioniert alles genau gleich, es kommt nur keine Meldung auf den Bildschirm.'
    });
  })();
})();
