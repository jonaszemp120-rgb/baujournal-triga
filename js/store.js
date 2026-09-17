/* Datenzugriff, lokaler Spiegel und Offline-Warteschlange.
 *
 * Grundhaltung: lesen darf aus dem lokalen Spiegel kommen, schreiben
 * geht entweder sofort durch oder wandert in die Warteschlange und wird
 * nachgereicht, sobald wieder Empfang da ist. Auf der Baustelle ist
 * kein Netz der Normalfall, nicht die Ausnahme.
 */

const BASIS_KONTROLLPUNKTE = [
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

const CACHE_PROJEKTE = 'bj_cache_projekte';
const CACHE_EINTRAEGE = 'bj_cache_eintraege';   // { [projektId]: Eintrag[] }
const QUEUE = 'bj_queue';

/* --- lokaler Spiegel ---------------------------------------------------- */

function lies(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function schreib(key, wert) {
  try { localStorage.setItem(key, JSON.stringify(wert)); } catch { /* Speicher voll, egal */ }
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
        if (auftrag.typ === 'eintrag') {
          const { error } = await sb.from('eintraege').insert(auftrag.payload);
          if (error) throw error;
        } else if (auftrag.typ === 'korrektur') {
          const { error } = await sb.rpc('korrigiere_eintrag', auftrag.payload);
          if (error) throw error;
        } else if (auftrag.typ === 'projekt') {
          const { error } = await sb.from('projekte').insert(auftrag.payload);
          if (error) throw error;
        }
      } catch (e) {
        console.warn('Sync gestoppt:', e.message || e);
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

  const { data, error } = await sb
    .from('projekte')
    .select('*, eintraege(datum)')
    .order('name', { ascending: true });
  if (error) return { daten: lies(CACHE_PROJEKTE, []), ausCache: true, fehler: error.message };

  const daten = (data || []).map(p => {
    const daten_ = (p.eintraege || []).map(e => e.datum).sort();
    const { eintraege, ...rest } = p;
    return { ...rest, letzter_eintrag: daten_.length ? daten_[daten_.length - 1] : null };
  });
  schreib(CACHE_PROJEKTE, daten);
  return { daten, ausCache: false };
}

function projektAusCache(id) {
  return lies(CACHE_PROJEKTE, []).find(p => p.id === id) || null;
}

async function ladeProjekt(id) {
  if (!navigator.onLine) return projektAusCache(id);
  const { data, error } = await sb.from('projekte').select('*').eq('id', id).maybeSingle();
  if (error || !data) return projektAusCache(id);
  return data;
}

async function speichereProjekt(felder, id = null) {
  if (id) {
    if (!navigator.onLine) throw new Error('Projektangaben lassen sich nur online ändern');
    const { data, error } = await sb.from('projekte').update(felder).eq('id', id).select().single();
    if (error) throw error;
    return data;
  }

  const s = await session();
  const neu = { ...felder, id: crypto.randomUUID(), erstellt_von: s.user.id };
  if (!navigator.onLine) {
    einreihen({ typ: 'projekt', payload: neu });
    const cache = lies(CACHE_PROJEKTE, []);
    cache.push({ ...neu, archiviert: false, letzter_eintrag: null, _lokal: true });
    schreib(CACHE_PROJEKTE, cache);
    return neu;
  }
  const { data, error } = await sb.from('projekte').insert(neu).select().single();
  if (error) throw error;
  return data;
}

/* --- Einträge ----------------------------------------------------------- */

function eintraegeAusCache(projektId) {
  return lies(CACHE_EINTRAEGE, {})[projektId] || [];
}

async function ladeEintraege(projektId) {
  // Wartende Eintraege kennen nur die ersteller_id. Den Namen liefert der
  // lokale Profilspiegel, sonst stuende im Verlauf "Unbekannt".
  const ich = profilLokal();
  const lokale = warteschlange()
    .filter(a => a.typ === 'eintrag' && a.payload.projekt_id === projektId)
    .map(a => ({
      ...a.payload,
      ersteller_name: a.payload.ersteller_id === ich?.id ? ich.name : null,
      _offen: true
    }));

  if (!navigator.onLine) {
    return [...lokale, ...eintraegeAusCache(projektId)].sort(sortEintraege);
  }

  const { data, error } = await sb
    .from('eintraege')
    .select('*, profile:ersteller_id(name)')
    .eq('projekt_id', projektId)
    .order('datum', { ascending: false })
    .order('erstellt_am', { ascending: false });
  if (error) return [...lokale, ...eintraegeAusCache(projektId)].sort(sortEintraege);

  const daten = (data || []).map(e => ({ ...e, ersteller_name: e.profile?.name || null }));
  const cache = lies(CACHE_EINTRAEGE, {});
  cache[projektId] = daten;
  schreib(CACHE_EINTRAEGE, cache);
  return [...lokale, ...daten].sort(sortEintraege);
}

function sortEintraege(a, b) {
  const d = String(b.datum).localeCompare(String(a.datum));
  return d !== 0 ? d : String(b.erstellt_am || '').localeCompare(String(a.erstellt_am || ''));
}

async function ladeEintrag(id) {
  if (navigator.onLine) {
    const { data } = await sb
      .from('eintraege')
      .select('*, profile:ersteller_id(name), projekte:projekt_id(*)')
      .eq('id', id).maybeSingle();
    if (data) return { ...data, ersteller_name: data.profile?.name || null, projekt: data.projekte };
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
  const { data } = await sb
    .from('eintraege_korrekturen')
    .select('*, profile:geaendert_von(name)')
    .eq('eintrag_id', eintragId)
    .order('geaendert_am', { ascending: false });
  return (data || []).map(k => ({ ...k, geaendert_name: k.profile?.name || null }));
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
  if (error) {
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
  if (error) {
    einreihen({ typ: 'korrektur', payload });
    return { geaendert: log.length, wartet: true, fehler: error.message };
  }
  return { geaendert: log.length, wartet: false };
}

/* --- Checkliste --------------------------------------------------------- */

/* Baut die Punkteliste eines Projekts: erst die Basis, dann die
   projektspezifischen Ergaenzungen. */
function kontrollpunkte(projekt) {
  const zusatz = Array.isArray(projekt?.zusatz_kontrollpunkte) ? projekt.zusatz_kontrollpunkte : [];
  return [
    ...BASIS_KONTROLLPUNKTE.map(label => ({ label, ok: false, projektspezifisch: false })),
    ...zusatz.map(label => ({ label: String(label), ok: false, projektspezifisch: true }))
  ];
}

function kontrollStand(kontrolle) {
  const punkte = kontrolle?.punkte || [];
  return { erfuellt: punkte.filter(p => p.ok).length, total: punkte.length };
}

addEventListener('online', () => syncWarteschlange().then(r => {
  if (r.erledigt) toast(`${r.erledigt} ${r.erledigt === 1 ? 'Eintrag' : 'Einträge'} nachgetragen`);
}));
