/* Benachrichtigungen ausserhalb der App.
 *
 * Bewusst ohne jeden Bezug zum Chat. Ein Abo gehört einem Gerät, nicht
 * einem Bereich: wenn später eine zugewiesene Pendenz melden soll, ruft
 * die ihre Meldung über dieselben zwei Funktionen ab, die hier stehen.
 *
 * Das Abo ist pro Gerät und pro Browser. Wer die App auf dem Handy und am
 * Rechner offen hat, hat zwei Zeilen in push_geraete, und das ist richtig
 * so — eine Meldung soll auf beiden ankommen.
 *
 * Ohne Erlaubnis läuft alles weiter, nur eben still. Keine Funktion hier
 * wirft; wer sie ruft, soll sich nicht darum kümmern müssen.
 *
 * Still heisst aber nicht heimlich. Wer gerade auf "erlauben" getippt
 * hat und danach nichts sieht, glaubt, es sei eingerichtet — und wundert
 * sich tagelang über ausbleibende Meldungen. Jeder Schritt, der schief
 * gehen kann, sagt deshalb warum: in der Konsole immer, und auf dem
 * Bildschirm dann, wenn die Person es selbst ausgelöst hat.
 */

const PUSH_GEFRAGT = 'bj_push_gefragt';

/* Kann dieses Gerät überhaupt? Ein iPhone kann es erst ab iOS 16.4 und nur
   in der zum Homescreen hinzugefügten App, ein alter Browser gar nicht. */
function pushMoeglich() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

/* Der öffentliche VAPID-Schlüssel gehört in den Client, das ist bei Web
   Push so vorgesehen. Der private liegt in den Umgebungsvariablen von
   Vercel und verlässt api/push.js nie. */
function vapidBytes(b64) {
  const voll = (b64 + '='.repeat((4 - b64.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const roh = atob(voll);
  return Uint8Array.from(roh, z => z.charCodeAt(0));
}

/* Fragt einmal nach der Erlaubnis, mit einer Begründung davor.
   Einmal heisst einmal: wer ablehnt, wird nicht beim nächsten Öffnen
   wieder gefragt. Der Browser würde nach einer Ablehnung ohnehin nicht
   mehr fragen, und ein zweites Sheet wäre nur lästig.
   Liefert true, wenn danach ein Abo besteht. */
async function pushFragen({ grund, knopf = 'Benachrichtigungen erlauben' } = {}) {
  if (!pushMoeglich()) return false;
  if (Notification.permission === 'granted') return pushAnmelden();
  if (Notification.permission === 'denied') return false;
  try { if (localStorage.getItem(PUSH_GEFRAGT)) return false; } catch { /* privates Fenster */ }

  const ja = await frage({
    titel: 'Benachrichtigungen einschalten?',
    text: grund || 'Damit sehen Sie neue Nachrichten auch, wenn die App gerade nicht offen ist. Ohne geht alles gleich, nur eben still.',
    knopf,
    gefahr: false
  });
  try { localStorage.setItem(PUSH_GEFRAGT, '1'); } catch { /* egal */ }
  if (!ja) return false;

  let erlaubnis = 'default';
  try {
    erlaubnis = await Notification.requestPermission();
  } catch (e) {
    console.warn('Benachrichtigungen: die Nachfrage des Browsers scheiterte', e.message);
    toast('Benachrichtigungen liessen sich nicht einschalten: der Browser hat die Nachfrage abgelehnt', true);
    return false;
  }
  if (erlaubnis !== 'granted') {
    console.info('Benachrichtigungen: keine Erlaubnis erteilt.');
    return false;
  }
  // Ab hier hat die Person aktiv zugestimmt und wartet auf ein Ergebnis.
  return pushAnmelden({ laut: true });
}

/* Meldet dieses Gerät an und legt das Abo in push_geraete ab. Ist es schon
   angemeldet, wird nur der Zeitstempel aufgefrischt — der Endpunkt ist in
   der Tabelle eindeutig, ein zweiter Eintrag zum selben Gerät kann also
   gar nicht entstehen.

   laut: true heisst, die Person hat gerade selbst zugestimmt und wartet
   auf ein Ergebnis. Dann gehört ein Fehlschlag auf den Bildschirm. Beim
   stillen Auffrischen bei jedem Öffnen reicht die Konsole. */
async function pushAnmelden({ laut = false } = {}) {
  const scheitert = (grund, zusatz = '') => {
    console.warn(`Benachrichtigungen nicht eingerichtet: ${grund}`, zusatz);
    if (laut) toast(`Benachrichtigungen liessen sich nicht einschalten: ${grund}`, true);
    return false;
  };

  if (!pushMoeglich()) return scheitert('dieser Browser kann das nicht');
  if (Notification.permission !== 'granted') return scheitert('die Erlaubnis fehlt');
  if (!istOnline()) return scheitert('dafür braucht es eine Verbindung');

  let abo;
  try {
    const reg = await navigator.serviceWorker.ready;
    const schluessel = vapidBytes(BJ_CONFIG.vapid);

    /* Ein bestehendes Abo weiterverwenden statt blind ein neues zu
       verlangen: Safari lehnt ein zweites subscribe() ab, solange eines
       besteht. Passt der Schlüssel nicht mehr zu dem, mit dem es einmal
       ausgestellt wurde, ist es wertlos — dann weg damit und neu. */
    abo = await reg.pushManager.getSubscription();
    if (abo && !gleicherSchluessel(abo.options?.applicationServerKey, schluessel)) {
      await abo.unsubscribe().catch(() => {});
      abo = null;
    }
    if (!abo) {
      abo = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: schluessel
      });
    }
  } catch (e) {
    return scheitert('das Gerät liess sich beim Dienst nicht anmelden', `${e.name}: ${e.message}`);
  }

  const j = abo.toJSON();
  if (!j?.endpoint || !j.keys?.p256dh || !j.keys?.auth) {
    return scheitert('der Dienst hat ein unvollständiges Abo geliefert', JSON.stringify(j));
  }

  const s = await session();
  if (!s) return scheitert('niemand ist angemeldet');

  const { error } = await sb.from('push_geraete').upsert({
    user_id: s.user.id,
    endpunkt: j.endpoint,
    p256dh: j.keys.p256dh,
    auth: j.keys.auth,
    zuletzt_gesehen: new Date().toISOString()
  }, { onConflict: 'endpunkt' });

  if (error) {
    return scheitert('das Gerät liess sich nicht eintragen',
                     `${error.code || ''} ${error.message || ''}`.trim());
  }

  console.info('Benachrichtigungen: dieses Gerät ist angemeldet.');
  return true;
}

/* Zwei Schlüssel vergleichen, einmal als ArrayBuffer vom Browser und
   einmal als eigene Bytes. */
function gleicherSchluessel(vomBrowser, eigene) {
  if (!vomBrowser) return false;
  const a = new Uint8Array(vomBrowser);
  return a.length === eigene.length && a.every((z, i) => z === eigene[i]);
}

/* Meldet dieses Gerät wieder ab. Beides zusammen: Abo im Browser aufheben
   und Zeile entfernen. Eine Zeile ohne Abo bekäme nie wieder etwas zu
   sehen, ein Abo ohne Zeile bekäme nie wieder etwas geschickt. */
async function pushAbmelden() {
  if (!pushMoeglich()) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const abo = await reg.pushManager.getSubscription();
    if (!abo) return;
    const { error } = await sb.from('push_geraete').delete().eq('endpunkt', abo.endpoint);
    if (error) console.warn('Benachrichtigungen: die Zeile blieb stehen', error.message);
    await abo.unsubscribe();
  } catch (e) {
    console.warn('Benachrichtigungen: das Abmelden scheiterte', e.message);
  }
}

/* Schickt eine Meldung. Genau eines von dreien sagt, worum es geht:

     chat     an die anderen Mitglieder eines Gesprächs
     beitrag  an alle anderen im Adressbuch, bei einem wichtigen Feed-Beitrag
     antrag   an die einreichende Person, wenn ein Antrag entschieden wurde

   Wer die Meldung bekommt und ob sie überhaupt hinausgeht, entscheidet
   api/push.js und nicht diese Zeile hier: die Funktion liest jedes Mal
   selbst nach, ob die Person im Gespräch steht, ob der Beitrag ihr gehört
   und "wichtig" ist, ob sie den Antrag entschieden hat.

   Der Aufruf wartet nicht: was gemeldet wird, steht längst in der
   Datenbank und ist bei den anderen angekommen. Die Meldung ist die
   Zugabe, nicht der Weg. */
function pushSenden({ chat, beitrag, antrag, titel, text, ziel }) {
  (async () => {
    try {
      if (!istOnline()) return;
      const s = await session();
      if (!s) return;
      const rumpf = { titel, text, ziel };
      if (chat) rumpf.chat = chat;
      else if (beitrag) rumpf.beitrag = beitrag;
      else if (antrag) rumpf.antrag = antrag;
      const antwort = await fetch('/api/push', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${s.access_token}`
        },
        body: JSON.stringify(rumpf)
      });
      /* Scheitert der Versand, ändert das für die Nachricht nichts — sie
         steht längst in der Datenbank. Stillschweigen wäre trotzdem
         falsch: ein Fehler, den niemand sieht, wird nicht gesucht. */
      if (!antwort.ok) {
        console.warn('Benachrichtigung nicht verschickt:', antwort.status,
                     await antwort.text().catch(() => ''));
      }
    } catch { /* ohne Meldung ist die Nachricht trotzdem da */ }
  })();
}
