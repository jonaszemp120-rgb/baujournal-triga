/* Gemeinsame Basis aller Screens: Client, Session, Formate, Kopfzeile. */

const sb = window.supabase.createClient(BJ_CONFIG.url, BJ_CONFIG.anonKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
});

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/* --- kleine Helfer ------------------------------------------------------ */

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function heute() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fmtDatum(iso) {
  if (!iso) return '';
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  return `${d}.${m}.${y}`;
}

/* Tage zwischen einem Datum und heute, unabhaengig von der Uhrzeit. */
function tageHer(iso) {
  if (!iso) return null;
  const a = new Date(String(iso).slice(0, 10) + 'T00:00:00');
  const b = new Date(heute() + 'T00:00:00');
  return Math.round((b - a) / 86400000);
}

function relativ(iso) {
  const t = tageHer(iso);
  if (t === null) return 'noch kein Eintrag';
  if (t <= 0) return 'heute';
  if (t === 1) return 'gestern';
  if (t < 7) return `vor ${t} Tagen`;
  if (t < 14) return 'vor einer Woche';
  if (t < 60) return `vor ${Math.floor(t / 7)} Wochen`;
  return `vor ${Math.floor(t / 30)} Monaten`;
}

/* Ampel auf den Projektkacheln: frisch, etwas her, lange nichts. */
function punktFarbe(iso) {
  const t = tageHer(iso);
  if (t === null) return 'var(--mute)';
  if (t <= 1) return 'var(--ok)';
  if (t <= 7) return 'var(--warn)';
  return 'var(--mute)';
}

function initialen(name) {
  const teile = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!teile.length) return '–';
  if (teile.length === 1) return teile[0].slice(0, 2).toUpperCase();
  return (teile[0][0] + teile[teile.length - 1][0]).toUpperCase();
}

/* --- Session und Profil ------------------------------------------------- */

const PROFIL_KEY = 'bj_profil';

/* Der Anzeigename wird lokal gespiegelt, damit die App auch ohne Netz
   weiss, wer gerade erfasst. */
function profilLokal() {
  try { return JSON.parse(localStorage.getItem(PROFIL_KEY) || 'null'); } catch { return null; }
}

async function session() {
  const { data } = await sb.auth.getSession();
  return data.session || null;
}

/* Schuetzt alle Screens ausser dem Login. Offline wird die zuletzt
   bekannte Session akzeptiert, sonst waere die App in der Tiefgarage
   nicht zu oeffnen. */
async function verlangeLogin() {
  const s = await session();
  if (!s) { location.replace('index.html'); return null; }
  if (navigator.onLine) ladeProfil(s).catch(() => {});
  return s;
}

async function ladeProfil(s) {
  const { data } = await sb.from('profile').select('id,name').eq('id', s.user.id).maybeSingle();
  const p = { id: s.user.id, email: s.user.email, name: data?.name || s.user.email };
  localStorage.setItem(PROFIL_KEY, JSON.stringify(p));
  document.dispatchEvent(new CustomEvent('profil', { detail: p }));
  return p;
}

async function profil() {
  const lokal = profilLokal();
  if (lokal) return lokal;
  const s = await session();
  return s ? ladeProfil(s) : null;
}

async function abmelden() {
  try { await sb.auth.signOut(); } catch { /* offline: lokale Session reicht */ }
  localStorage.removeItem(PROFIL_KEY);
  location.replace('index.html');
}

/* --- Berechtigungsstufen ------------------------------------------------- */

/* Drei Stufen, gespeichert in mitarbeiter.berechtigung. Nicht zu verwechseln
   mit mitarbeiter.rolle — das ist die Funktion im Betrieb ("Bauleiter",
   "Administration"). Hier geht es darum, wer was darf.
   Die Stufe steht hier und nicht im Bereich Mitarbeiter, weil sie künftig
   überall gebraucht wird: Beiträge im Feed löschen, Formulare genehmigen.
   Links steht der gespeicherte Wert, rechts der Text auf dem Bildschirm.
   Die beiden müssen nicht gleich heissen — "Mitarbeiter:in" gehört in die
   Anzeige, in der Tabelle steht weiter der schlichte Wert. */
const STUFEN = {
  mitarbeiter: 'Mitarbeiter:in',
  geschaeftsleitung: 'Geschäftsleitung',
  entwickler: 'Entwickler'
};
const STUFE_STANDARD = 'mitarbeiter';

function stufeTitel(wert) { return STUFEN[wert] || STUFEN[STUFE_STANDARD]; }

/* Was auf dem Abzeichen steht. Normalerweise der Name der Stufe; steht
   in badge_label etwas, gilt das stattdessen.
   Das ist reine Anzeige und ändert an den Rechten nichts. Es gibt dafür
   einen handfesten Grund: die Administration braucht dieselben Rechte
   wie die Geschäftsleitung, gehört ihr aber nicht an. Ein Abzeichen
   "Geschäftsleitung" neben der Funktion "Administration" behauptet dann
   etwas, das nicht stimmt. Eine vierte Stufe mit denselben Rechten wäre
   die schlechtere Antwort: zwei Stufen, die dasselbe dürfen, driften
   früher oder später auseinander. */
function badgeTitel(m) {
  const eigen = String(m?.badge_label || '').trim();
  return eigen || stufeTitel(m?.berechtigung);
}

/* Wer mehr darf als erfassen: Beiträge anderer löschen, Anträge genehmigen.
   Entwickler steht der Geschäftsleitung dabei gleich.
   Diese eine Stelle entscheidet das. Stünde an jedem Knopf einzeln
   berechtigung === 'geschaeftsleitung', liefe die Regel früher oder später
   auseinander und irgendein Bildschirm hätte die neue Stufe vergessen. */
const STUFEN_ERWEITERT = ['geschaeftsleitung', 'entwickler'];

function istBerechtigt(wert) {
  return STUFEN_ERWEITERT.includes(wert || STUFE_STANDARD);
}

/* Die eigene Stufe. Einmal pro Seitenaufruf geholt und daneben im
   localStorage abgelegt, damit die Oberfläche auch ohne Verbindung weiss,
   was sie anbieten darf.
   Das ist ausdrücklich nur für die Anzeige: was wirklich zählt, entscheidet
   die Datenbank. Die Policy auf mitarbeiter und der Trigger
   mitarbeiter_schutz() lassen einen Schreibversuch scheitern, auch wenn
   hier jemand von Hand true hineinschreibt. */
let STUFE_GEHOLT = null;

async function meineStufe() {
  if (STUFE_GEHOLT) return STUFE_GEHOLT;
  const gemerkt = (() => { try { return localStorage.getItem('bj_meine_stufe'); } catch { return null; } })();

  const s = await session();
  if (!s) return STUFE_STANDARD;
  if (!istOnline()) return gemerkt || STUFE_STANDARD;

  const { data } = await sb.from('mitarbeiter')
    .select('berechtigung').eq('user_id', s.user.id).is('geloescht_am', null).maybeSingle();

  STUFE_GEHOLT = data?.berechtigung || STUFE_STANDARD;
  try { localStorage.setItem('bj_meine_stufe', STUFE_GEHOLT); } catch { /* privates Fenster */ }
  return STUFE_GEHOLT;
}

/* Darf diese Person den Bereich Mitarbeiter verwalten: anlegen, Name und
   Funktion ändern, in den Papierkorb legen, zurückholen? */
async function darfVerwalten() { return istBerechtigt(await meineStufe()); }

/* --- Eigene Unterschrift ------------------------------------------------- */

/* Die im Profil hinterlegte Unterschrift der angemeldeten Person.
   Steht hier und nicht in js/profil.js, weil sie ab Schritt 14 an anderen
   Orten gebraucht wird: Bauabnahme, Protokolle, alles, was jemand
   offiziell bestätigt. Erfasst wird sie weiterhin nur an einem Ort.

   Liefert immer ein Objekt, nie einen Fehler: fehlt die Unterschrift,
   steht in grund der Satz, der dem Benutzer zu zeigen ist. Wer das
   aufruft, soll niemandem eine rote Fehlermeldung hinstellen, wenn in
   Wahrheit nur noch nicht unterschrieben wurde. */
async function meineUnterschrift() {
  const s = await session();
  if (!s) return { bild: null, grund: 'Nicht angemeldet.' };
  if (!istOnline()) return { bild: null, grund: 'Offline. Die Unterschrift braucht eine Verbindung.' };

  const { data, error } = await sb.from('mitarbeiter')
    .select('id, name, unterschrift, unterschrift_am')
    .eq('user_id', s.user.id).is('geloescht_am', null).maybeSingle();

  if (error) return { bild: null, grund: 'Die Unterschrift liess sich nicht laden.' };
  if (!data) return {
    bild: null,
    grund: 'Zu diesem Konto gehört kein Eintrag im Bereich Mitarbeiter. Die Administration stellt die Verknüpfung her.'
  };
  if (!data.unterschrift) return {
    bild: null, name: data.name, fehlt: true,
    grund: 'Sie haben noch keine Unterschrift hinterlegt. Einmal unter «Mein Profil» unterschreiben, danach setzt sie die App hier von selbst ein.'
  };
  return { bild: data.unterschrift, name: data.name, am: data.unterschrift_am };
}

/* Der fertige Block dazu: entweder die Unterschrift oder der Hinweis mit
   dem Weg dorthin. Ein Ort für beide Fälle, damit die Bauabnahme später
   nicht ihre eigene Variante davon erfindet. */
function unterschriftBlock(u) {
  if (u.bild) {
    return `<div style="border:1.5px solid var(--border); border-radius:14px; background:var(--card); padding:12px; display:flex; flex-direction:column; align-items:center; gap:6px;">
      <img src="${esc(u.bild)}" alt="Unterschrift ${esc(u.name || '')}" style="max-width:100%; max-height:120px;">
      <span style="font-size:12px; color:var(--text-dim);">${esc(u.name || '')}</span>
    </div>`;
  }
  return `<div style="border:1.5px dashed var(--border); border-radius:14px; background:#fafbfb; padding:16px; font-size:13px; color:var(--text-dim); line-height:1.55;">
    ${esc(u.grund)}${u.fehlt ? ' <a href="profil.html" style="color:var(--red); font-weight:700;">Zum Profil</a>' : ''}
  </div>`;
}

/* --- Unterschreiben ------------------------------------------------------ */

/* Das Feld zum Unterschreiben. Liefert eine Data-URL oder null.
   Gezeichnet wird mit Pointer-Ereignissen: die decken Finger, Stift und
   Maus mit demselben Code ab.

   Steht hier und nicht im Profil, weil es an zwei Orten gebraucht wird:
   einmal für die eigene Unterschrift unter «Mein Profil» und einmal bei
   der Bauabnahme für die Bauherrschaft, die kein Konto in dieser App hat.
   Zwei Fassungen desselben Felds liefen früher oder später auseinander —
   und dann sähe eine Unterschrift im Protokoll anders aus als im Profil. */
function unterschriftErfassen({ titel = 'Unterschreiben', text = 'Mit dem Finger oder einem Stift ins Feld schreiben.' } = {}) {
  return new Promise(fertig => {
    const s = sheet(`
      <div style="font-size:16px; font-weight:800; color:var(--navy); margin-bottom:6px;">${esc(titel)}</div>
      <div style="font-size:12.5px; color:var(--text-dim); line-height:1.5; margin-bottom:14px;">${esc(text)}</div>
      <div id="us-rahmen" style="border:1.5px dashed var(--border); border-radius:14px; background:#fafbfb; padding:6px; margin-bottom:14px;">
        <canvas id="us-feld" style="display:block; width:100%; height:190px; touch-action:none; cursor:crosshair;"></canvas>
      </div>
      <div style="display:flex; gap:10px;">
        <button type="button" id="us-ja" class="btn-primary pressable" style="flex:1; height:48px; border:none; border-radius:12px; background:var(--red); color:#fff; font-weight:700; font-size:15px;">Übernehmen</button>
        <button type="button" id="us-leer" class="pressable" style="flex:1; height:48px; border-radius:12px; background:var(--card); border:1.5px solid var(--border); color:var(--navy); font-weight:700; font-size:15px;">Nochmal</button>
        <button type="button" id="us-nein" class="pressable" style="flex:1; height:48px; border-radius:12px; background:var(--card); border:1.5px solid var(--border); color:var(--navy); font-weight:700; font-size:15px;">Abbrechen</button>
      </div>
    `);

    const feld = $('#us-feld', s.el);
    const punkt = window.devicePixelRatio || 1;
    let ctx = null;
    let gezeichnet = false;

    /* Erst nach der Einblendung messen: vorher ist das Sheet noch
       ausserhalb des Bildes und clientWidth wäre 0. */
    function aufspannen() {
      const b = feld.getBoundingClientRect();
      feld.width = Math.round(b.width * punkt);
      feld.height = Math.round(b.height * punkt);
      ctx = feld.getContext('2d');
      ctx.scale(punkt, punkt);
      ctx.lineWidth = 2.4;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#11223a';
    }
    setTimeout(aufspannen, 220);

    let malt = false;
    let letzter = null;
    const stelle = e => {
      const b = feld.getBoundingClientRect();
      return { x: e.clientX - b.left, y: e.clientY - b.top };
    };

    /* Pro Bewegung ein kurzes Stück zeichnen, nicht den ganzen Zug neu.
       Ein einziger langer Pfad würde bei jeder Bewegung komplett neu
       gestrichen — das wird gegen Ende einer Unterschrift zäh. */
    function strich(von, bis) {
      ctx.beginPath();
      ctx.moveTo(von.x, von.y);
      ctx.lineTo(bis.x, bis.y);
      ctx.stroke();
    }

    feld.addEventListener('pointerdown', e => {
      if (!ctx) aufspannen();
      malt = true;
      gezeichnet = true;
      feld.setPointerCapture(e.pointerId);
      letzter = stelle(e);
      // Ein einzelner Tipp soll auch einen Punkt hinterlassen.
      strich(letzter, { x: letzter.x + 0.1, y: letzter.y });
    });
    feld.addEventListener('pointermove', e => {
      if (!malt) return;
      e.preventDefault();
      const p = stelle(e);
      strich(letzter, p);
      letzter = p;
    });
    const loslassen = () => { malt = false; letzter = null; };
    feld.addEventListener('pointerup', loslassen);
    feld.addEventListener('pointercancel', loslassen);
    feld.addEventListener('pointerleave', loslassen);

    $('#us-leer', s.el).addEventListener('click', () => {
      if (!ctx) return;
      ctx.clearRect(0, 0, feld.width, feld.height);
      gezeichnet = false;
    });
    $('#us-nein', s.el).addEventListener('click', () => { s.schliessen(); fertig(null); });
    $('#us-ja', s.el).addEventListener('click', () => {
      if (!gezeichnet) return toast('Das Feld ist noch leer', true);
      const bild = unterschriftZuschneiden(feld);
      s.schliessen();
      fertig(bild);
    });
  });
}

/* Auf den beschriebenen Bereich zuschneiden. Ohne das wäre die halbe
   Datei leerer Rand, und die Unterschrift stünde später irgendwo im
   Protokoll statt dort, wo sie hingehört. */
function unterschriftZuschneiden(feld) {
  const ctx = feld.getContext('2d');
  const d = ctx.getImageData(0, 0, feld.width, feld.height).data;
  let oben = feld.height, unten = 0, links = feld.width, rechts = 0;

  for (let y = 0; y < feld.height; y++) {
    for (let x = 0; x < feld.width; x++) {
      if (d[(y * feld.width + x) * 4 + 3] > 8) {
        if (y < oben) oben = y;
        if (y > unten) unten = y;
        if (x < links) links = x;
        if (x > rechts) rechts = x;
      }
    }
  }
  if (rechts < links || unten < oben) return feld.toDataURL('image/png');

  const rand = Math.round(8 * (window.devicePixelRatio || 1));
  links = Math.max(0, links - rand);
  oben = Math.max(0, oben - rand);
  rechts = Math.min(feld.width - 1, rechts + rand);
  unten = Math.min(feld.height - 1, unten + rand);

  const aus = document.createElement('canvas');
  aus.width = rechts - links + 1;
  aus.height = unten - oben + 1;
  aus.getContext('2d').drawImage(feld, links, oben, aus.width, aus.height,
                                 0, 0, aus.width, aus.height);
  return aus.toDataURL('image/png');
}

/* --- Online-Status ------------------------------------------------------ */

function istOnline() { return navigator.onLine; }

function beiStatuswechsel(fn) {
  addEventListener('online', fn);
  addEventListener('offline', fn);
  fn();
}

/* --- Hinweiszeile ------------------------------------------------------- */

let toastTimer;
function toast(text, fehler = false) {
  let el = $('.toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = text;
  el.classList.toggle('err', !!fehler);
  requestAnimationFrame(() => el.classList.add('show'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

/* --- Sheet -------------------------------------------------------------- */

function sheet(inhalt) {
  const bg = document.createElement('div');
  bg.className = 'sheet-bg';
  const el = document.createElement('div');
  el.className = 'sheet';
  el.innerHTML = inhalt;
  document.body.append(bg, el);
  requestAnimationFrame(() => { bg.classList.add('show'); el.classList.add('show'); });
  const zu = () => {
    bg.classList.remove('show'); el.classList.remove('show');
    setTimeout(() => { bg.remove(); el.remove(); }, 240);
  };
  bg.addEventListener('click', zu);
  return { el, schliessen: zu };
}

/* Rückfrage vor einer Handlung, die man nicht versehentlich auslösen
   soll. Liefert true, wenn bestätigt wurde. */
function frage({ titel, text, knopf, gefahr = true }) {
  return new Promise(ok => {
    const s = sheet(`
      <div style="font-size:16px; font-weight:800; color:var(--navy); margin-bottom:8px;">${esc(titel)}</div>
      <div style="font-size:13.5px; color:var(--text-dim); line-height:1.55; margin-bottom:20px;">${esc(text)}</div>
      <button id="f-ja" class="${gefahr ? 'btn-primary ' : ''}pressable" style="width:100%; height:50px; border:none; border-radius:14px; background:${gefahr ? 'var(--red)' : 'var(--navy)'}; color:#fff; font-weight:700; font-size:15px; margin-bottom:10px;">${esc(knopf)}</button>
      <button id="f-nein" class="pressable" style="width:100%; height:50px; border-radius:14px; background:var(--card); border:1.5px solid var(--border); color:var(--navy); font-weight:700; font-size:15px;">Abbrechen</button>
    `);
    $('#f-ja', s.el).addEventListener('click', () => { s.schliessen(); ok(true); });
    $('#f-nein', s.el).addEventListener('click', () => { s.schliessen(); ok(false); });
  });
}

/* --- Kontozeile in der Kopfleiste --------------------------------------- */

/* Der Kreis oben rechts zeigt die Initialen und oeffnet Name und Abmelden.
   Im Prototyp ist das nur ein Kreis, die App braucht aber einen Weg
   heraus und einen Weg, den Anzeigenamen zu setzen. */
async function kontoSheet() {
  const p = await profil();
  const s = sheet(`
      <div style="font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--red);margin-bottom:14px;">Konto</div>
      <a href="profil.html" class="pressable" style="display:flex;align-items:center;gap:10px;height:50px;border-radius:14px;background:var(--card);border:1.5px solid var(--navy);color:var(--navy);font-weight:700;font-size:15px;justify-content:center;margin-bottom:16px;">
        <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
        Mein Profil
      </a>
      <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:16px;">
        <label style="font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--text-dim);">Anzeigename</label>
        <input id="k-name" type="text" value="${esc(p?.name || '')}" style="height:44px;border-radius:10px;border:1.5px solid var(--border);padding:0 13px;font-size:14px;color:var(--text);box-sizing:border-box;">
        <div style="font-size:12px;color:var(--text-dim);margin-top:2px;">${esc(p?.email || '')}</div>
      </div>
      <button id="k-save" class="btn-primary pressable" style="width:100%;height:50px;border:none;border-radius:14px;background:var(--red);color:#fff;font-weight:700;font-size:15px;margin-bottom:10px;">Name speichern</button>
      <button id="k-out" class="pressable" style="width:100%;height:50px;border-radius:14px;background:var(--card);border:1.5px solid var(--border);color:var(--navy);font-weight:700;font-size:15px;">Abmelden</button>
  `);
  $('#k-save', s.el).addEventListener('click', async () => {
    const name = $('#k-name', s.el).value.trim();
    if (!name) return;
    if (!istOnline()) return toast('Name lässt sich nur online ändern', true);
    const { error } = await sb.from('profile').update({ name }).eq('id', p.id);
    if (error) return toast(error.message, true);
    localStorage.setItem(PROFIL_KEY, JSON.stringify({ ...p, name }));
    document.dispatchEvent(new CustomEvent('profil', { detail: { ...p, name } }));
    s.schliessen();
    toast('Name gespeichert');
  });
  $('#k-out', s.el).addEventListener('click', abmelden);
}

/* Der Kreis mit den Initialen, oben rechts in der mobilen Kopfzeile. */
function kontoKreis(el) {
  const zeichne = p => { el.textContent = initialen(p?.name); };
  profil().then(zeichne);
  document.addEventListener('profil', e => zeichne(e.detail));
  el.addEventListener('click', kontoSheet);
}

/* --- Erwähnungen -------------------------------------------------------- */

/* Eine Erwähnung steht im Text selbst, als @[Name](Kennung). Nicht in
   einer eigenen Tabelle daneben: der Text ist die Wahrheit, und wer
   nachsehen will, wer wirklich erwähnt wurde — api/push.js tut das —,
   liest dieselbe Zeichenkette wie der Bildschirm. Eine zweite Tabelle
   liefe früher oder später auseinander, etwa wenn jemand den Namen aus
   dem Text löscht.

   Der Name steht mit drin, obwohl die Kennung genügen würde. Damit bleibt
   der Text auch dort lesbar, wo niemand das Adressbuch zur Hand hat: im
   Push auf dem Sperrbildschirm, im Auszug auf der Projektseite. */
const ERWAEHNUNG = /@\[([^\]\n]{1,80})\]\(([0-9a-zA-Z_-]{1,64})\)/gi;

/* Die Kennungen aller erwähnten Personen, jede einmal. */
function erwaehnungenAus(text) {
  const raus = new Set();
  for (const m of String(text || '').matchAll(ERWAEHNUNG)) raus.add(m[2].toLowerCase());
  return [...raus];
}

/* Derselbe Text ohne die Klammern: "@Thomas Zürcher" statt
   "@[Thomas Zürcher](…)". Für alles, was den Text nur anzeigt und keine
   Verknüpfung braucht. */
function erwaehnungKlartext(text) {
  return String(text || '').replace(ERWAEHNUNG, (_, name) => `@${name}`);
}

/* --- Service Worker ----------------------------------------------------- */

if ('serviceWorker' in navigator) {
  addEventListener('load', async () => {
    let reg;
    try { reg = await navigator.serviceWorker.register('sw.js'); } catch { return; }

    /* Der Worker meldet sich, wenn er eine ältere Fassung abgelöst hat.
       Dann steht im Fenster noch die alte App und ein Neuladen holt die
       neue. Ein zweites Mal kann das nicht passieren: die Meldung kommt
       genau einmal pro neuer Fassung, und nach dem Neuladen ist sie die
       laufende. Der Riegel schützt trotzdem vor einer Schleife, falls
       eine Auslieferung einmal kaputt ist.
       Wer gerade tippt, wird nicht unterbrochen — dann wartet das
       Neuladen, bis die Seite wieder in den Hintergrund geht. */
    navigator.serviceWorker.addEventListener('message', e => {
      if (e.data?.typ !== 'neue-version') return;

      const neuLaden = () => {
        // Der Riegel erst hier, unmittelbar vor dem Neuladen: käme er
        // schon beim Eintreffen der Meldung, bliebe die alte Fassung
        // hängen, falls es zum Neuladen gar nicht mehr kommt.
        try {
          if (sessionStorage.getItem('triga-version') === e.data.version) return;
          sessionStorage.setItem('triga-version', e.data.version);
        } catch { /* Privater Modus: dann eben ohne Riegel */ }
        location.reload();
      };

      // Mitten im Tippen wird niemand unterbrochen. Sobald das Feld die
      // Eingabe abgibt, ist der Weg frei.
      const tippt = () => {
        const el = document.activeElement;
        return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
      };
      if (!tippt()) { neuLaden(); return; }
      document.addEventListener('focusout', function pruefe() {
        // focusout kommt, bevor das nächste Feld den Fokus hat. Erst im
        // nächsten Durchlauf steht fest, ob überhaupt jemand weitertippt.
        setTimeout(() => {
          if (tippt()) return;
          document.removeEventListener('focusout', pruefe);
          neuLaden();
        }, 0);
      });
    });

    /* Auf dem Handy bleibt die App als Symbol auf dem Startbildschirm oft
       tagelang offen, ohne je neu zu laden. Ohne diesen Anstoss sucht der
       Browser in dieser Zeit nie nach einer neuen Fassung. */
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') reg.update().catch(() => {});
    });
  });
}
