/* Wo die Suiten ihre Sachen finden.
 *
 * Vorher stand in jeder Datei dreimal ein absoluter Pfad: der auf das
 * Verzeichnis, in dem sie entstand, der auf Playwright und der auf
 * Chromium. Damit liefen sie genau auf einer Maschine, und auf der auch
 * nur so lange, wie deren Container lebte.
 *
 * Jetzt leitet sich alles von der eigenen Lage ab. Wer das Repo
 * irgendwohin klont, fährt die Suiten ohne eine einzige Anpassung.
 */

import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';

/* Das Verzeichnis dieser Datei — also tests/ — und darüber die Wurzel des
   Repos. Von hier aus findet sich alles andere. */
export const HIER = dirname(fileURLToPath(import.meta.url));
export const WURZEL = resolve(HIER, '..');

/* Dieselbe Wurzel als file://-Adresse. createRequire() nimmt beides,
   manche Suiten schreiben es so. */
export const WURZEL_URL = new URL('../', import.meta.url).href;

/* Wohin die Bildschirmfotos gehen. Nicht ins Repo: sie entstehen bei
   jedem Lauf neu, und hundert PNG in der Versionsgeschichte helfen
   niemandem. Ein eigenes Verzeichnis daneben, das .gitignore kennt. */
export const AUSGABE = process.env.TRIGA_AUSGABE || join(HIER, 'ausgabe');

export function schuesse(name) {
  const ziel = join(AUSGABE, name);
  fs.rmSync(ziel, { recursive: true, force: true });
  fs.mkdirSync(ziel, { recursive: true });
  return ziel;
}

/* Die beiden Server. 8123 liefert das Repo, 8124 die Kopie mit dem fest
   eingebauten Stub für die Offline-Suite. Über Umgebungsvariablen
   umzubiegen, falls die Häfen schon belegt sind. */
export const SERVER = process.env.TRIGA_BASIS || 'http://127.0.0.1:8123';
export const SERVER_OFFLINE = process.env.TRIGA_BASIS_OFFLINE || 'http://127.0.0.1:8124';

/* Der Stub und der Anfangsbestand, beide hier im Verzeichnis. */
export const stubText = () => fs.readFileSync(join(HIER, 'stub.js'), 'utf8');
export const saat = () => JSON.parse(fs.readFileSync(join(HIER, 'saat.json'), 'utf8'));

/* Eine Datei der App, von den Suiten aus gesehen: api/push.js,
   js/wetter.js und was sonst noch direkt geladen wird. */
export const imRepo = (...teile) => join(WURZEL, ...teile);

/* require() für die Serverless-Funktionen. Sie sind CommonJS, und ein
   ESM-Test kommt sonst nicht an sie heran. */
export const verlange = createRequire(join(WURZEL, 'api/'));

/* --- Playwright ----------------------------------------------------------- */

/* Ein blosses `import ... from 'playwright'` scheitert, solange das Repo
   keine package.json hat — und es soll keine bekommen, die App kommt
   ohne Build-Schritt aus. Also wird der Reihe nach gesucht: erst die
   gewöhnliche Auflösung, dann die Orte, an denen eine globale
   Installation liegt.
   TRIGA_PLAYWRIGHT sticht alles, falls es anderswo liegt. */
const ORTE = [
  process.env.TRIGA_PLAYWRIGHT,
  'playwright',
  '/opt/node22/lib/node_modules/playwright/index.mjs',
  '/usr/lib/node_modules/playwright/index.mjs',
  '/usr/local/lib/node_modules/playwright/index.mjs'
].filter(Boolean);

async function holePlaywright() {
  const gescheitert = [];
  for (const ort of ORTE) {
    try { return await import(ort); }
    catch (e) { gescheitert.push(`${ort}: ${e.code || e.message}`); }
  }
  throw new Error(
    'Playwright nicht gefunden. Versucht wurde:\n  ' + gescheitert.join('\n  ') +
    '\nEntweder global installieren (npm i -g playwright) oder TRIGA_PLAYWRIGHT ' +
    'auf den Pfad zu index.mjs setzen.');
}

export const { chromium } = await holePlaywright();

/* Der Browser selbst braucht keinen Pfad mehr: Playwright findet ihn
   über PLAYWRIGHT_BROWSERS_PATH oder seine eigene Ablage. Wer doch einen
   bestimmten will, setzt PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH — das ist
   Playwrights eigener Weg und nicht unserer. */
