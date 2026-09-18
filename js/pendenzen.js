/* Die vollständige Pendenzenliste eines Projekts.
 *
 * Auf der Projektseite steht nur der Auszug mit den offenen Punkten.
 * Hier stehen alle, offene zuerst, die erledigten darunter — sichtbar
 * durchgestrichen statt versteckt. Wer wissen will, was diese Woche
 * abgehakt wurde, findet es sonst nirgends.
 */

(() => {
  const projektId = new URLSearchParams(location.search).get('projekt');

  let projekt = null;
  let liste = [];
  let firmen = [];

  const IKON = {
    haken: '<path d="M20 6 9 17l-5-5"/>',
    stift: '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/>',
    weg: '<path d="M18 6 6 18M6 6l12 12"/>'
  };
  const svg = (d, g = 14) => `<svg viewBox="0 0 24 24" width="${g}" height="${g}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;

  /* --- Zeichnen ------------------------------------------------------------ */

  function zeile(p) {
    const erledigt = !!p.erledigt_am;
    return `
      <div class="pj-pendenz" data-erledigt="${erledigt ? 1 : 0}">
        <button type="button" class="haken pressable" data-haken="${esc(p.id)}"
                role="checkbox" aria-checked="${erledigt}"
                aria-label="${esc(p.beschrieb)} ${erledigt ? 'wieder öffnen' : 'erledigen'}">${svg(IKON.haken)}</button>
        <span class="was">
          <span class="text">${esc(p.beschrieb)}</span>
          ${p.firmen ? `<span class="wer">${esc(p.firmen.name)}</span>` : ''}
        </span>
        <span class="tasten">
          <button type="button" class="pressable" data-bearb="${esc(p.id)}" aria-label="Pendenz bearbeiten">${svg(IKON.stift)}</button>
          <button type="button" class="rot pressable" data-fort="${esc(p.id)}" aria-label="Pendenz löschen">${svg(IKON.weg)}</button>
        </span>
      </div>`;
  }

  function zeichne() {
    const offen = liste.filter(p => !p.erledigt_am);
    const erledigt = liste.filter(p => p.erledigt_am);

    $('#liste').innerHTML = liste.length ? `
      <div class="pj-gruppe">Offen — ${offen.length}</div>
      ${offen.length ? `<div class="pj-kasten">${offen.map(zeile).join('')}</div>`
        : '<div class="pj-leer">Nichts offen.</div>'}
      ${erledigt.length ? `
        <div class="pj-gruppe">Erledigt — ${erledigt.length}</div>
        <div class="pj-kasten">${erledigt.map(zeile).join('')}</div>` : ''}
    ` : '<div class="br-leer">Noch keine Pendenz auf diesem Projekt.</div>';

    $$('#liste [data-haken]').forEach(el => el.addEventListener('click',
      () => haken(liste.find(p => p.id === el.dataset.haken))));
    $$('#liste [data-bearb]').forEach(el => el.addEventListener('click',
      () => erfassen(liste.find(p => p.id === el.dataset.bearb))));
    $$('#liste [data-fort]').forEach(el => el.addEventListener('click',
      () => loeschen(liste.find(p => p.id === el.dataset.fort))));
  }

  /* --- Handeln -------------------------------------------------------------- */

  async function neuLaden() {
    liste = await PJ.pendenzen(projektId);
    zeichne();
  }

  async function haken(p) {
    if (!p) return;
    try {
      await PJ.pendenzHaken(p, !p.erledigt_am);
      await neuLaden();
      toast(p.erledigt_am ? 'Wieder offen' : 'Erledigt');
    } catch (e) {
      toast(e.message, true);
    }
  }

  async function erfassen(vorhanden = null) {
    const gemacht = await PJ.pendenzFormular({
      projektId, firmen,
      vorhanden: vorhanden && vorhanden.id ? vorhanden : null
    });
    if (!gemacht) return;
    await neuLaden();
    toast(vorhanden && vorhanden.id ? 'Gespeichert' : 'Pendenz erfasst');
  }

  async function loeschen(p) {
    if (!p) return;
    const ja = await frage({
      titel: 'Pendenz löschen?',
      text: `„${p.beschrieb}" wird endgültig entfernt. Für Pendenzen gibt es keinen Papierkorb; wer einen Punkt nur abhaken will, nimmt die Checkbox — erledigte bleiben in der Liste stehen.`,
      knopf: 'Löschen'
    });
    if (!ja) return;
    try {
      await PJ.loeschen('pendenzen', p.id);
      await neuLaden();
      toast('Gelöscht');
    } catch (e) {
      toast(e.message, true);
    }
  }

  /* --- Start ---------------------------------------------------------------- */

  (async () => {
    if (!await verlangeLogin()) return;
    if (!projektId) { location.replace('projekte-bereich.html'); return; }

    const zurueck = `projekt-detail.html?projekt=${encodeURIComponent(projektId)}`;
    $('#d-zurueck').href = zurueck;
    $('#m-zurueck').href = zurueck;
    $('#d-neu').addEventListener('click', () => erfassen(null));
    $('#m-neu').addEventListener('click', () => erfassen(null));

    function hinweisZeigen() {
      const el = $('#hinweis');
      el.hidden = istOnline();
      if (!istOnline()) el.textContent = 'Offline. Pendenzen brauchen eine Verbindung.';
    }
    beiStatuswechsel(hinweisZeigen);

    const [p, l, e] = await Promise.all([
      PJ.projekt(projektId), PJ.pendenzen(projektId), PJ.einsaetze(projektId)
    ]);
    projekt = p;
    liste = l;
    firmen = e.map(x => x.firmen).filter(Boolean);

    const titel = projekt ? `Pendenzen — ${projekt.name}` : 'Pendenzen';
    document.title = `${titel} · TRIGA App`;
    $('#d-name').textContent = titel;
    $('#m-name').textContent = titel;
    zeichne();
  })();
})();
