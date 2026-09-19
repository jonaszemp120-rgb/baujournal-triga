/* Ein winziges, gültiges PDF mit lesbarem Text.
 *
 * Gebraucht wird es von der Dokumente-Suite: die Volltextsuche zieht den
 * Text mit pdf.js aus der Datei, und dafür muss wirklich Text drinstehen.
 * Ein paar Bytes "%PDF" und ein Kommentar, wie es die Suite bisher
 * benutzte, reichen dafür nicht — da ist nichts zu lesen.
 *
 * Kein Werkzeug von aussen, kein npm: das Projekt hat bewusst keine
 * package.json. Ein PDF dieser Grösse ist ein paar Objekte und eine
 * Verweistabelle, und die lässt sich hier ausrechnen.
 */

/* Klammern und Backslash sind in einer PDF-Zeichenkette Steuerzeichen.
   Umlaute schreiben wir gar nicht erst: die Standardschrift Helvetica
   liegt in WinAnsi, und die Suite braucht nur lateinische Buchstaben. */
const str = s => String(s).replace(/([\\()])/g, '\\$1');

export function pdfMitText(zeilen) {
  const inhalt = 'BT /F1 14 Tf 72 780 Td 18 TL\n'
    + zeilen.map(z => `(${str(z)}) Tj T*`).join('\n')
    + '\nET\n';

  const objekte = [
    '<</Type/Catalog/Pages 2 0 R>>',
    '<</Type/Pages/Kids[3 0 R]/Count 1>>',
    '<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]'
      + '/Resources<</Font<</F1 5 0 R>>>>/Contents 4 0 R>>',
    `<</Length ${Buffer.byteLength(inhalt, 'latin1')}>>\nstream\n${inhalt}endstream`,
    '<</Type/Font/Subtype/Type1/BaseFont/Helvetica/Encoding/WinAnsiEncoding>>'
  ];

  let roh = '%PDF-1.4\n';
  const stellen = [];
  objekte.forEach((o, i) => {
    stellen.push(Buffer.byteLength(roh, 'latin1'));
    roh += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });

  /* Die Verweistabelle: je Objekt zehn Stellen Versatz, fünf Stellen
     Ausgabe, dann n oder f. Das Format ist auf das Byte genau
     vorgeschrieben, deshalb padStart. */
  const xref = Buffer.byteLength(roh, 'latin1');
  roh += `xref\n0 ${objekte.length + 1}\n0000000000 65535 f \n`
    + stellen.map(s => `${String(s).padStart(10, '0')} 00000 n \n`).join('')
    + `trailer\n<</Size ${objekte.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF\n`;

  return Buffer.from(roh, 'latin1');
}
