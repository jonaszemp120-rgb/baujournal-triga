/* Bereich Projekte: die Übersicht.
 *
 * Eine Karte je Projekt, gefiltert nach Status. Die drei Zahlen im Fuss
 * jeder Karte kommen aus drei Abfragen für die ganze Liste, nicht aus
 * drei Abfragen je Projekt: bei zwanzig Projekten wären das sechzig
 * Anfragen für eine Übersicht.
 */

(() => {
  let alle = [];
  let zahlen = { firmen: {}, personen: {}, ordner: {} };
  let filter = 'alle';

  const IKON = {
    firma: '<path d="M3 21h18"/><path d="M5 21V7l8-4v18"/><path d="M19 21V11l-6-4"/>',
    person: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>',
    ordner: '<path d="M4 4h5l2 3h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z"/>'
  };
  const svg = (d, g = 14) => `<svg viewBox="0 0 24 24" width="${g}" height="${g}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;

  /* --- Zahlen für den Kartenfuss ------------------------------------------ */

  async function ladeZahlen() {
    if (!istOnline()) return { firmen: {}, personen: {}, ordner: {} };
    const zaehle = reihen => {
      const k = {};
      (reihen || []).forEach(r => { if (r.projekt_id) k[r.projekt_id] = (k[r.projekt_id] || 0) + 1; });
      return k;
    };
    const [e, m, o] = await Promise.all([
      sb.from('projekteinsaetze').select('projekt_id'),
      sb.from('projekt_mitarbeiter').select('projekt_id'),
      sb.from('ordner').select('projekt_id').is('geloescht_am', null)
    ]);
    meckern('Unternehmer zählen', e.error);
    meckern('Mitarbeiter zählen', m.error);
    meckern('Ordner zählen', o.error);
    return { firmen: zaehle(e.data), personen: zaehle(m.data), ordner: zaehle(o.data) };
  }

  /* --- Filter -------------------------------------------------------------- */

  function sichtbar() {
    if (filter === 'archiviert') return alle.filter(p => p.archiviert);
    const aktiv = alle.filter(p => !p.archiviert);
    return filter === 'alle' ? aktiv : aktiv.filter(p => p.status === filter);
  }

  function zeichneFilter() {
    const aktiv = alle.filter(p => !p.archiviert).length;
    const eintraege = [
      { id: 'alle', titel: `Alle · ${aktiv}` },
      ...PJ.STATUS.map(s => ({ id: s.id, titel: s.titel })),
      { id: 'archiviert', titel: 'Archiviert' }
    ];
    $('#filter').innerHTML = eintraege.map(e => `
      <button type="button" class="pj-chip pressable" data-filter="${e.id}" aria-pressed="${filter === e.id}">${esc(e.titel)}</button>
    `).join('');
    $$('#filter .pj-chip').forEach(el => el.addEventListener('click', () => {
      filter = el.dataset.filter;
      zeichneFilter();
      zeichneListe();
    }));
  }

  /* --- Liste --------------------------------------------------------------- */

  function karte(p) {
    const adr = PJ.adresse(p);
    const bh = (p.bauherrschaft || '').trim();
    const zahl = (art, eins, viele) => {
      const n = zahlen[art][p.id] || 0;
      return `<span>${svg(IKON[art === 'personen' ? 'person' : art === 'firmen' ? 'firma' : 'ordner'])}${n} ${n === 1 ? eins : viele}</span>`;
    };
    return `
      <a class="pj-karte pressable" href="projekt-detail.html?projekt=${encodeURIComponent(p.id)}">
        <span class="oben">
          <span class="pname">${esc(p.name)}</span>
          ${p.archiviert ? '<span class="pj-marke grau">Archiviert</span>' : PJ.statusChip(p.status)}
        </span>
        <span class="zeile">
          ${adr ? esc(adr) : '<span style="opacity:.6;">Keine Adresse erfasst</span>'}
          ${bh ? `<br>Bauherrschaft: ${esc(bh)}` : ''}
        </span>
        <span class="fuss">
          ${zahl('firmen', 'Firma', 'Firmen')}
          ${zahl('personen', 'Mitarbeiter', 'Mitarbeiter')}
          ${zahl('ordner', 'Ordner', 'Ordner')}
        </span>
      </a>`;
  }

  function zeichneListe() {
    const liste = sichtbar();
    $('#liste').innerHTML = liste.length
      ? liste.map(karte).join('')
      : `<div class="br-leer">${alle.length
          ? 'Kein Projekt in dieser Auswahl.'
          : 'Noch kein Projekt erfasst.<br>Oben rechts eines anlegen.'}</div>`;
  }

  /* --- Anlegen -------------------------------------------------------------- */

  async function anlegen() {
    const neu = await PJ.formular(null);
    if (neu) location.href = `projekt-detail.html?projekt=${encodeURIComponent(neu.id)}`;
  }

  /* --- Start ---------------------------------------------------------------- */

  (async () => {
    if (!await verlangeLogin()) return;

    $('#d-neu').addEventListener('click', anlegen);
    $('#m-neu').addEventListener('click', anlegen);

    function hinweisZeigen() {
      const el = $('#hinweis');
      el.hidden = istOnline();
      if (!istOnline()) el.textContent = 'Offline. Angezeigt wird der zuletzt geladene Stand, Änderungen sind erst wieder mit Verbindung möglich.';
    }
    beiStatuswechsel(hinweisZeigen);

    [alle, zahlen] = await Promise.all([PJ.projekte(), ladeZahlen()]);
    zeichneFilter();
    zeichneListe();
  })();
})();
