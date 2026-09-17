/* Eintragsliste, geteilt von der Projekt-Startseite und vom Papierkorb.
   Beide zeigen dieselbe Zeile, nur mit anderer Zusatzangabe. */

const PFEIL_KLEIN = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#9aa5a8" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><polyline points="9 18 15 12 9 6"/></svg>';

function wartetBadge() {
  return ' <span style="font-size:10px; font-weight:700; letter-spacing:.03em; color:#b20000; background:rgba(178,0,0,0.08); border-radius:999px; padding:3px 8px; text-transform:uppercase;">wartet</span>';
}

/* Die Metazeile eines Eintrags: wer, welche Gebäude, Wetter, Kontrollstand. */
function eintragsMeta(e) {
  const { erfuellt, total } = kontrollStand(e.kontrolle);
  return [e.ersteller_name || 'Unbekannt', gebaeudeText(e), e.wetter, e.temperatur,
          total ? `Kontrolle ${erfuellt}/${total}` : null].filter(Boolean).join(' · ');
}

/* Eine antippbare Zeile, die in die Detailansicht führt. */
function eintragsZeile(e, letzte) {
  const trenner = letzte ? '' : 'border-bottom:1px solid var(--border);';
  return `
    <a href="eintrag.html?id=${encodeURIComponent(e.id)}" class="pressable" style="display:flex; align-items:center; justify-content:space-between; gap:10px; padding:11px 0; ${trenner}">
      <div style="min-width:0;">
        <div style="font-size:14px; font-weight:700; color:var(--text);">${fmtDatum(e.datum)}${e._offen ? wartetBadge() : ''}</div>
        <div style="font-size:12px; color:var(--text-dim); margin-top:2px; overflow-wrap:anywhere;">${esc(eintragsMeta(e))}</div>
      </div>
      ${PFEIL_KLEIN}
    </a>`;
}

/* Suche über Freitext und Zeitraum, wie bisher im Verlauf. */
function filtereEintraege(eintraege, { q, von, bis }) {
  const suche = (q || '').trim().toLowerCase();
  return eintraege.filter(e => {
    if (von && String(e.datum) < von) return false;
    if (bis && String(e.datum) > bis) return false;
    if (!suche) return true;
    return [e.ersteller_name, e.wetter, e.temperatur, e.firmen, e.fortschritt,
            e.feststellungen, e.anweisungen, fmtDatum(e.datum), gebaeudeText(e)]
      .some(f => String(f || '').toLowerCase().includes(suche));
  });
}

function hinweisLeer(text) {
  return `<div style="font-size:13px; color:var(--text-dim); padding:6px 0 2px; line-height:1.5;">${text}</div>`;
}
