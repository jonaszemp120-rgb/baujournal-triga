/* Export eines Eintrags oder eines Zeitraums als PDF oder Word.
   Alles läuft im Browser, nichts geht an einen Server. jsPDF und docx
   liegen lokal unter vendor/ und werden erst geladen, wenn sie gebraucht
   werden. Der Service Worker legt sie trotzdem vorab in den Cache,
   damit der Export auch ohne Empfang funktioniert. */

const _geladen = {};
function ladeSkript(pfad) {
  if (_geladen[pfad]) return _geladen[pfad];
  _geladen[pfad] = new Promise((ok, fehler) => {
    const s = document.createElement('script');
    s.src = pfad;
    s.onload = ok;
    s.onerror = () => fehler(new Error('Bibliothek nicht verfügbar: ' + pfad));
    document.head.appendChild(s);
  });
  return _geladen[pfad];
}

/* Das Logo ins PDF, dieselbe Datei wie am Bildschirm. Wird einmal
   geladen und als Datenstrom eingebettet. Der Service Worker hat sie im
   Cache, der Export funktioniert deshalb auch ohne Empfang. */
let _logoDaten = null;
async function logoDatenUrl() {
  if (_logoDaten) return _logoDaten;
  const antwort = await fetch(LOGO_BILD);
  if (!antwort.ok) throw new Error('Logo nicht gefunden');
  const blob = await antwort.blob();
  _logoDaten = await new Promise((ok, fehler) => {
    const leser = new FileReader();
    leser.onload = () => ok(leser.result);
    leser.onerror = () => fehler(new Error('Logo nicht lesbar'));
    leser.readAsDataURL(blob);
  });
  return _logoDaten;
}

/* Die eingebaute Helvetica von jsPDF deckt nur WinAnsi ab und
   verschluckt Gedankenstrich und typografische Anfuehrungszeichen.
   Deshalb vor der Ausgabe auf einfache Zeichen abbilden. */
function pdfText(t) {
  return String(t ?? '')
    .replace(/[\u2010-\u2015]/g, '-')
    .replace(/[\u2018\u2019\u201a]/g, "'")
    .replace(/[\u201c\u201d\u201e]/g, '"')
    .replace(/\u2026/g, '...')
    .replace(/\u00a0/g, ' ');
}

function dateiname(projekt, teil) {
  const sauber = String(projekt?.name || 'Projekt')
    .replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_+|_+$/g, '').slice(0, 48);
  return `Baujournal_${sauber}_${teil}`;
}

/* Bereitet einen Eintrag als Abschnittsliste auf, die beide Formate
   gleich verwenden. So bleiben PDF und Word inhaltsgleich. */
function abschnitte(e) {
  const { erfuellt, total } = kontrollStand(e.kontrolle);
  const punkte = e.kontrolle?.punkte || [];
  return [
    { titel: 'Rundgang', zeilen: [
      ['Datum', fmtDatum(e.datum)],
      ...(gebaeudeText(e) ? [['Betrifft', gebaeudeText(e)]] : []),
      ['Bauleiter', e.ersteller_name || '–'],
      ['Erfasst am', e.erstellt_am ? new Date(e.erstellt_am).toLocaleString('de-CH') : '–'],
      ['Wetter', e.wetter || '–'],
      ['Temperatur', e.temperatur || '–']
    ] },
    { titel: `Allgemeine Kontrolle (${erfuellt}/${total})`, liste: punkte.map(p =>
      `${p.ok ? '[x]' : '[ ]'} ${p.label}`) },
    { titel: 'Firmen / Mannschaft vor Ort', text: e.firmen },
    { titel: 'Baufortschritt', text: e.fortschritt },
    { titel: 'Feststellungen / Mängel', text: e.feststellungen },
    { titel: 'Erteilte Anweisungen', text: e.anweisungen },
    { titel: 'Fotos', text: e.fotos_hinweis
        ? 'Fotos wurden gemacht und separat auf dem Server abgelegt.'
        : 'Keine Fotos vermerkt.' }
  ];
}

/* --- PDF ---------------------------------------------------------------- */

async function exportPDF(eintraege, projekt) {
  await ladeSkript('vendor/jspdf-2.5.2.umd.min.js');
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });

  // Ohne Logo lieber ein Dokument ohne Logo als gar keins.
  let logo = null, logoBreite = 0;
  const LOGO_H = 12;
  try {
    logo = await logoDatenUrl();
    const masse = doc.getImageProperties(logo);
    logoBreite = LOGO_H * masse.width / masse.height;
  } catch (e) {
    console.warn('[Baujournal] Logo fürs PDF nicht verfügbar:', e.message);
  }

  const L = 18, R = 192, BREITE = R - L;
  let y = 0;

  const kopf = () => {
    doc.setFillColor(0, 35, 63);
    doc.rect(0, 0, 210, 26, 'F');
    if (logo) doc.addImage(logo, 'PNG', L, (26 - LOGO_H) / 2, logoBreite, LOGO_H);
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold').setFontSize(13);
    doc.text('Baujournal', R, 15, { align: 'right' });
    y = 38;
  };

  const platz = (h) => {
    if (y + h > 280) { doc.addPage(); kopf(); }
  };

  const titel = (t) => {
    platz(14);
    doc.setFont('helvetica', 'bold').setFontSize(9);
    doc.setTextColor(178, 0, 0);
    doc.text(pdfText(t).toUpperCase(), L, y);
    y += 2.5;
    doc.setDrawColor(223, 228, 230).setLineWidth(0.3);
    doc.line(L, y, R, y);
    y += 5;
  };

  const absatz = (text) => {
    doc.setFont('helvetica', 'normal').setFontSize(10);
    doc.setTextColor(18, 24, 27);
    for (const zeile of doc.splitTextToSize(pdfText(text), BREITE)) {
      platz(6);
      doc.text(zeile, L, y);
      y += 5;
    }
  };

  kopf();

  doc.setFont('helvetica', 'bold').setFontSize(16);
  doc.setTextColor(0, 35, 63);
  doc.text(doc.splitTextToSize(pdfText(projekt?.name || 'Projekt'), BREITE), L, y);
  y += 7 * doc.splitTextToSize(pdfText(projekt?.name || 'Projekt'), BREITE).length;

  doc.setFont('helvetica', 'normal').setFontSize(9.5);
  doc.setTextColor(92, 106, 112);
  for (const z of [
    [projekt?.standort, projekt?.parzelle && `Parzelle ${projekt.parzelle}`].filter(Boolean).join(' · '),
    [projekt?.bauherrschaft && `Bauherrschaft: ${projekt.bauherrschaft}`,
     projekt?.projekt_nr && `Projekt-Nr. ${projekt.projekt_nr}`].filter(Boolean).join(' · ')
  ].filter(Boolean)) { doc.text(pdfText(z), L, y); y += 5; }
  y += 5;

  eintraege.forEach((e, idx) => {
    if (idx > 0) { doc.addPage(); kopf(); }
    doc.setFillColor(238, 241, 242);
    platz(12);
    doc.roundedRect(L, y - 5.5, BREITE, 10, 1.5, 1.5, 'F');
    doc.setFont('helvetica', 'bold').setFontSize(11);
    doc.setTextColor(0, 35, 63);
    doc.text(pdfText(`Rundgang vom ${fmtDatum(e.datum)}`), L + 3, y + 1);
    y += 11;

    for (const a of abschnitte(e)) {
      if (a.zeilen) {
        titel(a.titel);
        for (const [k, v] of a.zeilen) {
          platz(6);
          doc.setFont('helvetica', 'bold').setFontSize(9.5).setTextColor(92, 106, 112);
          doc.text(pdfText(k), L, y);
          doc.setFont('helvetica', 'normal').setFontSize(10).setTextColor(18, 24, 27);
          doc.text(pdfText(v), L + 34, y);
          y += 5.5;
        }
        y += 3;
      } else if (a.liste) {
        titel(a.titel);
        for (const z of a.liste) { absatz(z); }
        y += 3;
      } else {
        titel(a.titel);
        absatz(a.text && String(a.text).trim() ? a.text : '–');
        y += 3;
      }
    }
  });

  const seiten = doc.internal.getNumberOfPages();
  for (let i = 1; i <= seiten; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal').setFontSize(8);
    doc.setTextColor(140, 152, 158);
    doc.text(`Seite ${i} von ${seiten}`, R, 288, { align: 'right' });
    doc.text(`Erstellt am ${new Date().toLocaleDateString('de-CH')}`, L, 288);
  }

  const teil = eintraege.length === 1
    ? String(eintraege[0].datum)
    : `${eintraege[eintraege.length - 1].datum}_bis_${eintraege[0].datum}`;
  doc.save(`${dateiname(projekt, teil)}.pdf`);
}

/* --- Word --------------------------------------------------------------- */

async function exportWord(eintraege, projekt) {
  await ladeSkript('vendor/docx-9.5.1.iife.js');
  const D = window.docx;
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, BorderStyle } = D;

  const NAVY = '00233F', ROT = 'B20000', GRAU = '5C6A70';

  const ueberschrift = t => new Paragraph({
    spacing: { before: 260, after: 90 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'DFE4E6' } },
    children: [new TextRun({ text: t.toUpperCase(), bold: true, size: 18, color: ROT, characterSpacing: 24 })]
  });

  const text = t => new Paragraph({
    spacing: { after: 60 },
    children: [new TextRun({ text: String(t ?? '–'), size: 21, color: '12181B' })]
  });

  const paar = (k, v) => new Paragraph({
    spacing: { after: 40 },
    children: [
      new TextRun({ text: `${k}: `, bold: true, size: 20, color: GRAU }),
      new TextRun({ text: String(v ?? '–'), size: 21, color: '12181B' })
    ]
  });

  const inhalt = [
    new Paragraph({
      spacing: { after: 40 },
      children: [new TextRun({ text: 'TRIGA Baumanagement AG', bold: true, size: 20, color: NAVY, characterSpacing: 30 })]
    }),
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      spacing: { after: 60 },
      children: [new TextRun({ text: 'Baujournal', bold: true, size: 36, color: NAVY })]
    }),
    new Paragraph({
      spacing: { after: 40 },
      children: [new TextRun({ text: projekt?.name || 'Projekt', bold: true, size: 26, color: '12181B' })]
    }),
    new Paragraph({
      spacing: { after: 240 },
      children: [new TextRun({
        text: [projekt?.standort, projekt?.bauherrschaft && `Bauherrschaft: ${projekt.bauherrschaft}`,
               projekt?.parzelle && `Parzelle ${projekt.parzelle}`,
               projekt?.projekt_nr && `Projekt-Nr. ${projekt.projekt_nr}`].filter(Boolean).join(' · ') || ' ',
        size: 19, color: GRAU })]
    })
  ];

  eintraege.forEach((e, idx) => {
    inhalt.push(new Paragraph({
      pageBreakBefore: idx > 0,
      spacing: { before: idx > 0 ? 0 : 120, after: 60 },
      children: [new TextRun({ text: `Rundgang vom ${fmtDatum(e.datum)}`, bold: true, size: 24, color: NAVY })]
    }));
    for (const a of abschnitte(e)) {
      inhalt.push(ueberschrift(a.titel));
      if (a.zeilen) a.zeilen.forEach(([k, v]) => inhalt.push(paar(k, v)));
      else if (a.liste) a.liste.forEach(z => inhalt.push(text(z)));
      else inhalt.push(text(a.text && String(a.text).trim() ? a.text : '–'));
    }
  });

  inhalt.push(new Paragraph({
    spacing: { before: 320 },
    alignment: AlignmentType.RIGHT,
    children: [new TextRun({
      text: `Erstellt am ${new Date().toLocaleDateString('de-CH')} · TRIGA Baumanagement AG`,
      size: 16, color: '8C989E' })]
  }));

  const doc = new Document({ sections: [{ children: inhalt }] });
  const blob = await Packer.toBlob(doc);

  const teil = eintraege.length === 1
    ? String(eintraege[0].datum)
    : `${eintraege[eintraege.length - 1].datum}_bis_${eintraege[0].datum}`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${dateiname(projekt, teil)}.docx`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
