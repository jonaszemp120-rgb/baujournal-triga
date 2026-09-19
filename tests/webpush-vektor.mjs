/* Die Verschlüsselung gegen das Beispiel aus RFC 8291, Abschnitt 5.
   Dort stehen alle Eingaben fest, auch der ephemere Schlüssel und das
   Salz — genau deshalb lässt sich das Ergebnis Zeichen für Zeichen
   vergleichen. */
import { createRequire } from 'node:module';
const require = createRequire('/home/user/baujournal-triga/api/');
const wp = require('/home/user/baujournal-triga/api/_webpush.js');

let gut = 0, schlecht = 0;
const ok = (n, b, zusatz = '') => { b ? gut++ : schlecht++; console.log(`  ${b ? '✓' : '✗ FEHLER'}  ${n}${zusatz ? '  → ' + zusatz : ''}`); };

// --- RFC 8291, Abschnitt 5 -------------------------------------------------
const KLARTEXT   = 'When I grow up, I want to be a watermelon';
const UA_PUB     = 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4';
const AUTH       = 'BTBZMqHH6r4Tts7J_aSIgg';
const AS_PUB     = 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8';
const AS_PRIV    = 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw';
const SALZ       = 'DGv6ra1nlYgDCS1FRnbzlw';
const ERWARTET   = 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN';

console.log('\n=== Verschlüsselung gegen RFC 8291 ===');

const punkt = wp.ausB64u(AS_PUB);
const jwk = wp.punktAlsJwk(punkt, wp.ausB64u(AS_PRIV));
const privat = await wp.subtle.importKey('jwk', jwk, { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
const oeffentlich = await wp.subtle.importKey(
  'jwk', { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y, ext: true },
  { name: 'ECDH', namedCurve: 'P-256' }, true, []);

const ergebnis = await wp.verschluessle(
  KLARTEXT, UA_PUB, AUTH,
  { privateKey: privat, publicKey: oeffentlich },
  wp.ausB64u(SALZ));

const gerechnet = wp.nachB64u(ergebnis);
ok('Rumpf stimmt Byte für Byte mit dem Beispiel überein', gerechnet === ERWARTET,
   gerechnet === ERWARTET ? `${ergebnis.length} Byte` : `\n      gerechnet: ${gerechnet}\n      erwartet:  ${ERWARTET}`);

ok('Kopf trägt das Salz', gerechnet.startsWith(SALZ));
ok('Blockgrösse 4096 im Kopf', ergebnis[16] === 0 && ergebnis[17] === 0 && ergebnis[18] === 16 && ergebnis[19] === 0,
   `${ergebnis[16]},${ergebnis[17]},${ergebnis[18]},${ergebnis[19]}`);
ok('Länge des Schlüssels im Kopf ist 65', ergebnis[20] === 65);
ok('Eigener Punkt steht im Kopf', wp.nachB64u(ergebnis.slice(21, 86)) === AS_PUB);

// --- Zwei Aufrufe dürfen nie dasselbe ergeben ------------------------------
const a = wp.nachB64u(await wp.verschluessle(KLARTEXT, UA_PUB, AUTH));
const b = wp.nachB64u(await wp.verschluessle(KLARTEXT, UA_PUB, AUTH));
ok('Ohne feste Vorgaben ist jeder Rumpf anders', a !== b);
ok('Und trotzdem gleich lang', a.length === b.length && a.length === ERWARTET.length);

// --- VAPID ------------------------------------------------------------------
console.log('\n=== VAPID-Kopf ===');
const paar = await wp.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const pubRoh = new Uint8Array(await wp.subtle.exportKey('raw', paar.publicKey));
const privJwk = await wp.subtle.exportKey('jwk', paar.privateKey);

const kopf = await wp.vapidKopf('https://fcm.googleapis.com/fcm/send/abc123',
  wp.nachB64u(pubRoh), privJwk.d, 'mailto:jonas.zemp@triga.ch');

ok('Kopf beginnt mit vapid', kopf.startsWith('vapid t='));
const t = kopf.slice(8).split(', k=')[0];
const k = kopf.split(', k=')[1];
ok('Der Schlüssel im Kopf ist der öffentliche', k === wp.nachB64u(pubRoh));

const [h, n, s] = t.split('.');
const kopfJson = JSON.parse(Buffer.from(h, 'base64url').toString());
const nutz = JSON.parse(Buffer.from(n, 'base64url').toString());
ok('Algorithmus ES256', kopfJson.alg === 'ES256' && kopfJson.typ === 'JWT');
ok('Empfänger ist der Ursprung des Endpunkts', nutz.aud === 'https://fcm.googleapis.com', nutz.aud);
ok('Absender steht drin', nutz.sub === 'mailto:jonas.zemp@triga.ch');
const stunden = (nutz.exp - Math.floor(Date.now() / 1000)) / 3600;
ok('Läuft in zwölf Stunden ab', stunden > 11.9 && stunden < 12.1, stunden.toFixed(2) + ' h');

const echt = await wp.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, paar.publicKey,
  Buffer.from(s, 'base64url'), Buffer.from(`${h}.${n}`, 'utf8'));
ok('Unterschrift lässt sich mit dem öffentlichen Schlüssel prüfen', echt);

console.log(`\n=== ${gut} von ${gut + schlecht} Prüfungen bestanden ===`);
process.exit(schlecht ? 1 : 0);
