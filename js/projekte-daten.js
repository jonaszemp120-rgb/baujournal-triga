/* Alles, was mehrere Seiten über Projekte wissen müssen.
 *
 * Die Übersicht, die Projektseite, der Firmenpool, die Dokumente und die
 * globale Suche greifen hier zu. Damit gibt es eine Stelle, die weiss,
 * wie ein Status heisst, wie eine Auftragssumme aussieht und wie man an
 * eine Unternehmerliste kommt.
 *
 * Alles hängt an einem einzigen globalen Namen. Diese Dateien teilen
 * sich einen Namensraum, und ladeProjekte() gibt es im Baujournal
 * bereits, siehe js/store.js.
 */

const PJ = (() => {
  const CACHE = 'bj_cache_projekte_bereich';

  /* --- Vokabular ---------------------------------------------------------- */

  const STATUS = [
    { id: 'planung',      titel: 'In Planung',    farbe: 'grau' },
    { id: 'laufend',      titel: 'Laufend',       farbe: 'gruen' },
    { id: 'abgeschlossen', titel: 'Abgeschlossen', farbe: 'navy' }
  ];

  /* Der Weg einer Firma durch ein Projekt, von der Anfrage bis zur
     ausgeführten Arbeit. */
  const EINSATZ = [
    { id: 'angefragt',  titel: 'Angefragt',  farbe: 'grau' },
    { id: 'offeriert',  titel: 'Offeriert',  farbe: 'gelb' },
    { id: 'beauftragt', titel: 'Beauftragt', farbe: 'gruen' },
    { id: 'ausgefuehrt', titel: 'Ausgeführt', farbe: 'navy' }
  ];

  /* Vorschläge, kein Zwang: das Feld bleibt Freitext. Wer eine dritte
     Rolle braucht, tippt sie einfach. */
  const ROLLEN = ['Bauleiter', 'Unterstützung'];

  const statusTitel = id => (STATUS.find(s => s.id === id) || {}).titel || '—';
  const einsatzTitel = id => (EINSATZ.find(s => s.id === id) || {}).titel || '—';

  function chip(liste, id, klasse = 'pj-marke') {
    const s = liste.find(x => x.id === id);
    if (!s) return '';
    return `<span class="${klasse} ${s.farbe}">${esc(s.titel)}</span>`;
  }
  const statusChip = id => chip(STATUS, id);
  const einsatzChip = id => chip(EINSATZ, id, 'pj-marke klein');

  /* --- Darstellung -------------------------------------------------------- */

  /* Die Adresse steht in der Spalte standort. Sie heisst historisch so,
     weil das Baujournal sie als Untertitel führt; im Formular ist sie
     seit jeher mit "Standort / Adresse" beschriftet. Ein zweites Feld
     dafür wäre ein zweiter Ort zum Pflegen. */
  const adresse = p => (p?.standort || '').trim();

  /* 480000 -> "CHF 480’000". Den Tausendertrenner liefert de-CH selbst,
     und zwar den typografischen Apostroph U+2019, nicht den geraden.
     Wer einen so angezeigten Betrag zurück ins Formular kopiert, wird
     dort wieder verstanden, siehe js/projekt-detail.js. */
  function franken(betrag) {
    if (betrag === null || betrag === undefined || betrag === '') return '—';
    const n = Number(betrag);
    if (!isFinite(n)) return '—';
    const nachkomma = n % 1 === 0 ? 0 : 2;
    return 'CHF ' + n.toLocaleString('de-CH', {
      minimumFractionDigits: nachkomma, maximumFractionDigits: nachkomma
    });
  }

  /* --- Laden -------------------------------------------------------------- */

  async function projekte() {
    if (!istOnline()) return lies(CACHE, []);
    const { data, error } = await sb.from('projekte')
      .select('id, name, standort, bauherrschaft, beschrieb, status, archiviert, projekt_nr, parzelle')
      .order('name', { ascending: true });
    if (meckern('Projekte laden', error)) return lies(CACHE, []);
    schreib(CACHE, data || []);
    return data || [];
  }

  function ausCache(id) {
    return lies(CACHE, []).find(p => p.id === id) || null;
  }

  async function projekt(id) {
    if (!istOnline()) return ausCache(id);
    const { data, error } = await sb.from('projekte')
      .select('*').eq('id', id).maybeSingle();
    if (meckern('Projekt laden', error) || !data) return ausCache(id);
    return data;
  }

  /* Die Unternehmerliste eines Projekts, samt der Firma dahinter.
     Zwischen projekteinsaetze.firma_id und firmen.id gibt es einen echten
     Fremdschlüssel, das Einbetten funktioniert hier also. */
  async function einsaetze(projektId) {
    if (!istOnline()) return [];
    const { data, error } = await sb.from('projekteinsaetze')
      .select('id, projekt_id, firma_id, gewerk, status, auftragssumme, firmen(id, name, plz_ort, telefon, email, bkp_codes)')
      .eq('projekt_id', projektId)
      .order('erstellt_am', { ascending: true });
    if (meckern('Unternehmerliste laden', error)) return [];
    return data || [];
  }

  /* Dieselbe Tabelle, andere Richtung: auf welchen Projekten ist diese
     Firma im Einsatz. Die Firmenseite zeigt das nur an. */
  async function einsaetzeDerFirma(firmaId) {
    if (!istOnline()) return [];
    const { data, error } = await sb.from('projekteinsaetze')
      .select('id, gewerk, status, auftragssumme, projekte(id, name, status, archiviert)')
      .eq('firma_id', firmaId);
    if (meckern('Projekte der Firma laden', error)) return [];
    return (data || []).filter(e => e.projekte);
  }

  async function personen(projektId) {
    if (!istOnline()) return [];
    const { data, error } = await sb.from('projekt_mitarbeiter')
      .select('id, rolle, mitarbeiter(id, name, rolle, telefon, email, geloescht_am)')
      .eq('projekt_id', projektId);
    if (meckern('Projektmitarbeiter laden', error)) return [];
    return (data || [])
      .filter(z => z.mitarbeiter && !z.mitarbeiter.geloescht_am)
      .sort((a, b) => a.mitarbeiter.name.localeCompare(b.mitarbeiter.name, 'de-CH'));
  }

  async function ordner(projektId) {
    if (!istOnline()) return [];
    const { data, error } = await sb.from('ordner')
      .select('id, name').eq('projekt_id', projektId)
      .is('geloescht_am', null).order('name', { ascending: true });
    if (meckern('Projektordner laden', error)) return [];
    return data || [];
  }

  /* --- Schreiben ---------------------------------------------------------- */

  async function speichere(felder, id) {
    if (!istOnline()) throw new Error('Projekte lassen sich nur online bearbeiten');
    if (id) {
      const { data, error } = await sb.from('projekte').update(felder).eq('id', id).select().single();
      if (error) throw error;
      return data;
    }
    const s = await session();
    const { data, error } = await sb.from('projekte')
      .insert({ ...felder, erstellt_von: s.user.id }).select().single();
    if (error) throw error;
    return data;
  }

  /* Zuordnungen sind in Sekunden neu gesetzt, darum echtes Löschen ohne
     Papierkorb. Dasselbe gilt für Ansprechpersonen und Notizen im
     Firmenpool, siehe die Migration zum Firmenpool. */
  async function loeschen(tabelle, id) {
    if (!istOnline()) throw new Error('Entfernen geht nur online');
    const { error } = await sb.from(tabelle).delete().eq('id', id);
    if (error) throw error;
  }

  /* --- Das Stammdaten-Formular -------------------------------------------- */

  /* Steht hier und nicht in einer der beiden Seiten, weil es an beiden
     Orten gebraucht wird: in der Übersicht zum Anlegen, auf der
     Projektseite zum Bearbeiten. Liefert das gespeicherte Projekt oder
     null bei Abbruch. */
  function formular(p) {
    return new Promise(fertig => {
      let status = p?.status || 'laufend';
      const feld = (id, label, wert, platzhalter = '', mehrzeilig = false) => `
        <div style="display:flex; flex-direction:column; gap:6px;">
          <label for="pf-${id}" style="font-size:11px; font-weight:700; letter-spacing:.04em; text-transform:uppercase; color:var(--text-dim);">${esc(label)}</label>
          ${mehrzeilig
            ? `<textarea id="pf-${id}" rows="3" placeholder="${esc(platzhalter)}" style="border-radius:10px; border:1.5px solid var(--border); padding:11px 13px; font-size:14px; color:var(--text); box-sizing:border-box; resize:vertical;">${esc(wert || '')}</textarea>`
            : `<input id="pf-${id}" type="text" value="${esc(wert || '')}" placeholder="${esc(platzhalter)}" style="height:44px; border-radius:10px; border:1.5px solid var(--border); padding:0 13px; font-size:14px; color:var(--text); box-sizing:border-box;">`}
        </div>`;

      const s = sheet(`
        <div style="font-size:12px; font-weight:700; letter-spacing:.06em; text-transform:uppercase; color:var(--red); margin-bottom:14px;">${p ? 'Projekt bearbeiten' : 'Neues Projekt'}</div>
        <div style="display:flex; flex-direction:column; gap:14px;">
          ${feld('name', 'Name', p?.name, 'z.B. Garten Mille Fiori')}
          ${feld('standort', 'Adresse', p?.standort, 'Strasse, PLZ Ort')}
          ${feld('bauherrschaft', 'Bauherrschaft', p?.bauherrschaft, 'z.B. StImmobilia GmbH')}
          ${feld('beschrieb', 'Beschrieb', p?.beschrieb, 'Was wird gebaut?', true)}
          <div style="display:flex; flex-direction:column; gap:8px;">
            <span style="font-size:11px; font-weight:700; letter-spacing:.04em; text-transform:uppercase; color:var(--text-dim);">Status</span>
            <div id="pf-status" style="display:flex; gap:8px; flex-wrap:wrap;">
              ${STATUS.map(x => `<button type="button" class="pj-chip pressable" data-status="${x.id}" aria-pressed="${x.id === status}">${esc(x.titel)}</button>`).join('')}
            </div>
          </div>
          <div id="pf-fehler" hidden style="font-size:12.5px; color:var(--red); font-weight:600;"></div>
          <div style="display:flex; gap:10px; margin-top:4px;">
            <button type="button" id="pf-ja" class="btn-primary pressable" style="flex:1; height:48px; border:none; border-radius:12px; background:var(--red); color:#fff; font-weight:700; font-size:15px;">Speichern</button>
            <button type="button" id="pf-nein" class="pressable" style="flex:1; height:48px; border-radius:12px; background:var(--card); border:1.5px solid var(--border); color:var(--navy); font-weight:700; font-size:15px;">Abbrechen</button>
          </div>
        </div>
      `);
      s.el.style.maxHeight = '86dvh';
      s.el.style.overflowY = 'auto';

      $$('#pf-status .pj-chip', s.el).forEach(el => el.addEventListener('click', () => {
        status = el.dataset.status;
        $$('#pf-status .pj-chip', s.el).forEach(x => x.setAttribute('aria-pressed', String(x === el)));
      }));
      $('#pf-nein', s.el).addEventListener('click', () => { s.schliessen(); fertig(null); });

      $('#pf-ja', s.el).addEventListener('click', async () => {
        const fehler = $('#pf-fehler', s.el);
        fehler.hidden = true;
        const felder = {
          name: $('#pf-name', s.el).value.trim(),
          standort: $('#pf-standort', s.el).value.trim() || null,
          bauherrschaft: $('#pf-bauherrschaft', s.el).value.trim() || null,
          beschrieb: $('#pf-beschrieb', s.el).value.trim() || null,
          status
        };
        if (!felder.name) {
          fehler.textContent = 'Ohne Projektnamen geht es nicht.';
          fehler.hidden = false;
          $('#pf-name', s.el).focus();
          return;
        }
        const btn = $('#pf-ja', s.el);
        btn.disabled = true;
        btn.innerHTML = '<span class="spin"></span>';
        try {
          /* Kontrollpunkte und Gebäude werden bewusst nicht mitgeschickt.
             Ein neues Projekt bekommt die zehn Standardpunkte aus dem
             Default der Datenbank, ein bestehendes behält, was im
             Baujournal gepflegt wurde. */
          const gespeichert = await speichere(felder, p?.id);
          s.schliessen();
          fertig(gespeichert);
        } catch (e) {
          fehler.textContent = e.message || 'Speichern hat nicht geklappt.';
          fehler.hidden = false;
          btn.disabled = false;
          btn.textContent = 'Speichern';
        }
      });
    });
  }

  return {
    STATUS, EINSATZ, ROLLEN,
    statusTitel, einsatzTitel, statusChip, einsatzChip,
    adresse, franken,
    projekte, projekt, einsaetze, einsaetzeDerFirma, personen, ordner,
    speichere, loeschen, formular
  };
})();
