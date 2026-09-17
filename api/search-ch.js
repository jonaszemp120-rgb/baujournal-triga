/* Proxy zur Tel-API von search.ch.
 *
 * Der Schlüssel gehört nicht ins Frontend. Er steht als
 * SEARCH_CH_API_KEY in den Umgebungsvariablen von Vercel und verlässt
 * diese Funktion nie: die App ruft nur /api/search-ch?q=… auf und
 * bekommt eine aufgeräumte Trefferliste zurück.
 *
 * Solange die Variable nicht gesetzt ist, antwortet die Funktion mit
 * einem klaren Hinweis statt mit einem Fehler ohne Erklärung.
 */

const ENDPUNKT = 'https://tel.search.ch/api/';

module.exports = async (req, res) => {
  const schluessel = process.env.SEARCH_CH_API_KEY;
  if (!schluessel) {
    return res.status(503).json({ fehler: 'Für search.ch ist noch kein API-Schlüssel hinterlegt.' });
  }

  const q = String((req.query && req.query.q) || '').trim();
  if (q.length < 2) {
    return res.status(400).json({ fehler: 'Bitte mindestens zwei Zeichen suchen.' });
  }

  const url = ENDPUNKT + '?' + new URLSearchParams({
    key: schluessel, was: q, maxnum: '10', format: 'json'
  });

  try {
    const antwort = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!antwort.ok) {
      return res.status(502).json({ fehler: `search.ch antwortet mit Status ${antwort.status}.` });
    }
    const daten = await antwort.json();
    const roh = Array.isArray(daten) ? daten
      : Array.isArray(daten.entries) ? daten.entries
      : Array.isArray(daten.entry) ? daten.entry : [];
    res.setHeader('Cache-Control', 'private, max-age=60');
    return res.status(200).json({ treffer: roh.map(normalisiere) });
  } catch (e) {
    return res.status(502).json({ fehler: 'search.ch war nicht erreichbar.' });
  }
};

/* search.ch liefert Personen und Firmen im selben Format. Bei einer
   Firma steht der Name in org, bei einer Person in name/firstname. */
function normalisiere(e) {
  const strasse = [e.street, e.streetno].filter(Boolean).join(' ').trim();
  const person = [e.firstname, e.name].filter(Boolean).join(' ').trim();
  return {
    name: (e.org || person || e.title || '').trim(),
    adresse: strasse || null,
    plz_ort: [e.zip, e.city].filter(Boolean).join(' ').trim() || null,
    telefon: e.phone || null,
    email: e.email || null
  };
}
