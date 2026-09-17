/* Projektübersicht: Kachelliste, Suche, Archivfilter. */

(async () => {
  if (!await verlangeLogin()) return;
  kontoKreis($('#konto'));

  let alle = [];
  let zeigeArchiv = false;

  const liste = $('#liste');
  const suche = $('#suche');

  const PFEIL = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#9aa5a8" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><polyline points="9 18 15 12 9 6"/></svg>';

  function zweiteZeile(p) {
    return [p.projekt_nr ? `Projekt ${p.projekt_nr}` : null, p.standort]
      .filter(Boolean).join(' · ') || 'Keine Standortangabe';
  }

  function kachel(p) {
    const offenerEintrag = p._lokal ? ' · noch nicht übertragen' : '';
    return `
    <a href="journal.html?projekt=${encodeURIComponent(p.id)}" class="pressable" style="display:block; background:var(--card); border:1px solid var(--border); border-radius:16px; padding:16px 16px; box-shadow:0 1px 2px rgba(10,20,30,0.04);">
      <div style="display:flex; align-items:center; justify-content:space-between; gap:10px;">
        <div style="min-width:0;">
          <div style="font-size:15.5px; font-weight:700; color:var(--text); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${esc(p.name)}</div>
          <div style="font-size:12.5px; color:var(--text-dim); margin-top:3px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${esc(zweiteZeile(p))}</div>
          <div style="display:flex; align-items:center; gap:6px; margin-top:9px;">
            <div style="width:7px; height:7px; border-radius:999px; background:${punktFarbe(p.letzter_eintrag)}; flex-shrink:0;"></div>
            <div style="font-size:11.5px; color:var(--text-dim); font-weight:600;">${p.letzter_eintrag ? 'Letzter Eintrag: ' + relativ(p.letzter_eintrag) : 'Noch kein Eintrag'}${esc(offenerEintrag)}</div>
            ${p.archiviert ? '<div style="font-size:10px; font-weight:700; letter-spacing:.03em; color:var(--text-dim); background:var(--bg); border-radius:999px; padding:3px 8px; text-transform:uppercase;">Archiviert</div>' : ''}
          </div>
        </div>
        ${PFEIL}
      </div>
    </a>`;
  }

  function leer(text) {
    return `<div style="background:var(--card); border:1px dashed var(--border); border-radius:16px; padding:28px 20px; text-align:center; font-size:13.5px; color:var(--text-dim); line-height:1.55;">${text}</div>`;
  }

  function zeichne() {
    const q = suche.value.trim().toLowerCase();
    const sichtbar = alle
      .filter(p => !!p.archiviert === zeigeArchiv)
      .filter(p => !q || [p.name, p.standort, p.bauherrschaft, p.projekt_nr]
        .some(f => String(f || '').toLowerCase().includes(q)));

    const aktive = alle.filter(p => !p.archiviert).length;
    $('#titel').textContent = zeigeArchiv ? 'Archiv' : 'Projekte';
    $('#unterzeile').textContent = zeigeArchiv
      ? `${alle.length - aktive} archivierte ${alle.length - aktive === 1 ? 'Baustelle' : 'Baustellen'}`
      : `${aktive} aktive ${aktive === 1 ? 'Baustelle' : 'Baustellen'} im Team`;
    $('#filter').textContent = zeigeArchiv ? 'Aktive' : 'Archiv';

    liste.innerHTML = sichtbar.length
      ? sichtbar.map(kachel).join('')
      : leer(q
          ? 'Kein Projekt gefunden.'
          : zeigeArchiv
            ? 'Noch nichts archiviert.'
            : 'Noch keine Baustelle erfasst.<br>Unten ein neues Projekt anlegen.');
  }

  function hinweisZeigen() {
    const el = $('#hinweis');
    const wartend = offen();
    if (!istOnline()) {
      el.textContent = wartend
        ? `Offline. ${wartend} ${wartend === 1 ? 'Eintrag wartet' : 'Einträge warten'} auf Übertragung.`
        : 'Offline. Angezeigt wird der zuletzt geladene Stand.';
      el.hidden = false;
    } else if (wartend) {
      el.textContent = `${wartend} ${wartend === 1 ? 'Eintrag wird' : 'Einträge werden'} übertragen …`;
      el.hidden = false;
    } else {
      el.hidden = true;
    }
  }

  async function laden() {
    const { daten } = await ladeProjekte();
    alle = daten;
    zeichne();
    hinweisZeigen();
  }

  suche.addEventListener('input', zeichne);
  $('#filter').addEventListener('click', () => { zeigeArchiv = !zeigeArchiv; zeichne(); });
  document.addEventListener('queue', hinweisZeigen);
  beiStatuswechsel(() => { hinweisZeigen(); if (istOnline()) laden(); });

  await syncWarteschlange();
  await laden();
})();
