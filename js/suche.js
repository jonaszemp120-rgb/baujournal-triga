/* Die globale Suche.
 *
 * Ein Feld über alle vier Bereiche, Treffer nach Bereich gruppiert, jeder
 * mit einem Sprung an die Stelle, wo er hingehört.
 *
 * Gesucht wird in der Datenbank, nicht im Browser: der Firmenpool allein
 * hat 224 Zeilen, und das soll auch bei zehnmal so viel noch gehen. Je
 * Bereich eine Abfrage mit ilike, das reicht für diese Grössenordnung und
 * kommt ohne Volltextindex aus.
 */

(() => {
  const GRENZE = 12;   // je Bereich, damit eine kurze Anfrage nicht die Seite flutet

  let laeuft = 0;      // zählt die Anfragen, damit eine langsame keine neue überholt

  const IKON = {
    projekt: '<path d="M3 21h18"/><path d="M5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16"/><path d="M9 7h.01M15 7h.01M9 11h.01M15 11h.01"/>',
    firma: '<path d="M3 21h18"/><path d="M5 21V7l8-4v18"/><path d="M19 21V11l-6-4"/>',
    person: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>',
    ordner: '<path d="M4 4h5l2 3h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z"/>',
    datei: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>'
  };
  const svg = (d, g = 17) => `<svg viewBox="0 0 24 24" width="${g}" height="${g}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;

  /* Maskierung und or-Gruppe stehen in js/app.js: die Suche über die
     Protokolle eines Projekts braucht beides genauso. */
  const sauber = suchSauber;
  const oder = suchOder;

  async function suche(roh) {
    const q = sauber(roh);
    if (q.length < 2) return null;

    const [projekte, firmen, mitarbeiter, ordner, dateien] = await Promise.all([
      sb.from('projekte')
        .select('id, name, standort, bauherrschaft, status, archiviert')
        .or(oder(['name', 'standort', 'bauherrschaft', 'beschrieb', 'projekt_nr'], q)).limit(GRENZE),
      sb.from('firmen')
        .select('id, name, plz_ort, bkp_codes')
        .is('geloescht_am', null)
        .or(oder(['name', 'plz_ort', 'adresse', 'email', 'telefon'], q)).limit(GRENZE),
      sb.from('mitarbeiter')
        .select('id, name, rolle, telefon, email')
        .is('geloescht_am', null)
        .or(oder(['name', 'rolle', 'email', 'telefon'], q)).limit(GRENZE),
      sb.from('ordner')
        .select('id, name, projekt_id')
        .is('geloescht_am', null)
        .or(oder(['name'], q)).limit(GRENZE),
      /* Neu auch im Text der PDF. "Offerte_2026_final.pdf" verrät nicht,
         um welche Firma es geht — der Text darin schon. Er steht in
         dateien.volltext und wird beim Hochladen und beim ersten Öffnen
         im Browser mit pdf.js herausgezogen; siehe js/dokumente.js. */
      sb.from('dateien')
        .select('id, name, ordner_id, volltext')
        .is('geloescht_am', null)
        .or(oder(['name', 'volltext'], q)).limit(GRENZE)
    ]);

    [['Projekte', projekte], ['Firmen', firmen], ['Mitarbeiter', mitarbeiter],
     ['Ordner', ordner], ['Dateien', dateien]].forEach(([was, r]) => meckern(`Suche ${was}`, r.error));

    return {
      projekte: projekte.data || [],
      firmen: firmen.data || [],
      mitarbeiter: mitarbeiter.data || [],
      ordner: ordner.data || [],
      dateien: dateien.data || []
    };
  }

  /* Ein Stück Text um die Fundstelle herum. Nur wenn der Name selbst
     nichts hergibt — sonst wäre die Zeile doppelt. */
  function stelleImText(d, roh) {
    const q = String(roh || '').trim().toLowerCase();
    if (!q || !d.volltext) return null;
    if (String(d.name).toLowerCase().includes(q)) return null;
    if (!String(d.volltext).toLowerCase().includes(q)) return null;
    return textStelle(d.volltext, q);
  }

  /* --- Anzeige -------------------------------------------------------------- */

  function treffer(ikon, ziel, titel, unter, marke = '') {
    return `
      <a class="su-treffer" href="${esc(ziel)}">
        <span class="symbol">${svg(ikon)}</span>
        <span class="wer">
          <span class="titel">${esc(titel)}</span>
          ${unter ? `<span class="unter">${esc(unter)}</span>` : ''}
        </span>
        ${marke}
      </a>`;
  }

  function gruppe(titel, zeilen) {
    if (!zeilen.length) return '';
    return `
      <div class="su-gruppe">${esc(titel)} — ${zeilen.length} ${zeilen.length === 1 ? 'Treffer' : 'Treffer'}</div>
      <div class="su-liste">${zeilen.join('')}</div>`;
  }

  function zeichne(t, roh, ordnerNamen) {
    if (t === null) {
      $('#ergebnis').innerHTML = `<div class="br-leer">${roh.trim()
        ? 'Bitte mindestens zwei Zeichen eingeben.'
        : 'Tippe einen Namen, eine Adresse, ein Gewerk oder einen Dateinamen. Gesucht wird über Projekte, Firmen, Mitarbeiter und Dokumente.'}</div>`;
      return;
    }

    const teile = [
      gruppe('Projekte', t.projekte.map(p => treffer(
        IKON.projekt,
        `projekt-detail.html?projekt=${encodeURIComponent(p.id)}`,
        p.name,
        [PJ.adresse(p), p.bauherrschaft].filter(Boolean).join(' · '),
        p.archiviert ? '<span class="pj-marke klein grau">Archiviert</span>' : PJ.statusChip(p.status)))),

      gruppe('Firmen', t.firmen.map(f => treffer(
        IKON.firma,
        `firmenpool.html?firma=${encodeURIComponent(f.id)}`,
        f.name,
        [(Array.isArray(f.bkp_codes) ? f.bkp_codes : []).join(', '), f.plz_ort].filter(Boolean).join(' · ')))),

      gruppe('Mitarbeiter', t.mitarbeiter.map(m => treffer(
        IKON.person,
        `mitarbeiter.html?person=${encodeURIComponent(m.id)}`,
        m.name,
        [m.rolle, m.telefon].filter(Boolean).join(' · ')))),

      gruppe('Dokumente', [
        ...t.ordner.map(o => treffer(
          IKON.ordner,
          `dokumente.html?ordner=${encodeURIComponent(o.id)}`,
          o.name,
          'Ordner')),
        ...t.dateien.map(d => treffer(
          IKON.datei,
          `dokumente.html?ordner=${encodeURIComponent(d.ordner_id)}`,
          d.name,
          /* Steht das Gesuchte nicht im Namen, sondern im Text, wird die
             Stelle gezeigt. Sonst stünde eine Datei im Ergebnis, ohne
             dass erkennbar wäre, warum. */
          stelleImText(d, roh) || ordnerNamen[d.ordner_id] || 'Datei'))
      ])
    ].filter(Boolean);

    $('#ergebnis').innerHTML = teile.length
      ? teile.join('')
      : `<div class="br-leer">Nichts gefunden zu „${esc(roh.trim())}".</div>`;
  }

  /* --- Start ---------------------------------------------------------------- */

  (async () => {
    if (!await verlangeLogin()) return;

    const felder = [$('#d-q'), $('#m-q')];
    const start = new URLSearchParams(location.search).get('q') || '';
    felder.forEach(f => { f.value = start; });

    /* Ordnernamen einmal holen, damit eine gefundene Datei sagen kann, wo
       sie liegt. Die Liste ist kurz, das lohnt keine zweite Abfrage je
       Treffer. */
    let ordnerNamen = {};
    async function ladeOrdnerNamen() {
      if (!istOnline()) return;
      const { data } = await sb.from('ordner').select('id, name').is('geloescht_am', null);
      ordnerNamen = Object.fromEntries((data || []).map(o => [o.id, o.name]));
    }
    await ladeOrdnerNamen();

    let timer;
    async function los(roh) {
      const meine = ++laeuft;
      if (!istOnline()) {
        $('#ergebnis').innerHTML = '<div class="br-leer">Die Suche braucht eine Verbindung.</div>';
        return;
      }
      const t = await suche(roh);
      if (meine !== laeuft) return;   // eine neuere Anfrage ist schon unterwegs
      zeichne(t, roh, ordnerNamen);
      const url = new URL(location.href);
      if (roh.trim()) url.searchParams.set('q', roh.trim()); else url.searchParams.delete('q');
      history.replaceState(null, '', url);
    }

    felder.forEach(f => {
      f.addEventListener('input', () => {
        const wert = f.value;
        felder.filter(x => x !== f).forEach(x => { x.value = wert; });
        clearTimeout(timer);
        timer = setTimeout(() => los(wert), 220);
      });
    });
    ['#d-form', '#m-form'].forEach(id => $(id).addEventListener('submit', e => e.preventDefault()));

    function hinweisZeigen() {
      const el = $('#hinweis');
      el.hidden = istOnline();
      if (!istOnline()) el.textContent = 'Offline. Die Suche fragt die Datenbank und braucht eine Verbindung.';
    }
    beiStatuswechsel(hinweisZeigen);

    setTimeout(() => (matchMedia('(min-width:1024px)').matches ? $('#d-q') : $('#m-q')).focus(), 120);
    los(start);
  })();
})();
