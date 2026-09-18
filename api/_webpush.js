/* Web Push, von Hand.
 *
 * Ein Push besteht aus zwei Teilen, die nichts miteinander zu tun haben:
 *
 *   1. Die Nachricht wird für genau ein Gerät verschlüsselt (RFC 8291 auf
 *      Basis von RFC 8188). Der Push-Dienst von Apple, Google oder Mozilla
 *      leitet sie nur weiter und kann sie nicht lesen.
 *   2. Der Aufruf weist sich beim Push-Dienst aus (VAPID, RFC 8292). Das
 *      ist ein signiertes Token, damit nicht jeder an fremde Abos senden
 *      kann.
 *
 * Es gäbe dafür ein fertiges npm-Paket. Dieses Repo kommt seit jeher ohne
 * Build-Schritt und ohne Abhängigkeiten aus, und die beiden RFC bringen
 * ihre eigenen Testvektoren mit — die Prüfung dieser Datei rechnet das
 * Beispiel aus RFC 8291 nach und vergleicht Zeichen für Zeichen.
 *
 * Der Unterstrich im Dateinamen hält sie aus dem Routing von Vercel
 * heraus: das hier ist eine Bibliothek, kein Endpunkt.
 */

const { webcrypto } = require('node:crypto');
const subtle = webcrypto.subtle;

/* --- Kleinkram ----------------------------------------------------------- */

const roh = s => Uint8Array.from(Buffer.from(s, 'utf8'));

function ausB64u(s) {
  return Uint8Array.from(Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64'));
}

function nachB64u(b) {
  return Buffer.from(b).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function kette(...teile) {
  const gesamt = teile.reduce((n, t) => n + t.length, 0);
  const aus = new Uint8Array(gesamt);
  let i = 0;
  for (const t of teile) { aus.set(t, i); i += t.length; }
  return aus;
}

/* Zahl als 4 Byte, höchstwertiges zuerst — so will es der Kopf aus RFC 8188. */
function vierByte(n) {
  return new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
}

async function hmac(schluessel, daten) {
  const k = await subtle.importKey('raw', schluessel, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await subtle.sign('HMAC', k, daten));
}

/* HKDF, aber nur der eine Fall, den Web Push braucht: ein einziger Block,
   also höchstens 32 Byte Ausgabe. Mehr verlangt keine der beiden RFC. */
async function hkdf(salz, ikm, info, laenge) {
  const prk = await hmac(salz, ikm);
  const block = await hmac(prk, kette(info, new Uint8Array([1])));
  return block.slice(0, laenge);
}

/* --- Verschlüsseln (RFC 8291) -------------------------------------------- */

/* Ein Punkt auf der Kurve, wie ihn der Browser im Abo liefert: 65 Byte,
   erstes Byte 0x04, dann x und y. Für WebCrypto muss er als JWK herein. */
function punktAlsJwk(punkt, privat) {
  const jwk = {
    kty: 'EC', crv: 'P-256', ext: true,
    x: nachB64u(punkt.slice(1, 33)),
    y: nachB64u(punkt.slice(33, 65))
  };
  if (privat) jwk.d = nachB64u(privat);
  return jwk;
}

async function eigenesPaar() {
  return subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
}

/* Liefert den fertigen Rumpf der Anfrage: Kopf nach RFC 8188 plus
   Geheimtext. Ephemer und salz sind nur für die Prüfung vorgesehen — im
   Betrieb wird beides frisch gewürfelt, und genau das gehört so. */
async function verschluessle(klartext, p256dh, authGeheimnis, ephemer, salz) {
  const empfaenger = ausB64u(p256dh);
  const auth = ausB64u(authGeheimnis);

  const paar = ephemer || await eigenesPaar();
  const meinPunkt = new Uint8Array(await subtle.exportKey('raw', paar.publicKey));
  const salt = salz || webcrypto.getRandomValues(new Uint8Array(16));

  const fremdSchluessel = await subtle.importKey(
    'jwk', punktAlsJwk(empfaenger), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const gemeinsam = new Uint8Array(
    await subtle.deriveBits({ name: 'ECDH', public: fremdSchluessel }, paar.privateKey, 256));

  /* Erst das Geheimnis aus dem Abo hineinrühren, dann erst das Salz. Die
     Reihenfolge ist nicht beliebig: sie bindet den Schlüssel an genau
     dieses Gerät. */
  const ikm = await hkdf(
    auth, gemeinsam,
    kette(roh('WebPush: info'), new Uint8Array([0]), empfaenger, meinPunkt),
    32);

  const cek = await hkdf(salt, ikm, kette(roh('Content-Encoding: aes128gcm'), new Uint8Array([0])), 16);
  const nonce = await hkdf(salt, ikm, kette(roh('Content-Encoding: nonce'), new Uint8Array([0])), 12);

  // 0x02 schliesst den letzten und einzigen Block ab.
  const gefuellt = kette(roh(klartext), new Uint8Array([2]));

  const aesSchluessel = await subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
  const geheim = new Uint8Array(
    await subtle.encrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, aesSchluessel, gefuellt));

  const kopf = kette(salt, vierByte(4096), new Uint8Array([meinPunkt.length]), meinPunkt);
  return kette(kopf, geheim);
}

/* --- Ausweisen (RFC 8292) ------------------------------------------------ */

async function vapidKopf(endpunkt, oeffentlich, privat, absender) {
  const ziel = new URL(endpunkt);
  const nutzlast = {
    aud: `${ziel.protocol}//${ziel.host}`,
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
    sub: absender
  };

  const teil1 = nachB64u(roh(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const teil2 = nachB64u(roh(JSON.stringify(nutzlast)));
  const zuSignieren = roh(`${teil1}.${teil2}`);

  const punkt = ausB64u(oeffentlich);
  const schluessel = await subtle.importKey(
    'jwk', punktAlsJwk(punkt, ausB64u(privat)),
    { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);

  const unterschrift = new Uint8Array(await subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' }, schluessel, zuSignieren));

  return `vapid t=${teil1}.${teil2}.${nachB64u(unterschrift)}, k=${oeffentlich}`;
}

/* --- Senden --------------------------------------------------------------- */

/* Liefert den Status des Push-Dienstes zurück. 404 und 410 heissen: dieses
   Gerät gibt es nicht mehr, das Abo gehört gelöscht. Alles andere ist ein
   Fehler von unserer Seite oder eine Störung dort. */
async function sende(abo, text, schluessel, lebensdauer = 86400) {
  const rumpf = await verschluessle(text, abo.p256dh, abo.auth);
  const antwort = await fetch(abo.endpunkt, {
    method: 'POST',
    headers: {
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(rumpf.length),
      TTL: String(lebensdauer),
      Urgency: 'high',
      Authorization: await vapidKopf(abo.endpunkt, schluessel.oeffentlich, schluessel.privat, schluessel.absender)
    },
    body: rumpf
  });
  return antwort.status;
}

module.exports = { verschluessle, vapidKopf, sende, nachB64u, ausB64u, punktAlsJwk, subtle };
