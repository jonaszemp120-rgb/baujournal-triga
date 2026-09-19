/* Datenzugriff, lokaler Spiegel und Offline-Warteschlange.
 *
 * Grundhaltung: lesen darf aus dem lokalen Spiegel kommen, schreiben
 * geht entweder sofort durch oder wandert in die Warteschlange und wird
 * nachgereicht, sobald wieder Empfang da ist. Auf der Baustelle ist
 * kein Netz der Normalfall, nicht die Ausnahme.
 *
 * Namen der Ersteller werden bewusst nicht ueber eine eingebettete
 * Abfrage geholt. Zwischen eintraege.ersteller_id und profile.id gibt
 * es keinen Fremdschluessel, den PostgREST sieht, der zeigt auf
 * auth.users. Eine Einbettung scheitert deshalb. Stattdessen wird die
 * Namensliste einmal geladen und lokal zugeordnet.
 */

/* Startvorlage fuer ein neues Projekt. Danach ist die Liste je Projekt
   frei editierbar, es gibt keinen festen Sockel mehr. */
const STANDARD_KONTROLLPUNKTE = [
  'Gerüste (Zustand, Verankerung)',
  'Bauzaun / Absperrungen intakt',
  'Baustellensignalisation vorhanden',
  'Ordnung / Sauberkeit Baustelle',
  'Fluchtwege frei',
  'PSA getragen (Helm, Schuhe, Weste)',
  'Materiallagerung korrekt',
  'Bauschild vorhanden',
  'Entsorgung / Mulden geordnet',
  'Lärmschutz / Ruhezeiten eingehalten'
];

const WETTER = ['Sonnig', 'Wechselhaft', 'Bewölkt', 'Regen', 'Schnee', 'Nebel', 'Sturm/Wind'];
const WETTER_ICON = { 'Sonnig': '☀', 'Wechselhaft': '⛅', 'Bewölkt': '☁', 'Regen': '☂', 'Schnee': '❄', 'Nebel': '≈', 'Sturm/Wind': '🌬' };
const TEMPERATUR = ['< 0°C', '0–10°C', '10–20°C', '20–30°C', '> 30°C'];

/* Der Satz zur gemessenen Angabe: «Um 11:25 gemessen: Sonnig · 10–20°C
   (17.2 °C)». Er steht an zwei Orten — im Formular gleich nach dem Abruf
   und später in der Detailansicht des gespeicherten Eintrags —, und
   deshalb steht er hier und nicht zweimal.

   Eine Angabe ohne Zeitpunkt ist keine Messung; dann kommt nichts
   zurück, und die Stelle faellt weg. Genau daran erkennt man am Ende,
   welche Eintraege auf einer Messung beruhen und welche jemand angetippt
   hat. */
function wetterMessText(lage, stufe, grad, wann) {
  if (!wann) return null;
  const zeit = new Date(wann);
  if (Number.isNaN(zeit.getTime())) return null;

  const stufen = [lage, stufe].filter(Boolean).join(' · ');
  const zahl = Number(grad);
  /* Eine Nachkommastelle, und die nur, wenn sie etwas sagt: 17 Grad
     sollen nicht als 17.0 dastehen. */
  const genau = Number.isFinite(zahl)
    ? ` (${(Math.round(zahl * 10) / 10).toLocaleString('de-CH')} °C)` : '';
  const uhr = zeit.toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' });

  return `Um ${uhr} gemessen: ${stufen || 'keine Angabe'}${genau}.`;
}

/* Ob ein Eintrag eine Messung traegt. Massgebend ist der Zeitpunkt: ohne
   ihn gibt es keine, und aeltere Eintraege haben keinen. */
const hatWetterMessung = e => !!(e && e.wetter_gemessen_am);

/* Fester Chip neben den Gebaeuden eines Projekts. Er steht fuer sich und
   schliesst die Einzelauswahl aus, gespeichert wird genau das Wort. */
const ALLE = 'Alle';

/* Welche Gebaeude ein Eintrag betrifft, als Text fuer Verlauf, Detail
   und Export. Ohne Angabe kommt null zurueck, dann faellt die Stelle weg. */
function gebaeudeText(eintrag) {
  const g = eintrag?.betrifft_gebaeude;
  return Array.isArray(g) && g.length ? g.join(', ') : null;
}

const CACHE_PROJEKTE = 'bj_cache_projekte';
const CACHE_EINTRAEGE = 'bj_cache_eintraege';   // { [projektId]: Eintrag[] }
const CACHE_NAMEN = 'bj_cache_namen';           // { [userId]: Name }
const QUEUE = 'bj_queue';

/* --- lokaler Spiegel ---------------------------------------------------- */

function lies(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function schreib(key, wert) {
  try { localStorage.setItem(key, JSON.stringify(wert)); } catch { /* Speicher voll, egal */ }
}

/* Fehler aus Supabase nicht verschlucken. Ein stiller Rueckfall auf den
   leeren Cache sieht aus wie "keine Daten" und kostet Stunden Suche. */
function meckern(wo, error) {
  if (error) console.error(`[Baujournal] ${wo}:`, error.message || error);
  return error;
}

/* --- Namen der Teammitglieder ------------------------------------------- */

let namenKarte = null;

async function namen() {
  if (namenKarte) return namenKarte;
  if (navigator.onLine) {
    const { data, error } = await sb.from('profile').select('id,name');
    if (!meckern('Profile laden', error) && data) {
      namenKarte = Object.fromEntries(data.map(p => [p.id, p.name]));
      schreib(CACHE_NAMEN, namenKarte);
      return namenKarte;
    }
  }
  namenKarte = lies(CACHE_NAMEN, {});
  return namenKarte;
}

/* --- Warteschlange ------------------------------------------------------ */

function warteschlange() { return lies(QUEUE, []); }
function warteschlangeSetzen(q) { schreib(QUEUE, q); document.dispatchEvent(new Event('queue')); }
function offen() { return warteschlange().length; }

function einreihen(auftrag) {
  const q = warteschlange();
  q.push({ ...auftrag, id: crypto.randomUUID(), angelegt: new Date().toISOString() });
  warteschlangeSetzen(q);
}

/* Arbeitet die Warteschlange der Reihe nach ab. Was durchgeht, fliegt
   raus. Was scheitert, bleibt drin und wird beim naechsten Versuch
   erneut probiert. */
let syncLaeuft = false;
async function syncWarteschlange() {
  if (syncLaeuft || !navigator.onLine) return { erledigt: 0, offen: offen() };
  const s = await session();
  if (!s) return { erledigt: 0, offen: offen() };

  syncLaeuft = true;
  let erledigt = 0;
  try {
    let q = warteschlange();
    while (q.length) {
      const auftrag = q[0];
      try {
        let error = null;
        if (auftrag.typ === 'eintrag') {
          ({ error } = await sb.from('eintraege').insert(auftrag.payload));
        } else if (auftrag.typ === 'korrektur') {
          ({ error } = await sb.rpc('korrigiere_eintrag', auftrag.payload));
        } else if (auftrag.typ === 'projekt') {
          ({ error } = await sb.from('projekte').insert(auftrag.payload));
        } else if (auftrag.typ === 'loeschen') {
          ({ error } = await sb.rpc('loesche_eintrag', auftrag.payload));
        } else if (auftrag.typ === 'wiederherstellen') {
          ({ error } = await sb.rpc('stelle_eintrag_wieder_her', auftrag.payload));
        }
        if (error) throw error;
      } catch (e) {
        console.warn('[Baujournal] Sync gestoppt:', e.message || e);
        break;
      }
      q = warteschlange().filter(a => a.id !== auftrag.id);
      warteschlangeSetzen(q);
      erledigt++;
    }
  } finally {
    syncLaeuft = false;
  }
  return { erledigt, offen: offen() };
}

/* --- Projekte ----------------------------------------------------------- */

async function ladeProjekte() {
  if (!navigator.onLine) return { daten: lies(CACHE_PROJEKTE, []), ausCache: true };

  // geloescht_am wird mitgeladen und hier gefiltert, statt den
  // eingebetteten Datensatz serverseitig zu filtern. Das haelt die
  // Abfrage einfach und das Ergebnis vorhersagbar.
  const { data, error } = await sb
    .from('projekte')
    .select('*, eintraege(datum, geloescht_am)')
    .order('name', { ascending: true });
  if (meckern('Projekte laden', error)) {
    return { daten: lies(CACHE_PROJEKTE, []), ausCache: true, fehler: error.message };
  }

  const daten = (data || []).map(p => {
    const { eintraege, ...rest } = p;
    const daten_ = (eintraege || []).filter(e => !e.geloescht_am).map(e => e.datum).sort();
    return { ...rest, letzter_eintrag: daten_.length ? daten_[daten_.length - 1] : null };
  });
  schreib(CACHE_PROJEKTE, daten);
  return { daten, ausCache: false };
}

function projektAusCache(id) {
  return lies(CACHE_PROJEKTE, []).find(p => p.id === id) || null;
}

/* Legt ein einzelnes Projekt in den Spiegel. Ohne das waere ein gerade
   online angelegtes oder geaendertes Projekt offline unbekannt, bis
   jemand zufaellig die Uebersicht aufruft. */
function cacheProjektSetzen(projekt) {
  const cache = lies(CACHE_PROJEKTE, []);
  const i = cache.findIndex(p => p.id === projekt.id);
  const vorher = i >= 0 ? cache[i] : {};
  const neu = { letzter_eintrag: null, ...vorher, ...projekt };
  if (i >= 0) cache[i] = neu; else cache.push(neu);
  schreib(CACHE_PROJEKTE, cache);
}

async function ladeProjekt(id) {
  if (!navigator.onLine) return projektAusCache(id);
  const { data, error } = await sb.from('projekte').select('*').eq('id', id).maybeSingle();
  if (meckern('Projekt laden', error) || !data) return projektAusCache(id);
  cacheProjektSetzen(data);
  return data;
}

async function speichereProjekt(felder, id = null) {
  if (id) {
    if (!navigator.onLine) throw new Error('Projektangaben lassen sich nur online ändern');
    const { data, error } = await sb.from('projekte').update(felder).eq('id', id).select().single();
    if (error) throw error;
    cacheProjektSetzen(data);
    return data;
  }

  const s = await session();
  const neu = { ...felder, id: crypto.randomUUID(), erstellt_von: s.user.id };
  if (!navigator.onLine) {
    einreihen({ typ: 'projekt', payload: neu });
    cacheProjektSetzen({ ...neu, archiviert: false, _lokal: true });
    return neu;
  }
  const { data, error } = await sb.from('projekte').insert(neu).select().single();
  if (error) throw error;
  cacheProjektSetzen(data);
  return data;
}

/* --- Einträge ----------------------------------------------------------- */

function eintraegeAusCache(projektId) {
  return lies(CACHE_EINTRAEGE, {})[projektId] || [];
}

function sortEintraege(a, b) {
  const d = String(b.datum).localeCompare(String(a.datum));
  return d !== 0 ? d : String(b.erstellt_am || '').localeCompare(String(a.erstellt_am || ''));
}

/* Aendert einen Eintrag im lokalen Spiegel, damit die Liste ohne Netz
   sofort stimmt und nicht erst nach dem naechsten Sync. */
function cacheEintragAendern(id, patch) {
  const cache = lies(CACHE_EINTRAEGE, {});
  for (const pid of Object.keys(cache)) {
    const i = (cache[pid] || []).findIndex(e => e.id === id);
    if (i >= 0) { cache[pid][i] = { ...cache[pid][i], ...patch }; schreib(CACHE_EINTRAEGE, cache); return; }
  }
}

/* geloescht = false liefert die normale Liste, true den Papierkorb. */
async function ladeEintraege(projektId, { geloescht = false } = {}) {
  const ich = profilLokal();
  // Wartende Eintraege kennen nur die ersteller_id. Den Namen liefert der
  // lokale Profilspiegel, sonst stuende im Verlauf "Unbekannt".
  const lokale = geloescht ? [] : warteschlange()
    .filter(a => a.typ === 'eintrag' && a.payload.projekt_id === projektId)
    .map(a => ({
      ...a.payload,
      ersteller_name: a.payload.ersteller_id === ich?.id ? ich.name : null,
      _offen: true
    }));

  const ausCache = () => [
    ...lokale,
    ...eintraegeAusCache(projektId).filter(e => geloescht ? !!e.geloescht_am : !e.geloescht_am)
  ].sort(sortEintraege);

  if (!navigator.onLine) return ausCache();

  let frage = sb.from('eintraege').select('*').eq('projekt_id', projektId);
  frage = geloescht ? frage.not('geloescht_am', 'is', null) : frage.is('geloescht_am', null);

  const { data, error } = await frage
    .order('datum', { ascending: false })
    .order('erstellt_am', { ascending: false });
  if (meckern('Einträge laden', error)) return ausCache();

  const wer = await namen();
  const daten = (data || []).map(e => ({
    ...e,
    ersteller_name: wer[e.ersteller_id] || null,
    geloescht_name: e.geloescht_von ? (wer[e.geloescht_von] || null) : null
  }));

  // Der Spiegel haelt beide Zustaende, damit der Papierkorb auch offline
  // etwas anzeigt. Deshalb nur die jeweilige Haelfte ersetzen.
  const cache = lies(CACHE_EINTRAEGE, {});
  const andere = (cache[projektId] || []).filter(e => geloescht ? !e.geloescht_am : !!e.geloescht_am);
  cache[projektId] = [...daten, ...andere];
  schreib(CACHE_EINTRAEGE, cache);

  return [...lokale, ...daten].sort(sortEintraege);
}

async function ladeEintrag(id) {
  if (navigator.onLine) {
    // projekte ist ueber einen echten Fremdschluessel eingebettet, das
    // laeuft. Der Name kommt aus der Namensliste.
    const { data, error } = await sb
      .from('eintraege')
      .select('*, projekte:projekt_id(*)')
      .eq('id', id).maybeSingle();
    meckern('Eintrag laden', error);
    if (data) {
      const wer = await namen();
      return {
        ...data,
        ersteller_name: wer[data.ersteller_id] || null,
        geloescht_name: data.geloescht_von ? (wer[data.geloescht_von] || null) : null,
        projekt: data.projekte
      };
    }
  }
  const alle = lies(CACHE_EINTRAEGE, {});
  for (const pid of Object.keys(alle)) {
    const treffer = (alle[pid] || []).find(e => e.id === id);
    if (treffer) return { ...treffer, projekt: projektAusCache(pid) };
  }
  const ausQueue = warteschlange().find(a => a.typ === 'eintrag' && a.payload.id === id);
  if (ausQueue) {
    const ich = profilLokal();
    return {
      ...ausQueue.payload,
      ersteller_name: ausQueue.payload.ersteller_id === ich?.id ? ich.name : null,
      _offen: true,
      projekt: projektAusCache(ausQueue.payload.projekt_id)
    };
  }
  return null;
}

async function ladeKorrekturen(eintragId) {
  if (!navigator.onLine) return [];
  const { data, error } = await sb
    .from('eintraege_korrekturen')
    .select('*')
    .eq('eintrag_id', eintragId)
    .order('geaendert_am', { ascending: false });
  if (meckern('Korrekturen laden', error)) return [];
  const wer = await namen();
  return (data || []).map(k => ({ ...k, geaendert_name: wer[k.geaendert_von] || null }));
}

/* Speichert einen neuen Eintrag. Ohne Netz wandert er in die
   Warteschlange und erscheint sofort im Verlauf, markiert als offen. */
async function speichereEintrag(felder) {
  const s = await session();
  const p = await profil();
  const eintrag = {
    ...felder,
    id: crypto.randomUUID(),
    ersteller_id: s.user.id,
    erstellt_am: new Date().toISOString()
  };

  if (!navigator.onLine) {
    einreihen({ typ: 'eintrag', payload: eintrag });
    return { eintrag: { ...eintrag, ersteller_name: p?.name, _offen: true }, wartet: true };
  }

  const { data, error } = await sb.from('eintraege').insert(eintrag).select().single();
  if (meckern('Eintrag speichern', error)) {
    einreihen({ typ: 'eintrag', payload: eintrag });
    return { eintrag: { ...eintrag, ersteller_name: p?.name, _offen: true }, wartet: true, fehler: error.message };
  }
  return { eintrag: { ...data, ersteller_name: p?.name }, wartet: false };
}

/* Korrektur eines bestehenden Eintrags. Die Datenbankfunktion schreibt
   Protokoll und neue Werte in einer Transaktion, siehe Migration
   korrigiere_eintrag_rpc. */
async function korrigiereEintrag(id, neu, log) {
  if (!log.length) return { geaendert: 0 };
  const payload = { p_id: id, p_neu: neu, p_log: log };

  if (!navigator.onLine) {
    einreihen({ typ: 'korrektur', payload });
    return { geaendert: log.length, wartet: true };
  }
  const { error } = await sb.rpc('korrigiere_eintrag', payload);
  if (meckern('Korrektur speichern', error)) {
    einreihen({ typ: 'korrektur', payload });
    return { geaendert: log.length, wartet: true, fehler: error.message };
  }
  return { geaendert: log.length, wartet: false };
}

/* --- Papierkorb --------------------------------------------------------- */

/* In den Papierkorb legen und zurueckholen. Beides setzt nur zwei Felder,
   es wird nie eine Zeile geloescht. Auf eintraege gibt es weiterhin
   bewusst keine delete-Policy. */
async function loescheEintrag(id) {
  const s = await session();
  const patch = { geloescht_am: new Date().toISOString(), geloescht_von: s.user.id };
  if (!navigator.onLine) {
    einreihen({ typ: 'loeschen', payload: { p_id: id } });
    cacheEintragAendern(id, patch);
    return { wartet: true };
  }
  const { error } = await sb.rpc('loesche_eintrag', { p_id: id });
  if (meckern('Eintrag löschen', error)) {
    einreihen({ typ: 'loeschen', payload: { p_id: id } });
    cacheEintragAendern(id, patch);
    return { wartet: true, fehler: error.message };
  }
  cacheEintragAendern(id, patch);
  return { wartet: false };
}

async function stelleEintragWiederHer(id) {
  const patch = { geloescht_am: null, geloescht_von: null, geloescht_name: null };
  if (!navigator.onLine) {
    einreihen({ typ: 'wiederherstellen', payload: { p_id: id } });
    cacheEintragAendern(id, patch);
    return { wartet: true };
  }
  const { error } = await sb.rpc('stelle_eintrag_wieder_her', { p_id: id });
  if (meckern('Eintrag wiederherstellen', error)) {
    einreihen({ typ: 'wiederherstellen', payload: { p_id: id } });
    cacheEintragAendern(id, patch);
    return { wartet: true, fehler: error.message };
  }
  cacheEintragAendern(id, patch);
  return { wartet: false };
}

/* --- Checkliste --------------------------------------------------------- */

/* Die Punkteliste eines Projekts als frische, unausgefuellte Kopie.
   Seit die Liste je Projekt frei editierbar ist, gibt es keine
   Unterscheidung zwischen Basis und Zusatz mehr. */
function kontrollpunkte(projekt) {
  const liste = Array.isArray(projekt?.kontrollpunkte) ? projekt.kontrollpunkte : [];
  return liste.map(label => ({ label: String(label), ok: false }));
}

function kontrollStand(kontrolle) {
  const punkte = kontrolle?.punkte || [];
  return { erfuellt: punkte.filter(p => p.ok).length, total: punkte.length };
}

addEventListener('online', () => syncWarteschlange().then(r => {
  if (r.erledigt) toast(`${r.erledigt} ${r.erledigt === 1 ? 'Änderung' : 'Änderungen'} nachgetragen`);
}));
