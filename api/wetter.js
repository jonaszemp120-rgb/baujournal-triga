/* Wetter von MeteoSchweiz, Open Government Data.
 *
 * Die App ruft /api/wetter?lat=…&lon=… auf und bekommt die Messwerte
 * der nächstgelegenen SwissMetNet-Station zurück, aufgeräumt und in
 * den Einheiten, mit denen der Browser weiterrechnet.
 *
 * Warum überhaupt eine Function und nicht direkt aus dem Browser:
 *
 *   Erstens CORS. data.geo.admin.ch liefert statische Dateien; ob es
 *   fremden Ursprüngen den Zugriff erlaubt, ist nicht zugesichert. Ein
 *   Abruf, der auf dem iPhone an einer fehlenden Kopfzeile scheitert,
 *   wäre ein Fehler, den niemand vor dem ersten Einsatz sieht.
 *   Zweitens die Stationsliste: rund 160 Zeilen CSV, aus denen die
 *   nächste Station zu suchen ist. Das gehört nicht auf ein Handy mit
 *   Baustellenempfang.
 *   Drittens das Format: CSV mit Semikolon, Kürzeln wie tre200s0 und
 *   Metern pro Sekunde. Wer das an einer Stelle auf klares JSON bringt,
 *   muss es nicht an dreien tun.
 *
 * Kein Schlüssel, keine Registrierung, kein Abo. Die Daten von
 * MeteoSchweiz sind frei nutzbar, auch gewerblich; verlangt ist die
 * Quellenangabe, und die steht an jedem Eintrag in wetter_quelle.
 *
 * WICHTIG für den ersten echten Einsatz: die Pfade unten sind nach der
 * Dokumentation gebaut, liessen sich aus der Entwicklungsumgebung aber
 * nicht abrufen — dort ist der Zugang ins Netz gesperrt. Stimmt ein
 * Pfad nicht, meldet die Funktion das sauber, und die App fällt auf die
 * Auswahl von Hand zurück; zu ändern ist dann nur diese eine Datei.
 */

const BASIS = 'https://data.geo.admin.ch/ch.meteoschweiz.ogd-smn';
const STATIONEN_CSV = `${BASIS}/ogd-smn_meta_stations.csv`;

/* Die Kürzel von MeteoSchweiz, die hier gebraucht werden. Sie stehen
   beisammen, damit beim nächsten Blick in die Parameterliste an einer
   Stelle nachzuführen ist. */
const P = {
  temperatur: 'tre200s0',   // Lufttemperatur 2 m, °C
  boe:        'fkl010z1',   // Böenspitze der letzten 10 Minuten, m/s
  wind:       'fkl010z0',   // mittlerer Wind 10 Minuten, m/s
  regen:      'rre150z0',   // Niederschlag 10 Minuten, mm
  sonne:      'sre000z0',   // Sonnenscheindauer 10 Minuten, Minuten
  feuchte:    'ure200s0',   // relative Feuchte 2 m, %
  strahlung:  'gre000z0'    // Globalstrahlung, W/m²
};

/* Die Stationsliste ändert sich im Jahresrhythmus. Zwischen zwei
   Aufrufen derselben laufenden Function bleibt sie deshalb liegen. */
let stationen = null;
let stationenAlter = 0;
const STATIONEN_FRIST = 12 * 60 * 60 * 1000;

module.exports = async (req, res) => {
  const lat = Number((req.query && req.query.lat) ?? NaN);
  const lon = Number((req.query && req.query.lon) ?? NaN);

  if (!Number.isFinite(lat) || !Number.isFinite(lon)
      || lat < 45 || lat > 48.5 || lon < 5 || lon > 11) {
    /* Die Grenzen sind die der Schweiz mit etwas Rand. Ausserhalb gibt
       es keine SwissMetNet-Station, und eine "nächste" Station 300
       Kilometer entfernt wäre eine Falschaussage im Journal. */
    return res.status(400).json({
      fehler: 'Für diesen Standort gibt es keine Messstation von MeteoSchweiz.'
    });
  }

  try {
    const liste = await ladeStationen();
    const station = naechste(liste, lat, lon);
    if (!station) {
      return res.status(502).json({ fehler: 'Keine Messstation gefunden.' });
    }

    const werte = await ladeWerte(station.kennung);
    if (!werte) {
      return res.status(502).json({ fehler: 'MeteoSchweiz liefert für diese Station gerade keine Werte.' });
    }

    /* Eine Minute Ruhe: die Station misst alle zehn Minuten, öfter zu
       fragen bringt nichts. */
    res.setHeader('Cache-Control', 'private, max-age=60');
    return res.status(200).json({
      quelle: 'MeteoSchweiz',
      station: {
        kennung: station.kennung,
        name: station.name,
        hoehe_m: station.hoehe,
        abstand_km: Math.round(station.abstand * 10) / 10
      },
      gemessen_am: werte.zeit,
      /* Böe und Wind in km/h: MeteoSchweiz liefert Meter pro Sekunde,
         und auf der Baustelle spricht niemand in m/s. */
      grad: werte[P.temperatur],
      boe_kmh: umrechnen(werte[P.boe]),
      wind_kmh: umrechnen(werte[P.wind]),
      regen_mm: werte[P.regen],
      sonne_min: werte[P.sonne],
      feuchte_prozent: werte[P.feuchte],
      strahlung_wm2: werte[P.strahlung],
      /* Alles, was die Station geliefert hat, unverändert. Daraus lässt
         sich jede Zuordnung später nachvollziehen, auch eine, die es
         heute noch nicht gibt. */
      roh: werte
    });
  } catch (e) {
    return res.status(502).json({ fehler: 'MeteoSchweiz war nicht erreichbar.' });
  }
};

const umrechnen = v => Number.isFinite(v) ? Math.round(v * 3.6 * 10) / 10 : null;

/* --- Die Stationsliste ---------------------------------------------------- */

async function ladeStationen() {
  if (stationen && Date.now() - stationenAlter < STATIONEN_FRIST) return stationen;

  const antwort = await fetch(STATIONEN_CSV);
  if (!antwort.ok) throw new Error(`Stationsliste: Status ${antwort.status}`);
  const text = await antwort.text();

  const zeilen = csv(text);
  stationen = zeilen.map(z => ({
    kennung: (z.station_abbr || z.Abk || '').trim().toLowerCase(),
    name: (z.station_name || z.Station || '').trim(),
    /* WGS84 steht in der Liste neben den Landeskoordinaten. Gebraucht
       wird WGS84, weil von dort auch der Standort des Geräts kommt. */
    lat: Number(z.station_coordinates_wgs84_lat ?? z.Latitude),
    lon: Number(z.station_coordinates_wgs84_lon ?? z.Longitude),
    hoehe: Number(z.station_height_masl ?? z.Elevation) || null
  })).filter(s => s.kennung && Number.isFinite(s.lat) && Number.isFinite(s.lon));

  if (!stationen.length) throw new Error('Stationsliste leer oder unbekanntes Format');
  stationenAlter = Date.now();
  return stationen;
}

/* Grosskreisabstand. Für ein paar Dutzend Kilometer täte es auch die
   ebene Näherung, aber der Unterschied kostet hier nichts. */
function naechste(liste, lat, lon) {
  const rad = g => g * Math.PI / 180;
  let beste = null;
  for (const s of liste) {
    const dLat = rad(s.lat - lat), dLon = rad(s.lon - lon);
    const a = Math.sin(dLat / 2) ** 2
            + Math.cos(rad(lat)) * Math.cos(rad(s.lat)) * Math.sin(dLon / 2) ** 2;
    const abstand = 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(a)));
    if (!beste || abstand < beste.abstand) beste = { ...s, abstand };
  }
  return beste;
}

/* --- Die Messwerte einer Station ------------------------------------------ */

/* Die Datei mit den aktuellen Zehnminutenwerten. Für den Fall, dass die
   Ablage ihr Schema ändert oder eine Station beides führt, werden
   mehrere Schreibweisen der Reihe nach versucht — die erste, die
   antwortet, gilt. */
function pfade(kennung) {
  const k = kennung.toLowerCase();
  return [
    `${BASIS}/${k}/ogd-smn_${k}_t_now.csv`,
    `${BASIS}/${k}/ogd-smn_${k}_t_recent.csv`
  ];
}

async function ladeWerte(kennung) {
  for (const url of pfade(kennung)) {
    let antwort;
    try { antwort = await fetch(url); } catch { continue; }
    if (!antwort.ok) continue;

    const zeilen = csv(await antwort.text());
    if (!zeilen.length) continue;

    /* Die jüngste Zeile gewinnt. "now" führt nur eine, "recent" mehrere;
       so ist beides gleich behandelt. */
    const letzte = zeilen[zeilen.length - 1];
    const werte = { zeit: zeitAus(letzte.reference_timestamp || letzte.time || '') };
    let etwas = false;
    for (const spalte of Object.keys(letzte)) {
      const zahl = Number(String(letzte[spalte]).replace(',', '.'));
      if (Number.isFinite(zahl) && spalte !== 'station_abbr') {
        werte[spalte] = zahl;
        if (Object.values(P).includes(spalte)) etwas = true;
      }
    }
    if (etwas) return werte;
  }
  return null;
}

/* MeteoSchweiz schreibt den Zeitstempel als 20.09.2026 11:40 oder als
   ISO. Beides wird zu ISO, damit am Eintrag nur eine Form ankommt. */
function zeitAus(roh) {
  const t = String(roh).trim();
  const ch = /^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})$/.exec(t);
  if (ch) return new Date(Date.UTC(+ch[3], +ch[2] - 1, +ch[1], +ch[4], +ch[5])).toISOString();
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

/* --- CSV ------------------------------------------------------------------ */

/* Semikolon als Trenner, erste Zeile sind die Spaltennamen. Mehr braucht
   es für diese Dateien nicht: sie führen Zahlen und Kürzel, keine
   Anführungszeichen und keine eingebetteten Trenner. */
function csv(text) {
  const zeilen = String(text).split(/\r?\n/).filter(z => z.trim());
  if (zeilen.length < 2) return [];
  const trenner = zeilen[0].includes(';') ? ';' : ',';
  const kopf = zeilen[0].split(trenner).map(s => s.trim());
  return zeilen.slice(1).map(z => {
    const teile = z.split(trenner);
    const o = {};
    kopf.forEach((name, i) => { o[name] = (teile[i] ?? '').trim(); });
    return o;
  });
}
