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
  const TABELLEN_DA = ['projekte', 'mitarbeiter', 'ordner', 'firmen', 'chat_mitglieder'];

  async function zaehle(tabelle, filter = f => f) {
    if (!istOnline() || !TABELLEN_DA.includes(tabelle)) return null;
    const { count, error } = await filter(
      sb.from(tabelle).select('*', { count: 'exact', head: true })
    );
    if (meckern(`${tabelle} zählen`, error)) return null;
    return count ?? null;
  }

  const [mitarbeiter, projekte, laufend, firmen, ordner, gespraeche] = await Promise.all([
    zaehle('mitarbeiter', f => f.is('geloescht_am', null)),
    zaehle('projekte', f => f.eq('archiviert', false)),
    zaehle('projekte', f => f.eq('archiviert', false).eq('status', 'laufend')),
    zaehle('firmen', f => f.is('geloescht_am', null)),
    zaehle('ordner', f => f.is('geloescht_am', null)),
    // Nur die eigenen: fremde Gespräche gehen niemanden etwas an, und die
    // Policy gibt sie ohnehin nicht heraus.
    zaehle('chat_mitglieder', f => f.eq('user_id', p?.id || ''))
  ]);

  const zahlen = {
    mitarbeiter: { wert: mitarbeiter, eins: 'Person', viele: 'Personen', desktop: 'im Team erfasst' },
    projekte:    { wert: projekte, eins: 'Projekt', viele: 'Projekte',
                   desktop: laufend === null ? 'im Überblick' : `${laufend} laufend` },
    baujournal:  { wert: projekte, eins: 'aktives Projekt', viele: 'aktive Projekte', desktop: 'Projekte aktiv' },
    firmenpool:  { wert: firmen, eins: 'Firma', viele: 'Firmen', desktop: 'Unternehmer im Pool' },
    dokumente:   { wert: ordner, eins: 'Ordner', viele: 'Ordner', desktop: 'Ordner angelegt' },
    chat:        { wert: gespraeche, eins: 'Gespräch', viele: 'Gespräche', desktop: 'Gespräche' }
  };

  /* Feed und Formulare haben bewusst keine Kachel, sie stehen in der
     Seitenleiste. Auf dem Handy gibt es die Seitenleiste aber nicht, und
     ohne einen Weg dorthin wären die Bereiche auf dem Telefon schlicht
     nicht erreichbar. Darum diese Zeilen über den Kacheln: keine weiteren
     Felder im Raster, sondern Einstiege, die sich davon deutlich
     unterscheiden. */
  $('#einstiege').innerHTML = BEREICHE.filter(b => b.kachel === false).map(b => `
    <a class="st-einstieg pressable" href="${b.ziel}">
      <span class="symbol">${bereichsIcon(b.icon, 18)}</span>
      <span class="wort">
        <span class="titel">${esc(b.titel)}</span>
        <span class="unter">${esc(b.untertitel || '')}</span>
      </span>
      <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>
    </a>`).join('');

  $('#raster').innerHTML = BEREICHE.filter(b => b.kachel !== false).map(b => {
    const z = zahlen[b.id];
    const mobilZeile = z.wert === null
      ? 'wird noch eingerichtet'
      : b.id === 'projekte' && laufend !== null
        ? `${laufend} laufend`
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
