/* Wetter jetzt abrufen.
 *
 * Der Knopf im Baujournal-Formular holt den Standort über den Browser und
 * fragt damit das aktuelle Wetter ab. Anschliessend stehen die passenden
 * Chips für Wetterlage und Temperaturbereich bereits ausgewählt da.
 *
 * Alles daran ist freiwillig. Wer den Knopf nicht antippt, wählt wie
 * bisher von Hand; wer ihn antippt und den Standort nicht freigibt,
 * ebenfalls. Es gibt keinen Fall, in dem ein Eintrag daran hängen bleibt:
 * jeder Fehler endet in einer Zeile Text neben dem Knopf, und das
 * Formular ist so benutzbar wie zuvor. Auch die automatisch gesetzten
 * Chips bleiben ganz normale Chips — ein Tipp darauf ändert sie.
 *
 * Warum Open-Meteo: kein Konto, kein Schlüssel, keine Kreditkarte, keine
 * Bezahlstufe, die später zuschnappt. Der Dienst nennt die nicht
 * gewerbliche Nutzung ausdrücklich frei. Damit gibt es auch nichts in den
 * Umgebungsvariablen zu hinterlegen und nichts, was ohne Schlüssel
 * plötzlich still stehen bliebe — anders als bei der Adresssuche über
 * search.ch, die über eine eigene Serverless-Function läuft.
 *
 * Der Standort verlässt das Gerät auf drei Nachkommastellen gerundet,
 * also gut hundert Meter genau. Für das Wetter über einer Baustelle
 * reicht das bei weitem, und mehr als nötig soll niemand verschicken.
 */

const WETTER_JETZT = (() => {
  const API = 'https://api.open-meteo.com/v1/forecast';

  /* Der Name des Dienstes, so wie er am Eintrag stehen soll. Er wandert
     mit in die Datenbank und nicht nur in einen Anzeigetext: kommt
     später ein zweiter Dienst dazu oder wird gewechselt, muss an jedem
     einzelnen Eintrag nachvollziehbar bleiben, woher seine Angabe kam. */
  const QUELLE = 'Open-Meteo';

  /* Wie lange gewartet wird. Der Standort darf länger brauchen als die
     Abfrage: auf dem Handy heisst das erste Mal Freigabe-Dialog, GPS und
     manchmal ein Gang vor die Tür. */
  const GEDULD_ORT = 12000;
  const GEDULD_API = 8000;

  /* Ein Windwert, ab dem die Lage unabhängig vom Himmel «Sturm/Wind»
     heisst. 62 km/h ist Beaufort 8, der Beginn des Sturms — auf der
     Baustelle die Grenze, ab der Kran und Gerüst zum Thema werden.
     Darunter wird nicht übersteuert: ein sonniger Tag mit Brise bleibt
     sonnig. */
  const STURM_KMH = 62;

  /* Die WMO-Schlüssel, die Open-Meteo liefert, auf die sieben Chips
     abgebildet. Gewitter (95–99) zählt zu Sturm/Wind und nicht zu Regen:
     auf dem Bau ist der Grund für den Unterbruch das Gewitter, nicht die
     Nässe. */
  const CODES = [
    [[0, 1], 'Sonnig'],
    [[2], 'Wechselhaft'],
    [[3], 'Bewölkt'],
    [[45, 48], 'Nebel'],
    [[51, 53, 55, 56, 57], 'Regen'],          // Niesel, auch gefrierend
    [[61, 63, 65, 66, 67], 'Regen'],
    [[80, 81, 82], 'Regen'],                  // Schauer
    [[71, 73, 75, 77], 'Schnee'],
    [[85, 86], 'Schnee'],                     // Schneeschauer
    [[95, 96, 99], 'Sturm/Wind']              // Gewitter, auch mit Hagel
  ];

  /* Welcher der sieben Wetter-Chips passt. Ein unbekannter Schlüssel
     ergibt nichts — dann bleibt das Feld leer und wird von Hand gesetzt,
     statt dass etwas Falsches dasteht. */
  /* Fehlt ein Wert, ist er nicht null Grad und nicht Schlüssel null:
     Number(null) ergäbe beides, und aus einer Lücke in der Antwort würde
     ein wolkenloser Himmel. Also erst prüfen, dann rechnen. */
  const zahl = v => {
    if (v === null || v === undefined || v === '') return NaN;
    const n = Number(v);
    return Number.isFinite(n) ? n : NaN;
  };

  function lageAus(code, windKmh) {
    if (zahl(windKmh) >= STURM_KMH) return 'Sturm/Wind';
    const c = zahl(code);
    if (Number.isNaN(c)) return null;
    const treffer = CODES.find(([liste]) => liste.includes(c));
    return treffer ? treffer[1] : null;
  }

  /* Welcher der fünf Temperatur-Chips passt. Die Grenzen gehören jeweils
     zum unteren Bereich, so wie die Beschriftungen es lesen: 10 Grad sind
     «0–10°C», 30 Grad sind «20–30°C», und «< 0°C» beginnt wirklich erst
     unter null. */
  function stufeAus(grad) {
    const t = zahl(grad);
    if (Number.isNaN(t)) return null;
    if (t < 0) return '< 0°C';
    if (t <= 10) return '0–10°C';
    if (t <= 20) return '10–20°C';
    if (t <= 30) return '20–30°C';
    return '> 30°C';
  }

  /* Ein Fehler, der sagen kann, warum. Der Grund steuert den Text neben
     dem Knopf; die Meldung selbst steht schon hier, damit sie an einer
     Stelle gepflegt wird. */
  function fehler(grund, text) {
    const e = new Error(text);
    e.grund = grund;
    return e;
  }

  const TEXTE = {
    offline: 'Offline. Bitte das Wetter von Hand wählen.',
    'nicht-unterstuetzt': 'Dieses Gerät gibt keinen Standort her. Bitte von Hand wählen.',
    verweigert: 'Standort nicht freigegeben. Bitte von Hand wählen.',
    unbekannt: 'Der Standort liess sich nicht bestimmen. Bitte von Hand wählen.',
    zeit: 'Der Standort kam nicht rechtzeitig. Bitte von Hand wählen.',
    dienst: 'Der Wetterdienst antwortet gerade nicht. Bitte von Hand wählen.'
  };

  /* Den Standort holen.
   *
   * Zwei Dinge sind hier iPhone-Erfahrung und nicht Vorsicht auf Vorrat.
   * Erstens fragt iOS nur nach, wenn der Aufruf an einem Fingertipp
   * hängt — deshalb steht er hinter dem Knopf und nirgends sonst.
   * Zweitens meldet sich die Standortabfrage in einer zum
   * Startbildschirm hinzugefügten App gelegentlich überhaupt nicht
   * zurück, weder mit Erfolg noch mit Fehler; dann läuft auch das eigene
   * timeout der Browserfunktion nicht ab. Also läuft eine eigene Uhr
   * daneben, und nach ihr ist Schluss.
   *
   * maximumAge: eine Ortung aus den letzten fünf Minuten wird
   * angenommen. Für das Wetter ist sie so gut wie eine frische und auf
   * dem Handy um ein Vielfaches schneller. */
  function standort() {
    return new Promise((gut, schlecht) => {
      if (!navigator.geolocation) {
        return schlecht(fehler('nicht-unterstuetzt', TEXTE['nicht-unterstuetzt']));
      }
      let erledigt = false;
      const fertig = fn => (...args) => {
        if (erledigt) return;
        erledigt = true;
        clearTimeout(uhr);
        fn(...args);
      };
      const uhr = setTimeout(() => {
        if (erledigt) return;
        erledigt = true;
        schlecht(fehler('zeit', TEXTE.zeit));
      }, GEDULD_ORT + 2000);

      navigator.geolocation.getCurrentPosition(
        fertig(p => gut({ lat: p.coords.latitude, lon: p.coords.longitude })),
        fertig(e => {
          const grund = e && e.code === 1 ? 'verweigert'
                      : e && e.code === 3 ? 'zeit'
                      : 'unbekannt';
          schlecht(fehler(grund, TEXTE[grund]));
        }),
        { enableHighAccuracy: false, timeout: GEDULD_ORT, maximumAge: 5 * 60 * 1000 }
      );
    });
  }

  /* Die Abfrage selbst. Ohne Schlüssel, ohne Kopfzeilen, ohne Cookie —
     eine einfache GET-Anfrage, die auch der Service Worker in Ruhe lässt,
     weil sie an einen fremden Ursprung geht. */
  async function messwerte({ lat, lon }) {
    const ziel = `${API}?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}`
               + '&current=temperature_2m,weather_code,wind_speed_10m';

    const abbruch = new AbortController();
    const uhr = setTimeout(() => abbruch.abort(), GEDULD_API);
    let antwort;
    try {
      antwort = await fetch(ziel, { signal: abbruch.signal, cache: 'no-store' });
    } catch {
      throw fehler('dienst', TEXTE.dienst);
    } finally {
      clearTimeout(uhr);
    }
    if (!antwort.ok) throw fehler('dienst', TEXTE.dienst);

    let roh;
    try { roh = await antwort.json(); } catch { throw fehler('dienst', TEXTE.dienst); }

    const jetzt = roh && roh.current;
    if (!jetzt) throw fehler('dienst', TEXTE.dienst);

    const grad = zahl(jetzt.temperature_2m);
    const code = zahl(jetzt.weather_code);
    const wind = zahl(jetzt.wind_speed_10m);
    const lage = lageAus(code, wind);
    const stufe = stufeAus(grad);

    /* Kommt weder eine Lage noch eine Stufe heraus, war die Abfrage
       nutzlos. Lieber nichts setzen und das sagen, als einen Chip auf
       Verdacht drücken. */
    if (!lage && !stufe) throw fehler('dienst', TEXTE.dienst);

    return { lage, stufe, grad, code, wind, quelle: QUELLE };
  }

  /* Der ganze Weg, wie ihn der Knopf braucht. Offline wird gar nicht
     erst losgeschickt: das spart den Freigabe-Dialog für eine Abfrage,
     die ohnehin nicht durchkäme. */
  async function abrufen() {
    if (typeof istOnline === 'function' && !istOnline()) {
      throw fehler('offline', TEXTE.offline);
    }
    return messwerte(await standort());
  }

  return { lageAus, stufeAus, standort, messwerte, abrufen, TEXTE, STURM_KMH, QUELLE };
})();
