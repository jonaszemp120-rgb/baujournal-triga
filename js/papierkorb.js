/* Papierkorb eines Projekts. Zeigt, was aus den Listen genommen wurde,
   von wem und wann, und holt es auf Knopfdruck zurück. Ein endgültiges
   Löschen gibt es bewusst nicht, weder hier noch in der Datenbank. */

(async () => {
  if (!await verlangeLogin()) return;

  const projektId = new URLSearchParams(location.search).get('projekt');
  if (!projektId) { location.replace('projekte.html'); return; }

  $('#zurueck').href = `projekt-start.html?projekt=${encodeURIComponent(projektId)}`;

  function karte(e) {
    const wer = e.geloescht_name || 'Unbekannt';
    const wann = e.geloescht_am ? new Date(e.geloescht_am).toLocaleString('de-CH') : '–';
    return `
      <div style="background:var(--card); border:1px solid var(--border); border-radius:16px; padding:16px 18px;">
        <div style="font-size:15px; font-weight:700; color:var(--text);">${fmtDatum(e.datum)}</div>
        <div style="font-size:12.5px; color:var(--text-dim); margin-top:3px; overflow-wrap:anywhere;">${esc(eintragsMeta(e))}</div>
        <div style="font-size:11.5px; color:var(--text-dim); margin-top:9px; padding-top:10px; border-top:1px solid var(--border); font-weight:600;">
          Gelöscht von ${esc(wer)} · ${esc(wann)}
        </div>
        <button type="button" data-id="${esc(e.id)}" class="pressable" style="width:100%; margin-top:12px; height:44px; border-radius:12px; background:var(--card); border:1.5px solid var(--border); color:var(--navy); font-weight:700; font-size:14px; display:flex; align-items:center; justify-content:center; gap:8px;">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--navy)" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><polyline points="3 3 3 8 8 8"/></svg>
          Wiederherstellen
        </button>
      </div>`;
  }

  function hinweisZeigen() {
    const el = $('#hinweis');
    const wartend = offen();
    if (!istOnline()) {
      el.textContent = wartend
        ? `Offline. ${wartend} ${wartend === 1 ? 'Änderung wartet' : 'Änderungen warten'} auf Übertragung.`
        : 'Offline. Angezeigt wird der zuletzt geladene Stand.';
      el.hidden = false;
    } else if (wartend) {
      el.textContent = `${wartend} ${wartend === 1 ? 'Änderung wird' : 'Änderungen werden'} übertragen …`;
      el.hidden = false;
    } else {
      el.hidden = true;
    }
  }

  async function laden() {
    const geloeschte = await ladeEintraege(projektId, { geloescht: true });

    $('#liste').innerHTML = geloeschte.length
      ? geloeschte.map(karte).join('')
      : `<div style="background:var(--card); border:1px dashed var(--border); border-radius:16px; padding:28px 20px; text-align:center; font-size:13.5px; color:var(--text-dim); line-height:1.55;">Der Papierkorb ist leer.</div>`;

    $$('#liste button[data-id]').forEach(b => b.addEventListener('click', async () => {
      b.disabled = true;
      b.innerHTML = '<span class="spin" style="border-color:rgba(0,35,63,.25); border-top-color:var(--navy);"></span>';
      const r = await stelleEintragWiederHer(b.dataset.id);
      toast(r.wartet ? 'Offline erfasst, wird später übertragen' : 'Eintrag wiederhergestellt');
      await laden();
    }));

    hinweisZeigen();
  }

  document.addEventListener('queue', hinweisZeigen);
  beiStatuswechsel(() => { hinweisZeigen(); if (istOnline()) laden(); });

  const projekt = await ladeProjekt(projektId);
  $('#p-name').textContent = projekt?.name || '';

  await syncWarteschlange();
  await laden();
})();
