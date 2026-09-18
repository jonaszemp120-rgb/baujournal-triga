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

/* Wer mehr darf als erfassen: Beiträge anderer löschen, Anträge genehmigen.
   Entwickler steht der Geschäftsleitung dabei gleich.
   Diese eine Stelle entscheidet das. Stünde an jedem Knopf einzeln
   berechtigung === 'geschaeftsleitung', liefe die Regel früher oder später
   auseinander und irgendein Bildschirm hätte die neue Stufe vergessen. */
const STUFEN_ERWEITERT = ['geschaeftsleitung', 'entwickler'];

function istBerechtigt(wert) {
  return STUFEN_ERWEITERT.includes(wert || STUFE_STANDARD);
}

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

/* --- Service Worker ----------------------------------------------------- */

if ('serviceWorker' in navigator) {
  addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
