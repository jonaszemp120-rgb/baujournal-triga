/* Startseite: Auswahl des Bereichs.
   Handy ein Kachelraster, Desktop dieselben vier Bereiche als Karten
   neben der Seitenleiste. Die Zahlen kommen live aus der Datenbank.
   Bereiche, deren Tabelle es noch nicht gibt, zeigen keine Zahl statt
   einer falschen. */

(async () => {
  if (!await verlangeLogin()) return;
  kontoKreis($('#konto'));

  $('#banner-mobil').innerHTML = testBanner();
  $('#banner-desktop').innerHTML = testBanner();

  const p = await profil();
  const vorname = (p?.name || '').trim().split(/\s+/)[0] || '';
  $('#m-name').textContent = p?.name || '';
  $('#d-gruss').textContent = vorname ? `Guten Tag, ${vorname}` : 'Guten Tag';
  $('#d-datum').textContent = new Date().toLocaleDateString('de-CH', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });

  /* Welche Bereiche schon eine Tabelle haben. Die Liste wächst mit jedem
     Schritt. Eine Abfrage auf eine Tabelle, die es noch nicht gibt, wäre
     nur eine Fehlermeldung in der Konsole ohne Nutzen. */
  const TABELLEN_DA = ['projekte', 'mitarbeiter', 'ordner', 'firmen'];

  async function zaehle(tabelle, filter = f => f) {
    if (!istOnline() || !TABELLEN_DA.includes(tabelle)) return null;
    const { count, error } = await filter(
      sb.from(tabelle).select('*', { count: 'exact', head: true })
    );
    if (meckern(`${tabelle} zählen`, error)) return null;
    return count ?? null;
  }

  const [mitarbeiter, projekte, firmen, ordner] = await Promise.all([
    zaehle('mitarbeiter', f => f.is('geloescht_am', null)),
    zaehle('projekte', f => f.eq('archiviert', false)),
    zaehle('firmen', f => f.is('geloescht_am', null)),
    zaehle('ordner', f => f.is('geloescht_am', null))
  ]);

  const zahlen = {
    mitarbeiter: { wert: mitarbeiter, eins: 'Person', viele: 'Personen', desktop: 'im Team erfasst' },
    baujournal:  { wert: projekte, eins: 'aktives Projekt', viele: 'aktive Projekte', desktop: 'Projekte aktiv' },
    firmenpool:  { wert: firmen, eins: 'Firma', viele: 'Firmen', desktop: 'Unternehmer im Pool' },
    dokumente:   { wert: ordner, eins: 'Ordner', viele: 'Ordner', desktop: 'Ordner angelegt' }
  };

  $('#raster').innerHTML = BEREICHE.map(b => {
    const z = zahlen[b.id];
    const mobilZeile = z.wert === null
      ? 'wird noch eingerichtet'
      : `${z.wert} ${z.wert === 1 ? z.eins : z.viele}`;
    return `
      <a class="st-kachel pressable" href="${b.ziel}">
        <div class="kopf">
          <div class="symbol">${bereichsIcon(b.icon, 22)}</div>
          <div class="zahl">${z.wert === null ? '–' : z.wert}</div>
        </div>
        <div style="display:flex; flex-direction:column; gap:2px;">
          <div style="font-weight:700; font-size:16px;">${b.titel}</div>
          <div style="color:var(--text-dim); font-size:12.5px;">
            <span class="nur-mobil">${esc(mobilZeile)}</span>
            <span class="nur-desktop">${esc(z.desktop)}</span>
          </div>
        </div>
      </a>`;
  }).join('');
})();
