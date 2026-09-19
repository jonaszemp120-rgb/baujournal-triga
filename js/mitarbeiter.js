/* Bereich Mitarbeiter.
 *
 * Ein Adressbuch des Teams, bewusst getrennt von den Login-Konten. Einen
 * Eintrag hier in den Papierkorb zu legen berührt kein Konto, die Tabelle
 * kennt auth.users gar nicht als Person.
 *
 * Handy und Desktop teilen sich denselben Zeichner. Der Unterschied ist
 * nur, wohin das Detail geht: auf dem Desktop in die rechte Spalte, auf
 * dem Handy in ein Sheet von unten.
 */

/* Alles gekapselt: diese Dateien teilen sich einen globalen Raum. */
(() => {
  const MA_CACHE = 'bj_cache_mitarbeiter';

  let alle = [];
  let gewaehlt = null;
  let sheetOffen = null;

  /* Ob diese Person den Bereich verwalten darf: anlegen, Name und Funktion
     ändern, in den Papierkorb legen. Seit dem Schreibschutz auf der Tabelle
     ist das keine Frage der Höflichkeit mehr — die Datenbank weist einen
     solchen Schreibversuch ab. Einen Knopf hinzustellen, der verlässlich
     scheitert, wäre die schlechtere Art, dasselbe zu sagen. */
  let verwalten = false;
  let eigenesKonto = null;

  /* Wer heute in genehmigten Ferien ist, als user_id -> letzter Ferientag.
     Die Angabe kommt aus abwesend_heute() und nicht aus den Anträgen
     selbst: die gehören der antragstellenden Person und der
     Geschäftsleitung, und wer im Adressbuch blättert, soll nur sehen,
     dass jemand weg ist — nicht warum, nicht wie lange beantragt, nicht
     wer entschieden hat. */
  let abwesend = {};

  const breit = () => matchMedia('(min-width:1024px)').matches;

  /* --- Daten -------------------------------------------------------------- */

  /* Bewusst keine Sternchen-Abfrage: die Unterschrift aus Mein Profil hängt
     an derselben Zeile und ist ein Bild. Die gehört weder in eine Liste
     noch in den Spiegel im localStorage. */
  const SPALTEN = 'id, user_id, name, rolle, telefon, email, berechtigung, badge_label, erstellt_am';

  async function ladeMitarbeiter() {
    if (!navigator.onLine) return lies(MA_CACHE, []);
    const { data, error } = await sb.from('mitarbeiter')
      .select(SPALTEN)
      .is('geloescht_am', null).order('name', { ascending: true });
    if (meckern('Mitarbeiter laden', error)) return lies(MA_CACHE, []);
    schreib(MA_CACHE, data || []);
    return data || [];
  }

  /* Ohne Verbindung steht kein Hinweis da statt eines veralteten: "bis
     Freitag weg" aus der letzten Woche wäre schlechter als gar nichts.
     Deshalb wird das hier auch nicht gespiegelt. */
  async function ladeAbwesende() {
    if (!navigator.onLine) return {};
    const { data, error } = await sb.rpc('abwesend_heute');
    if (meckern('Abwesenheiten laden', error)) return {};
    return Object.fromEntries((data || []).map(a => [a.user_id, a.bis]));
  }

  const abwesenheit = m => (m.user_id && abwesend[m.user_id]) || null;

  const abwesenheitMarke = m => {
    const bis = abwesenheit(m);
    return bis ? `<span class="ma-abwesend">${svg(IKON.weg, 12)}Abwesend bis ${esc(fmtKurz(bis))}</span>` : '';
  };

  /* Ohne Jahr: "bis 24.12." liest sich schneller, und wer heute weg ist,
     ist nicht über den Jahreswechsel hinaus weg. */
  const fmtKurz = d => {
    const [, m, t] = String(d).slice(0, 10).split('-');
    return `${t}.${m}.`;
  };

  async function speichereMitarbeiter(felder, id) {
    if (!navigator.onLine) throw new Error('Mitarbeiter lassen sich nur online bearbeiten');
    if (id) {
      const { data, error } = await sb.from('mitarbeiter')
        .update(felder).eq('id', id).select(SPALTEN).single();
      if (error) throw error;
      return data;
    }
    const s = await session();
    const { data, error } = await sb.from('mitarbeiter')
      .insert({ ...felder, erstellt_von: s.user.id }).select(SPALTEN).single();
    if (error) throw error;
    return data;
  }

  /* Kein echtes Löschen: nur geloescht_am setzen. Wer und wann trägt ein
     Trigger in der Datenbank ein, siehe Migration mitarbeiter. */
  async function inPapierkorb(id) {
    if (!navigator.onLine) throw new Error('Löschen geht nur online');
    const { error } = await sb.from('mitarbeiter')
      .update({ geloescht_am: new Date().toISOString() }).eq('id', id);
    if (error) throw error;
  }

  /* --- Bausteine ---------------------------------------------------------- */

  const IKON = {
    telefon: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/>',
    mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 6-10 7L2 6"/>',
    stift: '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/>',
    eimer: '<path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
    kontakt: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6"/><path d="M22 11h-6"/>',
    weg: '<path d="M8 2v4"/><path d="M16 2v4"/><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M3 10h18"/>'
  };
  const svg = (d, g = 18) => `<svg viewBox="0 0 24 24" width="${g}" height="${g}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;

  /* Telefonnummern für den Link von Leerzeichen und Klammern befreien,
     damit das Wählen auch bei "+41 (41) 660 56 00" funktioniert. */
  const telLink = t => 'tel:' + String(t).replace(/[^\d+]/g, '');

  /* Die Berechtigungsstufe. Namen und Regel stehen in js/app.js, weil sie
     künftig überall gebraucht werden und nicht nur hier.
     Die Stufe selbst vergibt Jonas in der Supabase-Tabelle. Änderbar ist
     hier nur, was auf dem Abzeichen steht — badgeTitel() nimmt diesen
     Text, wenn einer da ist, und sonst den Namen der Stufe. */
  const stufeMarke = m =>
    `<span class="pj-marke klein stufe">${esc(badgeTitel(m))}</span>`;

  /* --- Liste -------------------------------------------------------------- */

  function zeichneListe() {
    const q = ($('#suche').value || '').trim().toLowerCase();
    const sichtbar = alle.filter(m => !q ||
      [m.name, m.rolle, m.telefon, m.email].some(f => String(f || '').toLowerCase().includes(q)));

    if (!sichtbar.length) {
      $('#liste').innerHTML = `<div style="padding:24px 14px; font-size:13.5px; color:var(--text-dim); line-height:1.5;">${
        q ? 'Niemand gefunden.' : 'Noch niemand erfasst.<br>Oben rechts mit dem Plus anlegen.'}</div>`;
      return;
    }

    $('#liste').innerHTML = sichtbar.map(m => `
      <div class="br-zeile pressable" data-id="${esc(m.id)}" role="button" tabindex="0"
           aria-current="${m.id === gewaehlt?.id}">
        <span class="avatar">${esc(initialen(m.name))}</span>
        <!-- Name und Funktion sind das Einzige, was schrumpfen darf. Marke
             und Knöpfe stehen fest; eine lange Funktion wie
             "Bau-/Projektleitung, Inhaber" wird abgeschnitten statt sie
             aus der Zeile zu schieben. -->
        <span style="min-width:0; flex:1;">
          <span class="titel" style="display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${esc(m.name)}</span>
          <span class="unter" style="display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${esc(m.rolle || '—')}</span>
          ${abwesenheitMarke(m)}
        </span>
        ${stufeMarke(m)}
        <span class="br-nur-handy" style="display:flex; gap:6px; flex-shrink:0;">
          ${m.telefon ? `<a class="br-knopf pressable" href="${esc(telLink(m.telefon))}" aria-label="${esc(m.name)} anrufen" data-stopp>${svg(IKON.telefon, 16)}</a>` : ''}
          ${m.email ? `<a class="br-knopf pressable" href="mailto:${esc(m.email)}" aria-label="${esc(m.name)} anschreiben" data-stopp>${svg(IKON.mail, 16)}</a>` : ''}
        </span>
      </div>`).join('');

    $$('#liste .br-zeile').forEach(el => {
      const oeffne = () => waehle(alle.find(m => m.id === el.dataset.id));
      el.addEventListener('click', e => { if (!e.target.closest('[data-stopp]')) oeffne(); });
      el.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); oeffne(); }
      });
    });
  }

  /* --- Detail ------------------------------------------------------------- */

  function detailHtml(m) {
    const neu = !m.id;
    const zeile = (ikon, wert, href, beschriftung) => wert ? `
      <a href="${esc(href)}" style="display:flex; align-items:center; gap:12px; padding:14px 4px; color:var(--navy); border-bottom:1px solid var(--border);" aria-label="${esc(beschriftung)}">
        ${svg(ikon)}<span style="font-weight:600; font-size:14.5px; overflow-wrap:anywhere;">${esc(wert)}</span>
      </a>` : '';

    return `
      <div id="ma-ansicht">
        <div style="display:flex; align-items:center; gap:14px; margin-bottom:20px;">
          <span class="avatar" style="width:56px; height:56px; font-size:17px; border-radius:50%; background:var(--navy); color:#fff; display:flex; align-items:center; justify-content:center; font-weight:700; flex-shrink:0;">${esc(initialen(m.name))}</span>
          <span style="min-width:0; flex:1;">
            <span style="display:block; font-size:20px; font-weight:800; overflow-wrap:anywhere;">${esc(m.name)}</span>
            <!-- Die Stufe steht auf der zweiten Zeile statt am rechten Rand:
                 rechts bliebe neben den zwei Knöpfen auf dem Handy so wenig
                 Platz, dass der Name buchstabenweise umbricht. -->
            <span style="display:flex; align-items:center; flex-wrap:wrap; gap:8px; color:var(--text-dim); font-size:13.5px;">
              <span>${esc(m.rolle || 'Keine Funktion erfasst')}</span>
              ${neu ? '' : stufeMarke(m)}
              ${neu ? '' : abwesenheitMarke(m)}
            </span>
          </span>
          ${verwalten ? `
            <button type="button" id="ma-bearbeiten" class="br-knopf pressable" aria-label="Bearbeiten" style="width:40px; height:40px;">${svg(IKON.stift, 17)}</button>
            <button type="button" id="ma-weg" class="br-knopf rot pressable" aria-label="In den Papierkorb" style="width:40px; height:40px;">${svg(IKON.eimer, 17)}</button>` : ''}
        </div>
        <div style="background:var(--card); border:1px solid var(--border); border-radius:16px; padding:10px 24px; max-width:480px;">
          ${zeile(IKON.telefon, m.telefon, telLink(m.telefon || ''), `${m.name} anrufen`)}
          ${zeile(IKON.mail, m.email, 'mailto:' + (m.email || ''), `${m.name} anschreiben`)}
          ${!m.telefon && !m.email ? '<div style="padding:14px 4px; font-size:13.5px; color:var(--text-dim);">Keine Kontaktangaben erfasst.</div>' : ''}
        </div>
        ${neu ? '' : `<button type="button" id="ma-vcard" class="ma-kontakt pressable">${svg(IKON.kontakt, 16)}<span>In Kontakte speichern</span></button>`}
        ${verwalten ? '' : `<div style="max-width:480px; margin-top:14px; font-size:12.5px; color:var(--text-dim); line-height:1.55;">${
          m.user_id && m.user_id === eigenesKonto
            ? 'Das sind Sie. Telefon und E-Mail ändern Sie unter <a href="profil.html" style="color:var(--red); font-weight:700;">Mein Profil</a>.'
            : 'Einträge anlegen und ändern darf die Geschäftsleitung.'}</div>`}
      </div>`;
  }

  function formularHtml(m) {
    const feld = (id, label, wert, typ = 'text', platzhalter = '') => `
      <div style="display:flex; flex-direction:column; gap:6px;">
        <label for="${id}" style="font-size:11px; font-weight:700; letter-spacing:.04em; text-transform:uppercase; color:var(--text-dim);">${esc(label)}</label>
        <input id="${id}" type="${typ}" value="${esc(wert || '')}" placeholder="${esc(platzhalter)}"
               style="height:44px; border-radius:10px; border:1.5px solid var(--border); padding:0 13px; font-size:14px; color:var(--text); box-sizing:border-box;">
      </div>`;

    return `
      <div id="ma-form">
        <div style="font-size:12px; font-weight:700; letter-spacing:.06em; text-transform:uppercase; color:var(--red); margin-bottom:14px;">${m.id ? 'Mitarbeiter bearbeiten' : 'Neuer Mitarbeiter'}</div>
        <div style="display:flex; flex-direction:column; gap:14px; max-width:480px;">
          ${feld('f-name', 'Name', m.name, 'text', 'Vorname Nachname')}
          ${feld('f-rolle', 'Funktion', m.rolle, 'text', 'z.B. Bauleiter')}
          ${feld('f-telefon', 'Telefon', m.telefon, 'tel', '079 000 00 00')}
          ${feld('f-email', 'E-Mail', m.email, 'email', 'vorname.name@triga.ch')}
          ${feld('f-badge', 'Abzeichen (freilassen für die Stufe)', m.badge_label, 'text', stufeTitel(m.berechtigung))}
          <div style="font-size:12px; color:var(--text-dim); line-height:1.5; margin-top:-6px;">
            Steht hier ein Text, zeigt das Abzeichen ihn statt
            „${esc(stufeTitel(m.berechtigung))}". An den Rechten ändert das nichts.
          </div>
          <div id="f-fehler" hidden style="font-size:12.5px; color:var(--red); font-weight:600;"></div>
          <div style="display:flex; gap:10px; margin-top:4px;">
            <button type="button" id="f-speichern" class="btn-primary pressable" style="flex:1; height:48px; border:none; border-radius:12px; background:var(--red); color:#fff; font-weight:700; font-size:15px;">Speichern</button>
            <button type="button" id="f-abbrechen" class="pressable" style="flex:1; height:48px; border-radius:12px; background:var(--card); border:1.5px solid var(--border); color:var(--navy); font-weight:700; font-size:15px;">Abbrechen</button>
          </div>
        </div>
      </div>`;
  }

  /* Setzt den Inhalt dorthin, wo er in dieser Breite hingehört. */
  function zeige(html, aufbau) {
    if (sheetOffen) { sheetOffen.schliessen(); sheetOffen = null; }
    if (breit()) {
      $('#detail').innerHTML = html;
      aufbau($('#detail'));
    } else {
      sheetOffen = sheet(html);
      aufbau(sheetOffen.el);
    }
  }

  function waehle(m) {
    if (!m) return;
    gewaehlt = m;
    zeichneListe();
    zeigeAnsicht(m);
  }

  /* Nach dem Speichern oder Löschen. Auf dem Desktop bleibt das Detail
     rechts stehen, auf dem Handy geht das Sheet zu und man ist zurück in
     der Liste. Ein Sheet, das nach dem Speichern offen bleibt, zeigt nur
     nochmals das eben Getippte und legt sich über die Knöpfe darunter. */
  function nachAktion(m) {
    if (breit() && m) zeigeAnsicht(m);
    else if (breit()) leeresDetail();
    else if (sheetOffen) { sheetOffen.schliessen(); sheetOffen = null; }
  }

  function zeigeAnsicht(m) {
    zeige(detailHtml(m), wurzel => {
      /* Der Kontakt-Export steht vor dem Riegel: eine Nummer ins eigene
         Telefon zu übernehmen ist keine Verwaltung, und wer sie am
         Bildschirm sieht, kann sie ohnehin abtippen. */
      $('#ma-vcard', wurzel)?.addEventListener('click', () => kontaktHerunterladen(m));
      if (!verwalten) return;
      $('#ma-bearbeiten', wurzel).addEventListener('click', () => zeigeFormular(m));
      $('#ma-weg', wurzel).addEventListener('click', async () => {
        const ja = await frage({
          titel: 'In den Papierkorb verschieben?',
          text: `${m.name} verschwindet aus der Liste und lässt sich jederzeit wiederherstellen. Das Login-Konto bleibt unberührt.`,
          knopf: 'In den Papierkorb'
        });
        if (!ja) return;
        try {
          await inPapierkorb(m.id);
          gewaehlt = null;
          alle = await ladeMitarbeiter();
          zeichneListe();
          nachAktion(null);
          toast('In den Papierkorb verschoben');
        } catch (e) { toast(e.message, true); }
      });
    });
  }

  function zeigeFormular(m) {
    zeige(formularHtml(m), wurzel => {
      const abbruch = () => {
        if (!m.id) { gewaehlt = null; zeichneListe(); }
        nachAktion(m.id ? m : null);
      };
      $('#f-abbrechen', wurzel).addEventListener('click', abbruch);

      $('#f-speichern', wurzel).addEventListener('click', async () => {
        const fehler = $('#f-fehler', wurzel);
        fehler.hidden = true;
        const felder = {
          name: $('#f-name', wurzel).value.trim(),
          rolle: $('#f-rolle', wurzel).value.trim() || null,
          telefon: $('#f-telefon', wurzel).value.trim() || null,
          email: $('#f-email', wurzel).value.trim() || null,
          badge_label: $('#f-badge', wurzel).value.trim() || null
        };
        if (!felder.name) {
          fehler.textContent = 'Ohne Namen geht es nicht.';
          fehler.hidden = false;
          $('#f-name', wurzel).focus();
          return;
        }
        // Dieselbe Grenze wie in der Datenbank, nur freundlicher gesagt.
        if (felder.badge_label && felder.badge_label.length > 24) {
          fehler.textContent = 'Das Abzeichen fasst höchstens 24 Zeichen.';
          fehler.hidden = false;
          $('#f-badge', wurzel).focus();
          return;
        }
        const btn = $('#f-speichern', wurzel);
        btn.disabled = true;
        btn.innerHTML = '<span class="spin"></span>';
        try {
          const gespeichert = await speichereMitarbeiter(felder, m.id);
          alle = await ladeMitarbeiter();
          gewaehlt = alle.find(x => x.id === gespeichert.id) || gespeichert;
          zeichneListe();
          nachAktion(gewaehlt);
          toast(m.id ? 'Gespeichert' : 'Mitarbeiter angelegt');
        } catch (e) {
          fehler.textContent = e.message || 'Speichern hat nicht geklappt.';
          fehler.hidden = false;
          btn.disabled = false;
          btn.textContent = 'Speichern';
        }
      });
    });
  }

  /* --- In Kontakte speichern ------------------------------------------------ */

  /* Dieselbe Maschinerie wie im Firmenpool, aus js/app.js. Eine einzelne
     Karte: eine Person ist keine Firma mit Ansprechpersonen.
     ORG steht fest auf der Firma — wer die Nummer ins Telefon holt, soll
     dort sehen, woher sie kommt, und nicht nur einen Vornamen. */
  function kontaktHerunterladen(m) {
    if (!m.telefon && !m.email) return toast('Für diesen Eintrag sind keine Kontaktangaben erfasst', true);
    const teile = String(m.name || '').trim().split(/\s+/);
    const nach = teile.length > 1 ? teile.pop() : '';
    const vor = teile.join(' ');

    vcardDatei([vcardKarte([
      `N:${vcardWert(nach)};${vcardWert(vor)};;;`,
      `FN:${vcardWert(m.name)}`,
      'ORG:TRIGA Baumanagement AG',
      m.rolle ? `TITLE:${vcardWert(m.rolle)}` : null,
      m.telefon ? `TEL;TYPE=WORK,VOICE:${vcardWert(m.telefon)}` : null,
      m.email ? `EMAIL;TYPE=INTERNET,WORK:${vcardWert(m.email)}` : null
    ])], m.name);
    toast('Kontakt exportiert');
  }

  function leeresDetail() {
    if (sheetOffen) { sheetOffen.schliessen(); sheetOffen = null; }
    $('#detail').innerHTML = `<div class="br-leer">Links jemanden auswählen${
      verwalten ? ', oder oben rechts einen neuen Eintrag anlegen' : ''}.</div>`;
  }

  /* --- Start -------------------------------------------------------------- */

  (async () => {
    if (!await verlangeLogin()) return;

    verwalten = await darfVerwalten();
    eigenesKonto = (await session())?.user?.id || null;

    $$('[data-neu]').forEach(b => {
      if (!verwalten) { b.hidden = true; return; }
      b.addEventListener('click', () => {
        gewaehlt = null;
        zeichneListe();
        zeigeFormular({ name: '', rolle: '', telefon: '', email: '' });
      });
    });
    $('#suche').addEventListener('input', zeichneListe);

    function hinweisZeigen() {
      const el = $('#hinweis');
      el.hidden = istOnline();
      if (!istOnline()) el.textContent = 'Offline. Angezeigt wird der zuletzt geladene Stand, Änderungen sind erst wieder mit Verbindung möglich.';
    }
    beiStatuswechsel(hinweisZeigen);

    /* Beides auf einmal: die Abwesenheiten hängen nicht am Adressbuch,
       und nacheinander zu warten kostet eine Rundreise ohne Gegenwert. */
    [alle, abwesend] = await Promise.all([ladeMitarbeiter(), ladeAbwesende()]);
    zeichneListe();
    leeresDetail();

    /* Sprung aus der globalen Suche direkt auf eine Person. */
    const gewuenscht = new URLSearchParams(location.search).get('person');
    if (gewuenscht) {
      const treffer = alle.find(m => m.id === gewuenscht);
      if (treffer) waehle(treffer);
      else toast('Diesen Eintrag gibt es nicht mehr.', true);
    }
  })();
})();
