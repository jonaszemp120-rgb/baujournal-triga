/* Der gemeinsame Rahmen der TRIGA App.
 *
 * Jede Seite eines Bereichs trägt <body data-bereich="…"> und lädt diese
 * Datei. Der Rest passiert hier: der vorhandene Seiteninhalt wandert in
 * einen Inhaltsbereich, davor kommt die Seitenleiste.
 *
 * Unter 1024px ist die Seitenleiste per CSS ausgeblendet und alles bleibt
 * wie vorher. Es gibt deshalb bewusst keine zwei Markup-Varianten und
 * keinen Umschalter in JavaScript, nur eine Struktur und einen
 * Breakpoint.
 */

const BEREICHE = [
  {
    id: 'mitarbeiter', titel: 'Mitarbeiter', ziel: 'mitarbeiter.html',
    icon: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>'
  },
  {
    id: 'baujournal', titel: 'Baujournal', ziel: 'projekte.html',
    icon: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M9 12h6M9 16h6M9 8h2"/>'
  },
  {
    id: 'firmenpool', titel: 'Firmenpool', ziel: 'firmenpool.html',
    icon: '<path d="M3 21h18"/><path d="M5 21V7l8-4v18"/><path d="M19 21V11l-6-4"/><path d="M9 9v.01M9 12v.01M9 15v.01M9 18v.01"/>'
  },
  {
    id: 'dokumente', titel: 'Dokumente', ziel: 'dokumente.html',
    icon: '<path d="M4 4h5l2 3h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z"/>'
  }
];

function bereichsIcon(inhalt, groesse = 20) {
  return `<svg viewBox="0 0 24 24" width="${groesse}" height="${groesse}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inhalt}</svg>`;
}

/* Das Test-Banner. Genau eine Stelle im Code, eine Zeile zum Entfernen:
   TEST_BANNER auf false setzen, dann verschwindet es überall. */
const TEST_BANNER = true;
const TEST_BANNER_TEXT = 'Test-Version — Nutzung noch nicht endgültig entschieden.';

function testBanner() {
  if (!TEST_BANNER) return '';
  return `<div class="tr-banner" style="background:#fdeaea; border:1px solid #f3b9b9; color:#8a0000; border-radius:10px; padding:11px 16px; font-size:13px; font-weight:600; line-height:1.4;">${TEST_BANNER_TEXT}</div>`;
}

function seitenleiste(aktiv) {
  const punkte = BEREICHE.map(b => `
    <a class="tr-nav" href="${b.ziel}"${b.id === aktiv ? ' aria-current="page"' : ''}>
      ${bereichsIcon(b.icon)}<span>${b.titel}</span>
    </a>`).join('');

  return `
    <aside class="tr-sidebar">
      <a class="marke" href="start.html" aria-label="Zur Startseite">
        <img src="assets/triga-logo.png" alt="TRIGA Baumanagement">
      </a>
      <nav style="display:flex; flex-direction:column; gap:4px;">${punkte}</nav>
      <button type="button" class="tr-konto pressable">
        <span class="kreis">–</span>
        <span class="name">…</span>
      </button>
    </aside>`;
}

(() => {
  const aktiv = document.body.dataset.bereich || '';
  const vorhanden = [...document.body.children];

  const inhalt = document.createElement('div');
  inhalt.className = 'tr-inhalt';
  vorhanden.forEach(el => inhalt.appendChild(el));

  document.body.insertAdjacentHTML('afterbegin', seitenleiste(aktiv));
  document.body.appendChild(inhalt);

  /* Ab 1024px gehört die Aktionsleiste in die Kopfzeile. Verschoben wird
     der Knoten selbst, nicht sein Inhalt: so überleben alle Ereignisse,
     IDs und das spätere Neuzeichnen durch die Screens. */
  const leiste = inhalt.querySelector('.actionbar');
  if (leiste) {
    const kopf = inhalt.querySelector('.topbar');
    const heimat = leiste.parentElement;
    const nachbar = leiste.nextElementSibling;
    const breit = matchMedia('(min-width:1024px)');
    const einsortieren = () => {
      if (!kopf) return;
      if (breit.matches) kopf.appendChild(leiste);
      else heimat.insertBefore(leiste, nachbar);
    };
    einsortieren();
    breit.addEventListener('change', einsortieren);
  }

  const konto = document.querySelector('.tr-konto');
  const zeichne = p => {
    konto.querySelector('.kreis').textContent = initialen(p?.name);
    konto.querySelector('.name').textContent = p?.name || '';
  };
  profil().then(zeichne);
  document.addEventListener('profil', e => zeichne(e.detail));
  konto.addEventListener('click', kontoSheet);
})();
