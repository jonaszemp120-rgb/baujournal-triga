/* Die Sitzungsprotokolle eines Projekts.
 *
 * Nur die Liste und das Anlegen. Was in einem Protokoll steht, macht
 * js/protokoll.js — die beiden Bildschirme haben wenig gemeinsam, und
 * eine Datei, die beides kann, wäre zwei Dateien mit einem Schalter
 * dazwischen.
 *
 * Die Nummer vergibt die Datenbank. Zwei Leute, die im selben Moment ein
 * Protokoll anlegen, bekämen sonst beide die 13.
 */

(() => {
  const IKON = {
    plus: '<path d="M12 5v14M5 12h14"/>',
    pfeil: '<path d="m9 18 6-6-6-6"/>'
  };
  const svg = (d, g = 16) => `<svg viewBox="0 0 24 24" width="${g}" height="${g}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;

  const projektId = new URLSearchParams(location.search).get('projekt') || '';

  let ich = null;
  let projekt = null;
  let liste = [];

  /* null heisst: nicht gesucht, die gewohnte Liste steht da. Sonst
     { q, treffer, anzahl } — das Ergebnis der letzten Eingabe. */
  let fund = null;
  let suchLauf = 0;    // zählt die Anfragen, damit eine langsame keine neue überholt

  /* Genug für jede Sitzungsreihe, die es hier gibt, und eine Grenze für
     den Fall, dass jemand nach "e" sucht. */
  const GRENZE = 60;

  const STATUS = {
    vorbereitet:   { titel: 'Vorbereitet',   farbe: 'grau' },
    entwurf:       { titel: 'Entwurf',       farbe: 'gelb' },
    abgeschlossen: { titel: 'Abgeschlossen', farbe: 'gruen' }
  };
  const chip = p => {
    const s = STATUS[p.status] || STATUS.vorbereitet;
    return `<span class="pj-marke klein ${s.farbe}">${esc(s.titel)}</span>`;
  };
  const titelVon = p => `${p.bezeichnung} Nr. ${p.nummer}`;

  /* --- Laden ---------------------------------------------------------------- */

  /* Die Zahlen unter dem Titel — wie viele Traktanden, wie viele davon zu
     einer Pendenz geführt haben — kommen aus einer einzigen Abfrage über
     alle Protokolle des Projekts. Eine Abfrage pro Zeile wäre bei zwölf
     Sitzungen zwölf Abfragen für zwei Zahlen. */
  async function laden() {
    const { data, error } = await sb.from('protokolle')
      .select('*').eq('projekt_id', projektId)
      .order('datum', { ascending: false }).order('nummer', { ascending: false });
    if (meckern('Protokolle laden', error)) return [];
    const alle = data || [];
    if (!alle.length) return [];

    const { data: tr } = await sb.from('protokoll_traktanden')
      .select('protokoll_id, pendenz_id').in('protokoll_id', alle.map(p => p.id));
    for (const p of alle) {
      const meine = (tr || []).filter(t => t.protokoll_id === p.id);
      p._traktanden = meine.length;
      p._pendenzen = meine.filter(t => t.pendenz_id).length;
    }

    /* Was schon war, steht oben, das Neueste zuerst. Die vorbereiteten
       Sitzungen hängen unten dran: sie haben noch nicht stattgefunden und
       gehören deshalb nicht zwischen die Protokolle. */
    const gewesen = alle.filter(p => p.status !== 'vorbereitet');
    const kommend = alle.filter(p => p.status === 'vorbereitet')
      .sort((a, b) => String(a.datum).localeCompare(String(b.datum)));
    return [...gewesen, ...kommend];
  }

  /* --- Suchen --------------------------------------------------------------- */

  /* Gesucht wird in zwei Töpfen: im Text der Traktanden und in den
     Firmennamen auf der Teilnehmerliste. Der Firmenname steht dort als
     eigene Spalte — jener Schnappschuss vom Tag der Sitzung, der auch
     dann noch stimmt, wenn die Firma später umbenannt wurde.
     Beides in der Datenbank und nicht im Browser: zwölf Protokolle mit
     je zwanzig Traktanden herunterzuladen, nur um darin zu suchen, wäre
     auf dem Bau eine Wartezeit für nichts. */
  async function suchen(roh) {
    const q = suchSauber(roh);
    if (q.length < 2) { fund = null; zeichne(); return; }

    const ids = liste.map(p => p.id);
    if (!ids.length) { fund = { q, treffer: [], anzahl: 0 }; zeichne(); return; }

    const lauf = ++suchLauf;
    const [tr, tn] = await Promise.all([
      sb.from('protokoll_traktanden')
        .select('protokoll_id, titel, text')
        .in('protokoll_id', ids).or(suchOder(['titel', 'text'], q)).limit(GRENZE),
      sb.from('protokoll_teilnehmer')
        .select('protokoll_id, name, firma')
        .in('protokoll_id', ids).ilike('firma', `%${q}%`).limit(GRENZE)
    ]);
    /* Wer schnell tippt, löst mehrere Anfragen aus. Kommt eine ältere
       später zurück als eine neuere, überschriebe sie das jüngere
       Ergebnis — deshalb der Zähler. */
    if (lauf !== suchLauf) return;

    meckern('Traktanden durchsuchen', tr.error);
    meckern('Firmen durchsuchen', tn.error);
    fund = { q, ...gruppiere(q, tr.data || [], tn.data || []) };
    zeichne();
  }

  function gruppiere(q, traktanden, teilnehmende) {
    const je = new Map();
    const hole = id => { if (!je.has(id)) je.set(id, []); return je.get(id); };
    const klein = q.toLowerCase();

    for (const t of traktanden) {
      const imTitel = String(t.titel || '').toLowerCase().includes(klein);
      hole(t.protokoll_id).push({
        art: 'Traktandum',
        wo: t.titel,
        /* Steht das Wort schon im Titel, wäre der Ausschnitt darunter
           dasselbe zweimal. */
        aus: imTitel ? '' : textStelle(t.text, q)
      });
    }

    /* Dieselbe Firma steht mit drei Leuten auf der Teilnehmerliste, im
       Ergebnis aber nur einmal: gesucht wurde die Firma, nicht die
       Person. */
    const gesehen = new Set();
    for (const p of teilnehmende) {
      const schluessel = `${p.protokoll_id}|${String(p.firma || '').toLowerCase()}`;
      if (gesehen.has(schluessel)) continue;
      gesehen.add(schluessel);
      hole(p.protokoll_id).push({ art: 'Beteiligt', wo: p.firma, aus: p.name });
    }

    /* Die Reihenfolge kommt aus der Liste und nicht aus den Treffern:
       das Neueste zuerst, wie überall sonst auch. */
    const treffer = liste.filter(p => je.has(p.id)).map(p => ({ p, zeilen: je.get(p.id) }));
    return { treffer, anzahl: treffer.reduce((s, t) => s + t.zeilen.length, 0) };
  }

  /* --- Zeichnen ------------------------------------------------------------- */

  function unterzeile(p) {
    const wann = [fmtDatum(p.datum), p.status === 'vorbereitet' ? 'noch nicht durchgeführt' : p.ort]
      .filter(Boolean).join(' · ');
    const zahlen = [
      `${p._traktanden} ${p._traktanden === 1 ? 'Traktandum' : 'Traktanden'}`,
      p._pendenzen ? `${p._pendenzen} ${p._pendenzen === 1 ? 'neue Pendenz' : 'neue Pendenzen'}` : ''
    ].filter(Boolean).join(' · ');
    return { wann, zahlen };
  }

  /* Ein Treffer nennt Nummer und Datum des Protokolls und darunter die
     Stellen, an denen das Wort steht. Karten und keine Tabellenzeilen:
     die Fundstellen brauchen die ganze Breite, und auf dem Desktop
     stünde in den Spalten für Traktanden und Pendenzen nichts. */
  function zeichneFund() {
    const { q, treffer, anzahl } = fund;
    if (!treffer.length) {
      $('#inhalt').innerHTML = `
        <div class="br-leer">In den Protokollen dieses Projekts steht nichts zu «${esc(q)}».</div>`;
      return;
    }
    $('#inhalt').innerHTML = `
      <div class="pk-label">${anzahl} ${anzahl === 1 ? 'Fundstelle' : 'Fundstellen'} in
        ${treffer.length} ${treffer.length === 1 ? 'Protokoll' : 'Protokollen'}</div>
      ${treffer.map(({ p, zeilen }) => `
        <a class="pk-karte pressable" href="protokoll.html?protokoll=${esc(p.id)}">
          <span class="oben"><span class="titel">${esc(titelVon(p))}</span>${chip(p)}</span>
          <span class="unter">${esc(fmtDatum(p.datum))}${p.ort ? ` · ${esc(p.ort)}` : ''}</span>
          ${zeilen.map(z => `
            <span class="pk-fund">
              <span class="was">${esc(z.art)}</span>
              <span class="wo">${esc(z.wo || '—')}</span>
              ${z.aus ? `<span class="aus">${esc(z.aus)}</span>` : ''}
            </span>`).join('')}
        </a>`).join('')}`;
  }

  function zeichne() {
    zeichneKopf();
    if (fund) { zeichneFund(); return; }
    if (!liste.length) {
      $('#inhalt').innerHTML = `
        <div class="br-leer">
          Für dieses Projekt gibt es noch kein Sitzungsprotokoll.<br>
          Ein neues beginnt mit Datum, Ort und der Traktandenliste; die Nummer zählt die App selbst hoch.
        </div>`;
      return;
    }

    const ziel = p => `protokoll.html?protokoll=${encodeURIComponent(p.id)}`;

    const karte = p => {
      const { wann, zahlen } = unterzeile(p);
      return `
        <a class="pk-karte pressable" href="${ziel(p)}">
          <span class="oben"><span class="titel">${esc(titelVon(p))}</span>${chip(p)}</span>
          <span class="unter">${esc(wann)}</span>
          <span class="unter" style="margin-top:4px;">${esc(zahlen)}</span>
        </a>`;
    };

    const reihe = p => {
      const { wann } = unterzeile(p);
      return `
        <a class="pk-reihe" href="${ziel(p)}">
          <span>
            <span class="titel">${esc(titelVon(p))}</span>
            <span class="unter">${esc(wann)}</span>
          </span>
          <span class="zahl">${p._traktanden} ${p._traktanden === 1 ? 'Traktandum' : 'Traktanden'}</span>
          <span class="zahl">${p._pendenzen
            ? esc(`${p._pendenzen} ${p._pendenzen === 1 ? 'neue Pendenz' : 'neue Pendenzen'}`)
            : '—'}</span>
          <span class="rechts">${chip(p)}</span>
        </a>`;
    };

    $('#inhalt').innerHTML = `
      <div class="nur-mobil" style="padding-top:16px;">${liste.map(karte).join('')}</div>
      <div class="nur-desktop pj-flach">${liste.map(reihe).join('')}</div>`;
  }

  function zeichneKopf() {
    const name = projekt?.name || 'Projekt';
    document.title = `Sitzungsprotokolle · ${name} · TRIGA App`;
    $('#d-titel').textContent = `Protokolle — ${name}`;
    $('#m-titel').textContent = `Protokolle — ${name}`;
    const zurueck = `projekt-detail.html?projekt=${encodeURIComponent(projektId)}`;
    $('#d-zurueck').href = zurueck;
    $('#m-zurueck').href = zurueck;

    $('#d-werkzeuge').innerHTML =
      `<button type="button" id="d-neu" class="pj-primaer pressable">${svg(IKON.plus, 15)}<span>Neues Protokoll</span></button>`;
    $('#d-neu').addEventListener('click', anlegen);
  }

  /* --- Anlegen -------------------------------------------------------------- */

  /* Der Ort kommt aus der letzten Sitzung. Besprochen wird fast immer am
     gleichen Ort, und geändert ist er in zwei Sekunden — dasselbe Muster
     wie "Angaben vom letzten Eintrag übernehmen" im Baujournal. */
  function anlegen() {
    const letzter = liste.find(p => p.ort);
    const naechste = Math.max(0, ...liste.map(p => p.nummer)) + 1;
    const s = sheet(`
      <div style="font-size:18px; font-weight:800; color:var(--navy); margin-bottom:18px;">Neues Protokoll</div>

      <div class="pk-label" style="margin-top:0;">Bezeichnung</div>
      <input id="pn-bez" type="text" value="Baubesprechung" maxlength="80" aria-label="Bezeichnung"
             style="width:100%; height:48px; border-radius:11px; border:1.5px solid var(--border); padding:0 14px; font-size:15px; box-sizing:border-box;">
      <div style="font-size:12px; color:var(--text-dim); margin-top:8px; line-height:1.5;">Die Nummer hängt die App an: aus «Baubesprechung» wird «Baubesprechung Nr. ${naechste}».</div>

      <div class="pk-label">Datum</div>
      <input id="pn-datum" type="date" value="${esc(heute())}" aria-label="Datum der Sitzung"
             style="width:100%; height:48px; border-radius:11px; border:1.5px solid var(--border); padding:0 14px; font-size:15px; box-sizing:border-box;">

      <div class="pk-label">Ort</div>
      <input id="pn-ort" type="text" value="${esc(letzter?.ort || '')}" maxlength="120" placeholder="z. B. Baustelle Sarnen" aria-label="Ort der Sitzung"
             style="width:100%; height:48px; border-radius:11px; border:1.5px solid var(--border); padding:0 14px; font-size:15px; box-sizing:border-box;">

      <div id="pn-fehler" hidden style="font-size:12.5px; color:var(--red); font-weight:600; margin-top:14px;"></div>
      <button type="button" id="pn-ja" class="btn-primary pressable" style="width:100%; height:50px; border:none; border-radius:13px; background:var(--red); color:#fff; font-weight:700; font-size:15px; margin-top:20px;">Protokoll anlegen</button>
    `);
    s.el.style.maxHeight = '88dvh';
    s.el.style.overflowY = 'auto';

    const fehler = $('#pn-fehler', s.el);
    const zeigeFehler = t => { fehler.textContent = t; fehler.hidden = false; };

    $('#pn-ja', s.el).addEventListener('click', async () => {
      fehler.hidden = true;
      const bezeichnung = $('#pn-bez', s.el).value.trim();
      const datum = $('#pn-datum', s.el).value;
      if (!bezeichnung) return zeigeFehler('Ohne Bezeichnung geht es nicht.');
      if (!datum) return zeigeFehler('Bitte das Datum der Sitzung setzen.');
      if (!istOnline()) return zeigeFehler('Dafür braucht es eine Verbindung.');

      const knopf = $('#pn-ja', s.el);
      knopf.disabled = true;
      knopf.innerHTML = '<span class="spin"></span>';
      try {
        const { data, error } = await sb.from('protokolle').insert({
          projekt_id: projektId, bezeichnung, datum,
          ort: $('#pn-ort', s.el).value.trim() || null,
          erstellt_von: ich
        }).select().single();
        if (error) throw error;
        location.href = `protokoll.html?protokoll=${encodeURIComponent(data.id)}`;
      } catch (e) {
        knopf.disabled = false;
        knopf.textContent = 'Protokoll anlegen';
        zeigeFehler(e.message || 'Das hat nicht geklappt.');
      }
    });
  }

  /* --- Start ---------------------------------------------------------------- */

  (async () => {
    if (!await verlangeLogin()) return;
    if (!projektId) { location.replace('projekte-bereich.html'); return; }

    const s = await session();
    ich = s.user.id;

    function hinweisZeigen() {
      const el = $('#hinweis');
      el.hidden = istOnline();
      if (!istOnline()) el.textContent = 'Offline. Sitzungsprotokolle brauchen eine Verbindung.';
    }
    beiStatuswechsel(hinweisZeigen);
    $('#m-neu').addEventListener('click', anlegen);

    /* Ein kurzer Moment Ruhe, bevor gefragt wird: wer "Fankhauser"
       tippt, löste sonst zehn Anfragen aus und bräuchte nur die letzte. */
    let warten = null;
    $('#p-suche').addEventListener('input', e => {
      const wert = e.target.value;
      clearTimeout(warten);
      warten = setTimeout(() => suchen(wert), 220);
    });

    async function alles() {
      $('#inhalt').innerHTML = '<div class="br-leer">Wird geladen…</div>';
      projekt = await PJ.projekt(projektId);
      if (!projekt) {
        $('#inhalt').innerHTML = '<div class="br-leer">Dieses Projekt gibt es nicht mehr.</div>';
        return;
      }
      liste = await laden();

      /* Das Feld erscheint erst, wenn es etwas zu durchsuchen gibt. Beim
         ersten Protokoll eines Projekts wäre es nur ein leeres Kästchen. */
      $('#suchleiste').hidden = !liste.length;
      zeichne();
    }

    if (!istOnline()) {
      $('#inhalt').innerHTML = '<div class="br-leer">Ohne Verbindung lassen sich die Protokolle nicht laden.</div>';
      beiRueckkehr(alles);
      return;
    }

    await alles();
  })();
})();
