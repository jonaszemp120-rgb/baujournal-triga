/* Papierkorb der Bereiche Mitarbeiter, Firmenpool und Dokumente.
 *
 * Eine Seite für alle drei, aufgerufen mit ?bereich=… Das Muster ist
 * überall dasselbe: die Tabelle trägt geloescht_am und geloescht_von,
 * zurückholen heisst beide Felder leeren. Ein endgültiges Löschen gibt
 * es nicht, weder hier noch in der Datenbank.
 */

const BEREICHE_PK = {
  mitarbeiter: { titel: 'Mitarbeiter', tabelle: 'mitarbeiter', spalte: 'name', zurueck: 'mitarbeiter.html' },
  firmen:      { titel: 'Firmenpool',  tabelle: 'firmen',      spalte: 'name', zurueck: 'firmenpool.html' },
  ordner:      { titel: 'Dokumente',   tabelle: 'ordner',      spalte: 'name', zurueck: 'dokumente.html' }
};

(async () => {
  if (!await verlangeLogin()) return;

  const schluessel = new URLSearchParams(location.search).get('bereich');
  const b = BEREICHE_PK[schluessel];
  if (!b) { location.replace('start.html'); return; }

  document.body.dataset.bereich = schluessel === 'ordner' ? 'dokumente'
                                : schluessel === 'firmen' ? 'firmenpool' : 'mitarbeiter';
  document.title = `Papierkorb ${b.titel} · TRIGA App`;
  $('#d-titel').textContent = `Papierkorb — ${b.titel}`;
  $('#m-titel').textContent = `Papierkorb — ${b.titel}`;
  $('#zurueck').href = b.zurueck;

  const PFEIL_ZURUECK = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg>';

  async function laden() {
    if (!istOnline()) {
      $('#inhalt').innerHTML = `<div class="br-leer">Der Papierkorb braucht eine Verbindung.</div>`;
      return;
    }

    const { data, error } = await sb.from(b.tabelle)
      .select(`id, ${b.spalte}, geloescht_am, geloescht_von`)
      .not('geloescht_am', 'is', null)
      .order('geloescht_am', { ascending: false });
    if (meckern('Papierkorb laden', error)) {
      $('#inhalt').innerHTML = `<div class="br-leer">Der Papierkorb liess sich nicht laden.</div>`;
      return;
    }

    if (!data.length) {
      $('#inhalt').innerHTML = `<div class="br-leer">Der Papierkorb ist leer.</div>`;
      return;
    }

    const wer = await namen();
    $('#inhalt').innerHTML = `
      <div class="pk-tabelle">
        <div class="pk-kopf">
          <div class="pk-name">Name</div><div class="pk-wann">Gelöscht am</div>
          <div class="pk-wer">Von</div><div style="width:190px;"></div>
        </div>
        ${data.map(z => `
          <div class="pk-zeile">
            <div class="pk-name">${esc(z[b.spalte])}</div>
            <div class="pk-wann">${esc(new Date(z.geloescht_am).toLocaleDateString('de-CH'))}</div>
            <div class="pk-wer">${esc(wer[z.geloescht_von] || 'Unbekannt')}</div>
            <button type="button" class="pk-zurueck pressable" data-id="${esc(z.id)}">
              ${PFEIL_ZURUECK}<span>Wiederherstellen</span>
            </button>
          </div>`).join('')}
      </div>`;

    $$('#inhalt button[data-id]').forEach(btn => btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.innerHTML = '<span class="spin" style="border-color:rgba(0,35,63,.25); border-top-color:var(--navy);"></span>';
      const { error } = await sb.from(b.tabelle)
        .update({ geloescht_am: null }).eq('id', btn.dataset.id);
      if (error) { toast(error.message, true); btn.disabled = false; }
      else toast('Wiederhergestellt');
      await laden();
    }));
  }

  beiStatuswechsel(laden);
})();
