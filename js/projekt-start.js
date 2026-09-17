/* Projekt-Startseite: der Einstieg in eine Baustelle.
   Von hier geht es in ein neues Baujournal, in einen bestehenden
   Eintrag oder in den Papierkorb. */

(async () => {
  if (!await verlangeLogin()) return;

  const projektId = new URLSearchParams(location.search).get('projekt');
  if (!projektId) { location.replace('projekte.html'); return; }

  let projekt = null;
  let eintraege = [];
  let gefiltert = [];

  $('#neu').href = `journal.html?projekt=${encodeURIComponent(projektId)}`;
  $('#p-edit').href = `projekt.html?id=${encodeURIComponent(projektId)}`;
  $('#papierkorb').href = `papierkorb.html?projekt=${encodeURIComponent(projektId)}`;

  /* --- Liste ------------------------------------------------------------ */

  function zeichne() {
    gefiltert = filtereEintraege(eintraege, {
      q: $('#v-suche').value, von: $('#v-von').value, bis: $('#v-bis').value
    });

    const gefiltertAktiv = $('#v-suche').value.trim() || $('#v-von').value || $('#v-bis').value;
    $('#liste').innerHTML = gefiltert.length
      ? gefiltert.map((e, i) => eintragsZeile(e, i === gefiltert.length - 1)).join('')
      : hinweisLeer(gefiltertAktiv
          ? 'Kein Eintrag passt zum Filter.'
          : 'Noch kein Eintrag für dieses Projekt.<br>Oben ein neues Baujournal anlegen.');
  }

  async function laden() {
    eintraege = await ladeEintraege(projektId);
    zeichne();
    zaehlePapierkorb();
    hinweisZeigen();
  }

  /* Der Zähler am Fuss der Liste. Ohne Netz bleibt er beim zuletzt
     bekannten Stand, deshalb ohne Zahl statt mit einer falschen. */
  async function zaehlePapierkorb() {
    const geloeschte = await ladeEintraege(projektId, { geloescht: true });
    $('#papierkorb-text').textContent = geloeschte.length
      ? `Papierkorb (${geloeschte.length})`
      : 'Papierkorb';
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

  /* --- Suche und Export ------------------------------------------------- */

  $('#v-filter').addEventListener('click', () => {
    const zeile = $('#v-suchzeile');
    zeile.hidden = !zeile.hidden;
    if (!zeile.hidden) $('#v-suche').focus();
  });
  $$('#v-suche, #v-von, #v-bis').forEach(el => el.addEventListener('input', zeichne));

  /* Noch nicht uebertragene Eintraege bleiben draussen, die gehoeren
     nicht in ein Dokument, das aus dem Haus geht. */
  async function zeitraumExport(art, btn) {
    const auswahl = gefiltert.filter(e => !e._offen);
    if (!auswahl.length) return toast('Kein übertragener Eintrag in der Auswahl', true);
    const alt = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'einen Moment …';
    try {
      if (art === 'pdf') await exportPDF(auswahl, projekt);
      else await exportWord(auswahl, projekt);
      toast(`${auswahl.length} ${auswahl.length === 1 ? 'Eintrag' : 'Einträge'} exportiert`);
    } catch (e) {
      toast(e.message || 'Export hat nicht geklappt', true);
    } finally {
      btn.disabled = false;
      btn.textContent = alt;
    }
  }

  $('#v-pdf').addEventListener('click', e => zeitraumExport('pdf', e.currentTarget));
  $('#v-word').addEventListener('click', e => zeitraumExport('word', e.currentTarget));

  document.addEventListener('queue', hinweisZeigen);
  beiStatuswechsel(() => { hinweisZeigen(); if (istOnline()) laden(); });

  /* --- Start ------------------------------------------------------------ */

  projekt = await ladeProjekt(projektId);
  if (!projekt) { toast('Projekt nicht gefunden', true); setTimeout(() => location.replace('projekte.html'), 1400); return; }

  $('#p-name').textContent = projekt.name;
  $('#p-standort').textContent = [projekt.standort, projekt.bauherrschaft].filter(Boolean).join(' · ');
  document.title = `${projekt.name} · Baujournal`;

  await syncWarteschlange();
  await laden();
})();
