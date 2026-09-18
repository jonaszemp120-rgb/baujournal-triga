/* Räumt abgelaufene Chat-Bilder weg.
 *
 * Ein Bild im Chat lebt 30 Tage. Danach verschwindet es wirklich: die
 * Datei wird aus dem Storage gelöscht, nicht nur ausgeblendet. Der
 * Gesprächsverlauf bleibt vollständig, an der Stelle steht danach der
 * Hinweis, dass es das Bild einmal gab.
 *
 * Der Ablauf selbst steht in api/_bilder.js, weil der Feed denselben
 * braucht. Hier stehen nur die Namen, die den Chat ausmachen.
 *
 * Läuft täglich über den Cron-Eintrag in vercel.json.
 */

const { raeumeAb } = require('./_bilder.js');

module.exports = (req, res) =>
  raeumeAb(req, res, { tabelle: 'nachrichten', bucket: 'chat-bilder' });
