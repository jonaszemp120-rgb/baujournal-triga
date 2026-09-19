/* Bereich Dokumente.
 *
 * Flache, frei benannte Ordner, darin PDF-Dateien. Die Dateien liegen im
 * Supabase-Bucket "dokumente", die Metadaten in der Tabelle dateien.
 *
 * Zum Papierkorb: Supabase Storage kennt kein Soft-Delete. Gelöscht wird
 * deshalb nur die Metadatenzeile, die Datei im Bucket bleibt unangetastet
 * liegen. Wiederherstellen heisst, die Felder zu leeren, und die Datei ist
 * sofort wieder da. Aus der App heraus wird nie ein Objekt aus dem Bucket
 * entfernt, die Storage-Policies erlauben nur Lesen und Hochladen.
 */

/* Alles gekapselt: diese Dateien teilen sich einen globalen Raum, und
   ein Name, den store.js schon belegt, wäre ein harter SyntaxError. */
(() => {
  const BUCKET = 'dokumente';

  let ordner = [];
  let projekte = [];
  let dateien = [];
  let offenerOrdner = null;      // der geöffnete Ordner
  let letzteHochgeladen = [];

  /* Die letzten fünf Dateien, die diese Person geöffnet hat — über alle
     Ordner und Projekte hinweg. Das ist der Unterschied zu "Zuletzt
     hochgeladen" darunter: dort steht, was neu ist, hier, woran man
     gerade arbeitet. */
  let zuletztAngesehen = [];

  const breit = () => matchMedia('(min-width:1024px)').matches;

  const IK = {
    ordner: '<path d="M4 4h5l2 3h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z"/>',
    pdf: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
    stift: '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/>',
    eimer: '<path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
    runter: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>',
    rauf: '<path d="M12 21V9"/><path d="m7 14 5-5 5 5"/><path d="M5 3h14"/>',
    pfeil: '<path d="m9 18 6-6-6-6"/>'
  };
  const svg = (d, g = 16) => `<svg viewBox="0 0 24 24" width="${g}" height="${g}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;

  function groesseText(b) {
    if (!b && b !== 0) return '';
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`;
    return `${(b / 1024 / 1024).toFixed(1)} MB`.replace('.', ',');
  }

  /* --- Daten -------------------------------------------------------------- */

  async function ladeOrdner() {
    const { data, error } = await sb.from('ordner')
      .select('*').is('geloescht_am', null).order('name', { ascending: true });
    if (meckern('Ordner laden', error)) return [];
    return data || [];
  }

  /* Ohne Ordner ist die Frage "was kam zuletzt dazu" und nicht "was gibt
     es alles". Die Grenze gehört deshalb in die Abfrage: sonst kämen
     alle Zeilen über die Leitung, samt dem Volltext jedes einzelnen PDF,
     nur um davon fünf zu zeigen.

     Und darum auch nicht select('*'): im geöffneten Ordner braucht die
     Liste den Dateinamen, nicht den ganzen Text darin. Gelesen wird der
     nur von der Suche. */
  const SPALTEN = 'id, name, pfad, ordner_id, groesse, hochgeladen_am, hochgeladen_von, volltext_am, geloescht_am';

  /* Fünf, und keine sechs: die Liste steht über allem anderen und soll
     den Blick auf die Ordner nicht verstellen. Die Begrenzung sitzt in
     der Abfrage und nicht erst beim Zeichnen — wer zweihundert Dateien
     geöffnet hat, soll sie nicht alle über die Leitung holen. */
  const ZULETZT_MAX = 5;

  async function ladeDateien(ordnerId) {
    let frage = sb.from('dateien').select(SPALTEN).is('geloescht_am', null);
    frage = ordnerId ? frage.eq('ordner_id', ordnerId) : frage.limit(ZULETZT_MAX);
    const { data, error } = await frage.order('hochgeladen_am', { ascending: false });
    if (meckern('Dateien laden', error)) return [];
    const wer = await namen();
    return (data || []).map(d => ({ ...d, wer: wer[d.hochgeladen_von] || 'Unbekannt' }));
  }

  async function ladeZuletzt() {
    const { data, error } = await sb.from('datei_zugriffe')
      .select('zuletzt_am, dateien(id, name, ordner_id, hochgeladen_am, groesse, hochgeladen_von, volltext_am, geloescht_am)')
      .order('zuletzt_am', { ascending: false })
      .limit(ZULETZT_MAX * 3);
    if (meckern('Zuletzt angesehen laden', error)) return [];

    const wer = await namen();
    /* Eine Datei im Papierkorb steht nicht mehr in der Liste. Ihre Zeile
       bleibt aber liegen: wird sie wiederhergestellt, ist sie wieder da,
       und das ist richtiger, als die Spur zu löschen. Deshalb wird hier
       gefiltert und erst danach auf fünf gekürzt. */
    return (data || [])
      .map(z => z.dateien)
      .filter(d => d && !d.geloescht_am)
      .map(d => ({ ...d, wer: wer[d.hochgeladen_von] || 'Unbekannt' }))
      .slice(0, ZULETZT_MAX);
  }

  /* --- Der Text im PDF ------------------------------------------------------ */

  /* Eine Suche, die nur Dateinamen kennt, findet "Offerte_2026_final.pdf"
     und nicht die Firma, um die es darin geht. Also wird der Text einmal
     herausgezogen und steht danach in dateien.volltext.

     Im Browser mit pdf.js, das ohnehin unter vendor/ liegt und von der
     Bauabnahme her schon geladen wird. Serverseitig bräuchte es eine
     Bibliothek in einer package.json und damit den Build-Schritt, den
     dieses Projekt bewusst nicht hat.

     Zwei Gelegenheiten: beim Hochladen, und bei älteren Dateien beim
     ersten Herunterladen. So füllt sich der Bestand von selbst, ohne
     dass jemand einen Knopf "alles indexieren" drücken muss.

     Zwanzig Seiten und 200'000 Zeichen sind die Grenze. Ein Bauplan mit
     achtzig Seiten voller Masszahlen macht die Suche langsamer statt
     besser, und irgendwo muss eine Grenze stehen. */
  const SEITEN_MAX = 20;
  const ZEICHEN_MAX = 200000;

  async function textAusPdf(blob) {
    await ladeSkript('vendor/pdfjs-3.11.174.min.js');
    const lib = window.pdfjsLib;
    if (!lib) throw new Error('Der PDF-Leser liess sich nicht laden.');
    lib.GlobalWorkerOptions.workerSrc = 'vendor/pdfjs-worker-3.11.174.min.js';

    const doc = await lib.getDocument({ data: await blob.arrayBuffer() }).promise;
    const teile = [];
    for (let i = 1; i <= Math.min(doc.numPages, SEITEN_MAX); i++) {
      const seite = await doc.getPage(i);
      const inhalt = await seite.getTextContent();
      teile.push(inhalt.items.map(x => x.str).join(' '));
      if (teile.join(' ').length > ZEICHEN_MAX) break;
    }
    /* Mehrfache Leerzeichen und Zeilenumbrüche weg: pdf.js liefert den
       Text stückweise, und "Fank  hauser" fände die Suche nicht. */
    return teile.join('\n').replace(/\s+/g, ' ').trim().slice(0, ZEICHEN_MAX);
  }

  /* Den Text herausziehen und ablegen. Scheitert das, bleibt die Datei
     unangetastet — ein PDF, das pdf.js nicht mag, darf weder das
     Hochladen noch das Herunterladen aufhalten. */
  async function volltextMerken(datei, blob) {
    try {
      const text = await textAusPdf(blob);
      const { error } = await sb.from('dateien')
        .update({ volltext: text, volltext_am: new Date().toISOString() })
        .eq('id', datei.id);
      if (error) throw error;
      datei.volltext = text;
      datei.volltext_am = new Date().toISOString();
    } catch (e) {
      console.warn('[TRIGA] Der Text aus', datei.name, 'liess sich nicht lesen:', e?.message || e);
    }
  }

  /* --- Ordner ------------------------------------------------------------- */

  /* Ein Ordner darf zu einem Projekt gehören, muss aber nicht. Ohne
     Zuordnung bleibt er allgemein, wie bisher. Die Dateien darin erben
     die Zuordnung über den Ordner und tragen bewusst kein eigenes Feld:
     eine Datei kann nur an einem Ort liegen. */
  const projektName = id => (projekte.find(p => p.id === id) || {}).name || '';

  async function ordnerAnlegen() {
    const werte = await ordnerFrage({ titel: 'Ordner anlegen', knopf: 'Anlegen' });
    if (!werte) return;
    const s = await session();
    const { error } = await sb.from('ordner')
      .insert({ name: werte.name, projekt_id: werte.projekt_id, erstellt_von: s.user.id });
    if (error) return toast(error.message, true);
    await allesLaden();
    toast('Ordner angelegt');
  }

  async function ordnerUmbenennen(o) {
    const werte = await ordnerFrage({
      titel: 'Ordner bearbeiten', knopf: 'Speichern', wert: o.name, projekt: o.projekt_id || null
    });
    if (!werte) return;
    if (werte.name === o.name && (werte.projekt_id || null) === (o.projekt_id || null)) return;
    const { error } = await sb.from('ordner')
      .update({ name: werte.name, projekt_id: werte.projekt_id }).eq('id', o.id);
    if (error) return toast(error.message, true);
    await allesLaden();
    toast('Gespeichert');
  }

  /* Name und Projekt in einem Dialog. textFrage bleibt daneben bestehen,
     die Dateien brauchen weiterhin nur ein Feld. */
  function ordnerFrage({ titel, knopf, wert = '', projekt = null }) {
    return new Promise(ok => {
      const s = sheet(`
        <div style="font-size:16px; font-weight:800; color:var(--navy); margin-bottom:16px;">${esc(titel)}</div>
        <div style="display:flex; flex-direction:column; gap:6px; margin-bottom:14px;">
          <label for="of-name" style="font-size:11px; font-weight:700; letter-spacing:.04em; text-transform:uppercase; color:var(--text-dim);">Name</label>
          <input id="of-name" type="text" value="${esc(wert)}" style="height:46px; border-radius:10px; border:1.5px solid var(--border); padding:0 13px; font-size:14.5px; color:var(--text); box-sizing:border-box;">
        </div>
        <div style="display:flex; flex-direction:column; gap:6px; margin-bottom:18px;">
          <label for="of-projekt" style="font-size:11px; font-weight:700; letter-spacing:.04em; text-transform:uppercase; color:var(--text-dim);">Projekt (optional)</label>
          <select id="of-projekt" style="height:46px; border-radius:10px; border:1.5px solid var(--border); background:var(--card); color:var(--text); font-size:14px; padding:0 10px; box-sizing:border-box;">
            <option value=""${projekt ? '' : ' selected'}>Ohne Projekt, allgemein</option>
            ${projekte.map(p => `<option value="${esc(p.id)}"${p.id === projekt ? ' selected' : ''}>${esc(p.name)}${p.archiviert ? ' (archiviert)' : ''}</option>`).join('')}
          </select>
        </div>
        <button id="of-ja" class="btn-primary pressable" style="width:100%; height:50px; border:none; border-radius:14px; background:var(--red); color:#fff; font-weight:700; font-size:15px; margin-bottom:10px;">${esc(knopf)}</button>
        <button id="of-nein" class="pressable" style="width:100%; height:50px; border-radius:14px; background:var(--card); border:1.5px solid var(--border); color:var(--navy); font-weight:700; font-size:15px;">Abbrechen</button>
      `);
      s.el.style.maxHeight = '86dvh';
      s.el.style.overflowY = 'auto';
      const feld = $('#of-name', s.el);
      feld.focus(); feld.select();
      const fertig = () => {
        const v = feld.value.trim();
        if (!v) return feld.focus();
        s.schliessen();
        ok({ name: v, projekt_id: $('#of-projekt', s.el).value || null });
      };
      $('#of-ja', s.el).addEventListener('click', fertig);
      feld.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); fertig(); } });
      $('#of-nein', s.el).addEventListener('click', () => { s.schliessen(); ok(null); });
    });
  }

  async function ordnerInPapierkorb(o) {
    const anzahl = (await ladeDateien(o.id)).length;
    const ja = await frage({
      titel: 'Ordner in den Papierkorb?',
      text: anzahl
        ? `„${o.name}" verschwindet aus der Liste, samt den ${anzahl} ${anzahl === 1 ? 'Datei' : 'Dateien'} darin. Nichts wird gelöscht, der Ordner lässt sich jederzeit zurückholen.`
        : `„${o.name}" verschwindet aus der Liste und lässt sich jederzeit zurückholen.`,
      knopf: 'In den Papierkorb'
    });
    if (!ja) return;
    const { error } = await sb.from('ordner')
      .update({ geloescht_am: new Date().toISOString() }).eq('id', o.id);
    if (error) return toast(error.message, true);
    if (offenerOrdner?.id === o.id) offenerOrdner = null;
    await allesLaden();
    toast('In den Papierkorb verschoben');
  }

  /* --- Dateien ------------------------------------------------------------ */

  /* Der Ablagepfad im Storage ist eine Zufalls-UUID, der sichtbare Name
     steht allein in der Spalte name. Umbenennen heisst darum: eine Spalte
     aendern, die Datei selbst bleibt liegen. Auch der Download nimmt den
     neuen Namen, er kommt aus derselben Spalte. */
  async function dateiUmbenennen(d) {
    if (!d) return;
    const endung = /\.pdf$/i.test(d.name) ? d.name.slice(0, -4) : d.name;
    const roh = await textFrage({ titel: 'Datei umbenennen', label: 'Name', wert: endung, knopf: 'Speichern' });
    if (!roh) return;
    const name = /\.pdf$/i.test(roh) ? roh : `${roh}.pdf`;
    if (name === d.name) return;
    const { error } = await sb.from('dateien').update({ name }).eq('id', d.id);
    if (error) return toast(error.message, true);
    await allesLaden();
    toast('Umbenannt');
  }

  async function hochladen(file) {
    if (!offenerOrdner) return;
    if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) {
      return toast('Es lassen sich nur PDF-Dateien ablegen', true);
    }

    const s = await session();
    // Der Ablagename ist zufällig, der echte Name steht in den Metadaten.
    // So können Umlaute, Leerzeichen und Schrägstriche im Dateinamen den
    // Pfad nicht durcheinanderbringen.
    const pfad = `${offenerOrdner.id}/${crypto.randomUUID()}.pdf`;

    toast('Wird hochgeladen …');
    const { error: hochError } = await sb.storage.from(BUCKET)
      .upload(pfad, file, { contentType: 'application/pdf' });
    if (hochError) return toast(hochError.message, true);

    const { data: neueZeile, error } = await sb.from('dateien').insert({
      ordner_id: offenerOrdner.id, name: file.name, pfad,
      groesse: file.size, typ: 'application/pdf', hochgeladen_von: s.user.id
    }).select().single();
    if (error) return toast(error.message, true);

    await allesLaden();
    toast('Hochgeladen');

    /* Der Text erst danach: die Datei ist oben, die Liste steht, und ob
       pdf.js noch eine Sekunde braucht, geht niemanden etwas an. Dass
       er durchsuchbar wird, merkt man erst beim nächsten Suchen. */
    if (neueZeile) volltextMerken(neueZeile, file);
  }

  /* Der Bucket ist nicht öffentlich. Heruntergeladen wird über eine
     Adresse, die eine Minute gilt. Das download-Argument setzt serverseitig
     Content-Disposition, damit die Datei unter ihrem echten Namen im
     Download landet statt unter der zufälligen Ablagebezeichnung. */
  async function herunterladen(d) {
    const { data, error } = await sb.storage.from(BUCKET)
      .createSignedUrl(d.pfad, 60, { download: d.name });
    if (error) return toast(error.message, true);
    const a = document.createElement('a');
    a.href = data.signedUrl;
    a.rel = 'noopener';
    a.download = d.name;
    document.body.appendChild(a);
    a.click();
    a.remove();

    /* Zwei Dinge nebenbei, beide ohne die Person warten zu lassen.
       Erstens die Spur für "Zuletzt angesehen". Zweitens der Text, falls
       die Datei von vor dieser Erweiterung stammt — so füllt sich der
       Bestand von selbst, ohne dass jemand einen Knopf drücken muss. */
    spurMerken(d.id);
    if (!d.volltext_am) nachtragen(d);
  }

  /* Eine Zeile je Person und Datei, beim zweiten Öffnen aktualisiert
     statt verdoppelt. Scheitert es, bleibt es still: eine Liste der
     zuletzt angesehenen Dateien ist Bequemlichkeit, kein Nachweis. */
  async function spurMerken(dateiId) {
    try {
      const s = await session();
      if (!s) return;
      await sb.from('datei_zugriffe')
        .upsert({ user_id: s.user.id, datei_id: dateiId, zuletzt_am: new Date().toISOString() },
                { onConflict: 'user_id,datei_id' });
      zuletztAngesehen = await ladeZuletzt();
      zeichneZuletzt();
      /* Am Schreibtisch steht dieselbe Liste in der rechten Fläche. Sie
         wird nur dann neu gezeichnet, wenn dort nichts anderes steht —
         im geöffneten Ordner gehört die Fläche seinen Dateien. */
      if (!offenerOrdner) zeichneDetail();
    } catch (e) {
      console.warn('[TRIGA] Die Spur liess sich nicht merken:', e?.message || e);
    }
  }

  /* Den Text einer älteren Datei nachholen. Sie liegt ohnehin gleich im
     Browser, weil sie gerade heruntergeladen wird — ein zweiter Abruf
     wäre derselbe Inhalt ein zweites Mal durch die Leitung. */
  async function nachtragen(d) {
    try {
      const { data, error } = await sb.storage.from(BUCKET).download(d.pfad);
      if (error || !data) return;
      await volltextMerken(d, data);
    } catch (e) {
      console.warn('[TRIGA] Der Text liess sich nicht nachtragen:', e?.message || e);
    }
  }

  async function dateiInPapierkorb(d) {
    const ja = await frage({
      titel: 'Datei in den Papierkorb?',
      text: `„${d.name}" verschwindet aus der Liste. Die Datei selbst bleibt liegen und lässt sich jederzeit zurückholen.`,
      knopf: 'In den Papierkorb'
    });
    if (!ja) return;
    const { error } = await sb.from('dateien')
      .update({ geloescht_am: new Date().toISOString() }).eq('id', d.id);
    if (error) return toast(error.message, true);
    await allesLaden();
    toast('In den Papierkorb verschoben');
  }

  /* --- Eingabe-Dialog ----------------------------------------------------- */

  function textFrage({ titel, label, wert = '', knopf }) {
    return new Promise(ok => {
      const s = sheet(`
        <div style="font-size:16px; font-weight:800; color:var(--navy); margin-bottom:16px;">${esc(titel)}</div>
        <div style="display:flex; flex-direction:column; gap:6px; margin-bottom:18px;">
          <label for="t-wert" style="font-size:11px; font-weight:700; letter-spacing:.04em; text-transform:uppercase; color:var(--text-dim);">${esc(label)}</label>
          <input id="t-wert" type="text" value="${esc(wert)}" style="height:46px; border-radius:10px; border:1.5px solid var(--border); padding:0 13px; font-size:14.5px; color:var(--text); box-sizing:border-box;">
        </div>
        <button id="t-ja" class="btn-primary pressable" style="width:100%; height:50px; border:none; border-radius:14px; background:var(--red); color:#fff; font-weight:700; font-size:15px; margin-bottom:10px;">${esc(knopf)}</button>
        <button id="t-nein" class="pressable" style="width:100%; height:50px; border-radius:14px; background:var(--card); border:1.5px solid var(--border); color:var(--navy); font-weight:700; font-size:15px;">Abbrechen</button>
      `);
      const feld = $('#t-wert', s.el);
      feld.focus(); feld.select();
      const fertig = () => {
        const v = feld.value.trim();
        if (!v) return feld.focus();
        s.schliessen(); ok(v);
      };
      $('#t-ja', s.el).addEventListener('click', fertig);
      feld.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); fertig(); } });
      $('#t-nein', s.el).addEventListener('click', () => { s.schliessen(); ok(null); });
    });
  }

  /* --- Zeichnen ----------------------------------------------------------- */

  function zeichneOrdner() {
    if (!ordner.length) {
      $('#ordner').innerHTML = `<div style="padding:18px 12px; font-size:13.5px; color:var(--text-dim); line-height:1.5;">Noch kein Ordner.<br>Oben einen anlegen.</div>`;
      return;
    }
    $('#ordner').innerHTML = ordner.map(o => `
      <div class="dk-ordnerzeile pressable" data-id="${esc(o.id)}" role="button" tabindex="0"
           aria-current="${offenerOrdner?.id === o.id}">
        <span class="symbol">${svg(IK.ordner)}</span>
        <span class="name">${esc(o.name)}${o.projekt_id && projektName(o.projekt_id)
          ? `<span class="dk-projekt">${esc(projektName(o.projekt_id))}</span>` : ''}</span>
        <button type="button" class="dk-mini" data-um="${esc(o.id)}" aria-label="${esc(o.name)} umbenennen">${svg(IK.stift, 12)}</button>
        <button type="button" class="dk-mini rot" data-weg="${esc(o.id)}" aria-label="${esc(o.name)} in den Papierkorb">${svg(IK.eimer, 12)}</button>
        <span class="nur-mobil" style="color:var(--mute); display:flex;">${svg(IK.pfeil, 15)}</span>
      </div>`).join('');

    $$('#ordner .dk-ordnerzeile').forEach(el => {
      const oeffne = () => oeffneOrdner(ordner.find(o => o.id === el.dataset.id));
      el.addEventListener('click', e => {
        if (e.target.closest('[data-um]')) return ordnerUmbenennen(ordner.find(o => o.id === el.dataset.id));
        if (e.target.closest('[data-weg]')) return ordnerInPapierkorb(ordner.find(o => o.id === el.dataset.id));
        oeffne();
      });
      el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); oeffne(); } });
    });
  }

  function dateiZeile(d, mitOrdner = false) {
    const o = ordner.find(x => x.id === d.ordner_id);
    return `
      <div class="dk-datei">
        <span class="pdf">${svg(IK.pdf, 17)}</span>
        <span class="dname">${esc(d.name)}</span>
        <span class="meta wann">${esc(d.hochgeladen_am ? new Date(d.hochgeladen_am).toLocaleDateString('de-CH') : '—')}</span>
        <span class="meta wer">${esc(mitOrdner ? (o?.name || '—') : d.wer)}</span>
        <span class="meta gross">${esc(groesseText(d.groesse))}</span>
        <span class="knoepfe">
          <button type="button" data-runter="${esc(d.id)}" aria-label="${esc(d.name)} herunterladen">${svg(IK.runter, 14)}</button>
          <button type="button" data-dum="${esc(d.id)}" aria-label="${esc(d.name)} umbenennen">${svg(IK.stift, 14)}</button>
          <button type="button" class="rot" data-dweg="${esc(d.id)}" aria-label="${esc(d.name)} in den Papierkorb">${svg(IK.eimer, 14)}</button>
        </span>
      </div>`;
  }

  function knoepfeBinden(wurzel, liste) {
    $$('[data-runter]', wurzel).forEach(b =>
      b.addEventListener('click', () => herunterladen(liste.find(d => d.id === b.dataset.runter))));
    $$('[data-dum]', wurzel).forEach(b =>
      b.addEventListener('click', () => dateiUmbenennen(liste.find(d => d.id === b.dataset.dum))));
    $$('[data-dweg]', wurzel).forEach(b =>
      b.addEventListener('click', () => dateiInPapierkorb(liste.find(d => d.id === b.dataset.dweg))));
  }

  function zeichneDetail() {
    $('#dk').dataset.offen = offenerOrdner ? '1' : '0';
    $('#pfad').textContent = offenerOrdner ? `Dokumente / ${offenerOrdner.name}` : 'Dokumente /';
    $('#m-titel').textContent = offenerOrdner ? offenerOrdner.name : 'Dokumente';
    $('#m-zurueck').href = offenerOrdner ? '#' : 'start.html';

    /* Am Schreibtisch steht die Liste hier und nicht in der linken Spalte:
       dort ist nur Platz für die Ordnernamen, und breit genug für Datum,
       Ordner und Grösse ist allein die rechte Fläche. Am Handy ist es
       umgekehrt — dort gibt es diese Fläche nicht, und die Liste steht
       oben über den Ordnern. */
    if (!offenerOrdner) {
      $('#detail').innerHTML = blockZuletzt()
        + `<div class="br-leer" style="margin-top:${zuletztAngesehen.length ? '20px' : '0'};">Links einen Ordner wählen, oder einen neuen anlegen.</div>`;
      knoepfeBinden($('#detail'), zuletztAngesehen);
      return;
    }

    $('#detail').innerHTML = `
      <div class="dk-kopfzeile" style="display:flex; align-items:center; justify-content:space-between; gap:14px; margin-bottom:14px; padding:16px 16px 0;">
        <div style="min-width:0;">
          <div style="font-weight:700; font-size:16px; overflow-wrap:anywhere;">${esc(offenerOrdner.name)}</div>
          ${offenerOrdner.projekt_id && projektName(offenerOrdner.projekt_id)
            ? `<a href="projekt-detail.html?projekt=${esc(offenerOrdner.projekt_id)}" style="display:inline-block; margin-top:3px; font-size:12px; font-weight:600; color:var(--navy);">${esc(projektName(offenerOrdner.projekt_id))} →</a>`
            : ''}
        </div>
        <button type="button" id="d-hoch" class="dk-hoch pressable">
          ${svg(IK.rauf, 15)}<span>Datei hochladen</span>
        </button>
      </div>
      <div class="dk-flaeche" style="padding:0 16px;">
        ${dateien.length
          ? `<div class="dk-tabelle">${dateien.map(d => dateiZeile(d)).join('')}</div>`
          : `<div class="br-leer">Noch keine Datei in diesem Ordner.</div>`}
      </div>`;

    $('#d-hoch').addEventListener('click', () => $('#datei-wahl').click());
    knoepfeBinden($('#detail'), dateien);
  }

  /* Ganz oben, über den Ordnern: es ist der kürzeste Weg zu dem, woran
     man gerade sitzt. Erst wenn dort nichts steht, fängt das Blättern
     durch die Ordner an. Im geöffneten Ordner verschwindet die Liste —
     dort sucht niemand nach etwas anderem. */
  function blockZuletzt() {
    if (offenerOrdner || !zuletztAngesehen.length) return '';
    return `
      <div style="font-size:12px; font-weight:700; letter-spacing:.06em; text-transform:uppercase; color:var(--red); margin:4px 0 10px;">Zuletzt angesehen</div>
      <div class="dk-tabelle">${zuletztAngesehen.map(d => dateiZeile(d, true)).join('')}</div>`;
  }

  function zeichneZuletzt() {
    const el = $('#zuletzt');
    if (!el) return;
    const html = blockZuletzt();
    el.innerHTML = html;
    /* Ohne das bliebe der Innenabstand des leeren Kastens stehen und
       drückte "Zuletzt hochgeladen" grundlos nach unten. */
    el.hidden = !html;
    knoepfeBinden(el, zuletztAngesehen);
  }

  function zeichneLetzte() {
    const el = $('#letzte');
    if (offenerOrdner || !letzteHochgeladen.length) { el.innerHTML = ''; return; }
    el.innerHTML = `
      <div style="font-size:12px; font-weight:700; letter-spacing:.06em; text-transform:uppercase; color:var(--red); margin:18px 0 10px;">Zuletzt hochgeladen</div>
      <div class="dk-tabelle">${letzteHochgeladen.map(d => dateiZeile(d, true)).join('')}</div>`;
    knoepfeBinden(el, letzteHochgeladen);
  }

  function oeffneOrdner(o) {
    offenerOrdner = o || null;
    allesLaden();
  }

  /* --- Start -------------------------------------------------------------- */

  async function allesLaden() {
    if (!istOnline()) {
      $('#hinweis').hidden = false;
      $('#hinweis').textContent = 'Offline. Dokumente brauchen eine Verbindung.';
      $('#ordner').innerHTML = '';
      $('#detail').innerHTML = `<div class="br-leer">Ohne Verbindung lassen sich keine Dokumente laden.</div>`;
      return;
    }
    $('#hinweis').hidden = true;

    [ordner, projekte] = await Promise.all([ladeOrdner(), PJ.projekte()]);
    if (offenerOrdner) offenerOrdner = ordner.find(o => o.id === offenerOrdner.id) || null;

    /* Beides auf einmal statt nacheinander: die Dateien des Ordners und
       die zuletzt angesehenen hängen nicht voneinander ab, und zwei
       Rundreisen hintereinander sind auf dem Bau eine zu viel. */
    if (offenerOrdner) {
      [dateien, zuletztAngesehen] = [await ladeDateien(offenerOrdner.id), []];
      letzteHochgeladen = [];
    } else {
      dateien = [];
      const [alleDateien, gesehen] = await Promise.all([ladeDateien(null), ladeZuletzt()]);
      letzteHochgeladen = alleDateien.slice(0, 5);
      zuletztAngesehen = gesehen;
    }

    zeichneOrdner();
    zeichneDetail();
    zeichneZuletzt();
    zeichneLetzte();
  }

  (async () => {
    if (!await verlangeLogin()) return;

    $('#d-neu').addEventListener('click', ordnerAnlegen);
    $('#m-neu').addEventListener('click', ordnerAnlegen);

    // Auf dem Handy führt der Zurück-Pfeil aus einem Ordner erst eine Ebene
    // hoch, statt gleich aus dem Bereich heraus.
    $('#m-zurueck').addEventListener('click', e => {
      if (offenerOrdner && !breit()) { e.preventDefault(); oeffneOrdner(null); }
    });

    $('#datei-wahl').addEventListener('change', async e => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (file) await hochladen(file);
    });

    /* Sprung von der Projektseite direkt in einen Ordner. */
    const gewuenscht = new URLSearchParams(location.search).get('ordner');
    if (gewuenscht) offenerOrdner = { id: gewuenscht };

    beiStatuswechsel(allesLaden);
  })();
})();
