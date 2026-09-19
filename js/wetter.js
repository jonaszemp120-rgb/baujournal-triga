/* Wetter jetzt abrufen.
 *
 * Der Knopf im Baujournal-Formular holt den Standort über den Browser
 * und fragt damit die nächstgelegene Messstation von MeteoSchweiz ab.
 * Anschliessend stehen die passenden Chips für Wetterlage und
 * Temperaturbereich bereits ausgewählt da.
 *
 * Alles daran ist freiwillig. Wer den Knopf nicht antippt, wählt wie
 * bisher von Hand; wer ihn antippt und den Standort nicht freigibt,
 * ebenfalls. Es gibt keinen Fall, in dem ein Eintrag daran hängen
 * bleibt: jeder Fehler endet in einer Zeile Text unter den Chips, und
 * das Formular ist so benutzbar wie zuvor. Auch die automatisch
 * gesetzten Chips bleiben ganz normale Chips — ein Tipp darauf ändert
 * sie.
 *
 * Warum MeteoSchweiz und nicht mehr Open-Meteo: der freie Endpunkt von
 * Open-Meteo ist ausdrücklich der nicht gewerblichen Nutzung
 * vorbehalten, und eine Firmen-App, mit der eine Bauleitung ihre
 * Journale führt, ist gewerbliche Nutzung. Die Open Government Data von
 * MeteoSchweiz sind dagegen ohne Einschränkung frei, verlangt ist die
 * Quellenangabe — und die steht an jedem Eintrag in wetter_quelle. Kein
 * Konto, kein Schlüssel, kein Abo. Dazu sind es amtliche Messwerte
 * einer realen Station statt eines gerechneten Modellwerts.
 *
 * Der Preis dafür steht gleich dabei, damit ihn niemand übersieht:
 *
 *   Ein Messnetz misst, es beurteilt nicht. MeteoSchweiz liefert
 *   Temperatur, Böe, Niederschlag, Sonnenschein und Feuchte — aber
 *   keinen Wetterschlüssel. Die Lage wird hier deshalb abgeleitet, und
 *   zwar nur, wo die Messwerte sie wirklich hergeben. Nebel und
 *   Gewitter setzt diese Datei nie: für beides gibt es keinen Messwert,
 *   der sie belegen würde, und ein geratener Chip in einem Journal ist
 *   schlimmer als ein leerer. Die tippt der Bauleiter.
 *
 *   Die Station steht nicht auf der Baustelle. Sie kann Kilometer
 *   entfernt und einige hundert Meter höher liegen, und deshalb steht
 *   sie mit Name und Abstand in der Zeile unter den Chips und in den
 *   Rohwerten am Eintrag. Wer das Journal später liest, soll nicht
 *   glauben, hier sei auf dem Bauplatz gemessen worden.
 *
 * Alle Rohwerte wandern mit an den Eintrag. Damit bleibt die Zuordnung
 * auf die sieben Chips eine Frage der Anzeige: sie lässt sich jederzeit
 * nachrechnen und bei Bedarf anders treffen, ohne dass etwas
 * unwiderruflich zusammenfällt.
 *
 * Abgefragt wird über die eigene Function /api/wetter. Warum nicht
 * direkt: siehe den Kopf von api/wetter.js — CORS, die Stationssuche
 * über rund 160 Zeilen CSV und das Format mit Semikolon und Metern pro
 * Sekunde haben auf einem Handy mit Baustellenempfang nichts verloren.
 *
 * Der Standort verlässt das Gerät auf drei Nachkommastellen gerundet,
 * also gut hundert Meter genau. Für die Suche nach der nächsten Station
 * reicht das bei weitem, und mehr als nötig soll niemand verschicken.
 */

const WETTER_JETZT = (() => {
  const API = '/api/wetter';

  /* Der Name des Dienstes, so wie er am Eintrag stehen soll. Er wandert
     mit in die Datenbank und nicht nur in einen Anzeigetext: kommt
     später ein zweiter Dienst dazu oder wird gewechselt, muss an jedem
     einzelnen Eintrag nachvollziehbar bleiben, woher seine Angabe kam. */
  const QUELLE = 'MeteoSchweiz';

  /* Wie lange gewartet wird. Der Standort darf länger brauchen als die
     Abfrage: auf dem Handy heisst das erste Mal Freigabe-Dialog, GPS und
     manchmal ein Gang vor die Tür. Hinter /api/wetter liegen zwei
     fremde Abrufe, deshalb etwas mehr Geduld als bei einem einzelnen. */
  const GEDULD_ORT = 12000;
  const GEDULD_API = 10000;

  /* Ab welcher Böenspitze die Lage unabhängig vom Himmel «Sturm/Wind»
     heisst.
     Gemessen wird die Böe und nicht mehr der mittlere Wind — das ist
     der Wert, an dem auf der Baustelle etwas hängt. Kranführer stellen
     im Bereich um 60 bis 70 km/h ein, Gerüst- und Fassadenarbeiten
     hören früher auf. 60 km/h ist damit die Grenze, ab der ein Tag im
     Journal «Sturm/Wind» heissen soll, auch wenn die Sonne scheint.
     Der mittlere Wind lag für dasselbe Ereignis bei gut der Hälfte;
     wer alte Einträge vergleicht, muss das wissen. */
  const STURM_KMH = 60;

  /* Ab wann Niederschlag als Schnee gilt. Nassschnee fällt bis knapp
     über null; darüber wird es Regen. */
  const SCHNEE_GRAD = 1;

  /* Sonnenscheindauer der letzten zehn Minuten, in Minuten. Sieben von
     zehn heisst: die Sonne stand die meiste Zeit frei. Unter zwei war
     sie es so gut wie nie. Dazwischen wechselt es, und genau so heisst
     der Chip. */
  const SONNIG_MIN = 7;
  const WECHSEL_MIN = 2;

  /* Unter dieser Sonnenhöhe sagt die Sonnenscheindauer nichts mehr:
     nachts ist sie immer null, und daraus «bedeckt» zu machen wäre
     falsch. Drei Grad, weil knapp über dem Horizont auch bei klarem
     Himmel kaum noch etwas gemessen wird. */
  const DAEMMERUNG_GRAD = 3;

  const zahl = v => {
    if (v === null || v === undefined || v === '') return NaN;
    const n = Number(v);
    return Number.isFinite(n) ? n : NaN;
  };

  /* --- Die Zuordnung auf die Chips ---------------------------------------- */

  /* Welcher der sieben Wetter-Chips passt, aus den Messwerten. Kommt
     nichts Belastbares heraus, kommt nichts zurück — dann bleibt das
     Feld leer und wird von Hand gesetzt, statt dass etwas Falsches
     dasteht.

     Was diese Funktion bewusst nie liefert:
       Nebel    — SwissMetNet misst keine Sichtweite an jeder Station,
                  und hohe Feuchte allein ist kein Nebel.
       Gewitter — dafür gibt es unter diesen Messwerten keinen Beleg.
     Beides steht als Chip bereit und wartet auf einen Fingertipp. */
  function lageAus({ boe_kmh, regen_mm, sonne_min, grad, tag } = {}) {
    if (zahl(boe_kmh) >= STURM_KMH) return 'Sturm/Wind';

    const regen = zahl(regen_mm);
    if (Number.isFinite(regen) && regen > 0) {
      const t = zahl(grad);
      return Number.isFinite(t) && t <= SCHNEE_GRAD ? 'Schnee' : 'Regen';
    }

    /* Ohne Tageslicht ist die Sonnenscheindauer keine Aussage über den
       Himmel, sondern nur über die Uhrzeit. */
    if (tag === false) return null;

    const sonne = zahl(sonne_min);
    if (Number.isNaN(sonne)) return null;
    if (sonne >= SONNIG_MIN) return 'Sonnig';
    if (sonne >= WECHSEL_MIN) return 'Wechselhaft';
    return 'Bewölkt';
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

  /* Steht die Sonne über dem Horizont? Gebraucht wird nur ja oder nein,
     deshalb genügt die übliche Näherung über Deklination und
     Zeitgleichung; sie liegt auf etwa ein Grad genau, und das ist für
     diese Frage eine Genauigkeit zu viel statt zu wenig. */
  function sonnenhoehe(wann, lat, lon) {
    const d = wann instanceof Date ? wann : new Date(wann);
    if (Number.isNaN(d.getTime())) return null;
    const rad = Math.PI / 180;

    const jahresbeginn = Date.UTC(d.getUTCFullYear(), 0, 0);
    const tag = (d.getTime() - jahresbeginn) / 86400000;

    const dekl = 23.44 * rad * Math.sin(2 * Math.PI * (284 + tag) / 365);
    const b = 2 * Math.PI * (tag - 81) / 364;
    const zeitgleichung = 9.87 * Math.sin(2 * b) - 7.53 * Math.cos(b) - 1.5 * Math.sin(b);

    const utc = d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600;
    const ortszeit = utc + lon / 15 + zeitgleichung / 60;
    const stundenwinkel = (ortszeit - 12) * 15 * rad;

    const h = Math.asin(
      Math.sin(lat * rad) * Math.sin(dekl) +
      Math.cos(lat * rad) * Math.cos(dekl) * Math.cos(stundenwinkel));
    return h / rad;
  }

  const istTag = (wann, lat, lon) => {
    const h = sonnenhoehe(wann, lat, lon);
    return h === null ? true : h > DAEMMERUNG_GRAD;
  };

  /* --- Fehler ------------------------------------------------------------- */

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
    dienst: 'MeteoSchweiz antwortet gerade nicht. Bitte von Hand wählen.',
    ausserhalb: 'Für diesen Standort gibt es keine Messstation von MeteoSchweiz. Bitte von Hand wählen.'
  };

  /* --- Der Standort -------------------------------------------------------- */

  /* Zwei Dinge sind hier iPhone-Erfahrung und nicht Vorsicht auf Vorrat.
     Erstens fragt iOS nur nach, wenn der Aufruf an einem Fingertipp
     hängt — deshalb steht er hinter dem Knopf und nirgends sonst.
     Zweitens meldet sich die Standortabfrage in einer zum
     Startbildschirm hinzugefügten App gelegentlich überhaupt nicht
     zurück, weder mit Erfolg noch mit Fehler; dann läuft auch das eigene
     timeout der Browserfunktion nicht ab. Also läuft eine eigene Uhr
     daneben, und nach ihr ist Schluss.

     maximumAge: eine Ortung aus den letzten fünf Minuten wird
     angenommen. Für die Suche nach der nächsten Station ist sie so gut
     wie eine frische und auf dem Handy um ein Vielfaches schneller. */
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

  /* --- Die Abfrage --------------------------------------------------------- */

  async function messwerte({ lat, lon }) {
    const ziel = `${API}?lat=${lat.toFixed(3)}&lon=${lon.toFixed(3)}`;

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

    /* 400 heisst hier immer dasselbe: ausserhalb des Messnetzes. Das ist
       kein Ausfall und soll auch nicht so klingen. */
    if (antwort.status === 400) throw fehler('ausserhalb', TEXTE.ausserhalb);
    if (!antwort.ok) throw fehler('dienst', TEXTE.dienst);

    let d;
    try { d = await antwort.json(); } catch { throw fehler('dienst', TEXTE.dienst); }
    if (!d || !d.station) throw fehler('dienst', TEXTE.dienst);

    const grad = zahl(d.grad);
    const gemessen_am = d.gemessen_am || new Date().toISOString();
    const tag = istTag(gemessen_am, lat, lon);

    const lage = lageAus({
      boe_kmh: d.boe_kmh, regen_mm: d.regen_mm, sonne_min: d.sonne_min, grad, tag
    });
    const stufe = stufeAus(grad);

    /* Kommt weder eine Lage noch eine Stufe heraus, war die Abfrage
       nutzlos. Lieber nichts setzen und das sagen, als einen Chip auf
       Verdacht drücken. */
    if (!lage && !stufe) throw fehler('dienst', TEXTE.dienst);

    /* Was an den Eintrag wandert: die Werte, aus denen die Zuordnung
       entstanden ist, dazu die Station und der ganze Rohsatz der
       Messung. Damit ist jede Zuordnung später nachrechenbar. */
    const rohwerte = {
      station: d.station,
      gemessen_am,
      boe_kmh: Number.isFinite(zahl(d.boe_kmh)) ? d.boe_kmh : null,
      wind_kmh: Number.isFinite(zahl(d.wind_kmh)) ? d.wind_kmh : null,
      regen_mm: Number.isFinite(zahl(d.regen_mm)) ? d.regen_mm : null,
      sonne_min: Number.isFinite(zahl(d.sonne_min)) ? d.sonne_min : null,
      feuchte_prozent: Number.isFinite(zahl(d.feuchte_prozent)) ? d.feuchte_prozent : null,
      strahlung_wm2: Number.isFinite(zahl(d.strahlung_wm2)) ? d.strahlung_wm2 : null,
      sonne_am_himmel: tag,
      messung: d.roh || null
    };

    return {
      lage, stufe, grad,
      boe_kmh: d.boe_kmh ?? null,
      quelle: d.quelle || QUELLE,
      gemessen_am,
      station: d.station,
      rohwerte
    };
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

  return {
    lageAus, stufeAus, sonnenhoehe, istTag, standort, messwerte, abrufen,
    TEXTE, QUELLE, STURM_KMH, SCHNEE_GRAD
  };
})();
