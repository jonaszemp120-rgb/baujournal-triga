/* Service Worker: legt die ganze App in den Cache, damit sie auch ohne
   Empfang öffnet. Relevant ist das in der Tiefgarage und im Rohbau.
   Daten von Supabase laufen daran vorbei, die kommen aus dem Netz oder
   aus dem lokalen Spiegel in localStorage.
   Die Versionsnummer bei jeder Änderung hochzählen, dann räumt der
   Worker die alte Fassung beim nächsten Start weg. */

const VERSION = 'triga-v37';

const DATEIEN = [
  './',
  'index.html',
  'start.html',
  'feed.html',
  'formulare.html',
  'abnahme.html',
  'protokolle.html',
  'protokoll.html',
  'mitarbeiter.html',
  'firmenpool.html',
  'dokumente.html',
  'projekte-bereich.html',
  'projekt-detail.html',
  'pendenzen.html',
  'suche.html',
  'profil.html',
  'chat.html',
  'papierkorb-bereich.html',
  'projekte.html',
  'projekt.html',
  'projekt-start.html',
  'journal.html',
  'eintrag.html',
  'papierkorb.html',
  'manifest.json',
  'css/app.css',
  'css/projekte.css',
  'css/chat.css',
  'css/feed.css',
  'css/formulare.css',
  'css/abnahme.css',
  'css/protokoll.css',
  'js/config.js',
  'js/logo.js',
  'js/shell.js',
  'js/start.js',
  'js/mitarbeiter.js',
  'js/dokumente.js',
  'js/firmenpool.js',
  'js/projekte-daten.js',
  'js/projekte-bereich.js',
  'js/projekt-detail.js',
  'js/pendenzen.js',
  'js/suche.js',
  'js/profil.js',
  'js/chat.js',
  'js/feed.js',
  'js/formulare.js',
  'js/abnahme.js',
  'js/protokolle.js',
  'js/protokoll.js',
  'js/push.js',
  'js/papierkorb-bereich.js',
  'js/app.js',
  'js/store.js',
  'js/projekte.js',
  'js/projekt.js',
  'js/projekt-start.js',
  'js/journal.js',
  'js/wetter.js',
  'js/eintrag.js',
  'js/papierkorb.js',
  'js/verlauf.js',
  'js/export.js',
  'vendor/supabase-js-2.58.0.js',
  // Die beiden Export-Bibliotheken werden erst bei Bedarf geladen, landen
  // aber vorab im Cache, damit der Export auch offline funktioniert.
  'vendor/jspdf-2.5.2.umd.min.js',
  'vendor/docx-9.5.1.iife.js',
  'assets/favicon-32.png',
  'assets/triga-logo.png',
  'assets/icon-180.png',
  'assets/icon-192.png',
  'assets/icon-512.png',
  'assets/icon-maskable-512.png',
  'assets/fonts/archivo-latin-400-normal.woff2',
  'assets/fonts/archivo-latin-500-normal.woff2',
  'assets/fonts/archivo-latin-600-normal.woff2',
  'assets/fonts/archivo-latin-700-normal.woff2',
  'assets/fonts/archivo-latin-900-normal.woff2'
];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    // Einzeln statt addAll: eine fehlende Datei soll nicht die ganze
    // Installation kippen.
    await Promise.all(DATEIEN.map(d =>
      cache.add(new Request(d, { cache: 'reload' })).catch(() => {})));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const namen = await caches.keys();
    const alte = namen.filter(n => n !== VERSION);
    await Promise.all(alte.map(n => caches.delete(n)));
    await self.clients.claim();

    /* Der Haken am Cache: das offene Fenster hat seine Dateien schon aus
       der alten Fassung geladen, bevor diese hier fertig war. Es zeigt
       also weiter die alte App, obwohl die neue bereitliegt — beim
       nächsten Start dasselbe Spiel, weil auch dann zuerst der Cache
       antwortet und der neue Worker erst danach übernimmt. Genau so ist
       ein fertig ausgelieferter Bereich schon einmal tagelang unsichtbar
       geblieben.
       Darum sagt der Worker den offenen Fenstern Bescheid, sobald er eine
       ältere Fassung abgelöst hat. Nur dann: bei der ersten Installation
       gibt es nichts abzulösen und nichts neu zu laden. */
    if (!alte.length) return;
    const fenster = await self.clients.matchAll({ type: 'window' });
    fenster.forEach(f => f.postMessage({ typ: 'neue-version', version: VERSION }));
  })());
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Nur eigene GET-Anfragen. Supabase und alles andere geht direkt raus.
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;

  // Die Serverless-Functions liefern zu jeder Suchanfrage ein anderes
  // Ergebnis. Der Cache ignoriert den Query-String, wuerde also jeder
  // Suche die erste Antwort zurueckgeben. Also gar nicht erst anfassen.
  if (url.pathname.startsWith('/api/')) return;

  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const treffer = await cache.match(e.request, { ignoreSearch: true });

    // Aus dem Cache liefern und im Hintergrund auffrischen.
    const ausNetz = fetch(e.request).then(antwort => {
      if (antwort && antwort.ok) cache.put(e.request, antwort.clone());
      return antwort;
    }).catch(() => null);

    if (treffer) { e.waitUntil(ausNetz); return treffer; }

    const antwort = await ausNetz;
    if (antwort) return antwort;

    // Ohne Netz und ohne Cache: wenigstens die Startseite ausliefern,
    // damit die App nicht mit einem Browserfehler dasteht.
    if (e.request.mode === 'navigate') {
      return (await cache.match('index.html')) ||
             new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
    }
    return new Response('', { status: 504 });
  })());
});

/* --- Benachrichtigungen --------------------------------------------------- */

/* Der Push kommt verschlüsselt an und ist hier schon entschlüsselt: der
   Browser erledigt das, bevor er dieses Ereignis auslöst. Im Rumpf steht
   das JSON aus api/push.js.
   Ein Push ohne lesbaren Inhalt ist kein Grund, gar nichts zu zeigen —
   dann steht eben nur, dass es etwas Neues gibt. */
self.addEventListener('push', e => {
  let d = { titel: 'TRIGA App', text: 'Neue Nachricht', ziel: 'chat.html' };
  try { if (e.data) d = { ...d, ...e.data.json() }; } catch { /* Rohtext oder leer */ }

  e.waitUntil(self.registration.showNotification(d.titel, {
    body: d.text,
    icon: 'assets/icon-192.png',
    badge: 'assets/icon-192.png',
    // Gleiches Gespräch, gleiche Kennung: mehrere Nachrichten stapeln sich
    // nicht zu einem Turm, sondern ersetzen einander.
    tag: d.ziel,
    data: { ziel: d.ziel }
  }));
});

/* Antippen bringt die App nach vorne statt einen zweiten Tab zu öffnen.
   Läuft schon ein Fenster, wandert es auf das Ziel und wird sichtbar. */
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const ziel = new URL(e.notification.data?.ziel || 'start.html', self.location.origin).href;

  e.waitUntil((async () => {
    const fenster = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const f of fenster) {
      if (f.url.startsWith(self.location.origin)) {
        await f.focus();
        if ('navigate' in f) await f.navigate(ziel);
        return;
      }
    }
    await self.clients.openWindow(ziel);
  })());
});
