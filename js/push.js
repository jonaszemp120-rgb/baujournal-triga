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
  try { erlaubnis = await Notification.requestPermission(); } catch { return false; }
  if (erlaubnis !== 'granted') return false;
  return pushAnmelden();
}

/* Meldet dieses Gerät an und legt das Abo in push_geraete ab. Ist es schon
   angemeldet, wird nur der Zeitstempel aufgefrischt — der Endpunkt ist in
   der Tabelle eindeutig, ein zweiter Eintrag zum selben Gerät kann also
   gar nicht entstehen. */
async function pushAnmelden() {
  if (!pushMoeglich() || Notification.permission !== 'granted') return false;
  if (!istOnline()) return false;

  try {
    const reg = await navigator.serviceWorker.ready;
    const abo = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: vapidBytes(BJ_CONFIG.vapid)
    });

    const j = abo.toJSON();
    const s = await session();
    if (!s) return false;

    const { error } = await sb.from('push_geraete').upsert({
      user_id: s.user.id,
      endpunkt: j.endpoint,
      p256dh: j.keys.p256dh,
      auth: j.keys.auth,
      zuletzt_gesehen: new Date().toISOString()
    }, { onConflict: 'endpunkt' });

    return !error;
  } catch {
    return false;
  }
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
    await sb.from('push_geraete').delete().eq('endpunkt', abo.endpoint);
    await abo.unsubscribe();
  } catch { /* nicht schlimm */ }
}

/* Schickt eine Meldung an die anderen Mitglieder eines Gesprächs.
   Der Aufruf wartet nicht: die Nachricht steht längst in der Datenbank
   und ist beim Gegenüber angekommen, die Meldung ist nur die Zugabe. */
function pushSenden({ chat, titel, text, ziel }) {
  (async () => {
    try {
      if (!istOnline()) return;
      const s = await session();
      if (!s) return;
      const antwort = await fetch('/api/push', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${s.access_token}`
        },
        body: JSON.stringify({ chat, titel, text, ziel })
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
