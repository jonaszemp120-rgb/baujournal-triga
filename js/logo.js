/* Die einzige Logo-Quelle der App.
 *
 * Wer das Logo irgendwo braucht, holt es hier. Es gibt bewusst keine
 * zweite Variante, kein Zeichen allein und keinen Schriftzug allein:
 * das Logo ist immer die ganze Wortbildmarke, nur unterschiedlich gross.
 *
 * Im Markup genügt <div data-logo="34"></div>, die Zahl ist die Höhe in
 * Pixeln. Weil die Datei eng beschnitten ist, entspricht das der Höhe
 * des Zeichens, der Schriftzug daneben skaliert mit.
 *
 * assets/triga-logo.png entsteht aus der Originaldatei
 * assets/triga-logo-master.jpg, siehe tools/build_icons.py. Die einzige
 * Ausnahme sind die App-Icons: dort steht das Zeichen allein, weil ein
 * Schriftzug auf 180 x 180 Pixeln nicht mehr lesbar wäre. Auch die
 * entstehen aus derselben Datei.
 *
 * Der Hintergrund des Bildes ist exakt das Navy der App (#00233f), es
 * fügt sich damit nahtlos in die dunklen Flächen ein.
 */

const LOGO_BILD = 'assets/triga-logo.png';

function logoLockup(hoehe) {
  const h = Number(hoehe) || 28;
  return `<img src="${LOGO_BILD}" alt="TRIGA Baumanagement" style="height:${h}px; width:auto; display:block;">`;
}

/* Jedes <div data-logo="…"> im Dokument bekommt das Logo eingesetzt. */
document.querySelectorAll('[data-logo]').forEach(el => {
  el.innerHTML = logoLockup(el.dataset.logo);
});
