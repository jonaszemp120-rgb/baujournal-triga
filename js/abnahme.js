/* Bauabnahme: Mängel auf dem Grundriss, digitale Unterschrift.
 *
 * Der Weg: Pläne aus den Projekt-Dokumenten wählen — einen je Haus und
 * Geschoss —, Mängel durch Tippen auf dem jeweiligen Plan verorten, am
 * Schluss unterschreiben. Mit der
 * Unterschrift entsteht ein PDF-Protokoll, das im Bereich Dokumente des
 * Projekts landet — und ab dann ist die Abnahme zu. Kein Mangel kommt
 * dazu, keiner verschwindet, keiner ändert sich. Das hält nicht diese
 * Datei fest, sondern der Trigger abnahme_gesperrt() in der Datenbank.
 *
 * Warum der Plan als Bild und nicht als PDF: auf ein PDF lässt sich keine
 * Stecknadel zuverlässig setzen — die Anzeige skaliert, scrollt und
 * rendert je nach Gerät anders, und eine Position in Pixeln wäre morgen
 * eine andere Stelle. Die gewählte Seite wird deshalb einmal zu einem PNG
 * gerendert und liegt danach fest im Bucket. Jede Nadel steht als Anteil
 * der Bildbreite und -höhe zwischen 0 und 1 und sitzt damit auf jedem
 * Bildschirm am selben Fleck.
 *
 * Daraus folgt auch die Antwort auf die Frage, was bei einer neuen
 * Planversion passiert: nichts. Die Nadel bezieht sich auf das gerenderte
 * Bild und nicht auf die Quelldatei in den Dokumenten. Wird dort ein neues
 * PDF hochgeladen, bleibt dieses Bild, wie es ist — eine Nadel verschiebt
 * sich nie unbemerkt. Wer einen anderen Stand braucht, legt ihn als
 * weiteren Plan an; der alte bleibt samt seiner Mängel daneben stehen.
 *
 * Gerendert wird im Browser, mit pdf.js aus vendor/. Der Spec sah dafür
 * einen Server vor; diese App hat aber keinen Build-Schritt und keine
 * npm-Abhängigkeiten, und ein PDF im Serverless-Umfeld zu rastern
 * verlangt beides. Das Ergebnis ist dasselbe: ein Bild, einmal erzeugt,
 * für alle gleich.
 */

(() => {
  const IKON = {
    plus: '<path d="M12 5v14M5 12h14"/>',
    haken: '<path d="M20 6 9 17l-5-5"/>',
    stift: '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/>',
    weg: '<path d="M18 6 6 18M6 6l12 12"/>',
    bild: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>',
    datei: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
    nadel: '<path d="M14 0a14 14 0 0 0-14 14c0 9 14 22 14 22s14-13 14-22A14 14 0 0 0 14 0z"/>'
  };
  const svg = (d, g = 16) => `<svg viewBox="0 0 24 24" width="${g}" height="${g}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const nadelSvg = () => `<svg viewBox="0 0 28 36" width="28" height="36" fill="currentColor"><path d="M14 0a14 14 0 0 0-14 14c0 9 14 22 14 22s14-13 14-22A14 14 0 0 0 14 0z"/></svg>`;

  const breit = () => matchMedia('(min-width:1024px)').matches;
  const P = new URLSearchParams(location.search);

  let ich = null;
  let projektId = P.get('projekt') || '';
  let projekt = null;
  let abnahme = null;
  let maengel = [];
  let plaene = [];          // die Grundrisse dieser Abnahme (abnahme_plaene)
  let dokumente = [];       // PDF und Bilder aus den Projekt-Dokumenten
  let firmen = [];          // die Unternehmerliste des Projekts
  let leute = [];
  let aktiv = null;         // welcher Plan gerade am Bildschirm steht
  let planUrl = null;
  let ansicht = 'plan';     // plan | abschluss

  const nameVon = u => leute.find(l => l.user_id === u)?.name || 'Unbekannt';
  const firmaVon = id => firmen.find(f => f.id === id)?.name || '';
  const zu = () => !!abnahme?.abgeschlossen_am;

  const planVon = id => plaene.find(p => p.id === id) || null;
  const aktiverPlan = () => planVon(aktiv) || plaene[0] || null;
  const maengelAuf = id => maengel.filter(m => m.plan_id === id);

  /* --- Laden ---------------------------------------------------------------- */

  /* Welche Dateien kommen als Plan in Frage: alles, was in einem Ordner
     dieses Projekts liegt. Die Dokumentenablage nimmt heute nur PDF an,
     Bilder sind trotzdem vorgesehen — ein abfotografierter Plan ist auf
     der Baustelle nichts Ungewöhnliches. */
  async function ladeDokumente() {
    const { data: ordner } = await sb.from('ordner')
      .select('id, name').eq('projekt_id', projektId).is('geloescht_am', null);
    const ids = (ordner || []).map(o => o.id);
    if (!ids.length) return [];
    const { data } = await sb.from('dateien')
      .select('id, ordner_id, name, pfad, typ').in('ordner_id', ids)
      .is('geloescht_am', null).order('name');
    return (data || []).filter(d =>
      d.typ === 'application/pdf' || String(d.typ || '').startsWith('image/'));
  }

  /* Die Pläne und die Mängel einer Abnahme. Getrennt von ladeAlles(),
     weil beides nach jeder Änderung wieder frisch gebraucht wird. */
  async function ladeInhalt() {
    if (!abnahme) { plaene = []; maengel = []; aktiv = null; return; }
    const [pl, ma] = await Promise.all([
      sb.from('abnahme_plaene').select('*').eq('abnahme_id', abnahme.id)
        .order('reihenfolge').order('erstellt_am'),
      sb.from('maengel').select('*').eq('abnahme_id', abnahme.id).order('nummer')
    ]);
    plaene = pl.data || [];
    maengel = ma.data || [];
    if (!plaene.some(p => p.id === aktiv)) aktiv = plaene[0]?.id || null;
  }

  async function ladeAlles() {
    const gewuenscht = P.get('abnahme');
    const [ma, pj, ab, fi, dk] = await Promise.all([
      sb.from('mitarbeiter').select('user_id, name').not('user_id', 'is', null).is('geloescht_am', null),
      PJ.projekt(projektId),
      sb.from('abnahmen').select('*').eq('projekt_id', projektId).order('erstellt_am', { ascending: false }),
      PJ.einsaetze(projektId),
      ladeDokumente()
    ]);
    leute = ma.data || [];
    projekt = pj;
    firmen = (fi || []).map(e => e.firmen).filter(Boolean);
    dokumente = dk;

    const alle = ab.data || [];
    abnahme = gewuenscht
      ? alle.find(a => a.id === gewuenscht) || null
      : alle.find(a => !a.abgeschlossen_am) || null;
    /* Ohne offene Abnahme, aber mit abgeschlossenen: die jüngste zeigen.
       Wer eine neue braucht, legt sie über den Knopf an — von selbst eine
       zweite Abnahme aufzumachen wäre zu viel des Guten. */
    if (!abnahme && !gewuenscht && alle.length) abnahme = alle[0];

    await ladeInhalt();
    return alle;
  }

  /* --- Der Plan als Bild ------------------------------------------------------ */

  /* Einmal rendern, dann liegt es. Beim nächsten Öffnen wird nur noch die
     abgelegte Fassung geholt — auch auf jedem anderen Gerät. */
  async function planBesorgen(pfad) {
    if (!pfad) return null;
    const { data, error } = await sb.storage.from('abnahme').createSignedUrl(pfad, 3600);
    if (error || !data?.signedUrl) return null;
    return data.signedUrl;
  }

  /* Rendert eine Seite zu einem PNG und legt sie als weiteren Plan ab.
     Die Datei in den Dokumenten bleibt, wo sie ist; massgebend für jede
     Nadel ist von hier an dieses Bild. */
  async function planAnlegen(datei, seite, titel) {
    const blob = await planRendern(datei, seite);
    const pfad = `${abnahme.id}/plan-${Date.now()}.png`;
    const { error: hoch } = await sb.storage.from('abnahme')
      .upload(pfad, blob, { contentType: 'image/png' });
    if (hoch) throw new Error(hoch.message);

    const { data, error } = await sb.from('abnahme_plaene').insert({
      abnahme_id: abnahme.id, titel, datei_id: datei.id, seite,
      bild_pfad: pfad,
      reihenfolge: plaene.reduce((m, p) => Math.max(m, p.reihenfolge), -1) + 1,
      erstellt_von: ich
    }).select().single();
    if (error) {
      await sb.storage.from('abnahme').remove([pfad]);
      throw new Error(error.message);
    }
    plaene = [...plaene, data];
    aktiv = data.id;
    return data;
  }

  async function planRendern(datei, seite) {
    const { data, error } = await sb.storage.from('dokumente').download(datei.pfad);
    if (error || !data) throw new Error('Der Plan liess sich nicht laden.');

    let blob;
    if (String(datei.typ || '').startsWith('image/')) {
      blob = data;
    } else {
      await ladeSkript('vendor/pdfjs-3.11.174.min.js');
      const lib = window.pdfjsLib;
      if (!lib) throw new Error('Der PDF-Leser liess sich nicht laden.');
      lib.GlobalWorkerOptions.workerSrc = 'vendor/pdfjs-worker-3.11.174.min.js';

      const doc = await lib.getDocument({ data: await data.arrayBuffer() }).promise;
      const s = await doc.getPage(Math.min(Math.max(1, seite), doc.numPages));

      /* Gross genug, dass man Raumbeschriftungen lesen kann, und klein
         genug, dass die Datei auf dem Bau noch lädt. 2000 Pixel Breite
         sind der Kompromiss. */
      const roh = s.getViewport({ scale: 1 });
      const massstab = Math.min(3, Math.max(1, 2000 / roh.width));
      const sicht = s.getViewport({ scale: massstab });

      const leinwand = document.createElement('canvas');
      leinwand.width = Math.round(sicht.width);
      leinwand.height = Math.round(sicht.height);
      const flaeche = leinwand.getContext('2d');
      flaeche.fillStyle = '#ffffff';
      flaeche.fillRect(0, 0, leinwand.width, leinwand.height);
      await s.render({ canvasContext: flaeche, viewport: sicht }).promise;

      blob = await new Promise(ok => leinwand.toBlob(ok, 'image/png'));
      if (!blob) throw new Error('Die Seite liess sich nicht in ein Bild umwandeln.');
    }
    return blob;
  }

  /* --- Zeichnen: Einrichten --------------------------------------------------- */

  function zeichneEinrichten() {
    $('#inhalt').classList.add('einspaltig');
    if (!dokumente.length) {
      $('#inhalt').innerHTML = `
        <div class="br-leer">
          Für dieses Projekt liegt noch kein Plan in den Dokumenten.<br>
          Laden Sie zuerst die Grundrisse als PDF hoch, danach lassen sich die Mängel darauf verorten.<br><br>
          <a class="pj-primaer pressable" style="display:inline-flex;" href="dokumente.html">Zum Bereich Dokumente</a>
        </div>`;
      return;
    }

    $('#inhalt').innerHTML = `
      <div class="ba-label">Neue Abnahme</div>
      <div style="background:var(--card); border:1px solid var(--border); border-radius:14px; padding:18px;">
        <div class="ba-label" style="margin-top:0;">Bezeichnung</div>
        <input id="a-titel" type="text" class="fm-eingabe" placeholder="z. B. Rohbauabnahme Etappe 1"
               aria-label="Bezeichnung der Abnahme" maxlength="120"
               style="width:100%; height:48px; border-radius:11px; border:1.5px solid var(--border); padding:0 14px; font-size:15px; box-sizing:border-box;">
        ${planWahlMarkup('Erster Grundriss')}
        <div id="a-fehler" hidden style="font-size:12.5px; color:var(--red); font-weight:600; margin-top:14px;"></div>
        <button type="button" id="a-los" class="pj-primaer pressable" style="width:100%; height:50px; margin-top:18px; justify-content:center;">Abnahme beginnen</button>
      </div>
      <div class="ba-hinweis">Weitere Pläne — ein Haus, ein Geschoss — kommen danach mit einem Tipp dazu.</div>`;

    const wahl = planWahlBinden();

    $('#a-los').addEventListener('click', async () => {
      const fehler = $('#a-fehler');
      fehler.hidden = true;
      const zeigeFehler = t => { fehler.textContent = t; fehler.hidden = false; };
      const titel = $('#a-titel').value.trim();
      const w = wahl.lesen();
      if (!titel) return zeigeFehler('Die Abnahme braucht eine Bezeichnung.');
      if (!w.datei) return zeigeFehler('Bitte den Grundriss auswählen.');
      if (!w.titel) return zeigeFehler('Bitte dem Plan einen Namen geben, etwa «Haus Magnolia, 1. OG».');
      if (!istOnline()) return zeigeFehler('Dafür braucht es eine Verbindung.');

      const knopf = $('#a-los');
      knopf.disabled = true;
      knopf.innerHTML = '<span class="spin"></span>';
      try {
        const { data, error } = await sb.from('abnahmen')
          .insert({ projekt_id: projektId, titel, erstellt_von: ich }).select().single();
        if (error) throw error;
        abnahme = data;
        maengel = [];
        plaene = [];
        await planAnlegen(w.datei, w.seite, w.titel);
        await zeichne();
      } catch (e) {
        knopf.disabled = false;
        knopf.textContent = 'Abnahme beginnen';
        zeigeFehler(e.message || 'Das hat nicht geklappt.');
      }
    });
  }

  /* Die Auswahl eines Grundrisses. Zweimal gebraucht: beim Anlegen der
     Abnahme und später bei jedem weiteren Plan. Deshalb einmal als
     Markup und einmal als Bindung, statt zweimal derselbe Block. */
  function planWahlMarkup(ueberschrift) {
    return `
      <div class="ba-label">${esc(ueberschrift)}</div>
      <input id="a-plantitel" type="text" class="fm-eingabe" placeholder="z. B. Haus Magnolia, 1. OG"
             aria-label="Bezeichnung des Plans" maxlength="120"
             style="width:100%; height:48px; border-radius:11px; border:1.5px solid var(--border); padding:0 14px; font-size:15px; box-sizing:border-box; margin-bottom:12px;">
      <div id="a-dokumente" style="display:flex; flex-direction:column; gap:8px; max-height:34dvh; overflow-y:auto;"></div>
      <div id="a-seite" hidden style="margin-top:14px;">
        <div class="ba-label" style="margin-top:0;">Seite im PDF</div>
        <input id="a-seite-nr" type="number" min="1" value="1" aria-label="Seitenzahl"
               style="width:110px; height:44px; border-radius:10px; border:1.5px solid var(--border); padding:0 12px; font-size:15px; box-sizing:border-box;">
      </div>`;
  }

  function planWahlBinden(wurzel = document) {
    let gewaehlt = null;
    const zeichneDokumente = () => {
      $('#a-dokumente', wurzel).innerHTML = dokumente.map(d => `
        <button type="button" class="pressable" data-dok="${esc(d.id)}"
                style="display:flex; align-items:center; gap:10px; width:100%; padding:11px 12px; border-radius:10px; text-align:left;
                       border:1.5px solid ${d.id === gewaehlt ? 'var(--navy)' : 'var(--border)'};
                       background:${d.id === gewaehlt ? 'var(--bg)' : 'var(--card)'};">
          <span style="color:var(--navy); display:flex;">${svg(IKON.datei, 17)}</span>
          <span style="flex:1; min-width:0; font-weight:600; font-size:13.5px; overflow-wrap:anywhere;">${esc(d.name)}</span>
        </button>`).join('');
      $$('#a-dokumente [data-dok]', wurzel).forEach(el => el.addEventListener('click', () => {
        gewaehlt = el.dataset.dok;
        const d = dokumente.find(x => x.id === gewaehlt);
        $('#a-seite', wurzel).hidden = String(d?.typ) !== 'application/pdf';
        /* Der Dateiname ist meist schon der halbe Plantitel. Wer nichts
           eingetippt hat, bekommt ihn vorgeschlagen und ändert ihn. */
        const feld = $('#a-plantitel', wurzel);
        if (!feld.value.trim()) feld.value = String(d?.name || '').replace(/\.[a-z0-9]+$/i, '').slice(0, 120);
        zeichneDokumente();
      }));
    };
    zeichneDokumente();

    return {
      lesen: () => ({
        datei: dokumente.find(d => d.id === gewaehlt) || null,
        seite: Number($('#a-seite-nr', wurzel).value) || 1,
        titel: $('#a-plantitel', wurzel).value.trim()
      })
    };
  }

  /* Ein weiterer Plan zur laufenden Abnahme. Bestehende Nadeln bleiben
     unberührt: sie hängen an ihrem eigenen Plan und wissen nichts von
     diesem hier. */
  function planHinzufuegen() {
    if (!dokumente.length) {
      return toast('In den Dokumenten dieses Projekts liegt kein Plan', true);
    }
    const s = sheet(`
      <div style="font-size:18px; font-weight:800; color:var(--navy); margin-bottom:6px;">Plan hinzufügen</div>
      <div style="font-size:12.5px; color:var(--text-dim); line-height:1.5; margin-bottom:8px;">
        Die schon gesetzten Nadeln bleiben, wo sie sind — jede gehört zu ihrem eigenen Plan.
      </div>
      ${planWahlMarkup('Grundriss')}
      <div id="p-fehler" hidden style="font-size:12.5px; color:var(--red); font-weight:600; margin-top:14px;"></div>
      <button type="button" id="p-ja" class="btn-primary pressable" style="width:100%; height:50px; border:none; border-radius:13px; background:var(--red); color:#fff; font-weight:700; font-size:15px; margin-top:18px;">Plan hinzufügen</button>
    `);
    s.el.style.maxHeight = '90dvh';
    s.el.style.overflowY = 'auto';

    const wahl = planWahlBinden(s.el);
    const fehler = $('#p-fehler', s.el);
    const zeigeFehler = t => { fehler.textContent = t; fehler.hidden = false; };

    $('#p-ja', s.el).addEventListener('click', async () => {
      fehler.hidden = true;
      const w = wahl.lesen();
      if (!w.datei) return zeigeFehler('Bitte den Grundriss auswählen.');
      if (!w.titel) return zeigeFehler('Bitte dem Plan einen Namen geben, etwa «Haus Magnolia, 1. OG».');
      if (!istOnline()) return zeigeFehler('Dafür braucht es eine Verbindung.');

      const knopf = $('#p-ja', s.el);
      knopf.disabled = true;
      knopf.innerHTML = '<span class="spin"></span>';
      try {
        await planAnlegen(w.datei, w.seite, w.titel);
        s.schliessen();
        await zeichne();
        toast('Plan hinzugefügt');
      } catch (e) {
        knopf.disabled = false;
        knopf.textContent = 'Plan hinzufügen';
        zeigeFehler(e.message || 'Das hat nicht geklappt.');
      }
    });
  }

  /* Ein Plan geht nur weg, solange keine Nadel darauf steckt. Das sagt
     auch die Datenbank; hier wird es nur vorher erklärt. */
  async function planLoeschen(p) {
    if (!p) return;
    const darauf = maengelAuf(p.id).length;
    if (darauf) {
      return toast(`Auf «${p.titel}» stecken ${darauf} ${darauf === 1 ? 'Mangel' : 'Mängel'}`, true);
    }
    const ja = await frage({
      titel: 'Plan entfernen?',
      text: `„${p.titel}" verschwindet aus dieser Abnahme. Die Datei im Bereich Dokumente bleibt unberührt.`,
      knopf: 'Entfernen'
    });
    if (!ja) return;
    if (!istOnline()) return toast('Dafür braucht es eine Verbindung', true);

    const { error } = await sb.from('abnahme_plaene').delete().eq('id', p.id);
    if (error) return toast(error.message, true);
    await sb.storage.from('abnahme').remove([p.bild_pfad]);
    plaene = plaene.filter(x => x.id !== p.id);
    if (aktiv === p.id) aktiv = plaene[0]?.id || null;
    await zeichne();
    toast('Plan entfernt');
  }

  /* --- Zeichnen: Plan und Mängel ---------------------------------------------- */

  /* Nur die Nadeln des gezeigten Plans. Eine Nadel von «Haus Magnolia,
     1. OG» hat auf dem Grundriss des Dachgeschosses nichts verloren. */
  function nadeln(planId) {
    return maengelAuf(planId).map(m => `
      <button type="button" class="ba-nadel${m.erledigt_am ? ' erledigt' : ''}"
              style="left:${(m.x * 100).toFixed(3)}%; top:${(m.y * 100).toFixed(3)}%;"
              data-nadel="${esc(m.id)}" aria-label="Mangel ${m.nummer}: ${esc(m.beschrieb)}">
        ${nadelSvg()}<span class="zahl">${m.nummer}</span>
      </button>`).join('');
  }

  /* Die Planleiste. Bei einem einzigen Plan wäre sie nur im Weg, deshalb
     erscheint sie erst ab dem zweiten — der Knopf zum Hinzufügen steht
     davon unabhängig da. */
  function planLeiste() {
    if (!plaene.length) return '';
    const chips = plaene.map(p => {
      const offen = maengelAuf(p.id).filter(m => !m.erledigt_am).length;
      return `
        <button type="button" class="ba-planchip pressable${p.id === aktiv ? ' an' : ''}"
                data-plan="${esc(p.id)}" aria-pressed="${p.id === aktiv}">
          <span class="name">${esc(p.titel)}</span>
          ${offen ? `<span class="zahl">${offen}</span>` : ''}
        </button>`;
    }).join('');
    return `
      <div class="ba-planleiste">
        ${plaene.length > 1 ? chips : ''}
        ${zu() ? '' : `<button type="button" id="p-neu" class="ba-planchip neu pressable">${svg(IKON.plus, 14)}<span class="name">Plan</span></button>`}
        ${zu() || plaene.length < 2 ? '' : `<button type="button" id="p-weg" class="ba-planchip weg pressable" aria-label="Diesen Plan entfernen">${svg(IKON.weg, 14)}</button>`}
      </div>`;
  }

  function mangelZeile(m) {
    /* Bei mehreren Plänen gehört in die Zeile, wo der Mangel steckt —
       sonst steht in der Liste zehnmal «Türzarge verkratzt» ohne Haus. */
    const teile = [plaene.length > 1 ? planVon(m.plan_id)?.titel : '',
                   firmaVon(m.firma_id), m.frist ? `Frist ${fmtDatum(m.frist)}` : '']
      .filter(Boolean).join(' · ');
    return `
      <div class="ba-mangel" data-mangel="${esc(m.id)}" data-erledigt="${m.erledigt_am ? 1 : 0}">
        <span class="zahl">${m.nummer}</span>
        <span class="was">
          <span class="titel">${esc(m.beschrieb)}</span>
          ${teile ? `<span class="unter">${esc(teile)}</span>` : ''}
        </span>
        ${m.foto_pfad ? `<img class="foto" data-foto="${esc(m.foto_pfad)}" alt="Foto zum Mangel ${m.nummer}">` : ''}
        ${zu() ? '' : `
        <span class="tasten">
          <button type="button" data-haken="${esc(m.id)}" aria-label="${m.erledigt_am ? 'Wieder offen' : 'Als erledigt markieren'}">${svg(IKON.haken, 15)}</button>
          ${m.erledigt_am ? '' : `<button type="button" class="rot" data-mweg="${esc(m.id)}" aria-label="Mangel löschen">${svg(IKON.weg, 15)}</button>`}
        </span>`}
      </div>`;
  }

  async function zeichnePlan() {
    const offen = maengel.filter(m => !m.erledigt_am).length;
    const p = aktiverPlan();
    $('#inhalt').classList.remove('einspaltig');
    $('#inhalt').innerHTML = `
      <div>
        <div class="ba-label">${p ? esc(p.titel) : 'Grundriss'} — Mängel verortet</div>
        ${planLeiste()}
        <div id="plan" class="ba-plan${zu() ? '' : ' setzen'}">
          <div class="laden">${p ? 'Der Plan wird geladen…' : 'Für diese Abnahme liegt kein Plan bereit.'}</div>
        </div>
        ${zu()
          ? `<div class="ba-fertig" style="margin-top:12px;">${svg(IKON.haken, 17)}<span>Abgeschlossen am ${esc(fmtDatum(abnahme.abgeschlossen_am))}, unterschrieben von ${esc(abnahme.gast_name || '')}. Diese Abnahme lässt sich nicht mehr ändern.</span></div>`
          : '<div class="ba-hinweis">Auf den Plan tippen, um einen Mangel an dieser Stelle zu erfassen.</div>'}
      </div>

      <div class="ba-spalte-liste">
        <div class="ba-kopfzeile">
          <h2>Mängel${maengel.length ? ` — ${offen} offen` : ''}</h2>
          ${zu() || !p ? '' : `<button type="button" id="m-neu" class="pj-umriss pressable">${svg(IKON.plus, 15)}<span>Mangel</span></button>`}
        </div>
        ${maengel.length ? maengel.map(mangelZeile).join('')
          : '<div class="pj-leer">Noch kein Mangel erfasst.</div>'}
      </div>`;

    /* Die Planleiste hängt nicht am Bild: sie soll auch dann bedienbar
       sein, wenn der Grundriss gerade nicht lädt. */
    $$('#inhalt [data-plan]').forEach(el => el.addEventListener('click', async () => {
      if (el.dataset.plan === aktiv) return;
      aktiv = el.dataset.plan;
      await zeichnePlan();
    }));
    $('#p-neu')?.addEventListener('click', planHinzufuegen);
    $('#p-weg')?.addEventListener('click', () => planLoeschen(aktiverPlan()));

    const plan = $('#plan');
    planUrl = p ? await planBesorgen(p.bild_pfad) : null;
    if (!planUrl) {
      if (p) plan.innerHTML = '<div class="laden">Der Plan lässt sich gerade nicht laden.</div>';
      bindeMaengel();
      await fotosNachladen();
      return;
    }
    plan.innerHTML = `<img src="${esc(planUrl)}" alt="Grundriss ${esc(p.titel)}">${nadeln(p.id)}`;

    if (!zu()) {
      plan.addEventListener('click', e => {
        if (e.target.closest('.ba-nadel')) return;
        const bild = plan.querySelector('img');
        if (!bild) return;
        const b = bild.getBoundingClientRect();
        const x = (e.clientX - b.left) / b.width;
        const y = (e.clientY - b.top) / b.height;
        if (x < 0 || x > 1 || y < 0 || y > 1) return;
        mangelFormular(null, { x, y, plan_id: p.id });
      });
      $('#m-neu')?.addEventListener('click', () => mangelFormular(null, { x: 0.5, y: 0.5, plan_id: p.id }));
    }

    bindeMaengel();
    await fotosNachladen();
  }

  /* Nadeln und Mängelzeilen zeigen auf dieselben Mängel, deshalb hier
     beides beisammen. Ein Tipp auf eine Zeile führt nebenbei zum
     passenden Plan: sonst klickt man auf einen Mangel von Haus C und
     sieht weiter den Grundriss von Haus A. */
  function bindeMaengel() {
    $$('[data-nadel]').forEach(el => el.addEventListener('click', () => {
      const m = maengel.find(x => x.id === el.dataset.nadel);
      if (m) mangelZeigen(m);
    }));
    $$('[data-mangel]').forEach(el => el.addEventListener('click', async e => {
      if (e.target.closest('.tasten')) return;
      const m = maengel.find(x => x.id === el.dataset.mangel);
      if (!m) return;
      if (m.plan_id !== aktiv) { aktiv = m.plan_id; await zeichnePlan(); }
      mangelZeigen(m);
    }));
    $$('[data-haken]').forEach(el => el.addEventListener('click',
      () => hakenSetzen(maengel.find(x => x.id === el.dataset.haken))));
    $$('[data-mweg]').forEach(el => el.addEventListener('click',
      () => mangelLoeschen(maengel.find(x => x.id === el.dataset.mweg))));
  }

  async function fotosNachladen() {
    await Promise.all($$('[data-foto]').map(async el => {
      const { data } = await sb.storage.from('abnahme').createSignedUrl(el.dataset.foto, 3600);
      if (data?.signedUrl) el.src = data.signedUrl;
    }));
  }

  /* --- Ein Mangel ------------------------------------------------------------- */

  function mangelZeigen(m) {
    const teile = [planVon(m.plan_id)?.titel, firmaVon(m.firma_id),
                   m.frist ? `Frist ${fmtDatum(m.frist)}` : '',
                   m.erledigt_am ? 'erledigt' : 'offen'].filter(Boolean).join(' · ');
    const s = sheet(`
      <div style="display:flex; align-items:center; gap:10px; margin-bottom:10px;">
        <span class="ba-mangel-zahl" style="width:28px; height:28px; border-radius:50%; background:${m.erledigt_am ? 'var(--warn)' : 'var(--red)'}; color:#fff; display:flex; align-items:center; justify-content:center; font-weight:800; font-size:13px;">${m.nummer}</span>
        <div style="font-size:16px; font-weight:800; color:var(--navy);">Mangel ${m.nummer}</div>
      </div>
      <div style="font-size:15px; line-height:1.5; margin-bottom:6px;">${esc(m.beschrieb)}</div>
      <div style="font-size:12.5px; color:var(--text-dim); margin-bottom:14px;">${esc(teile)}</div>
      ${m.foto_pfad ? '<img data-foto="' + esc(m.foto_pfad) + '" alt="Foto zum Mangel" style="width:100%; border-radius:12px; display:block; background:var(--bg);">' : ''}
      ${zu() ? '' : `
      <button type="button" id="mz-bearb" class="pressable" style="display:flex; align-items:center; justify-content:center; gap:8px; width:100%; height:48px; border-radius:12px; background:var(--card); border:1.5px solid var(--navy); color:var(--navy); font-weight:700; font-size:14.5px; margin-top:14px;">
        ${svg(IKON.stift, 16)} Bearbeiten
      </button>`}
    `);
    s.el.style.maxHeight = '88dvh';
    s.el.style.overflowY = 'auto';
    $$('[data-foto]', s.el).forEach(async el => {
      const { data } = await sb.storage.from('abnahme').createSignedUrl(el.dataset.foto, 3600);
      if (data?.signedUrl) el.src = data.signedUrl;
    });
    $('#mz-bearb', s.el)?.addEventListener('click', () => { s.schliessen(); mangelFormular(m); });
  }

  function mangelFormular(vorhanden, stelle) {
    let foto = null;
    let vorschau = null;
    /* Der Plan steht schon fest, bevor das Blatt aufgeht: die Nadel
       sitzt auf dem, der gerade gezeigt wird. Hier steht er nur noch
       im Klartext, damit niemand am falschen Haus markiert. */
    const aufPlan = plaene.length > 1
      ? planVon(vorhanden ? vorhanden.plan_id : stelle?.plan_id)
      : null;

    const s = sheet(`
      <div style="font-size:18px; font-weight:800; color:var(--navy); margin-bottom:${aufPlan ? '4px' : '16px'};">${vorhanden ? `Mangel ${vorhanden.nummer} bearbeiten` : 'Mangel erfassen'}</div>
      ${aufPlan ? `<div style="font-size:12.5px; color:var(--text-dim); margin-bottom:16px;">auf ${esc(aufPlan.titel)}</div>` : ''}

      <div class="ba-label" style="margin-top:0;">Was ist der Mangel?</div>
      <textarea id="mf-text" placeholder="z. B. Türzarge Wohnung 1.02 verkratzt" aria-label="Beschrieb" maxlength="500"
                style="width:100%; min-height:80px; border-radius:11px; border:1.5px solid var(--border); padding:12px 14px; font-size:15px; box-sizing:border-box; line-height:1.5; resize:vertical;">${esc(vorhanden?.beschrieb || '')}</textarea>

      <div class="ba-label">Zuständige Firma</div>
      <select id="mf-firma" aria-label="Zuständige Firma"
              style="width:100%; height:48px; border-radius:11px; border:1.5px solid var(--border); padding:0 12px; font-size:15px; background:var(--card); box-sizing:border-box;">
        <option value="">— keine Firma —</option>
      </select>

      <div class="ba-label">Frist</div>
      <input id="mf-frist" type="date" value="${esc(vorhanden?.frist || '')}" aria-label="Frist"
             style="width:100%; height:48px; border-radius:11px; border:1.5px solid var(--border); padding:0 14px; font-size:15px; box-sizing:border-box;">

      <button type="button" id="mf-foto" class="fm-ablage pressable" style="display:flex; flex-direction:column; align-items:center; justify-content:center; gap:8px; width:100%; min-height:110px; margin-top:16px; border:1.5px dashed var(--border); border-radius:11px; background:transparent; color:var(--text-dim); font-size:13.5px;">
        ${svg(IKON.bild, 22)}<span>${vorhanden?.foto_pfad ? 'Anderes Foto wählen' : 'Foto aufnehmen'}</span>
      </button>
      <input id="mf-datei" type="file" accept="image/*" hidden>

      <div id="mf-fehler" hidden style="font-size:12.5px; color:var(--red); font-weight:600; margin-top:14px;"></div>
      <button type="button" id="mf-ja" class="btn-primary pressable" style="width:100%; height:50px; border:none; border-radius:13px; background:var(--red); color:#fff; font-weight:700; font-size:15px; margin-top:18px;">${vorhanden ? 'Speichern' : 'Mangel erfassen'}</button>
    `);
    s.el.style.maxHeight = '90dvh';
    s.el.style.overflowY = 'auto';

    $('#mf-firma', s.el).innerHTML += firmen.map(f =>
      `<option value="${esc(f.id)}"${f.id === vorhanden?.firma_id ? ' selected' : ''}>${esc(f.name)}</option>`).join('');

    const fehler = $('#mf-fehler', s.el);
    const zeigeFehler = t => { fehler.textContent = t; fehler.hidden = false; };

    const wahl = $('#mf-datei', s.el);
    $('#mf-foto', s.el).addEventListener('click', () => wahl.click());
    wahl.addEventListener('change', e => {
      const datei = e.target.files?.[0];
      e.target.value = '';
      if (!datei) return;
      if (!/^image\//.test(datei.type)) return zeigeFehler('Das ist kein Bild.');
      if (datei.size > 10 * 1024 * 1024) return zeigeFehler('Das Bild ist grösser als 10 MB.');
      foto = datei;
      if (vorschau) URL.revokeObjectURL(vorschau);
      vorschau = URL.createObjectURL(datei);
      $('#mf-foto', s.el).innerHTML = `<img src="${vorschau}" alt="Vorschau" style="max-width:100%; max-height:170px; border-radius:9px; display:block;"><span>Anderes Foto wählen</span>`;
      fehler.hidden = true;
    });

    $('#mf-ja', s.el).addEventListener('click', async () => {
      fehler.hidden = true;
      const text = $('#mf-text', s.el).value.trim();
      if (!text) return zeigeFehler('Bitte kurz beschreiben, was der Mangel ist.');
      if (!istOnline()) return zeigeFehler('Dafür braucht es eine Verbindung.');

      const knopf = $('#mf-ja', s.el);
      knopf.disabled = true;
      knopf.innerHTML = '<span class="spin"></span>';

      try {
        let pfad = vorhanden?.foto_pfad || null;
        if (foto) {
          const endung = (foto.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
          pfad = `${abnahme.id}/${crypto.randomUUID()}.${endung}`;
          const { error } = await sb.storage.from('abnahme')
            .upload(pfad, foto, { contentType: foto.type });
          if (error) throw error;
        }

        const felder = {
          beschrieb: text,
          firma_id: $('#mf-firma', s.el).value || null,
          frist: $('#mf-frist', s.el).value || null,
          foto_pfad: pfad
        };

        if (vorhanden) {
          const { data, error } = await sb.from('maengel')
            .update(felder).eq('id', vorhanden.id).select().single();
          if (error) throw error;
          Object.assign(vorhanden, data);
        } else {
          /* Die Nummer läuft je Abnahme und beginnt bei eins — sie steht
             auf der Nadel und im Protokoll, und beides soll zueinander
             passen. */
          const nummer = maengel.reduce((m, x) => Math.max(m, x.nummer), 0) + 1;
          const { data, error } = await sb.from('maengel').insert({
            abnahme_id: abnahme.id, nummer, plan_id: stelle.plan_id,
            x: Number(stelle.x.toFixed(4)), y: Number(stelle.y.toFixed(4)),
            ...felder, erstellt_von: ich
          }).select().single();
          if (error) throw error;
          maengel = [...maengel, data];
        }

        if (vorschau) URL.revokeObjectURL(vorschau);
        s.schliessen();
        await zeichne();
        toast(vorhanden ? 'Gespeichert' : 'Mangel erfasst');
      } catch (e) {
        knopf.disabled = false;
        knopf.textContent = vorhanden ? 'Speichern' : 'Mangel erfassen';
        zeigeFehler(e.message || 'Das hat nicht geklappt.');
      }
    });
  }

  async function hakenSetzen(m) {
    if (!m) return;
    if (!istOnline()) return toast('Dafür braucht es eine Verbindung', true);
    const jetzt = m.erledigt_am ? null : new Date().toISOString();
    const { data, error } = await sb.from('maengel')
      .update({ erledigt_am: jetzt, erledigt_von: jetzt ? ich : null })
      .eq('id', m.id).select().single();
    if (error) return toast(error.message, true);
    Object.assign(m, data);
    await zeichne();
    toast(jetzt ? 'Erledigt' : 'Wieder offen');
  }

  async function mangelLoeschen(m) {
    if (!m) return;
    const ja = await frage({
      titel: 'Mangel löschen?',
      text: `„${m.beschrieb}" wird entfernt. Für Mängel gibt es keinen Papierkorb; wer einen Punkt nur abhaken will, nimmt den Haken daneben.`,
      knopf: 'Löschen'
    });
    if (!ja) return;
    if (!istOnline()) return toast('Dafür braucht es eine Verbindung', true);

    if (m.foto_pfad) {
      const { error } = await sb.storage.from('abnahme').remove([m.foto_pfad]);
      if (error) return toast(error.message, true);
    }
    const { error } = await sb.from('maengel').delete().eq('id', m.id);
    if (error) return toast(error.message, true);

    maengel = maengel.filter(x => x.id !== m.id);
    await zeichne();
    toast('Gelöscht');
  }

  /* --- Kopfzeile -------------------------------------------------------------- */

  function zeichneKopf() {
    const name = projekt?.name || 'Projekt';
    document.title = `Bauabnahme · ${name} · TRIGA App`;
    $('#d-titel').textContent = `Bauabnahme — ${name}`;
    $('#m-titel').textContent = 'Bauabnahme';
    const zurueck = `projekt-detail.html?projekt=${encodeURIComponent(projektId)}`;
    $('#d-zurueck').href = zurueck;
    $('#m-zurueck').href = ansicht === 'abschluss' ? '#' : zurueck;

    const knopf = (!abnahme || zu() || ansicht === 'abschluss') ? ''
      : `<button type="button" class="pj-primaer pressable" data-abschluss>Abnahme abschliessen</button>`;
    $('#d-werkzeuge').innerHTML = knopf;
    $('#m-werkzeuge').innerHTML = knopf;
    $$('[data-abschluss]').forEach(el => el.addEventListener('click', () => {
      ansicht = 'abschluss';
      zeichne();
    }));

    /* Im Abschluss führt der Pfeil zurück auf den Plan und nicht aus der
       Abnahme heraus. onclick statt addEventListener, damit sich beim
       Neuzeichnen keine zweite Zuweisung ansammelt. */
    $('#m-zurueck').onclick = ansicht === 'abschluss'
      ? e => { e.preventDefault(); ansicht = 'plan'; zeichne(); }
      : null;
    if (ansicht === 'abschluss') {
      $('#m-titel').textContent = 'Abnahme abschliessen';
      $('#d-titel').textContent = 'Abnahme abschliessen';
    }
  }

  /* --- Abschluss -------------------------------------------------------------- */

  async function zeichneAbschluss() {
    $('#inhalt').classList.add('einspaltig');
    const u = await meineUnterschrift();
    const fristen = maengel.map(m => m.frist).filter(Boolean).sort()
      .map(f => fmtDatum(f));
    const anwesend = nameVon(ich);

    $('#inhalt').innerHTML = `
      <div class="ba-zusammen">
        <b>Zusammenfassung</b>
        ${esc(projekt?.name || '')}, ${esc(abnahme.titel)}<br>
        ${maengel.length} ${maengel.length === 1 ? 'Mangel' : 'Mängel'} erfasst${fristen.length ? `, ${fristen.length === 1 ? 'Frist' : 'Fristen'} ${esc([...new Set(fristen)].join(' und '))}` : ''}<br>
        Anwesend: ${esc(anwesend)}<span id="z-gast"></span>
      </div>

      <div class="ba-label">Unterschrift TRIGA (automatisch aus Profil)</div>
      <div id="u-triga">${u.bild
        ? `<div class="ba-unterschrift"><img src="${esc(u.bild)}" alt="Unterschrift ${esc(u.name || '')}"><span class="name">${esc(u.name || '')}</span></div>`
        : `<div class="br-leer" style="text-align:left;">${esc(u.grund)}${u.fehlt ? ' <a href="profil.html" style="color:var(--red); font-weight:700;">Zum Profil</a>' : ''}</div>`}</div>

      <div class="ba-label">Unterschrift Bauherrschaft / Firma</div>
      <input id="u-name" type="text" placeholder="Name und Firma" aria-label="Name der unterschreibenden Person" maxlength="120"
             style="width:100%; height:48px; border-radius:11px; border:1.5px solid var(--border); padding:0 14px; font-size:15px; box-sizing:border-box; margin-bottom:10px;">
      <div id="u-feld" class="ba-feld" data-voll="0">
        <div style="padding:60px 16px; text-align:center; color:var(--text-dim); font-size:13.5px;">Hier tippen, um zu unterschreiben</div>
        <span class="wink">zum Unterschreiben tippen</span>
      </div>

      <div class="ba-hinweis">Mit der Unterschrift wird automatisch ein PDF-Protokoll erstellt und im Bereich Dokumente des Projekts abgelegt.</div>

      <div id="u-fehler" hidden style="font-size:12.5px; color:var(--red); font-weight:600; margin-top:14px;"></div>
      <div class="ba-tasten">
        <button type="button" id="u-nein" class="nein pressable">Zurück</button>
        <button type="button" id="u-ja" class="ja btn-primary pressable">Abnahme abschliessen</button>
      </div>`;

    let gast = null;
    const fehler = $('#u-fehler');
    const zeigeFehler = t => { fehler.textContent = t; fehler.hidden = false; };

    const nameFeld = $('#u-name');
    nameFeld.addEventListener('input', () => {
      $('#z-gast').textContent = nameFeld.value.trim() ? `, ${nameFeld.value.trim()}` : '';
    });

    $('#u-feld').addEventListener('click', async () => {
      const bild = await unterschriftErfassen({
        titel: 'Unterschrift Bauherrschaft / Firma',
        text: 'Mit dem Finger oder einem Stift ins Feld schreiben.'
      });
      if (!bild) return;
      gast = bild;
      $('#u-feld').dataset.voll = '1';
      $('#u-feld').innerHTML = `<img src="${esc(bild)}" alt="Unterschrift" style="max-height:150px; margin:10px auto; display:block;">`;
    });

    $('#u-nein').addEventListener('click', () => { ansicht = 'plan'; zeichne(); });

    $('#u-ja').addEventListener('click', async () => {
      fehler.hidden = true;
      if (!u.bild) return zeigeFehler('Sie haben noch keine Unterschrift im Profil hinterlegt. Einmal unter «Mein Profil» unterschreiben, danach setzt die App sie hier von selbst ein.');
      if (!nameFeld.value.trim()) return zeigeFehler('Bitte den Namen der unterschreibenden Person eintragen.');
      if (!gast) return zeigeFehler('Es fehlt die Unterschrift der Bauherrschaft oder Firma.');
      if (!istOnline()) return zeigeFehler('Dafür braucht es eine Verbindung.');

      const knopf = $('#u-ja');
      knopf.disabled = true;
      knopf.innerHTML = '<span class="spin"></span>';
      try {
        await abschliessen({ triga: u, gast, gastName: nameFeld.value.trim() });
      } catch (e) {
        knopf.disabled = false;
        knopf.textContent = 'Abnahme abschliessen';
        zeigeFehler(e.message || 'Das hat nicht geklappt.');
      }
    });
  }

  /* Bilder fürs PDF werden heruntergeladen und als Data-URL eingesetzt,
     nicht über ihre Adresse eingebunden. Eine Leinwand, auf die ein Bild
     von einem anderen Ursprung gezeichnet wurde, gibt ihren Inhalt nicht
     mehr heraus — und genau das braucht das Protokoll. */
  async function alsDatenUrl(bucket, pfad) {
    if (!pfad) return null;
    const { data, error } = await sb.storage.from(bucket).download(pfad);
    if (error || !data) return null;
    return new Promise(ok => {
      const leser = new FileReader();
      leser.onload = () => ok(leser.result);
      leser.onerror = () => ok(null);
      leser.readAsDataURL(data);
    });
  }

  /* Wohin das Protokoll gehört: in einen Ordner dieses Projekts. Gibt es
     keinen, wird einer angelegt — sonst stünde das Protokoll nirgends,
     und der Satz «liegt unter Dokumente» wäre gelogen. */
  async function ordnerFuerProtokoll() {
    const { data } = await sb.from('ordner')
      .select('id, name').eq('projekt_id', projektId).is('geloescht_am', null).order('name');
    if (data?.length) {
      return data.find(o => /abnahme|protokoll/i.test(o.name)) || data[0];
    }
    const { data: neu, error } = await sb.from('ordner')
      .insert({ name: `${projekt?.name || 'Projekt'} — Abnahmen`, projekt_id: projektId, erstellt_von: ich })
      .select().single();
    if (error) throw new Error(`Der Ordner für das Protokoll liess sich nicht anlegen: ${error.message}`);
    return neu;
  }

  async function protokollAblegen({ triga, gast, gastName, jetzt }) {
    /* Jeder Plan kommt ins Protokoll, mit den Nadeln, die auf ihm
       stecken. Ein Plan, der sich gerade nicht laden lässt, darf den
       Abschluss nicht aufhalten — dann steht er ohne Bild da. */
    const fuerPdf = await Promise.all(plaene.map(async p => ({
      id: p.id, titel: p.titel, bild: await alsDatenUrl('abnahme', p.bild_pfad)
    })));
    const fotos = {};
    await Promise.all(maengel.filter(m => m.foto_pfad).map(async m => {
      fotos[m.id] = await alsDatenUrl('abnahme', m.foto_pfad);
    }));

    const blob = await abnahmeProtokoll({
      projekt, abnahme,
      maengel: maengel.map(m => ({
        ...m, firma_name: firmaVon(m.firma_id), plan_titel: planVon(m.plan_id)?.titel || ''
      })),
      plaene: fuerPdf, fotos,
      anwesend: nameVon(ich),
      gastName,
      unterschriftTriga: triga.bild,
      unterschriftGast: gast,
      wann: jetzt
    });

    const ordner = await ordnerFuerProtokoll();
    const pfad = `${ordner.id}/${crypto.randomUUID()}.pdf`;
    const { error: hoch } = await sb.storage.from('dokumente')
      .upload(pfad, blob, { contentType: 'application/pdf' });
    if (hoch) throw new Error(hoch.message);

    const sauber = String(projekt?.name || 'Projekt').replace(/[^\p{L}\p{N}]+/gu, '_').slice(0, 40);
    const { data, error } = await sb.from('dateien').insert({
      ordner_id: ordner.id,
      name: `Abnahmeprotokoll_${sauber}_${abnahme.titel.replace(/[^\p{L}\p{N}]+/gu, '_')}_${jetzt.toISOString().slice(0, 10)}.pdf`,
      pfad, groesse: blob.size, typ: 'application/pdf', hochgeladen_von: ich
    }).select().single();
    if (error) throw new Error(error.message);
    return data;
  }

  /* Erst das Protokoll, dann der Abschluss. In dieser Reihenfolge, weil
     die Datenbank eine abgeschlossene Abnahme sperrt — die Kennung des
     Protokolls liesse sich danach nicht mehr eintragen. */
  async function abschliessen({ triga, gast, gastName }) {
    const jetzt = new Date();
    const datei = await protokollAblegen({ triga, gast, gastName, jetzt });

    const { data, error } = await sb.from('abnahmen').update({
      abgeschlossen_am: jetzt.toISOString(),
      unterschrift_triga: triga.bild,
      unterschrift_gast: gast,
      gast_name: gastName,
      protokoll_datei_id: datei?.id || null
    }).eq('id', abnahme.id).select().single();
    if (error) throw error;

    abnahme = data;
    ansicht = 'plan';
    await zeichne();
    toast('Abnahme abgeschlossen, Protokoll liegt unter Dokumente');
  }

  /* --- Start -------------------------------------------------------------------- */

  async function zeichne() {
    zeichneKopf();
    if (!abnahme) return zeichneEinrichten();
    if (ansicht === 'abschluss') return zeichneAbschluss();
    /* Eine Abnahme ohne einen einzigen Plan kann es eigentlich nicht
       geben — der erste entsteht beim Anlegen. Bleibt trotzdem einer
       übrig, führt der Weg zurück ans Einrichten. */
    if (!plaene.length) return zeichneEinrichten();
    return zeichnePlan();
  }

  (async () => {
    if (!await verlangeLogin()) return;
    if (!projektId) { location.replace('projekte-bereich.html'); return; }

    const s = await session();
    ich = s.user.id;

    function hinweisZeigen() {
      const el = $('#hinweis');
      el.hidden = istOnline();
      if (!istOnline()) el.textContent = 'Offline. Die Bauabnahme braucht eine Verbindung.';
    }
    beiStatuswechsel(hinweisZeigen);

    async function alles() {
      $('#inhalt').innerHTML = '<div class="br-leer">Wird geladen…</div>';
      await ladeAlles();
      if (!projekt) {
        $('#inhalt').innerHTML = '<div class="br-leer">Dieses Projekt gibt es nicht mehr.</div>';
        return;
      }
      await zeichne();
    }

    if (!istOnline()) {
      $('#inhalt').innerHTML = '<div class="br-leer">Ohne Verbindung lässt sich die Bauabnahme nicht laden. Der Plan und die Fotos liegen im Netz.</div>';
      /* Früher lud die Seite sich hier selbst neu. Laden und zeichnen
         kann sie ohnehin, und nur das ist nötig. */
      beiRueckkehr(alles);
      return;
    }

    await alles();
  })();
})();
