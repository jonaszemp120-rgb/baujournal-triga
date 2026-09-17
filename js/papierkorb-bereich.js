/* Papierkorb der Bereiche Mitarbeiter, Firmenpool und Dokumente.
 *
 * Eine Seite für alle drei, aufgerufen mit ?bereich=… Das Muster ist
 * überall dasselbe: die Tabelle trägt geloescht_am und geloescht_von,
 * zurückholen heisst beide Felder leeren. Ein endgültiges Löschen gibt
 * es nicht, weder hier noch in der Datenbank.
 */

const BEREICHE_PK = {
  mitarbeiter: {
    titel: 'Mitarbeiter', zurueck: 'mitarbeiter.html', bereich: 'mitarbeiter',
    teile: [{ tabelle: 'mitarbeiter', spalte: 'name' }]
  },
  firmen: {
    titel: 'Firmenpool', zurueck: 'firmenpool.html', bereich: 'firmenpool',
    teile: [
      { tabelle: 'firmen',    spalte: 'name', ueberschrift: 'Firmen' },
      { tabelle: 'bkp_liste', spalte: 'code', zusatz: 'bezeichnung', ueberschrift: 'BKP-Kategorien' }
    ]
  },
  ordner: {
    titel: 'Dokumente', zurueck: 'dokumente.html', bereich: 'dokumente',
    teile: [
      { tabelle: 'ordner',  spalte: 'name', ueberschrift: 'Ordner' },
      { tabelle: 'dateien', spalte: 'name', ueberschrift: 'Dateien' }
    ]
  }
};

(async () => {
  if (!await verlangeLogin()) return;

  const schluessel = new URLSearchParams(location.search).get('bereich');
  const b = BEREICHE_PK[schluessel];
  if (!b) { location.replace('start.html'); return; }

  document.body.dataset.bereich = b.bereich;
  document.title = `Papierkorb ${b.titel} · TRIGA App`;
  $('#d-titel').textContent = `Papierkorb — ${b.titel}`;
  $('#m-titel').textContent = `Papierkorb — ${b.titel}`;
  $('#zurueck').href = b.zurueck;

  const PFEIL_ZURUECK = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg>';

  async function ladeTeil(t, wer) {
    /* Manche Tabellen brauchen zwei Spalten, um erkennbar zu sein: eine
       BKP-Kategorie ist "211 Baumeisterarbeiten", nicht nur "211". */
    const felder = [t.spalte, t.zusatz].filter(Boolean);
    const { data, error } = await sb.from(t.tabelle)
      .select(`id, ${felder.join(', ')}, geloescht_am, geloescht_von`)
      .not('geloescht_am', 'is', null)
      .order('geloescht_am', { ascending: false });
    if (meckern(`Papierkorb ${t.tabelle}`, error)) return null;

    const zeilen = (data || []).map(z => `
      <div class="pk-zeile">
        <div class="pk-name">${esc(felder.map(f => z[f]).filter(Boolean).join(' '))}</div>
        <div class="pk-wann">${esc(new Date(z.geloescht_am).toLocaleDateString('de-CH'))}</div>
        <div class="pk-wer">${esc(wer[z.geloescht_von] || 'Unbekannt')}</div>
        <button type="button" class="pk-zurueck pressable" data-tabelle="${esc(t.tabelle)}" data-id="${esc(z.id)}">
          ${PFEIL_ZURUECK}<span>Wiederherstellen</span>
        </button>
      </div>`).join('');

    return { anzahl: data?.length || 0, html: `
      ${t.ueberschrift ? `<div style="font-size:12px; font-weight:700; letter-spacing:.06em; text-transform:uppercase; color:var(--red); margin:0 0 10px;">${esc(t.ueberschrift)}</div>` : ''}
      ${data?.length ? `<div class="pk-tabelle" style="margin-bottom:24px;">
        <div class="pk-kopf">
          <div class="pk-name">Name</div><div class="pk-wann">Gelöscht am</div>
          <div class="pk-wer">Von</div><div style="width:190px;"></div>
        </div>${zeilen}</div>`
      : `<div class="br-leer" style="margin-bottom:24px;">Nichts im Papierkorb.</div>`}` };
  }

  async function laden() {
    if (!istOnline()) {
      $('#inhalt').innerHTML = `<div class="br-leer">Der Papierkorb braucht eine Verbindung.</div>`;
      return;
    }

    const wer = await namen();
    const teile = await Promise.all(b.teile.map(t => ladeTeil(t, wer)));
    if (teile.some(t => t === null)) {
      $('#inhalt').innerHTML = `<div class="br-leer">Der Papierkorb liess sich nicht laden.</div>`;
      return;
    }

    $('#inhalt').innerHTML = teile.every(t => t.anzahl === 0)
      ? `<div class="br-leer">Der Papierkorb ist leer.</div>`
      : teile.map(t => t.html).join('');

    $$('#inhalt button[data-id]').forEach(btn => btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.innerHTML = '<span class="spin" style="border-color:rgba(0,35,63,.25); border-top-color:var(--navy);"></span>';
      const { error } = await sb.from(btn.dataset.tabelle)
        .update({ geloescht_am: null }).eq('id', btn.dataset.id);
      if (error) { toast(error.message, true); btn.disabled = false; }
      else toast('Wiederhergestellt');
      await laden();
    }));
  }

  beiStatuswechsel(laden);
})();
