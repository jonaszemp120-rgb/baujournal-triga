/* Bereich Feed: Beiträge und Umfragen für das ganze Haus.
 *
 * Ein Strom, chronologisch, mit zwei Arten darin. Der Unterschied
 * zwischen einem Beitrag und einer Umfrage ist in der Karte sichtbar,
 * aber nicht in der Datenhaltung: beide stehen in feed_beitraege, tragen
 * dieselben Herzen und dieselben Kommentare. Zwei Tabellen hiessen jede
 * Abfrage zweimal und die Sortierung von Hand.
 *
 * Gelöscht wird hier wirklich gelöscht, ohne Papierkorb. Das ist der
 * Unterschied zum Baujournal und ausdrücklich so gewollt. Wer löschen
 * darf, entscheidet die Datenbank; hier wird der Knopf nur weggelassen,
 * wo er ohnehin nichts bewirkte.
 *
 * Die Anonymität einer Umfrage kommt nicht daher, dass die App die Namen
 * verschweigt. Sie kommt daher, dass fremde Stimmzeilen gar nicht erst
 * herausgegeben werden — auch der erstellenden Person nicht. Gezählt wird
 * in der Datenbank, mit feed_ergebnisse(), und von dort kommen nur Zahlen
 * zurück.
 *
 * Der Feed läuft in Echtzeit, wie der Chat. Was hereinkommt, geht durch
 * dieselben Listen wie das, was hier selbst geschrieben wird — und jede
 * eigene Änderung kommt über die Echtzeit noch einmal zurück, oft bevor
 * die Antwort auf das Einfügen da ist. Darum legt nichts blind etwas in
 * eine Liste, alles geht über merke().
 *
 * Nur ein Beitrag der Kategorie "wichtig" meldet sich auf den Telefonen
 * der anderen. Ob das zutrifft, entscheidet api/push.js und nicht diese
 * Datei.
 */

(() => {
  const IKON = {
    herz: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21.2l7.7-7.7 1.1-1.1a5.5 5.5 0 0 0 0-7.8z"/>',
    sprechblase: '<path d="M21 11.5a8.4 8.4 0 0 1-8.5 8.5 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8A8.4 8.4 0 0 1 12.5 3 8.4 8.4 0 0 1 21 11.5z"/>',
    eimer: '<path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
    bild: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    uhr: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    weg: '<path d="M18 6 6 18M6 6l12 12"/>',
    zurueck: '<path d="m15 18-6-6 6-6"/>',
    weiter: '<path d="m9 18 6-6-6-6"/>'
  };
  const svg = (d, g = 16) => `<svg viewBox="0 0 24 24" width="${g}" height="${g}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;

  const breit = () => matchMedia('(min-width:1024px)').matches;

  const FILTER = [
    { id: 'alle',     titel: 'Alle',     passt: () => true },
    { id: 'update',   titel: 'Update',   passt: b => b.art === 'beitrag' && b.kategorie === 'update' },
    { id: 'wichtig',  titel: 'Wichtig',  passt: b => b.art === 'beitrag' && b.kategorie === 'wichtig' },
    { id: 'umfragen', titel: 'Umfragen', passt: b => b.art === 'umfrage' }
  ];

  let ich = null;
  let leute = [];            // Mitarbeitende mit Konto
  let projekte = [];
  let beitraege = [];
  let bilder = [];           // Fotos, mehrere je Beitrag möglich
  let optionen = [];
  let ergebnisse = [];       // { beitrag_id, option_id, stimmen }
  let meineStimmen = [];     // nur die eigenen
  let reaktionen = [];
  let kommentare = [];
  let filter = 'alle';
  let darfModerieren = false;
  let kanal = null;          // Echtzeit
  const offen = new Set();   // Beiträge, deren Kommentare aufgeklappt sind

  const nameVon = u => leute.find(l => l.user_id === u)?.name || 'Unbekannt';
  const projektName = id => projekte.find(p => p.id === id)?.name || '';

  /* --- Erwähnungen ---------------------------------------------------------- */

  /* Was jemand beim Tippen aus der Liste gewählt hat, Name → Kennung. Ein
     Eintrag je Feld: für den Dialog unter "neu", für jeden Kommentar
     unter der Kennung seines Beitrags. Die Einträge überleben das
     Neuzeichnen der Liste, genau wie der angefangene Text selbst. */
  /* Erwähnungen: dasselbe Werkzeug wie im Chat, nicht ein zweites, das
     ihm heute gleicht. Es steht in js/app.js — was hier stand, ist Wort
     für Wort dorthin gewandert. */
  const erw = macheErwaehnungen({ leute: () => leute, ich: () => ich });
  const { markiere, mitErwaehnungen, merkeFuer, vergiss } = erw;
  const erwaehnungHelfer = erw.helfer;
  const erwaehnungSchliessen = erw.schliessen;

  /* Jede eigene Änderung kommt über die Echtzeit noch einmal zurück, und
     zwar nicht unbedingt danach: die Meldung kann eintreffen, bevor die
     Antwort auf das Einfügen da ist. Wer etwas in eine dieser Listen
     legt, prüft deshalb zuerst, ob es schon drin ist — sonst steht ein
     Beitrag zweimal da, mit allem, was daran hängt. */
  function merke(liste, zeile, gleich) {
    return liste.some(x => gleich(x, zeile)) ? liste : [...liste, zeile];
  }
  const gleicheId = (a, b) => a.id === b.id;

  /* --- Zeit ---------------------------------------------------------------- */

  /* "heute, 07:12" und "gestern, 16:40" wie im Design, alles Ältere mit
     Datum. Das Jahr nur, wenn es ein anderes ist — sonst steht in einem
     Feed voller Einträge aus diesem Jahr überall dieselbe Jahreszahl. */
  function wann(iso) {
    if (!iso) return '';
    const d = new Date(iso), jetzt = new Date();
    const tag = x => new Date(x.getFullYear(), x.getMonth(), x.getDate());
    const tage = Math.round((tag(jetzt) - tag(d)) / 86400000);
    const uhr = d.toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' });
    if (tage === 0) return `heute, ${uhr}`;
    if (tage === 1) return `gestern, ${uhr}`;
    const datum = d.getFullYear() === jetzt.getFullYear()
      ? d.toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit' })
      : d.toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit', year: 'numeric' });
    return `${datum}, ${uhr}`;
  }

  /* --- Laden --------------------------------------------------------------- */

  async function ladeAlles() {
    if (!istOnline()) return;
    const [ma, pj, bt, bi, op, er, st, re, ko] = await Promise.all([
      sb.from('mitarbeiter').select('id, user_id, name').not('user_id', 'is', null).is('geloescht_am', null).order('name'),
      sb.from('projekte').select('id, name').order('name'),
      sb.from('feed_beitraege')
        .select('id, art, kategorie, text, bild_ablauf, projekt_id, anonym, erstellt_von, erstellt_am')
        .order('erstellt_am', { ascending: false }).limit(200),
      sb.from('feed_bilder').select('id, beitrag_id, bild_pfad, bild_ablauf, reihenfolge').order('reihenfolge'),
      sb.from('feed_optionen').select('id, beitrag_id, text, reihenfolge').order('reihenfolge'),
      sb.rpc('feed_ergebnisse'),
      sb.from('feed_stimmen').select('beitrag_id, option_id').eq('user_id', ich),
      sb.from('feed_reaktionen').select('beitrag_id, user_id'),
      sb.from('feed_kommentare').select('id, beitrag_id, verfasser, text, erstellt_am').order('erstellt_am')
    ]);
    meckern('Team laden', ma.error);
    meckern('Projekte laden', pj.error);
    meckern('Feed laden', bt.error);
    meckern('Fotos laden', bi.error);
    meckern('Umfragen laden', op.error);
    meckern('Ergebnisse laden', er.error);
    meckern('Kommentare laden', ko.error);

    leute = ma.data || [];
    projekte = pj.data || [];
    beitraege = bt.data || [];
    bilder = bi.data || [];
    optionen = op.data || [];
    ergebnisse = er.data || [];
    meineStimmen = st.data || [];
    reaktionen = re.data || [];
    kommentare = ko.data || [];
  }

  /* --- Auswertung einer Umfrage -------------------------------------------- */

  /* Alles, was eine Umfragekarte braucht, an einer Stelle gerechnet: die
     Optionen mit ihren Stimmen, wie viele insgesamt abgestimmt haben und
     was man selbst gewählt hat.
     Die Prozente werden auf ganze Zahlen gerundet und können sich deshalb
     auf 99 oder 101 summieren. Das ist so gewollt: eine künstlich
     geglättete Zahl wäre falscher als eine gerundete. */
  function auswertung(b) {
    /* Nach reihenfolge sortiert und nicht nach Eintreffen: über die
       Echtzeit kommen die Antwortmöglichkeiten einzeln herein, und die
       Reihenfolge soll bei allen dieselbe sein wie beim Erfassen. */
    const eigene = optionen.filter(o => o.beitrag_id === b.id)
      .slice().sort((x, y) => (x.reihenfolge ?? 0) - (y.reihenfolge ?? 0));
    const zahlen = eigene.map(o =>
      ergebnisse.find(e => e.beitrag_id === b.id && e.option_id === o.id)?.stimmen || 0);
    const gesamt = zahlen.reduce((a, x) => a + Number(x), 0);
    const meine = meineStimmen.find(s => s.beitrag_id === b.id)?.option_id || null;
    return {
      optionen: eigene.map((o, i) => ({
        ...o,
        stimmen: Number(zahlen[i]),
        prozent: gesamt ? Math.round(Number(zahlen[i]) * 100 / gesamt) : 0,
        meine: o.id === meine
      })),
      gesamt, meine
    };
  }

  /* --- Zeichnen ------------------------------------------------------------ */

  function zeichneFilter() {
    $('#filter').innerHTML = FILTER.map(f => `
      <button type="button" class="pj-chip pressable" data-filter="${f.id}" aria-pressed="${f.id === filter}">${esc(f.titel)}</button>`).join('');
    $$('#filter [data-filter]').forEach(el => el.addEventListener('click', () => {
      filter = el.dataset.filter;
      zeichneFilter();
      zeichneListe();
    }));
  }

  /* Die Liste wird am Stück neu gezeichnet, auch wenn nur ein Herz
     dazukommt. Seit der Feed in Echtzeit läuft, kann das mitten im Tippen
     passieren — deshalb werden angefangene Kommentare und der Cursor
     vorher gesichert und danach zurückgesetzt. Ohne das verlöre jemand
     seinen halben Satz, weil irgendwo ein Herz gesetzt wurde. */
  function zeichneListe() {
    // Die Auswahlliste hängt an einem Feld, das es gleich nicht mehr gibt.
    erwaehnungSchliessen();
    const entwuerfe = {};
    let warFokus = null;
    let stand = 0;
    $$('#liste [data-kfeld]').forEach(el => {
      if (el.value) entwuerfe[el.dataset.kfeld] = el.value;
      if (el === document.activeElement) { warFokus = el.dataset.kfeld; stand = el.selectionStart; }
    });

    const passt = FILTER.find(f => f.id === filter).passt;
    const sichtbar = beitraege.filter(passt);

    $('#liste').innerHTML = sichtbar.length
      ? sichtbar.map(karte).join('')
      : `<div class="br-leer">${filter === 'alle'
          ? 'Noch nichts im Feed.<br>Oben den ersten Beitrag schreiben.'
          : 'Zu diesem Filter gibt es nichts.'}</div>`;

    $$('#liste [data-kfeld]').forEach(el => {
      const t = entwuerfe[el.dataset.kfeld];
      if (t) el.value = t;
      if (el.dataset.kfeld === warFokus) {
        el.focus();
        try { el.setSelectionRange(stand, stand); } catch { /* egal */ }
      }
    });

    binde();
    bilderNachladen();
  }

  function kopf(b) {
    const eigenerName = nameVon(b.erstellt_von);
    const zusatz = [wann(b.erstellt_am)];
    if (b.art === 'umfrage' && b.anonym) zusatz.push('anonym');
    if (b.projekt_id && projektName(b.projekt_id)) zusatz.push(projektName(b.projekt_id));

    /* Die Marke rechts: "Wichtig" fällt auf und steht überall, "Update"
       ist der Normalfall und steht nur dort, wo Platz dafür ist. Bei einer
       Umfrage steht das Wort stattdessen hinter dem Namen. */
    const marke = b.art === 'umfrage' ? ''
      : b.kategorie === 'wichtig'
        ? '<span class="fd-marke wichtig">Wichtig</span>'
        : '<span class="fd-marke update nur-desktop">Update</span>';

    const weg = (b.erstellt_von === ich || darfModerieren)
      ? `<button type="button" class="fd-weg pressable" data-weg="${esc(b.id)}" aria-label="Beitrag löschen">${svg(IKON.eimer, 15)}</button>`
      : '';

    return `
      <div class="fd-kopf">
        <span class="fd-avatar">${esc(initialen(eigenerName))}</span>
        <span class="fd-wer">
          <span class="fd-name">${esc(eigenerName)}${b.art === 'umfrage' ? ' <span class="fd-art">· Umfrage</span>' : ''}</span>
          <span class="fd-meta">${esc(zusatz.join(' · '))}</span>
        </span>
        ${marke}${weg}
      </div>`;
  }

  const fotosVon = id => bilder.filter(x => x.beitrag_id === id)
    .slice().sort((x, y) => (x.reihenfolge ?? 0) - (y.reihenfolge ?? 0));

  /* Ein Foto lebt 30 Tage, genau wie im Chat. Danach bleibt die Stelle
     stehen und sagt, dass es das Foto einmal gab — keine Lücke, aus der
     niemand schlau wird.
     Sind es mehrere, liegen sie nebeneinander in einer Spur, durch die
     man wischt; darunter zeigen Punkte, wo man gerade ist. Am Schreibtisch
     gibt es dazu zwei Pfeile, weil dort niemand wischt. */
  function galerie(b) {
    if (!b.bild_ablauf) return '';
    const eigene = fotosVon(b.id);

    /* Die Fotozeilen zeigen auf den Beitrag und folgen ihm deshalb einen
       Wimpernschlag später — über die Echtzeit genau wie beim Erfassen. */
    if (!eigene.length) {
      return '<div class="fd-bild"><div class="platzhalter">Fotos werden geladen…</div></div>';
    }

    const da = eigene.filter(x => x.bild_pfad);
    if (!da.length) {
      return `<div class="fd-bild"><div class="platzhalter">${eigene.length === 1 ? 'Foto' : 'Fotos'} nicht mehr verfügbar.<br>Fotos werden nach 30 Tagen entfernt.</div></div>`;
    }

    const bis = new Date(b.bild_ablauf).toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit' });
    const hinweis = `<div class="fd-ablauf">${svg(IKON.uhr, 12)}<span>Verfügbar bis ${esc(bis)}, danach automatisch gelöscht</span></div>`;

    if (da.length === 1) {
      return `<div class="fd-bild" data-pfad="${esc(da[0].bild_pfad)}"><div class="platzhalter">Foto wird geladen…</div></div>${hinweis}`;
    }

    return `
      <div class="fd-galerie" data-galerie="${esc(b.id)}">
        <div class="fd-rahmen">
          <div class="fd-spur">${da.map((x, i) => `
            <div class="fd-bild" data-pfad="${esc(x.bild_pfad)}"><div class="platzhalter">Foto ${i + 1} von ${da.length} wird geladen…</div></div>`).join('')}</div>
          <button type="button" class="fd-pfeil links nur-desktop pressable" data-blaettern="-1" aria-label="Vorheriges Foto">${svg(IKON.zurueck, 18)}</button>
          <button type="button" class="fd-pfeil rechts nur-desktop pressable" data-blaettern="1" aria-label="Nächstes Foto">${svg(IKON.weiter, 18)}</button>
        </div>
        <div class="fd-punkte" aria-label="${da.length} Fotos">${da.map((_, i) =>
          `<span class="fd-punkt${i === 0 ? ' an' : ''}"></span>`).join('')}</div>
      </div>
      ${hinweis}`;
  }

  function umfrage(b) {
    const a = auswertung(b);
    if (!a.optionen.length) return '<div class="pj-leer">Die Antwortmöglichkeiten werden geladen…</div>';

    /* Vor der eigenen Stimme Knöpfe, danach Balken. Das Ergebnis erst nach
       dem Abstimmen zu zeigen ist kein Geheimniskram, sondern verhindert,
       dass die Mehrheit die eigene Wahl vorwegnimmt. */
    const inhalt = a.meine
      ? a.optionen.map(o => `
          <div class="fd-balken${o.meine ? ' meine' : ''}">
            <span class="fuellung" style="width:${o.prozent}%"></span>
            <span class="wort">${esc(o.text)}</span>
            <span class="prozent">${o.prozent} %</span>
          </div>`).join('')
      : a.optionen.map(o => `
          <button type="button" class="fd-option pressable" data-stimme="${esc(o.id)}" data-umfrage="${esc(b.id)}">
            <span>${esc(o.text)}</span>
          </button>`).join('');

    /* Wie viele mitgemacht haben, steht auch vor der eigenen Stimme da.
       Das verrät nichts über die Verteilung — die Balken bleiben ja
       verdeckt — und beantwortet die Frage, die man sich sonst stellt:
       hat sich überhaupt schon jemand gemeldet? */
    const teilnahme = `${a.gesamt} von ${leute.length || a.gesamt} haben abgestimmt`;
    return `
      <div class="fd-optionen">${inhalt}</div>
      <div class="fd-abgestimmt">${a.meine
        ? teilnahme
        : `${teilnahme} · Eine Stimme pro Person, und sie lässt sich nicht ändern.`}</div>`;
  }

  function fuss(b) {
    const herzen = reaktionen.filter(r => r.beitrag_id === b.id);
    const meins = herzen.some(r => r.user_id === ich);
    const anzahlK = kommentare.filter(k => k.beitrag_id === b.id).length;
    return `
      <div class="fd-fuss">
        <button type="button" class="herz pressable" data-herz="${esc(b.id)}" aria-pressed="${meins}"
                aria-label="${meins ? 'Herz entfernen' : 'Herz setzen'}">
          ${svg(IKON.herz, 17)}<span>${herzen.length}</span>
        </button>
        <button type="button" class="pressable" data-kommentare="${esc(b.id)}"
                aria-expanded="${offen.has(b.id)}">
          ${svg(IKON.sprechblase, 17)}<span>${anzahlK}<span class="nur-desktop"> ${anzahlK === 1 ? 'Kommentar' : 'Kommentare'}</span></span>
        </button>
      </div>`;
  }

  function kommentarBlock(b) {
    if (!offen.has(b.id)) return '';
    const eigene = kommentare.filter(k => k.beitrag_id === b.id);
    return `
      <div class="fd-kommentare">
        ${eigene.map(k => `
          <div class="fd-kommentar">
            <span class="fd-avatar">${esc(initialen(nameVon(k.verfasser)))}</span>
            <span class="inhalt">
              <span class="oben">
                <span class="wer">${esc(nameVon(k.verfasser))}</span>
                <span class="wann">${esc(wann(k.erstellt_am))}</span>
              </span>
              <span class="was">${mitErwaehnungen(k.text)}</span>
            </span>
            ${(k.verfasser === ich || darfModerieren)
              ? `<button type="button" class="fd-weg pressable" data-kweg="${esc(k.id)}" aria-label="Kommentar löschen">${svg(IKON.weg, 14)}</button>`
              : ''}
          </div>`).join('') || '<div class="pj-leer">Noch kein Kommentar.</div>'}
        <div class="fd-schreiben">
          <input type="text" data-kfeld="${esc(b.id)}" placeholder="Kommentar schreiben…" aria-label="Kommentar schreiben" maxlength="2000">
          <button type="button" class="pressable" data-ksenden="${esc(b.id)}">Senden</button>
        </div>
      </div>`;
  }

  function karte(b) {
    const wichtig = b.art === 'beitrag' && b.kategorie === 'wichtig';
    return `
      <article class="fd-karte${wichtig ? ' wichtig' : ''}" data-beitrag="${esc(b.id)}">
        ${kopf(b)}
        ${b.text ? `<div class="${b.art === 'umfrage' ? 'fd-frage' : 'fd-text'}">${mitErwaehnungen(b.text)}</div>` : ''}
        ${b.art === 'umfrage' ? umfrage(b) : galerie(b)}
        ${fuss(b)}
        ${kommentarBlock(b)}
      </article>`;
  }

  /* Die Fotos liegen in einem geschlossenen Bucket. Jedes braucht eine
     eigene, zeitlich begrenzte Adresse — deshalb erst nach dem Zeichnen
     und nur für das, was wirklich am Bildschirm steht. */
  async function bilderNachladen() {
    await Promise.all($$('#liste [data-pfad]').map(async el => {
      const { data, error } = await sb.storage.from('feed-bilder').createSignedUrl(el.dataset.pfad, 3600);
      const platz = el.querySelector('.platzhalter');
      if (!platz) return;
      if (error || !data?.signedUrl) { platz.textContent = 'Foto lässt sich gerade nicht laden.'; return; }
      platz.outerHTML = `<img src="${esc(data.signedUrl)}" alt="Foto zum Beitrag" loading="lazy">`;
    }));
  }

  function binde() {
    $$('#liste [data-herz]').forEach(el => el.addEventListener('click', () => herz(el.dataset.herz)));
    $$('#liste [data-weg]').forEach(el => el.addEventListener('click', () => beitragLoeschen(el.dataset.weg)));
    $$('#liste [data-kweg]').forEach(el => el.addEventListener('click', () => kommentarLoeschen(el.dataset.kweg)));
    $$('#liste [data-stimme]').forEach(el => el.addEventListener('click',
      () => abstimmen(el.dataset.umfrage, el.dataset.stimme)));
    $$('#liste [data-kommentare]').forEach(el => el.addEventListener('click', () => {
      const id = el.dataset.kommentare;
      if (offen.has(id)) offen.delete(id); else offen.add(id);
      zeichneListe();
      if (offen.has(id)) $(`#liste [data-kfeld="${CSS.escape(id)}"]`)?.focus();
    }));
    $$('#liste [data-ksenden]').forEach(el => el.addEventListener('click', () => kommentieren(el.dataset.ksenden)));
    $$('#liste [data-kfeld]').forEach(el => {
      /* Der Helfer hängt vor dem Absenden: steht die Auswahlliste offen,
         wählt Enter dort aus und schickt den Kommentar nicht ab. */
      erwaehnungHelfer(el, el.dataset.kfeld);
      el.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !auswahl) { e.preventDefault(); kommentieren(el.dataset.kfeld); }
      });
    });
    blaetternBinden();
  }

  /* Gewischt wird mit dem Finger, das macht der Browser von selbst —
     hier hängen nur die Punkte darunter daran und die beiden Pfeile für
     die Maus. Welches Foto gerade vorne ist, wird nicht mitgezählt,
     sondern aus der Position der Spur gelesen: gezählt liefe es nach dem
     ersten schnellen Wisch auseinander. */
  function blaetternBinden() {
    $$('#liste .fd-galerie').forEach(g => {
      const spur = $('.fd-spur', g);
      const punkte = $$('.fd-punkt', g);
      if (!spur || !punkte.length) return;

      const setze = () => {
        const i = Math.round(spur.scrollLeft / Math.max(1, spur.clientWidth));
        punkte.forEach((p, n) => p.classList.toggle('an', n === Math.min(i, punkte.length - 1)));
      };
      spur.addEventListener('scroll', setze, { passive: true });

      $$('[data-blaettern]', g).forEach(el => el.addEventListener('click', () => {
        spur.scrollBy({ left: Number(el.dataset.blaettern) * spur.clientWidth, behavior: 'smooth' });
      }));
    });
  }

  /* --- Herz ---------------------------------------------------------------- */

  async function herz(id) {
    if (!istOnline()) return toast('Dafür braucht es eine Verbindung', true);
    const meins = reaktionen.some(r => r.beitrag_id === id && r.user_id === ich);
    if (meins) {
      const { error } = await sb.from('feed_reaktionen').delete().eq('beitrag_id', id).eq('user_id', ich);
      if (error) return toast(error.message, true);
      reaktionen = reaktionen.filter(r => !(r.beitrag_id === id && r.user_id === ich));
    } else {
      const { error } = await sb.from('feed_reaktionen').insert({ beitrag_id: id, user_id: ich });
      if (error) return toast(error.message, true);
      reaktionen = merke(reaktionen, { beitrag_id: id, user_id: ich },
        (a, b) => a.beitrag_id === b.beitrag_id && a.user_id === b.user_id);
    }
    zeichneListe();
  }

  /* --- Abstimmen ------------------------------------------------------------ */

  async function abstimmen(beitragId, optionId) {
    if (!istOnline()) return toast('Dafür braucht es eine Verbindung', true);
    if (meineStimmen.some(s => s.beitrag_id === beitragId)) return;

    const { error } = await sb.from('feed_stimmen')
      .insert({ beitrag_id: beitragId, option_id: optionId, user_id: ich });
    if (error) return toast(error.message, true);

    meineStimmen.push({ beitrag_id: beitragId, option_id: optionId });
    await holeErgebnisse();
    zeichneListe();
    toast('Stimme gezählt');

    /* Den anderen Bescheid sagen, dass sich das Ergebnis geändert hat.
       Als Rundruf und nicht über die Tabelle: bei einer anonymen Umfrage
       gibt die Policy fremde Stimmzeilen nicht heraus, die Echtzeit hält
       sich daran, und niemand sonst bekäme etwas mit. Der Rundruf trägt
       nur die Kennung der Umfrage — wer gestimmt hat, verlässt die
       Datenbank weiterhin nicht. */
    kanal?.send({ type: 'broadcast', event: 'stimme', payload: { beitrag: beitragId } });
  }

  /* Das Ergebnis wird nie von Hand hochgezählt, sondern geholt. In der
     Zwischenzeit haben vielleicht andere auch abgestimmt, und eine selbst
     gerechnete Zahl wiche ab, ohne dass es auffiele. */
  async function holeErgebnisse() {
    const { data } = await sb.rpc('feed_ergebnisse');
    if (data) ergebnisse = data;
  }

  /* --- Kommentare ----------------------------------------------------------- */

  async function kommentieren(beitragId) {
    const feld = $(`#liste [data-kfeld="${CSS.escape(beitragId)}"]`);
    const roh = (feld?.value || '').trim();
    if (!roh) return;
    if (!istOnline()) return toast('Dafür braucht es eine Verbindung', true);

    const text = markiere(roh, merkeFuer(beitragId));

    /* Das Feld wird vor dem Einfügen geleert, nicht danach. Die eigene
       Zeile kommt über die Echtzeit zurück, und zwar unter Umständen
       schon während des Wartens — die Liste wird dann neu gezeichnet,
       zeichneListe() sichert dabei jeden angefangenen Kommentar und setzt
       ihn zurück, und der gerade abgeschickte stünde gleich wieder da.
       Danach zeigt feld ausserdem auf ein Element, das es nicht mehr
       gibt; deshalb geht das Leeren über eine frische Abfrage. */
    const setzeFeld = wert => {
      const f = $(`#liste [data-kfeld="${CSS.escape(beitragId)}"]`);
      if (f) f.value = wert;
    };
    setzeFeld('');

    const { data, error } = await sb.from('feed_kommentare')
      .insert({ beitrag_id: beitragId, verfasser: ich, text }).select().single();
    if (error) {
      setzeFeld(roh);
      return toast(error.message, true);
    }

    vergiss(beitragId);
    kommentare = merke(kommentare, data, gleicheId);
    zeichneListe();
    setzeFeld('');
    $(`#liste [data-kfeld="${CSS.escape(beitragId)}"]`)?.focus();

    /* Ein Kommentar geht sonst unter: er steht weit unten an einer Karte,
       die vielleicht niemand mehr aufklappt. Wer darin erwähnt wird,
       bekommt deshalb eine Meldung. Wer wirklich erwähnt wurde, liest
       api/push.js selbst aus dem gespeicherten Text — diese Zeile hier
       entscheidet es nicht. */
    if (erwaehnungenAus(text).filter(u => u !== ich).length) {
      pushSenden({
        kommentar: data.id,
        titel: `${nameVon(ich).split(' ')[0]} hat Sie erwähnt`,
        text: erwaehnungKlartext(text),
        ziel: 'feed.html'
      });
    }
  }

  async function kommentarLoeschen(id) {
    const k = kommentare.find(x => x.id === id);
    if (!k) return;
    const ja = await frage({
      titel: 'Kommentar löschen?',
      text: 'Der Kommentar verschwindet für alle. Für den Feed gibt es keinen Papierkorb.',
      knopf: 'Löschen'
    });
    if (!ja) return;
    if (!istOnline()) return toast('Dafür braucht es eine Verbindung', true);

    const { error } = await sb.from('feed_kommentare').delete().eq('id', id);
    if (error) return toast(error.message, true);
    kommentare = kommentare.filter(x => x.id !== id);
    zeichneListe();
    toast('Kommentar gelöscht');
  }

  /* --- Beitrag löschen ------------------------------------------------------- */

  /* Erst die Datei, dann die Zeile. Andersherum wäre der Beitrag weg und
     mit ihm die Erlaubnis, das Foto zu entfernen — es läge für immer im
     Bucket, ohne dass noch etwas darauf zeigte. */
  async function beitragLoeschen(id) {
    const b = beitraege.find(x => x.id === id);
    if (!b) return;
    const fremd = b.erstellt_von !== ich;
    const ja = await frage({
      titel: b.art === 'umfrage' ? 'Umfrage löschen?' : 'Beitrag löschen?',
      text: `${fremd ? `Der Beitrag von ${nameVon(b.erstellt_von)} verschwindet` : 'Der Beitrag verschwindet'} mit allen Herzen und Kommentaren${b.art === 'umfrage' ? ' und allen Stimmen' : ''}, für alle. Für den Feed gibt es keinen Papierkorb.`,
      knopf: 'Löschen'
    });
    if (!ja) return;
    if (!istOnline()) return toast('Dafür braucht es eine Verbindung', true);

    const pfade = fotosVon(id).map(x => x.bild_pfad).filter(Boolean);
    if (pfade.length) {
      const { error } = await sb.storage.from('feed-bilder').remove(pfade);
      if (error) return toast(error.message, true);
    }
    const { error } = await sb.from('feed_beitraege').delete().eq('id', id);
    if (error) return toast(error.message, true);

    beitraege = beitraege.filter(x => x.id !== id);
    bilder = bilder.filter(x => x.beitrag_id !== id);
    kommentare = kommentare.filter(k => k.beitrag_id !== id);
    reaktionen = reaktionen.filter(r => r.beitrag_id !== id);
    zeichneListe();
    toast('Gelöscht');
  }

  /* --- Echtzeit --------------------------------------------------------------- */

  /* Ein Kanal für den ganzen Bereich. Der Chat braucht zwei, weil dort ein
     Gespräch offen ist und die Liste daneben weiterlaufen muss; hier gibt
     es nur die eine Liste.

     Die eigenen Änderungen kommen als Ereignis zurück, nachdem sie hier
     schon eingetragen wurden. Jeder Zweig prüft deshalb zuerst, ob er das
     Neue nicht längst kennt — sonst stünde jedes Herz doppelt. */
  function horche() {
    if (kanal) sb.removeChannel(kanal);
    kanal = sb.channel('feed')
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'feed_beitraege' },
        n => beitragEingetroffen(n.new))
      .on('postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'feed_beitraege' },
        n => beitragEntfernt(n.old))
      /* Eine Umfrage kommt als Zeile herein, ihre Antwortmöglichkeiten
         folgen einen Wimpernschlag später als eigene Zeilen — anders
         geht es nicht, sie zeigen ja auf die Umfrage. Solange keine da
         ist, sagt die Karte, dass geladen wird. */
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'feed_optionen' },
        n => {
          const o = n.new;
          if (!o?.id || optionen.some(x => x.id === o.id)) return;
          optionen = merke(optionen, o, gleicheId);
          if (beitraege.some(b => b.id === o.beitrag_id)) zeichneListe();
        })
      /* Dasselbe für die Fotos: der Beitrag kommt zuerst, seine Fotos
         zeigen auf ihn und folgen als eigene Zeilen. Bis dahin sagt die
         Karte, dass geladen wird. */
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'feed_bilder' },
        n => {
          const f = n.new;
          if (!f?.id || bilder.some(x => x.id === f.id)) return;
          bilder = merke(bilder, f, gleicheId);
          if (beitraege.some(b => b.id === f.beitrag_id)) zeichneListe();
        })
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'feed_kommentare' },
        n => {
          if (!n.new?.id || kommentare.some(k => k.id === n.new.id)) return;
          kommentare = merke(kommentare, n.new, gleicheId);
          zeichneListe();
        })
      .on('postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'feed_kommentare' },
        n => {
          if (!n.old?.id || !kommentare.some(k => k.id === n.old.id)) return;
          kommentare = kommentare.filter(k => k.id !== n.old.id);
          zeichneListe();
        })
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'feed_reaktionen' },
        n => {
          const r = n.new;
          if (!r?.beitrag_id) return;
          if (reaktionen.some(x => x.beitrag_id === r.beitrag_id && x.user_id === r.user_id)) return;
          reaktionen = [...reaktionen, { beitrag_id: r.beitrag_id, user_id: r.user_id }];
          zeichneListe();
        })
      .on('postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'feed_reaktionen' },
        n => {
          const r = n.old;
          if (!r?.beitrag_id) return;
          const vorher = reaktionen.length;
          reaktionen = reaktionen.filter(x => !(x.beitrag_id === r.beitrag_id && x.user_id === r.user_id));
          if (reaktionen.length !== vorher) zeichneListe();
        })
      /* Die Stimmen kommen nicht über die Tabelle, sondern als Rundruf —
         siehe abstimmen() und die Migration dazu. Gemeldet wird nur, dass
         sich an dieser Umfrage etwas geändert hat; die Zahlen holt sich
         jeder selbst. */
      .on('broadcast', { event: 'stimme' }, async m => {
        const id = m?.payload?.beitrag;
        if (!id || !beitraege.some(b => b.id === id)) return;
        await holeErgebnisse();
        zeichneListe();
      })
      .subscribe();
  }

  function beitragEingetroffen(b) {
    if (!b?.id || beitraege.some(x => x.id === b.id)) return;
    beitraege = merke(beitraege, b, gleicheId).sort((x, y) =>
      new Date(y.erstellt_am) - new Date(x.erstellt_am));
    zeichneListe();
  }

  function beitragEntfernt(alt) {
    if (!alt?.id || !beitraege.some(b => b.id === alt.id)) return;
    beitraege = beitraege.filter(b => b.id !== alt.id);
    kommentare = kommentare.filter(k => k.beitrag_id !== alt.id);
    reaktionen = reaktionen.filter(r => r.beitrag_id !== alt.id);
    optionen = optionen.filter(o => o.beitrag_id !== alt.id);
    bilder = bilder.filter(x => x.beitrag_id !== alt.id);
    offen.delete(alt.id);
    zeichneListe();
  }

  /* --- Neuer Beitrag --------------------------------------------------------- */

  /* Ein Dialog mit zwei Gesichtern, nicht zwei Dialoge. Der Umschalter
     oben wechselt nur, welche Hälfte sichtbar ist — was schon getippt
     wurde, bleibt stehen, auch wenn jemand hin und her schaltet. */
  function neuerBeitrag() {
    let art = 'beitrag';
    let kategorie = 'update';
    let anonym = false;
    let fotos = [];            // { datei, vorschau }
    let antworten = ['', ''];
    const HOECHSTENS = 10;

    const s = sheet(`
      <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:16px;">
        <div style="font-size:18px; font-weight:800; color:var(--navy);">Neuer Beitrag</div>
        <button type="button" id="nb-zu" class="br-knopf pressable nur-desktop" aria-label="Schliessen">${svg(IKON.weg, 16)}</button>
      </div>

      <div class="fd-umschalter" role="group" aria-label="Art des Beitrags">
        <button type="button" id="nb-beitrag" aria-pressed="true">Beitrag</button>
        <button type="button" id="nb-umfrage" aria-pressed="false">Umfrage</button>
      </div>

      <div id="nb-teil-beitrag">
        <div class="fd-label">Kategorie</div>
        <div id="nb-kategorie" style="display:flex; gap:8px; margin-bottom:14px;">
          <button type="button" class="pj-chip pressable" data-kat="update" aria-pressed="true">Update</button>
          <button type="button" class="pj-chip pressable" data-kat="wichtig" aria-pressed="false">Wichtig</button>
        </div>
        <textarea id="nb-text" class="fd-eingabe" placeholder="Was gibt's Neues?" aria-label="Text des Beitrags" maxlength="4000"></textarea>
        <div id="nb-fotos" class="fd-fotos"></div>
        <button type="button" id="nb-foto" class="fd-ablage pressable">
          ${svg(IKON.bild, 22)}<span>Fotos hinzufügen</span>
        </button>
        <input id="nb-datei" type="file" accept="image/*" multiple hidden>
        <div class="fd-label" style="margin-top:16px;">Projekt zuordnen (optional)</div>
        <select id="nb-projekt" class="fd-eingabe" style="height:48px; padding:0 12px; background:var(--card);" aria-label="Projekt zuordnen">
          <option value="">Kein Projekt ausgewählt</option>
        </select>
      </div>

      <div id="nb-teil-umfrage" hidden>
        <input id="nb-frage" class="fd-eingabe" type="text" placeholder="Deine Frage" aria-label="Frage" maxlength="400" style="margin-bottom:12px;">
        <div id="nb-antworten" style="display:flex; flex-direction:column; gap:10px;"></div>
        <button type="button" id="nb-mehr" class="fd-dazu pressable">${svg(IKON.plus, 15)}<span>Option hinzufügen</span></button>
        <div class="fd-schalter">
          <span>Anonym abstimmen</span>
          <button type="button" id="nb-anonym" class="knebel pressable" role="switch" aria-checked="false" aria-label="Anonym abstimmen"></button>
        </div>
        <div style="font-size:12px; color:var(--text-dim); line-height:1.5;">
          Anonym heisst: niemand sieht, wer wie gestimmt hat, auch Sie selbst nicht. Gespeichert wird nur, wer schon abgestimmt hat, damit niemand zweimal stimmt.
        </div>
      </div>

      <div id="nb-fehler" hidden style="font-size:12.5px; color:var(--red); font-weight:600; margin-top:14px;"></div>

      <div class="fd-tasten">
        <button type="button" id="nb-nein" class="nein pressable nur-desktop">Abbrechen</button>
        <button type="button" id="nb-ja" class="ja btn-primary pressable">Posten</button>
      </div>
    `);
    if (breit()) s.el.classList.add('fd-mitte');
    s.el.style.maxHeight = breit() ? '88dvh' : '90dvh';
    s.el.style.overflowY = 'auto';

    const fehler = $('#nb-fehler', s.el);
    const zeigeFehler = t => { fehler.textContent = t; fehler.hidden = false; };

    $('#nb-projekt', s.el).innerHTML += projekte
      .map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');

    /* Erwähnungen gibt es im Beitragstext. In der Frage einer Umfrage
       nicht: dort ginge es nicht darum, jemanden anzusprechen, sondern
       darum, von allen eine Antwort zu bekommen. */
    vergiss('neu');
    erwaehnungHelfer($('#nb-text', s.el), 'neu');

    /* --- Umschalter --- */
    function setzeArt(neu) {
      art = neu;
      $('#nb-beitrag', s.el).setAttribute('aria-pressed', String(art === 'beitrag'));
      $('#nb-umfrage', s.el).setAttribute('aria-pressed', String(art === 'umfrage'));
      $('#nb-teil-beitrag', s.el).hidden = art !== 'beitrag';
      $('#nb-teil-umfrage', s.el).hidden = art !== 'umfrage';
      $('#nb-ja', s.el).textContent = art === 'umfrage' ? 'Umfrage posten' : 'Posten';
      fehler.hidden = true;
    }
    $('#nb-beitrag', s.el).addEventListener('click', () => setzeArt('beitrag'));
    $('#nb-umfrage', s.el).addEventListener('click', () => setzeArt('umfrage'));

    $$('#nb-kategorie [data-kat]', s.el).forEach(el => el.addEventListener('click', () => {
      kategorie = el.dataset.kat;
      $$('#nb-kategorie [data-kat]', s.el).forEach(x =>
        x.setAttribute('aria-pressed', String(x.dataset.kat === kategorie)));
    }));

    /* --- Antwortmöglichkeiten --- */
    function zeichneAntworten() {
      $('#nb-antworten', s.el).innerHTML = antworten.map((t, i) => `
        <div style="display:flex; gap:8px; align-items:center;">
          <input class="fd-eingabe" type="text" data-antwort="${i}" value="${esc(t)}"
                 placeholder="Antwort ${i + 1}" aria-label="Antwort ${i + 1}" maxlength="120">
          ${antworten.length > 2
            ? `<button type="button" class="fd-weg pressable" data-antwort-weg="${i}" aria-label="Antwort entfernen">${svg(IKON.weg, 15)}</button>`
            : ''}
        </div>`).join('');
      $$('#nb-antworten [data-antwort]', s.el).forEach(el =>
        el.addEventListener('input', () => { antworten[Number(el.dataset.antwort)] = el.value; }));
      $$('#nb-antworten [data-antwort-weg]', s.el).forEach(el =>
        el.addEventListener('click', () => {
          antworten.splice(Number(el.dataset.antwortWeg), 1);
          zeichneAntworten();
        }));
    }
    zeichneAntworten();
    $('#nb-mehr', s.el).addEventListener('click', () => {
      if (antworten.length >= 10) return zeigeFehler('Mehr als zehn Antwortmöglichkeiten werden unübersichtlich.');
      antworten.push('');
      zeichneAntworten();
    });

    const knebel = $('#nb-anonym', s.el);
    knebel.addEventListener('click', () => {
      anonym = !anonym;
      knebel.setAttribute('aria-checked', String(anonym));
    });

    /* --- Fotos ---
       Mehrere auf einmal, und jedes einzeln wieder wegzunehmen. Die
       Reihenfolge hier ist die Reihenfolge im Feed. */
    function zeichneFotos() {
      $('#nb-fotos', s.el).innerHTML = fotos.map((f, i) => `
        <div class="fd-vorschau">
          <img src="${f.vorschau}" alt="Vorschau ${i + 1}">
          <button type="button" class="pressable" data-fweg="${i}" aria-label="Foto ${i + 1} entfernen">${svg(IKON.weg, 13)}</button>
        </div>`).join('');
      $$('#nb-fotos [data-fweg]', s.el).forEach(el => el.addEventListener('click', () => {
        const i = Number(el.dataset.fweg);
        URL.revokeObjectURL(fotos[i].vorschau);
        fotos.splice(i, 1);
        zeichneFotos();
      }));
      $('#nb-foto', s.el).querySelector('span').textContent =
        fotos.length ? `Weitere Fotos hinzufügen (${fotos.length})` : 'Fotos hinzufügen';
    }

    const wahl = $('#nb-datei', s.el);
    $('#nb-foto', s.el).addEventListener('click', () => wahl.click());
    wahl.addEventListener('change', e => {
      const neue = [...(e.target.files || [])];
      e.target.value = '';
      if (!neue.length) return;
      for (const datei of neue) {
        if (!/^image\//.test(datei.type)) { zeigeFehler('Eine der Dateien ist kein Bild.'); continue; }
        if (datei.size > 10 * 1024 * 1024) { zeigeFehler(`„${datei.name}" ist grösser als 10 MB.`); continue; }
        if (fotos.length >= HOECHSTENS) { zeigeFehler(`Mehr als ${HOECHSTENS} Fotos werden unübersichtlich.`); break; }
        fotos.push({ datei, vorschau: URL.createObjectURL(datei) });
        fehler.hidden = true;
      }
      zeichneFotos();
    });

    $('#nb-zu', s.el)?.addEventListener('click', () => s.schliessen());
    $('#nb-nein', s.el)?.addEventListener('click', () => s.schliessen());

    /* --- Posten --- */
    $('#nb-ja', s.el).addEventListener('click', async () => {
      fehler.hidden = true;
      const text = art === 'umfrage'
        ? $('#nb-frage', s.el).value.trim()
        : markiere($('#nb-text', s.el).value.trim(), merkeFuer('neu'));

      if (art === 'umfrage') {
        if (!text) return zeigeFehler('Die Umfrage braucht eine Frage.');
        if (antworten.filter(t => t.trim()).length < 2)
          return zeigeFehler('Eine Umfrage braucht mindestens zwei Antwortmöglichkeiten.');
      } else if (!text && !fotos.length) {
        return zeigeFehler('Ein Beitrag braucht Text oder ein Foto.');
      }
      if (!istOnline()) return zeigeFehler('Dafür braucht es eine Verbindung.');

      const knopf = $('#nb-ja', s.el);
      knopf.disabled = true;
      knopf.innerHTML = '<span class="spin"></span>';
      const zurueck = () => {
        knopf.disabled = false;
        knopf.textContent = art === 'umfrage' ? 'Umfrage posten' : 'Posten';
      };

      /* Die Kennung wird hier gewürfelt und nicht von der Datenbank
         geholt: das Foto liegt unter dieser Kennung im Bucket, muss also
         vor der Zeile hochgeladen werden. Geht danach etwas schief, wird
         die Datei gleich wieder entfernt. */
      const id = crypto.randomUUID();
      const pfade = [];
      let ablauf = null;

      if (art === 'beitrag' && fotos.length) {
        ablauf = new Date(Date.now() + 30 * 86400000).toISOString();
        for (const f of fotos) {
          const endung = (f.datei.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
          const pfad = `${id}/${crypto.randomUUID()}.${endung}`;
          const { error } = await sb.storage.from('feed-bilder')
            .upload(pfad, f.datei, { contentType: f.datei.type });
          if (error) {
            if (pfade.length) await sb.storage.from('feed-bilder').remove(pfade);
            zurueck();
            return zeigeFehler(error.message);
          }
          pfade.push(pfad);
        }
      }

      const zeile = {
        id, art, text: text || null,
        kategorie: art === 'beitrag' ? kategorie : null,
        projekt_id: art === 'beitrag' ? ($('#nb-projekt', s.el).value || null) : null,
        anonym: art === 'umfrage' ? anonym : false,
        bild_ablauf: ablauf,
        erstellt_von: ich
      };
      const { data, error } = await sb.from('feed_beitraege').insert(zeile).select().single();
      if (error) {
        if (pfade.length) await sb.storage.from('feed-bilder').remove(pfade);
        zurueck();
        return zeigeFehler(error.message);
      }

      /* Die Fotozeilen zeigen auf den Beitrag und folgen ihm deshalb —
         genau wie die Antwortmöglichkeiten einer Umfrage. Geht das
         schief, wäre der Beitrag eine leere Hülle mit Dateien, auf die
         nichts zeigt: dann lieber ganz zurück. */
      if (pfade.length) {
        const reihen = pfade.map((pfad, i) => ({
          beitrag_id: id, bild_pfad: pfad, bild_ablauf: ablauf, reihenfolge: i
        }));
        const { data: bi, error: e3 } = await sb.from('feed_bilder').insert(reihen).select();
        if (e3) {
          await sb.from('feed_beitraege').delete().eq('id', id);
          await sb.storage.from('feed-bilder').remove(pfade);
          zurueck();
          return zeigeFehler(e3.message);
        }
        // Ersetzen statt anhängen: die Echtzeit hat sie vielleicht schon gemeldet.
        bilder = [...bilder.filter(x => x.beitrag_id !== id), ...(bi || [])];
      }

      if (art === 'umfrage') {
        const reihen = antworten.map(t => t.trim()).filter(Boolean)
          .map((t, i) => ({ beitrag_id: id, text: t, reihenfolge: i }));
        const { data: opt, error: e2 } = await sb.from('feed_optionen').insert(reihen).select();
        if (e2) {
          /* Eine Umfrage ohne Antwortmöglichkeiten wäre kaputt. Lieber
             ganz zurück als halb stehen lassen. */
          await sb.from('feed_beitraege').delete().eq('id', id);
          zurueck();
          return zeigeFehler(e2.message);
        }
        /* Ersetzen statt anhängen: hat die Echtzeit die Umfrage schon
           gemeldet, hat sie die Antwortmöglichkeiten bereits geholt. */
        optionen = [...optionen.filter(o => o.beitrag_id !== id), ...(opt || [])];
      }

      s.schliessen();
      beitraege = merke(beitraege, data, gleicheId).sort((x, y) =>
        new Date(y.erstellt_am) - new Date(x.erstellt_am));
      filter = 'alle';
      zeichneFilter();
      zeichneListe();
      toast(art === 'umfrage' ? 'Umfrage gepostet' : 'Beitrag gepostet');

      /* Zwei Gründe, warum sich ein Beitrag auf den Telefonen der anderen
         meldet: er ist wichtig, oder er spricht jemanden direkt an. Ein
         Update ohne Erwähnung steht im Feed und wartet dort, bis jemand
         hinschaut — sonst wäre die Kategorie "Wichtig" nach zwei Wochen
         nichts mehr wert.

         Beides zugleich ergibt trotzdem nur eine Meldung: bei einem
         wichtigen Beitrag sind die Erwähnten ohnehin unter "alle", und
         zwei Meldungen zum selben Beitrag wären eine zu viel.

         Geprüft wird das alles noch einmal in api/push.js: die Regel
         soll nicht davon abhängen, dass diese Zeile hier stimmt. */
      const erwaehnt = art === 'beitrag' ? erwaehnungenAus(text).filter(u => u !== ich) : [];
      if (art === 'beitrag' && (kategorie === 'wichtig' || erwaehnt.length)) {
        const vorname = nameVon(ich).split(' ')[0];
        pushSenden({
          beitrag: id,
          titel: kategorie === 'wichtig' ? `Wichtig von ${vorname}` : `${vorname} hat Sie erwähnt`,
          text: erwaehnungKlartext(text),
          ziel: 'feed.html'
        });
      }
    });
  }

  /* --- Start ------------------------------------------------------------------ */

  (async () => {
    if (!await verlangeLogin()) return;

    const s = await session();
    ich = s.user.id;
    darfModerieren = await darfVerwalten();

    function hinweisZeigen() {
      const el = $('#hinweis');
      el.hidden = istOnline();
      if (!istOnline()) el.textContent = 'Offline. Der Feed braucht eine Verbindung.';
    }
    beiStatuswechsel(hinweisZeigen);

    zeichneFilter();
    $('#liste').innerHTML = '<div class="br-leer">Der Feed wird geladen…</div>';

    /* Der Feed hat bewusst keinen lokalen Spiegel: ein Aushang, den man
       offline sieht, wäre womöglich der von vorgestern, und beim
       Wichtigsten wäre das am gefährlichsten. Dann lieber ehrlich sagen,
       dass gerade nichts geht. */
    if (!istOnline()) {
      $('#liste').innerHTML = '<div class="br-leer">Ohne Verbindung lässt sich der Feed nicht laden. Sobald das Gerät wieder online ist, steht hier alles.</div>';
      $$('[data-neu]').forEach(b => b.hidden = true);
      beiStatuswechsel(() => { if (istOnline()) location.reload(); });
      return;
    }

    await ladeAlles();

    /* Nur wer im Adressbuch steht, sieht den Feed. Das steht auch in der
       Policy; hier soll niemand vor einer leeren Seite ohne Erklärung
       stehen. */
    if (!leute.some(l => l.user_id === ich)) {
      $('#liste').innerHTML = '<div class="br-leer">Ihr Konto ist mit keinem Eintrag im Bereich Mitarbeiter verknüpft. Der Feed ist dem TRIGA-Team vorbehalten.</div>';
      $$('[data-neu]').forEach(b => b.hidden = true);
      return;
    }

    zeichneListe();
    horche();
    $$('[data-neu]').forEach(b => b.addEventListener('click', neuerBeitrag));

    /* Einmal nach der Erlaubnis fragen, mit Begründung. Die Frage wird
       nur ein einziges Mal gestellt, bereichsübergreifend — wer sie hier
       beantwortet, bekommt sie im Chat nicht noch einmal. Darum nennt der
       Grund beides. */
    pushFragen({
      grund: 'Damit ein wichtiger Beitrag auch ankommt, wenn die App gerade nicht offen ist — und damit Sie neue Nachrichten im Chat sehen. Ohne funktioniert alles genau gleich, es kommt nur keine Meldung auf den Bildschirm.'
    });

    addEventListener('beforeunload', () => { if (kanal) sb.removeChannel(kanal); });
  })();
})();
