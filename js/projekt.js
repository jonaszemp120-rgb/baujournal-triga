/* Projekt anlegen und bearbeiten. Derselbe Screen für beides:
   ohne ?id= ein neues Projekt, mit ?id= das bestehende. */

(async () => {
  if (!await verlangeLogin()) return;

  const id = new URLSearchParams(location.search).get('id');
  const bearbeiten = !!id;

  const X = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#9aa5a8" stroke-width="2.4" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';

  /* Zusaetzliche Kontrollpunkte und Gebaeude verhalten sich gleich:
     antippbare Liste, Eingabefeld mit Plus, einzeln entfernbar. */
  function freieListe(listeSel, feldSel, knopfSel) {
    const eintraege = [];
    const liste = $(listeSel);
    const feld = $(feldSel);

    function zeichne() {
      liste.innerHTML = eintraege.map((label, i) => `
        <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; background:var(--bg); border-radius:10px; padding:10px 12px;">
          <span style="font-size:13.5px; color:var(--text); font-weight:500; min-width:0; overflow-wrap:anywhere;">${esc(label)}</span>
          <button type="button" data-i="${i}" aria-label="Entfernen" style="border:none; background:none; padding:0; display:flex; flex-shrink:0;">${X}</button>
        </div>`).join('');
      $$('button[data-i]', liste).forEach(b =>
        b.addEventListener('click', () => { eintraege.splice(+b.dataset.i, 1); zeichne(); }));
    }

    function hinzu() {
      const wert = feld.value.trim();
      if (!wert) return;
      if (eintraege.some(z => z.toLowerCase() === wert.toLowerCase())) { feld.value = ''; return; }
      eintraege.push(wert);
      feld.value = '';
      zeichne();
      feld.focus();
    }

    $(knopfSel).addEventListener('click', hinzu);
    feld.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); hinzu(); }
    });

    return {
      hinzu,
      werte: () => [...eintraege],
      setzen(neue) { eintraege.length = 0; eintraege.push(...neue.map(String)); zeichne(); }
    };
  }

  const zusatz = freieListe('#kp-liste', '#kp-neu', '#kp-add');
  const gebaeude = freieListe('#geb-liste', '#geb-neu', '#geb-add');

  /* Archiv-Schalter */
  const schalter = $('#f-archiviert');
  function zeichneSchalter() {
    const an = schalter.checked;
    $('#archiv-track').style.background = an ? 'var(--red)' : 'var(--border)';
    $('#archiv-knopf').style.transform = an ? 'translateX(20px)' : 'translateX(0)';
    $('#archiv-text').textContent = an ? 'Archiviert' : 'Aktives Projekt';
  }
  schalter.addEventListener('change', zeichneSchalter);

  /* Bestehendes Projekt laden */
  if (bearbeiten) {
    $('#kopftitel').textContent = 'Projekt bearbeiten';
    $('#speichern').textContent = 'Änderungen speichern';
    $('#zurueck').href = `journal.html?projekt=${encodeURIComponent(id)}`;
    $('#archiv-karte').hidden = false;

    const p = await ladeProjekt(id);
    if (!p) { toast('Projekt nicht gefunden', true); return; }
    $('#f-name').value = p.name || '';
    $('#f-standort').value = p.standort || '';
    $('#f-bauherrschaft').value = p.bauherrschaft || '';
    $('#f-parzelle').value = p.parzelle || '';
    $('#f-nr').value = p.projekt_nr || '';
    $('#f-notizen').value = p.notizen || '';
    schalter.checked = !!p.archiviert;
    zusatz.setzen(Array.isArray(p.zusatz_kontrollpunkte) ? p.zusatz_kontrollpunkte : []);
    gebaeude.setzen(Array.isArray(p.gebaeude) ? p.gebaeude : []);
    zeichneSchalter();
  }

  /* Speichern */
  $('#speichern').addEventListener('click', async () => {
    const fehler = $('#fehler');
    fehler.hidden = true;

    // Was noch unbestaetigt im Eingabefeld steht, zaehlt mit, sonst geht
    // es beim Speichern verloren.
    zusatz.hinzu();
    gebaeude.hinzu();

    const felder = {
      name: $('#f-name').value.trim(),
      standort: $('#f-standort').value.trim() || null,
      bauherrschaft: $('#f-bauherrschaft').value.trim() || null,
      parzelle: $('#f-parzelle').value.trim() || null,
      projekt_nr: $('#f-nr').value.trim() || null,
      notizen: $('#f-notizen').value.trim() || null,
      zusatz_kontrollpunkte: zusatz.werte(),
      gebaeude: gebaeude.werte(),
      archiviert: schalter.checked
    };

    if (!felder.name) {
      fehler.textContent = 'Ohne Projektnamen geht es nicht.';
      fehler.hidden = false;
      $('#f-name').focus();
      return;
    }

    const btn = $('#speichern');
    btn.disabled = true;
    btn.innerHTML = '<span class="spin"></span>';
    try {
      const p = await speichereProjekt(felder, bearbeiten ? id : null);
      toast(bearbeiten ? 'Projekt gespeichert' : 'Projekt erstellt');
      location.replace(`journal.html?projekt=${encodeURIComponent(p.id)}`);
    } catch (e) {
      fehler.textContent = e.message || 'Speichern hat nicht geklappt.';
      fehler.hidden = false;
      btn.disabled = false;
      btn.textContent = bearbeiten ? 'Änderungen speichern' : 'Projekt erstellen';
    }
  });
})();
