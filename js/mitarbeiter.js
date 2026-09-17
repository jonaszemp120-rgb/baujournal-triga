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

const MA_CACHE = 'bj_cache_mitarbeiter';

let alle = [];
let gewaehlt = null;
let sheetOffen = null;

const breit = () => matchMedia('(min-width:1024px)').matches;

/* --- Daten -------------------------------------------------------------- */

async function ladeMitarbeiter() {
  if (!navigator.onLine) return lies(MA_CACHE, []);
  const { data, error } = await sb.from('mitarbeiter')
    .select('*').is('geloescht_am', null).order('name', { ascending: true });
  if (meckern('Mitarbeiter laden', error)) return lies(MA_CACHE, []);
  schreib(MA_CACHE, data || []);
  return data || [];
}

async function speichereMitarbeiter(felder, id) {
  if (!navigator.onLine) throw new Error('Mitarbeiter lassen sich nur online bearbeiten');
  if (id) {
    const { data, error } = await sb.from('mitarbeiter').update(felder).eq('id', id).select().single();
    if (error) throw error;
    return data;
  }
  const s = await session();
  const { data, error } = await sb.from('mitarbeiter')
    .insert({ ...felder, erstellt_von: s.user.id }).select().single();
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
  eimer: '<path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>'
};
const svg = (d, g = 18) => `<svg viewBox="0 0 24 24" width="${g}" height="${g}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;

/* Telefonnummern für den Link von Leerzeichen und Klammern befreien,
   damit das Wählen auch bei "+41 (41) 660 56 00" funktioniert. */
const telLink = t => 'tel:' + String(t).replace(/[^\d+]/g, '');

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
      <span style="min-width:0; flex:1;">
        <span class="titel" style="display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${esc(m.name)}</span>
        <span class="unter" style="display:block;">${esc(m.rolle || '—')}</span>
      </span>
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
          <span style="display:block; color:var(--text-dim); font-size:13.5px;">${esc(m.rolle || 'Keine Funktion erfasst')}</span>
        </span>
        <button type="button" id="ma-bearbeiten" class="br-knopf pressable" aria-label="Bearbeiten" style="width:40px; height:40px;">${svg(IKON.stift, 17)}</button>
        <button type="button" id="ma-weg" class="br-knopf rot pressable" aria-label="In den Papierkorb" style="width:40px; height:40px;">${svg(IKON.eimer, 17)}</button>
      </div>
      <div style="background:var(--card); border:1px solid var(--border); border-radius:16px; padding:10px 24px; max-width:480px;">
        ${zeile(IKON.telefon, m.telefon, telLink(m.telefon || ''), `${m.name} anrufen`)}
        ${zeile(IKON.mail, m.email, 'mailto:' + (m.email || ''), `${m.name} anschreiben`)}
        ${!m.telefon && !m.email ? '<div style="padding:14px 4px; font-size:13.5px; color:var(--text-dim);">Keine Kontaktangaben erfasst.</div>' : ''}
      </div>
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
        email: $('#f-email', wurzel).value.trim() || null
      };
      if (!felder.name) {
        fehler.textContent = 'Ohne Namen geht es nicht.';
        fehler.hidden = false;
        $('#f-name', wurzel).focus();
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

function leeresDetail() {
  if (sheetOffen) { sheetOffen.schliessen(); sheetOffen = null; }
  $('#detail').innerHTML = `<div class="br-leer">Links jemanden auswählen, oder oben rechts einen neuen Eintrag anlegen.</div>`;
}

/* --- Start -------------------------------------------------------------- */

(async () => {
  if (!await verlangeLogin()) return;

  $$('[data-neu]').forEach(b => b.addEventListener('click', () => {
    gewaehlt = null;
    zeichneListe();
    zeigeFormular({ name: '', rolle: '', telefon: '', email: '' });
  }));
  $('#suche').addEventListener('input', zeichneListe);

  function hinweisZeigen() {
    const el = $('#hinweis');
    el.hidden = istOnline();
    if (!istOnline()) el.textContent = 'Offline. Angezeigt wird der zuletzt geladene Stand, Änderungen sind erst wieder mit Verbindung möglich.';
  }
  beiStatuswechsel(hinweisZeigen);

  alle = await ladeMitarbeiter();
  zeichneListe();
  leeresDetail();
})();
