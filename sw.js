/* Service Worker: legt die ganze App in den Cache, damit sie auch ohne
   Empfang öffnet. Relevant ist das in der Tiefgarage und im Rohbau.
   Daten von Supabase laufen daran vorbei, die kommen aus dem Netz oder
   aus dem lokalen Spiegel in localStorage.
   Die Versionsnummer bei jeder Änderung hochzählen, dann räumt der
   Worker die alte Fassung beim nächsten Start weg. */

const VERSION = 'baujournal-v2';

const DATEIEN = [
  './',
  'index.html',
  'projekte.html',
  'projekt.html',
  'journal.html',
  'eintrag.html',
  'manifest.json',
  'css/app.css',
  'js/config.js',
  'js/app.js',
  'js/store.js',
  'js/projekte.js',
  'js/projekt.js',
  'js/journal.js',
  'js/eintrag.js',
  'js/export.js',
  'vendor/supabase-js-2.58.0.js',
  // Die beiden Export-Bibliotheken werden erst bei Bedarf geladen, landen
  // aber vorab im Cache, damit der Export auch offline funktioniert.
  'vendor/jspdf-2.5.2.umd.min.js',
  'vendor/docx-9.5.1.iife.js',
  'assets/favicon-32.png',
  'assets/icon-180.png',
  'assets/icon-192.png',
  'assets/icon-512.png',
  'assets/icon-maskable-512.png',
  'assets/triga-mark-light.svg',
  'assets/triga-mark-navy.svg',
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
    await Promise.all(namen.filter(n => n !== VERSION).map(n => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Nur eigene GET-Anfragen. Supabase und alles andere geht direkt raus.
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;

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
