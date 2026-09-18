/* Räumt abgelaufene Feed-Fotos weg.
 *
 * Dieselbe Regel wie im Chat, und darum auch derselbe Ablauf: ein Foto
 * lebt 30 Tage, danach wird die Datei aus dem Storage gelöscht. Der
 * Beitrag bleibt im Feed stehen und sagt an der Stelle, dass es das Foto
 * einmal gab.
 *
 * Läuft täglich über den Cron-Eintrag in vercel.json, eine halbe Stunde
 * nach dem Chat — beide greifen auf dasselbe Storage zu, und nacheinander
 * ist das leichter zu lesen, wenn man später ins Protokoll schaut.
 */

const { raeumeAb } = require('./_bilder.js');

module.exports = (req, res) =>
  raeumeAb(req, res, { tabelle: 'feed_beitraege', bucket: 'feed-bilder' });
