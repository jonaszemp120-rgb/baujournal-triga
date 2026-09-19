/* Bereich Chat.
 *
 * Rein intern, nur für die Leute aus dem Adressbuch. Ein Einzelchat wird
 * nicht angelegt, er entsteht: beim ersten Öffnen eines Gesprächs mit
 * jemandem. Gruppen legt man bewusst an, mit Namen und Mitgliedern.
 *
 * Der Ungelesen-Zähler steht nirgends als Zahl. Er ist die Anzahl
 * Nachrichten nach chat_mitglieder.zuletzt_gelesen — eine gepflegte Zahl
 * daneben würde beim ersten verlorenen Update abweichen und niemand
 * merkte es.
 *
 * Ändern lässt sich eine Nachricht nicht, löschen schon. Ein ganzes
 * Gespräch verschwindet für alle, eine einzelne Nachricht nur bei der
 * Person, die sie geschrieben hat — und hinterlässt einen Platzhalter
 * statt einer Lücke im Verlauf. Was erlaubt ist, entscheidet die
 * Datenbank; hier wird es nur bedienbar gemacht.
 *
 * Die Lesebestätigung rechnet sich aus chat_mitglieder.zuletzt_gelesen,
 * derselben Angabe, die schon den Ungelesen-Zähler trägt. Ein zweiter
 * Vermerk pro Nachricht wäre ein zweiter Ort für dieselbe Wahrheit.
 */

(() => {
  const EMOJI = [
    '👍','👌','🙏','💪','👏','🙌','🤝','✌️',
    '😀','😅','😂','🙂','😉','😍','🤔','😴',
    '😐','😕','😮','😢','😡','🤯','🥳','🤷',
    '✅','❌','⚠️','❗','❓','⏰','📅','📍',
    '🏗️','🚧','🔨','🪜','🧱','📐','🚜','🏠',
    '☀️','🌧️','❄️','💨','🔥','💧','📸','📄'
  ];

  const IKON = {
    zurueck: '<path d="M19 12H5"/><path d="m12 19-7-7 7-7"/>',
    mehr: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
    gruppe: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    uhr: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    haken: '<path d="M20 6 9 17l-5-5"/>',
    eimer: '<path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
    einHaken: '<path d="M4 12.5 9 17.5 20 6.5"/>',
    zweiHaken: '<path d="M1 12.5 6 17.5 17 6.5"/><path d="M8 12.5 11 15.5 22 4.5"/>',
    stumm: '<path d="M11 5 6 9H2v6h4l5 4z"/><path d="m23 9-6 6"/><path d="m17 9 6 6"/>',
    laut: '<path d="M11 5 6 9H2v6h4l5 4z"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>',
    sichern: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
    lupe: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
    raster: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    blase: '<path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9 9 0 0 1-3.8-.9L3 21l2-4.9A8.4 8.4 0 0 1 12 3a8.4 8.4 0 0 1 9 8.5z"/>'
  };
  const svg = (d, g = 16) => `<svg viewBox="0 0 24 24" width="${g}" height="${g}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;

  const breit = () => matchMedia('(min-width:1024px)').matches;

  /* Die fünf Reaktionen. Dieselben wie in der Prüfregel der Datenbank —
     steht hier eine sechste, weist die Datenbank sie ab, und das ist die
     richtige Reihenfolge: die Regel gehört dorthin, die Knöpfe hierhin. */
  const REAKTIONEN = ['👍', '❤️', '✅', '😂', '❗'];

  let ich = null;              // auth.users.id
  let leute = [];              // alle Mitarbeitenden mit Konto
  let chats = [];              // { id, art, name, erstellt_von, mitglieder[], admins[], letzte, ungelesen, zuletzt_gelesen }
  let offen = null;            // der gerade gezeigte Chat
  let nachrichten = [];
  let kanal = null;            // Echtzeit für das offene Gespräch
  let kanalListe = null;       // Echtzeit für die Liste

  /* Reaktionen des offenen Gesprächs, nach Nachricht gebündelt. Roh als
     Zeilen und nicht als fertige Zahl: der Zähler ist ihre Anzahl, und
     wer reagiert hat, steht als Name im Titel. Eine gepflegte Zahl
     daneben wiche beim ersten verlorenen Update ab. */
  let reaktionen = {};         // nachricht_id -> [{ user_id, emoji }]

  /* Welcher der drei Ausschnitte gerade gezeigt wird: der Verlauf, die
     Medien oder die Suche. Die Nachrichten bleiben dieselben, nur der
     Blick darauf ändert sich — deshalb ein Zustand und nicht drei
     Seiten. */
  let blick = 'verlauf';
  let suchbegriff = '';

  /* Die eigenen Einstellungen zum offenen Gespräch. Sie stehen an der
     Mitgliedszeile, nicht am Chat: stumm stellt jede Person für sich. */
  let meineZeile = { stumm: false, fotos_sichern: false };

  /* Fotos, die seit dem letzten Sichern eingetroffen sind. Nur im
     Arbeitsspeicher: was gesichert wurde, weiss allein das Gerät, und
     das gehört niemandem sonst. */
  let zuSichern = [];
  /* Wann hat wer zuletzt gelesen. Die Lesebestätigung rechnet sich daraus
     aus, nicht aus einem Vermerk pro Nachricht — dieselbe Angabe, die
     schon den Ungelesen-Zähler trägt. Ein zweiter Ort dafür würde früher
     oder später abweichen. */
  let lesestand = {};          // user_id -> zuletzt_gelesen (ISO)

  const nameVon = u => leute.find(l => l.user_id === u)?.name || 'Unbekannt';

  /* Erwähnungen: genau dasselbe Werkzeug wie im Feed, aus js/app.js. Kein
     zweiter Nachbau — sonst bekommt der eine Bereich irgendwann die Regel
     für umbenannte Personen und der andere nicht.
     Die Klassen heissen hier anders, weil eine Erwähnung in einer roten
     Blase anders aussehen muss als auf weissem Grund. Die Logik dahinter
     ist dieselbe. */
  const erw = macheErwaehnungen({
    leute: () => leute,
    ich: () => ich,
    marke: 'ch-erwaehnt',
    liste: 'fd-erwaehnliste',
    avatar: 'fd-avatar'
  });

  /* Bin ich in diesem Text gemeint? Danach richtet sich, ob die Nachricht
     hervorgehoben dasteht — und in api/push.js, ob die Meldung auch durch
     eine Stummschaltung kommt. */
  const meintMich = text => erwaehnungenAus(text).includes(String(ich).toLowerCase());

  /* Der Schlüssel für die gemerkten Erwähnungen. Es gibt nur ein
     Eingabefeld im Chat, also genügt ein fester Name. */
  const FELD = 'chat';

  /* --- Daten ---------------------------------------------------------------- */

  async function ladeLeute() {
    const { data, error } = await sb.from('mitarbeiter')
      .select('id, user_id, name, rolle')
      .not('user_id', 'is', null)
      .is('geloescht_am', null)
      .order('name');
    if (meckern('Team laden', error)) return [];
    return data || [];
  }

  /* Alles, was die Liste braucht, in vier Abfragen statt in einer pro Chat.
     Die Nachrichten werden dabei begrenzt: für Vorschau und Zähler reicht
     der jüngste Stapel, und ein Team von zehn Leuten kommt damit weit. */
  async function ladeChats() {
    const { data: meine, error: e1 } = await sb.from('chat_mitglieder')
      .select('chat_id, zuletzt_gelesen').eq('user_id', ich);
    if (meckern('Gespräche laden', e1)) return [];
    const ids = (meine || []).map(m => m.chat_id);
    if (!ids.length) return [];

    const [{ data: koepfe }, { data: alleMitglieder }, { data: letzte }] = await Promise.all([
      sb.from('chats').select('id, art, name, erstellt_von, erstellt_am').in('id', ids),
      sb.from('chat_mitglieder').select('chat_id, user_id, admin, stumm').in('chat_id', ids),
      sb.from('nachrichten')
        .select('id, chat_id, absender, text, bild_pfad, bild_ablauf, erstellt_am, geloescht_am')
        .in('chat_id', ids).order('erstellt_am', { ascending: false }).limit(500)
    ]);

    const gelesen = Object.fromEntries((meine || []).map(m => [m.chat_id, m.zuletzt_gelesen]));

    return (koepfe || []).map(c => {
      const zeilen = (alleMitglieder || []).filter(m => m.chat_id === c.id);
      const mit = zeilen.map(m => m.user_id);
      const eigene = (letzte || []).filter(n => n.chat_id === c.id);
      return {
        ...c,
        mitglieder: mit,
        admins: zeilen.filter(m => m.admin).map(m => m.user_id),
        stumm: !!zeilen.find(m => m.user_id === ich)?.stumm,
        zuletzt_gelesen: gelesen[c.id],
        letzte: eigene[0] || null,
        ungelesen: eigene.filter(n =>
          n.absender !== ich && new Date(n.erstellt_am) > new Date(gelesen[c.id])).length
      };
    }).sort((a, b) =>
      new Date(b.letzte?.erstellt_am || b.erstellt_am) - new Date(a.letzte?.erstellt_am || a.erstellt_am));
  }

  /* --- Namen und Zeiten ------------------------------------------------------ */

  function chatName(c) {
    if (c.art === 'gruppe') return c.name;
    const andere = c.mitglieder.find(u => u !== ich);
    return andere ? nameVon(andere) : 'Nur Sie';
  }

  function chatZeichen(c) {
    if (c.art === 'gruppe') return { klasse: 'gruppe', inhalt: svg(IKON.gruppe, 20) };
    const andere = c.mitglieder.find(u => u !== ich);
    return { klasse: 'person', inhalt: esc(initialen(nameVon(andere))) };
  }

  /* Heute die Uhrzeit, gestern "Gestern", diese Woche der Wochentag, sonst
     das Datum. Genau so steht es in der Design-Referenz. */
  function kurzeZeit(iso) {
    if (!iso) return '';
    const d = new Date(iso), jetzt = new Date();
    const tag = x => new Date(x.getFullYear(), x.getMonth(), x.getDate());
    const tage = Math.round((tag(jetzt) - tag(d)) / 86400000);
    if (tage === 0) return d.toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' });
    if (tage === 1) return 'Gestern';
    if (tage < 7) return d.toLocaleDateString('de-CH', { weekday: 'short' });
    return d.toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit' });
  }

  const tagesTitel = iso => {
    const d = new Date(iso), jetzt = new Date();
    const tag = x => new Date(x.getFullYear(), x.getMonth(), x.getDate());
    const tage = Math.round((tag(jetzt) - tag(d)) / 86400000);
    if (tage === 0) return 'Heute';
    if (tage === 1) return 'Gestern';
    return d.toLocaleDateString('de-CH', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
  };

  function vorschau(n) {
    if (!n) return 'Noch keine Nachricht';
    const wer = n.absender === ich ? 'Sie' : nameVon(n.absender).split(' ')[0];
    const was = n.geloescht_am ? 'Nachricht gelöscht' : (n.text ? n.text : 'Foto gesendet');
    return `${wer}: ${was}`;
  }

  /* Die Uhrzeit steht an jeder Nachricht. Bei allem, was nicht von heute
     ist, zusätzlich der Tag — der Trenner darüber gilt zwar für den ganzen
     Block, aber wer eine einzelne Zeile herauspickt, soll nicht scrollen
     müssen, um zu wissen, wann sie kam. */
  function nachrichtZeit(iso) {
    const d = new Date(iso), jetzt = new Date();
    const tag = x => new Date(x.getFullYear(), x.getMonth(), x.getDate());
    const uhr = d.toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' });
    if (tag(jetzt).getTime() === tag(d).getTime()) return uhr;
    return `${d.toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit' })}, ${uhr}`;
  }

  /* Ein Haken heisst: in der Datenbank angekommen. Zwei heissen: von allen
     anderen gelesen. In der Gruppe reicht es nicht, dass eine Person
     hineingeschaut hat — sonst hiesse "gelesen" bei zwei Leuten etwas
     anderes als bei fünf. */
  function istGelesen(n) {
    if (!offen) return false;
    const andere = offen.mitglieder.filter(u => u !== ich);
    if (!andere.length) return false;
    const gesendet = new Date(n.erstellt_am);
    return andere.every(u => lesestand[u] && new Date(lesestand[u]) >= gesendet);
  }

  /* --- Reaktionen ------------------------------------------------------------ */

  async function ladeReaktionen() {
    reaktionen = {};
    const ids = nachrichten.map(n => n.id);
    if (!ids.length) return;
    const { data, error } = await sb.from('nachrichten_reaktionen')
      .select('nachricht_id, user_id, emoji').in('nachricht_id', ids);
    if (meckern('Reaktionen laden', error)) return;
    for (const r of data || []) (reaktionen[r.nachricht_id] ||= []).push(r);
  }

  const meineReaktion = (id, emoji) =>
    (reaktionen[id] || []).some(r => r.user_id === ich && r.emoji === emoji);

  /* Die Zeile unter der Blase: je Emoji ein Knopf mit der Anzahl. Wer
     selbst dabei ist, sieht seinen Knopf hervorgehoben — und ein Tipp
     darauf nimmt die eigene Reaktion zurück. Der Titel nennt die Namen,
     damit in einer Gruppe nachvollziehbar bleibt, wer zugestimmt hat. */
  function reaktionsZeile(n) {
    const alle = reaktionen[n.id] || [];
    if (!alle.length) return '';
    const nach = {};
    for (const r of alle) (nach[r.emoji] ||= []).push(r.user_id);

    /* In der Reihenfolge der Auswahl und nicht nach Anzahl: eine Zeile,
       die bei jeder neuen Reaktion die Plätze tauscht, ist unruhig und
       man tippt daneben. */
    return `<span class="ch-reaktionen">${REAKTIONEN.filter(e => nach[e]).map(e => {
      const wer = nach[e].map(u => u === ich ? 'Sie' : nameVon(u)).join(', ');
      return `<button type="button" class="ch-reaktion${meineReaktion(n.id, e) ? ' meine' : ''}"
                      data-reagiere="${esc(n.id)}" data-emoji="${esc(e)}"
                      title="${esc(wer)}" aria-label="${esc(`${e} von ${wer}`)}"
                      aria-pressed="${meineReaktion(n.id, e)}">${e}<span>${nach[e].length}</span></button>`;
    }).join('')}</span>`;
  }

  /* Setzen und Zurücknehmen sind derselbe Tipp: entweder steht die eigene
     Reaktion schon da, dann geht sie weg, oder sie kommt dazu. Zwei
     Knöpfe dafür wären einer zu viel.

     Die Oberfläche geht dabei voraus und wartet nicht auf die Datenbank —
     ein Daumen, der eine halbe Sekunde später erscheint, fühlt sich
     kaputt an. Geht es schief, wird zurückgenommen, was zu früh dastand. */
  async function reagiere(nachrichtId, emoji) {
    if (!istOnline()) return toast('Reaktionen brauchen eine Verbindung', true);
    const hatte = meineReaktion(nachrichtId, emoji);
    const liste = (reaktionen[nachrichtId] ||= []);

    if (hatte) liste.splice(liste.findIndex(r => r.user_id === ich && r.emoji === emoji), 1);
    else liste.push({ nachricht_id: nachrichtId, user_id: ich, emoji });
    await zeichneVerlauf();

    const { error } = hatte
      ? await sb.from('nachrichten_reaktionen').delete()
          .eq('nachricht_id', nachrichtId).eq('user_id', ich).eq('emoji', emoji)
      : await sb.from('nachrichten_reaktionen')
          .insert({ nachricht_id: nachrichtId, user_id: ich, emoji });

    if (error) {
      await ladeReaktionen();
      await zeichneVerlauf();
      toast(error.message, true);
    }
  }

  /* Die Auswahl beim langen Drücken. Fünf Zeichen, gross genug für einen
     Daumen — auf einer Baustelle mit Handschuhen zielt niemand auf
     zwanzig Pixel. Was schon gesetzt ist, steht hervorgehoben da und ein
     Tipp nimmt es zurück. */
  function reaktionWaehlen(nachrichtId) {
    const n = nachrichten.find(x => x.id === nachrichtId);
    if (!n || n.geloescht_am) return;
    const s = sheet(`
      <div style="font-size:15px; font-weight:800; color:var(--navy); margin-bottom:12px;">Reagieren</div>
      <div class="ch-reaktionswahl">
        ${REAKTIONEN.map(e => `
          <button type="button" data-waehle="${esc(e)}"
                  class="${meineReaktion(nachrichtId, e) ? 'meine' : ''}"
                  aria-pressed="${meineReaktion(nachrichtId, e)}"
                  aria-label="${esc(e)}">${e}</button>`).join('')}
      </div>
    `);
    $$('[data-waehle]', s.el).forEach(el => el.addEventListener('click', async () => {
      s.schliessen();
      await reagiere(nachrichtId, el.dataset.waehle);
    }));
  }

  /* Antippen und Halten, beides auf derselben Blase. Auf dem Desktop
     genügt der Rechtsklick, auf dem Handy das lange Drücken — und damit
     ein Wischen durch den Verlauf nicht versehentlich eine Auswahl
     aufklappt, zählt nur, wer den Finger ruhig hält. */
  const HALTEN_MS = 450;
  function haltenBinden(el, nachrichtId) {
    let uhr = null, gewandert = false, start = null;

    const los = e => {
      gewandert = false;
      const p = e.touches?.[0] || e;
      start = { x: p.clientX, y: p.clientY };
      uhr = setTimeout(() => {
        uhr = null;
        if (gewandert) return;
        /* Ohne das bliebe nach dem Aufklappen der Finger als Auswahl im
           Text stehen. */
        getSelection()?.removeAllRanges();
        reaktionWaehlen(nachrichtId);
      }, HALTEN_MS);
    };
    const bewegt = e => {
      if (!start) return;
      const p = e.touches?.[0] || e;
      if (Math.abs(p.clientX - start.x) > 10 || Math.abs(p.clientY - start.y) > 10) {
        gewandert = true;
        clearTimeout(uhr);
        uhr = null;
      }
    };
    const stopp = () => { clearTimeout(uhr); uhr = null; start = null; };

    el.addEventListener('pointerdown', los);
    el.addEventListener('pointermove', bewegt);
    el.addEventListener('pointerup', stopp);
    el.addEventListener('pointercancel', stopp);
    el.addEventListener('pointerleave', stopp);
    el.addEventListener('contextmenu', e => { e.preventDefault(); reaktionWaehlen(nachrichtId); });
  }

  /* Die Fusszeile einer Nachricht: Zeit, bei eigenen dazu die Haken und
     der Weg zum Löschen. */
  function fuss(n, meine) {
    const haken = meine && !n.geloescht_am
      ? (istGelesen(n)
          ? `<span class="haken gelesen" role="img" aria-label="Gelesen">${svg(IKON.zweiHaken, 15)}</span>`
          : `<span class="haken" role="img" aria-label="Gesendet">${svg(IKON.einHaken, 15)}</span>`)
      : '';
    const weg = meine && !n.geloescht_am
      ? `<button type="button" class="ch-weg" data-loeschen="${esc(n.id)}" aria-label="Nachricht löschen">${svg(IKON.eimer, 13)}</button>`
      : '';
    return `<span class="ch-fuss"><span class="wann">${esc(nachrichtZeit(n.erstellt_am))}</span>${haken}${weg}</span>`;
  }

  /* --- Die Liste ------------------------------------------------------------- */

  function zeichneListe() {
    const q = ($('#suche').value || '').trim().toLowerCase();
    const sichtbar = chats.filter(c => !q || chatName(c).toLowerCase().includes(q));

    if (!sichtbar.length) {
      $('#gespraeche').innerHTML = `<div class="br-leer" style="margin:10px;">${
        q ? 'Kein Gespräch gefunden.' : 'Noch kein Gespräch.<br>Oben mit dem Plus eines beginnen.'}</div>`;
      return;
    }

    $('#gespraeche').innerHTML = sichtbar.map(c => {
      const z = chatZeichen(c);
      return `
      <button type="button" class="ch-zeile pressable" data-chat="${esc(c.id)}"
              aria-current="${c.id === offen?.id}">
        <span class="bild ${z.klasse}">${z.inhalt}</span>
        <span class="mitte">
          <span class="name">${esc(chatName(c))}</span>
          <span class="vorschau">${esc(vorschau(c.letzte))}</span>
        </span>
        <span class="rechts">
          <span class="wann">${esc(kurzeZeit(c.letzte?.erstellt_am))}</span>
          ${c.stumm ? `<span class="ch-stummzeichen" role="img" aria-label="Stumm gestellt">${svg(IKON.stumm, 14)}</span>` : ''}
          ${c.ungelesen ? `<span class="zaehler" aria-label="${c.ungelesen} ungelesen">${c.ungelesen}</span>` : ''}
        </span>
      </button>`;
    }).join('');

    $$('#gespraeche .ch-zeile').forEach(el =>
      el.addEventListener('click', () => oeffne(el.dataset.chat)));
  }

  /* --- Das Gespräch ---------------------------------------------------------- */

  function zeichneKopf() {
    const kopf = $('#g-kopf');
    if (!offen) { kopf.hidden = true; return; }
    kopf.hidden = false;
    const z = chatZeichen(offen);
    const wer = offen.art === 'gruppe'
      ? offen.mitglieder.map(u => nameVon(u).split(' ')[0]).join(', ')
      : (leute.find(l => l.user_id === offen.mitglieder.find(u => u !== ich))?.rolle || '');

    kopf.innerHTML = `
      <button type="button" id="g-zurueck" class="br-knopf pressable nur-mobil" aria-label="Zurück zur Liste">${svg(IKON.zurueck, 18)}</button>
      <span class="bild ${z.klasse}">${z.inhalt}</span>
      <span style="flex:1; min-width:0;">
        <span class="titel">${esc(chatName(offen))}</span>
        <span class="wer">${esc(wer)}</span>
      </span>
      <button type="button" id="g-mehr" class="br-knopf pressable" aria-label="${offen.art === 'gruppe' ? 'Gruppe verwalten' : 'Gespräch verwalten'}">${svg(IKON.mehr, 18)}</button>`;

    $('#g-zurueck')?.addEventListener('click', () => zeigeListe());
    $('#g-mehr')?.addEventListener('click', gespraechMenue);
  }

  async function zeichneVerlauf() {
    const v = $('#verlauf');
    if (!offen) {
      v.innerHTML = `<div class="br-leer" style="margin:auto;">Links ein Gespräch auswählen.</div>`;
      zeichneReiter();
      return;
    }
    zeichneReiter();
    if (blick === 'medien') return zeichneMedien();
    if (blick === 'suche') return zeichneSuche();

    if (!nachrichten.length) {
      v.innerHTML = `<div class="br-leer" style="margin:auto;">Noch keine Nachricht. Schreiben Sie die erste.</div>`;
      return;
    }

    let letzterTag = '';
    let letzterAbsender = '';
    const teile = [sicherBanner()];

    for (const n of nachrichten) {
      const tag = tagesTitel(n.erstellt_am);
      if (tag !== letzterTag) {
        teile.push(`<div class="ch-tag">${esc(tag)}</div>`);
        letzterTag = tag;
        letzterAbsender = '';
      }
      const meine = n.absender === ich;
      // Den Namen nur beim Wechsel, und nur in Gruppen. In einem Einzelchat
      // weiss man, wer schreibt.
      if (!meine && offen.art === 'gruppe' && n.absender !== letzterAbsender) {
        teile.push(`<div class="ch-absender">${esc(nameVon(n.absender))}</div>`);
      }
      letzterAbsender = n.absender;

      if (n.geloescht_am) {
        teile.push(`<div class="ch-blase geloescht ${meine ? 'ich' : 'andere'}" id="n-${esc(n.id)}"><span class="wort">Nachricht gelöscht</span>${fuss(n, meine)}</div>`);
        continue;
      }
      if (n.bild_ablauf) teile.push(bildBlase(n, meine));
      if (n.text) {
        /* Wer selbst gemeint ist, soll es sehen, ohne zu lesen. Deshalb
           ein eigener Rand an der Blase und nicht nur die Hervorhebung
           des Namens im Text — in einer Gruppe mit vierzig Nachrichten
           scrollt sonst niemand bis dorthin. */
        const anMich = !meine && meintMich(n.text);
        teile.push(`
          <div class="ch-blase ${meine ? 'ich' : 'andere'}${anMich ? ' anMich' : ''}" id="n-${esc(n.id)}"
               data-halten="${esc(n.id)}">
            <span class="wort">${erw.mitErwaehnungen(n.text)}</span>
            ${fuss(n, meine)}${reaktionsZeile(n)}
          </div>`);
      }
    }

    v.innerHTML = teile.join('');
    v.classList.remove('medien');
    $$('#verlauf [data-loeschen]').forEach(el => el.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      nachrichtLoeschen(el.dataset.loeschen);
    }));
    $$('#verlauf [data-reagiere]').forEach(el => el.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      reagiere(el.dataset.reagiere, el.dataset.emoji);
    }));
    $$('#verlauf [data-halten]').forEach(el => haltenBinden(el, el.dataset.halten));
    $('#verlauf [data-sichern-jetzt]')?.addEventListener('click', () => sichereStapel());
    await bilderNachladen();
    if (!zielNachricht) v.scrollTop = v.scrollHeight;
    springeHin();
  }

  /* --- Die drei Blicke --------------------------------------------------------- */

  /* Verlauf, Medien und Suche sind derselbe Bestand, nur anders
     angesehen. Die Reiter stehen deshalb im Gespräch und nicht in der
     Hauptnavigation: sie wechseln den Blick, nicht den Ort. */
  function zeichneReiter() {
    const el = $('#g-reiter');
    if (!el) return;
    if (!offen) { el.hidden = true; return; }
    el.hidden = false;
    const wahl = [
      ['verlauf', 'Verlauf', IKON.blase],
      ['medien', 'Medien', IKON.raster],
      ['suche', 'Suchen', IKON.lupe]
    ];
    el.innerHTML = wahl.map(([wert, titel, ikon]) => `
      <button type="button" class="pressable" data-blick="${wert}"
              aria-pressed="${blick === wert}">${svg(ikon, 15)}<span>${titel}</span></button>`).join('');
    $$('[data-blick]', el).forEach(b => b.addEventListener('click', async () => {
      blick = b.dataset.blick;
      await zeichneVerlauf();
      if (blick === 'suche') $('#ch-suchfeld')?.focus();
    }));
  }

  /* Alle Bilder des Gesprächs als Raster, neueste zuerst. Ein Tipp führt
     zur Nachricht, in der es steht — ein Foto ohne seinen Zusammenhang
     ist auf einer Baustelle oft wertlos. */
  let zielNachricht = null;

  async function zeichneMedien() {
    const v = $('#verlauf');
    const bilder = nachrichten
      .filter(n => n.bild_ablauf && !n.geloescht_am)
      .sort((a, b) => new Date(b.erstellt_am) - new Date(a.erstellt_am));

    if (!bilder.length) {
      v.classList.remove('medien');
      v.innerHTML = `<div class="br-leer" style="margin:auto;">In diesem Gespräch wurde noch kein Foto geschickt.</div>`;
      return;
    }

    v.classList.add('medien');
    v.innerHTML = `
      <div class="ch-medienkopf">
        <span>${bilder.length} ${bilder.length === 1 ? 'Foto' : 'Fotos'}</span>
        <button type="button" class="pressable" data-alle-sichern>${svg(IKON.sichern, 14)} Alle sichern</button>
      </div>
      <div class="ch-raster">
        ${bilder.map(n => `
          <button type="button" class="ch-kachel pressable" data-hin="${esc(n.id)}"
                  data-pfad="${esc(n.bild_pfad || '')}"
                  aria-label="${esc(`Foto von ${nameVon(n.absender)}, ${nachrichtZeit(n.erstellt_am)}`)}">
            <span class="platzhalter">${n.bild_pfad ? '' : 'nicht mehr verfügbar'}</span>
            <span class="wann">${esc(kurzeZeit(n.erstellt_am))}</span>
          </button>`).join('')}
      </div>`;

    $$('#verlauf [data-hin]').forEach(el => el.addEventListener('click', async () => {
      zielNachricht = el.dataset.hin;
      blick = 'verlauf';
      await zeichneVerlauf();
    }));
    $('#verlauf [data-alle-sichern]')?.addEventListener('click', () => sichereAlle());
    await bilderNachladen();
  }

  /* Nach dem Sprung aus den Medien soll die Nachricht nicht irgendwo
     stehen, sondern ins Auge fallen. Der Rahmen verschwindet von selbst
     wieder — er ist ein Hinweis und keine Markierung. */
  function springeHin() {
    if (!zielNachricht) return;
    const el = $(`#n-${CSS.escape(zielNachricht)}`);
    zielNachricht = null;
    if (!el) return;
    el.scrollIntoView({ block: 'center' });
    el.classList.add('gefunden');
    setTimeout(() => el.classList.remove('gefunden'), 2200);
  }

  /* Die Suche läuft über das, was ohnehin schon geladen ist: beim Öffnen
     kommt das ganze Gespräch, eine zweite Abfrage brächte nichts Neues
     und wäre ohne Empfang nur ein Fehler mehr. Gesucht wird im Klartext,
     also ohne die Klammern einer Erwähnung — wer "@Thomas" tippt, soll
     ihn finden und nicht seine Kennung. */
  function zeichneSuche() {
    const v = $('#verlauf');
    v.classList.remove('medien');
    const q = suchbegriff.trim().toLowerCase();
    const treffer = !q ? [] : nachrichten
      .filter(n => n.text && !n.geloescht_am
                && erwaehnungKlartext(n.text).toLowerCase().includes(q))
      .sort((a, b) => new Date(b.erstellt_am) - new Date(a.erstellt_am));

    v.innerHTML = `
      <div class="ch-suchkopf">
        <input id="ch-suchfeld" type="search" placeholder="In diesem Gespräch suchen"
               aria-label="In diesem Gespräch suchen" value="${esc(suchbegriff)}">
      </div>
      ${!q
        ? '<div class="br-leer" style="margin:auto;">Tippen Sie ein Wort, das in einer Nachricht vorkommt.</div>'
        : treffer.length
          ? `<div class="ch-treffer">${treffer.map(n => `
              <button type="button" class="pressable" data-hin="${esc(n.id)}">
                <span class="oben">
                  <span class="wer">${esc(n.absender === ich ? 'Sie' : nameVon(n.absender))}</span>
                  <span class="wann">${esc(langeZeit(n.erstellt_am))}</span>
                </span>
                <span class="was">${hervor(erwaehnungKlartext(n.text), q)}</span>
              </button>`).join('')}</div>`
          : `<div class="br-leer" style="margin:auto;">Nichts gefunden zu „${esc(suchbegriff)}“.</div>`}`;

    const feld = $('#ch-suchfeld');
    feld.addEventListener('input', () => {
      suchbegriff = feld.value;
      const stand = feld.selectionStart;
      zeichneSuche();
      const neu = $('#ch-suchfeld');
      neu.focus();
      try { neu.setSelectionRange(stand, stand); } catch { /* egal */ }
    });
    $$('#verlauf [data-hin]').forEach(el => el.addEventListener('click', async () => {
      zielNachricht = el.dataset.hin;
      blick = 'verlauf';
      await zeichneVerlauf();
    }));
  }

  /* Das gesuchte Wort im Treffer hervorheben. Escapet wird stückweise,
     sonst stünde das Markup als Text da. */
  function hervor(text, q) {
    const roh = String(text || '');
    const unten = roh.toLowerCase();
    let raus = '', i = 0, stelle;
    while ((stelle = unten.indexOf(q, i)) >= 0) {
      raus += esc(roh.slice(i, stelle)) + `<mark>${esc(roh.slice(stelle, stelle + q.length))}</mark>`;
      i = stelle + q.length;
    }
    return raus + esc(roh.slice(i));
  }

  /* Im Treffer steht das volle Datum und nicht "Gestern": wer sucht,
     will wissen, wann es war, und nicht, wie lange es her ist. */
  const langeZeit = iso => new Date(iso).toLocaleDateString('de-CH',
    { day: '2-digit', month: '2-digit', year: 'numeric' })
    + ', ' + new Date(iso).toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' });

  /* Ein Bild lebt 30 Tage. Danach bleibt die Stelle im Gespräch stehen und
     sagt, dass es das Bild einmal gab — keine Lücke, aus der man nicht
     schlau wird. */
  function bildBlase(n, meine) {
    const weg = !n.bild_pfad;
    const ablauf = new Date(n.bild_ablauf).toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit' });
    return `
      <div class="ch-bildblase ${meine ? 'ich' : ''}" id="n-${esc(n.id)}"
           data-bild="${esc(n.id)}" data-pfad="${esc(n.bild_pfad || '')}"
           ${weg ? '' : `data-halten="${esc(n.id)}"`}>
        ${weg
          ? '<div class="platzhalter">Bild nicht mehr verfügbar.<br>Bilder werden nach 30 Tagen entfernt.</div>'
          : '<div class="platzhalter">Bild wird geladen…</div>'}
        ${weg ? '' : `<div class="ch-ablauf">${svg(IKON.uhr, 13)}<span>Verfügbar bis ${esc(ablauf)}, danach automatisch gelöscht</span></div>`}
        ${fuss(n, meine)}${reaktionsZeile(n)}
      </div>`;
  }

  /* Die Bilder liegen in einem geschlossenen Bucket. Jedes braucht eine
     eigene, zeitlich begrenzte Adresse — deshalb erst nach dem Zeichnen
     und nur für das, was wirklich am Bildschirm steht. */
  async function bilderNachladen() {
    const offeneBilder = $$('#verlauf [data-pfad]').filter(el => el.dataset.pfad);
    await Promise.all(offeneBilder.map(async el => {
      const { data, error } = await sb.storage.from('chat-bilder')
        .createSignedUrl(el.dataset.pfad, 3600);
      const platz = el.querySelector('.platzhalter');
      if (error || !data?.signedUrl) {
        if (platz) platz.textContent = 'Bild lässt sich gerade nicht laden.';
        return;
      }
      if (!platz) return;
      /* Im Verlauf führt ein Tipp aufs Bild zum Bild selbst, im Raster
         zur Nachricht — dort ist die Kachel schon ein Knopf, und ein
         Link darin wäre keiner mehr. */
      platz.outerHTML = el.classList.contains('ch-kachel')
        ? `<img src="${esc(data.signedUrl)}" alt="Gesendetes Bild" loading="lazy">`
        : `<a href="${esc(data.signedUrl)}" download target="_blank" rel="noopener">
            <img src="${esc(data.signedUrl)}" alt="Gesendetes Bild" loading="lazy"></a>`;
    }));
  }

  /* --- Fotos sichern ---------------------------------------------------------- */

  /* Hier gibt iOS die Regeln vor, und sie sind eng: aus einer Web-App
     kommt kein Code unbeaufsichtigt an die Fotomediathek. Es gibt dafür
     keine Schnittstelle, weder in Safari noch in der zum
     Startbildschirm hinzugefügten App. Wirklich in "Fotos" landet ein
     Bild nur über das Teilen-Blatt des Systems, und das öffnet sich nur
     auf einen Fingertipp hin.

     Daraus folgt der Zuschnitt: automatisch ist alles bis auf diesen
     einen Tipp. Ist der Schalter an, sammelt die App neu eintreffende
     Fotos und legt oben im Gespräch einen Knopf hin; ein Tipp gibt alle
     zusammen ans Teilen-Blatt weiter, dort "Bild sichern". Wo es kein
     Teilen-Blatt gibt — Desktop, ältere Browser —, wird stattdessen
     heruntergeladen.

     Dass die App nicht still im Hintergrund speichert, ist also keine
     Bequemlichkeit, sondern die Grenze der Plattform. Sie steht hier,
     damit sie beim nächsten Lesen nicht für einen Fehler gehalten wird. */
  const kannTeilen = () => typeof navigator.canShare === 'function'
    && typeof navigator.share === 'function';

  function sicherBanner() {
    if (!meineZeile.fotos_sichern || !zuSichern.length) return '';
    const n = zuSichern.length;
    return `
      <div class="ch-sicherbanner">
        <span>${n} ${n === 1 ? 'neues Foto' : 'neue Fotos'} zum Sichern bereit</span>
        <button type="button" class="pressable" data-sichern-jetzt>${svg(IKON.sichern, 14)} Sichern</button>
      </div>`;
  }

  /* Eine Nachricht mit Bild holen und als Datei zurückgeben. Der Bucket
     ist geschlossen, also braucht jedes Bild eine kurzlebige Adresse. */
  async function alsDatei(n) {
    if (!n.bild_pfad) return null;
    const { data, error } = await sb.storage.from('chat-bilder')
      .createSignedUrl(n.bild_pfad, 600);
    if (error || !data?.signedUrl) return null;
    try {
      const antwort = await fetch(data.signedUrl);
      if (!antwort.ok) return null;
      const blob = await antwort.blob();
      const endung = (n.bild_pfad.split('.').pop() || 'jpg').toLowerCase();
      const wann = new Date(n.erstellt_am).toISOString().slice(0, 10);
      return new File([blob], `TRIGA_${wann}_${n.id.slice(0, 8)}.${endung}`,
                      { type: blob.type || 'image/jpeg' });
    } catch { return null; }
  }

  /* Der gemeinsame Weg für beide Knöpfe. Das Teilen-Blatt nimmt mehrere
     Dateien auf einmal, das ist der Fall, für den es gebaut ist. Wo es
     fehlt, wird eines nach dem anderen heruntergeladen — auf dem iPhone
     landet das in "Dateien" und nicht in "Fotos", und genau deshalb ist
     das Teilen-Blatt der erste Weg und nicht der zweite. */
  async function sichere(liste, wortDanach) {
    if (!liste.length) return false;
    if (!istOnline()) { toast('Zum Sichern braucht es eine Verbindung', true); return false; }

    toast(liste.length === 1 ? 'Foto wird geholt…' : `${liste.length} Fotos werden geholt…`);
    const dateien = (await Promise.all(liste.map(alsDatei))).filter(Boolean);
    if (!dateien.length) { toast('Die Fotos liessen sich nicht laden', true); return false; }

    if (kannTeilen() && navigator.canShare({ files: dateien })) {
      try {
        await navigator.share({ files: dateien });
        toast(wortDanach);
        return true;
      } catch (e) {
        /* Wer das Blatt zumacht, hat abgebrochen und keinen Fehler
           gemacht — dann bleibt der Stapel stehen und der Knopf auch. */
        if (e?.name === 'AbortError') return false;
        console.warn('[TRIGA] Teilen ging nicht, es wird heruntergeladen:', e?.message || e);
      }
    }

    for (const d of dateien) {
      const adresse = URL.createObjectURL(d);
      const auf = document.createElement('a');
      auf.href = adresse;
      auf.download = d.name;
      document.body.appendChild(auf);
      auf.click();
      auf.remove();
      setTimeout(() => URL.revokeObjectURL(adresse), 10000);
    }
    toast(kannTeilen() ? wortDanach : `${dateien.length === 1 ? 'Foto' : 'Fotos'} in den Downloads`);
    return true;
  }

  async function sichereStapel() {
    const liste = zuSichern.slice();
    if (await sichere(liste, liste.length === 1 ? 'Foto gesichert' : 'Fotos gesichert')) {
      zuSichern = zuSichern.filter(n => !liste.includes(n));
      await zeichneVerlauf();
    }
  }

  async function sichereAlle() {
    const alle = nachrichten.filter(n => n.bild_pfad && !n.geloescht_am);
    if (!alle.length) return toast('In diesem Gespräch gibt es kein Foto');
    await sichere(alle, `${alle.length} ${alle.length === 1 ? 'Foto' : 'Fotos'} gesichert`);
  }

  /* Beim ersten Foto wird einmal gefragt, mit Begründung, und die
     Antwort steht danach an der Mitgliedszeile. Wer Nein sagt, wird in
     diesem Gespräch nicht wieder gefragt — die Frage kommt nur, solange
     der Schalter noch nie gestellt wurde. */
  let schonGefragt = false;

  async function vielleichtFragen() {
    if (schonGefragt || meineZeile.fotos_sichern || !offen) return;
    schonGefragt = true;
    const ja = await frage({
      titel: 'Fotos aus diesem Gespräch sichern?',
      text: `Neue Fotos aus „${chatName(offen)}“ werden dann gesammelt, und ein Tipp auf „Sichern“ legt sie in Ihre Fotos. Ganz ohne Tipp geht es nicht: in die Fotomediathek kommt eine App im Browser nur über das Teilen-Blatt. Umstellen lässt sich das jederzeit im Menü oben rechts.`,
      knopf: 'Ja, sammeln'
    });
    if (!ja) return;
    await schalterSetzen('fotos_sichern', true);
  }

  /* Beide Schalter gehen denselben Weg. Die Oberfläche geht voraus, die
     Datenbank zieht nach; scheitert sie, kippt der Schalter zurück. */
  async function schalterSetzen(feld, wert) {
    const vorher = meineZeile[feld];
    meineZeile[feld] = wert;
    if (feld === 'stumm' && offen) offen.stumm = wert;
    const { error } = await sb.from('chat_mitglieder')
      .update({ [feld]: wert }).eq('chat_id', offen.id).eq('user_id', ich);
    if (error) {
      meineZeile[feld] = vorher;
      if (feld === 'stumm' && offen) offen.stumm = vorher;
      toast(error.message, true);
      return false;
    }
    return true;
  }

  /* --- Öffnen und Lesen ------------------------------------------------------ */

  async function oeffne(id) {
    const c = chats.find(x => x.id === id);
    if (!c) return;
    offen = c;

    if (!breit()) zeigeGespraech();
    $('#eingabe').hidden = false;
    zeichneKopf();
    zeichneListe();

    $('#verlauf').innerHTML = `<div class="ch-laden"><span class="spin"></span>Nachrichten werden geladen…</div>`;
    const [{ data, error }, { data: staende }] = await Promise.all([
      sb.from('nachrichten')
        .select('id, chat_id, absender, text, bild_pfad, bild_ablauf, erstellt_am, geloescht_am')
        .eq('chat_id', id).order('erstellt_am', { ascending: true }),
      sb.from('chat_mitglieder').select('user_id, zuletzt_gelesen, stumm, fotos_sichern').eq('chat_id', id)
    ]);
    if (meckern('Nachrichten laden', error)) return;
    nachrichten = data || [];
    lesestand = Object.fromEntries((staende || []).map(m => [m.user_id, m.zuletzt_gelesen]));

    const meine = (staende || []).find(m => m.user_id === ich);
    meineZeile = { stumm: !!meine?.stumm, fotos_sichern: !!meine?.fotos_sichern };
    c.stumm = meineZeile.stumm;

    /* Die Reaktionen kommen in einer Abfrage für das ganze Gespräch und
       nicht je Nachricht: bei zweihundert Blasen wären das zweihundert
       Anfragen für eine Handvoll Daumen. */
    await ladeReaktionen();

    /* Was schon dasteht, ist nicht neu. Beim Öffnen wird der Stapel
       deshalb geleert und nicht gefüllt — sonst böte die App beim ersten
       Öffnen eines alten Gesprächs an, vierzig Fotos zu sichern. */
    zuSichern = [];
    blick = 'verlauf';
    suchbegriff = '';
    await zeichneVerlauf();

    await alsGelesen(c);
    horcheAufGespraech(id);

    const u = new URL(location.href);
    u.searchParams.set('chat', id);
    history.replaceState(null, '', u);
  }

  async function alsGelesen(c) {
    if (!c) return;
    const jetzt = new Date().toISOString();
    c.zuletzt_gelesen = jetzt;
    c.ungelesen = 0;
    if (offen && offen.id === c.id) lesestand[ich] = jetzt;
    zeichneListe();
    await sb.from('chat_mitglieder').update({ zuletzt_gelesen: jetzt })
      .eq('chat_id', c.id).eq('user_id', ich);
  }

  function zeigeListe() {
    offen = null;
    nachrichten = [];
    lesestand = {};
    if (kanal) { sb.removeChannel(kanal); kanal = null; }
    $('#spalte-liste').hidden = false;
    $('#spalte-gespraech').hidden = !breit();
    $('#eingabe').hidden = true;
    zeichneKopf();
    zeichneVerlauf();
    zeichneListe();
    const u = new URL(location.href);
    u.searchParams.delete('chat');
    history.replaceState(null, '', u);
  }

  function zeigeGespraech() {
    $('#spalte-liste').hidden = true;
    $('#spalte-gespraech').hidden = false;
  }

  /* --- Echtzeit --------------------------------------------------------------- */

  /* Zwei Kanäle mit verschiedenen Aufgaben: einer für das offene Gespräch,
     einer für die Liste. Der zweite bleibt bestehen, während man von Chat
     zu Chat springt — sonst verpasste man neue Nachrichten in allen
     anderen Gesprächen. */
  function horcheAufGespraech(id) {
    if (kanal) sb.removeChannel(kanal);
    kanal = sb.channel(`gespraech-${id}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'nachrichten', filter: `chat_id=eq.${id}` },
        async nutzlast => {
          const n = nutzlast.new;
          if (nachrichten.some(x => x.id === n.id)) return;
          nachrichten.push(n);

          /* Ein fremdes Foto kommt auf den Stapel, wenn der Schalter an
             ist. Eigene nicht: die liegen schon auf dem Gerät, von dem
             sie kamen. */
          if (n.bild_pfad && n.absender !== ich) {
            if (meineZeile.fotos_sichern) zuSichern.push(n);
            else vielleichtFragen();
          }

          await zeichneVerlauf();
          if (n.absender !== ich) await alsGelesen(offen);
        })
      /* Reaktionen der anderen erscheinen, ohne dass jemand neu lädt.
         Dieselbe Zeile liefert Kommen und Gehen: ein zurückgenommener
         Daumen ist hier wirklich ein delete und kein Leeren. */
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'nachrichten_reaktionen' },
        async nutzlast => {
          const r = nutzlast.new?.nachricht_id ? nutzlast.new : nutzlast.old;
          if (!r?.nachricht_id) return;
          if (!nachrichten.some(x => x.id === r.nachricht_id)) return;
          if (r.user_id === ich) return;      // die eigene steht längst da

          const liste = (reaktionen[r.nachricht_id] ||= []);
          const wo = liste.findIndex(x => x.user_id === r.user_id && x.emoji === r.emoji);
          if (nutzlast.eventType === 'DELETE') {
            if (wo >= 0) liste.splice(wo, 1);
          } else if (wo < 0) {
            liste.push({ nachricht_id: r.nachricht_id, user_id: r.user_id, emoji: r.emoji });
          }
          await zeichneVerlauf();
        })
      /* Gelöscht wird nicht wirklich gelöscht, sondern geleert — für die
         Echtzeit ist das eine Änderung, keine Entfernung. */
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'nachrichten', filter: `chat_id=eq.${id}` },
        async nutzlast => {
          const n = nutzlast.new;
          const i = nachrichten.findIndex(x => x.id === n.id);
          if (i < 0) return;
          nachrichten[i] = { ...nachrichten[i], ...n };
          await zeichneVerlauf();
        })
      /* Liest die Gegenseite mit, wandert ihr Lesestand weiter — daraus
         werden aus einem Haken zwei, ohne Neuladen. */
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'chat_mitglieder', filter: `chat_id=eq.${id}` },
        async nutzlast => {
          const m = nutzlast.new;
          if (!m?.user_id) return;

          /* Dieselbe Zeile traegt den Lesestand und das Admin-Haekchen.
             Ernennt jemand einen Admin, kommt es hier herein — sonst
             stuende im offenen Fenster der alte Stand. */
          const c = chats.find(x => x.id === m.chat_id);
          if (c) {
            const hatte = (c.admins || []).includes(m.user_id);
            if (hatte !== !!m.admin) {
              c.admins = m.admin
                ? [...(c.admins || []), m.user_id]
                : (c.admins || []).filter(u => u !== m.user_id);
              if (offen?.id === c.id) zeichneKopf();
            }
          }

          if (lesestand[m.user_id] === m.zuletzt_gelesen) return;
          lesestand[m.user_id] = m.zuletzt_gelesen;
          if (m.user_id !== ich) await zeichneVerlauf();
        })
      .subscribe();
  }

  function horcheAufListe() {
    if (kanalListe) sb.removeChannel(kanalListe);
    kanalListe = sb.channel('chatliste')
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'nachrichten' },
        async nutzlast => {
          const n = nutzlast.new;
          // Das offene Gespräch führt der andere Kanal nach.
          if (offen && n.chat_id === offen.id) { aktualisiereVorschau(n); return; }
          const c = chats.find(x => x.id === n.chat_id);
          if (!c) { chats = await ladeChats(); zeichneListe(); return; }
          aktualisiereVorschau(n);
        })
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'nachrichten' },
        nutzlast => {
          const n = nutzlast.new;
          const c = chats.find(x => x.id === n.chat_id);
          if (!c || c.letzte?.id !== n.id) return;
          c.letzte = { ...c.letzte, ...n };
          zeichneListe();
        })
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_mitglieder', filter: `user_id=eq.${ich}` },
        async () => { chats = await ladeChats(); zeichneListe(); })
      /* Löscht jemand ein Gespräch, fallen die Mitgliedschaften mit ihm.
         Die Datenbank meldet beim Entfernen nur den Schlüssel — chat_id
         und user_id, mehr braucht es hier auch nicht. */
      .on('postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'chat_mitglieder' },
        nutzlast => gespraechWeg(nutzlast.old))
      .subscribe();
  }

  function gespraechWeg(alt) {
    if (!alt?.chat_id) return;
    const c = chats.find(x => x.id === alt.chat_id);
    if (!c) return;
    if (alt.user_id && alt.user_id !== ich) {
      // Nur eine Person hat die Gruppe verlassen oder wurde entfernt.
      c.mitglieder = c.mitglieder.filter(u => u !== alt.user_id);
      c.admins = (c.admins || []).filter(u => u !== alt.user_id);
      if (offen?.id === c.id) { zeichneKopf(); zeichneVerlauf(); }
      return;
    }
    chats = chats.filter(x => x.id !== c.id);
    if (offen?.id === c.id) { toast('Das Gespräch wurde gelöscht'); zeigeListe(); }
    else zeichneListe();
  }

  function aktualisiereVorschau(n) {
    const c = chats.find(x => x.id === n.chat_id);
    if (!c) return;
    c.letzte = n;
    if (n.absender !== ich && (!offen || offen.id !== c.id)) c.ungelesen += 1;
    chats.sort((a, b) =>
      new Date(b.letzte?.erstellt_am || b.erstellt_am) - new Date(a.letzte?.erstellt_am || a.erstellt_am));
    zeichneListe();
  }

  /* --- Senden ------------------------------------------------------------------ */

  async function senden() {
    const feld = $('#e-text');
    const roh = feld.value.trim();
    if (!roh || !offen) return;
    if (!istOnline()) return toast('Nachrichten brauchen eine Verbindung', true);

    /* Aus "@Thomas Zürcher" wird hier "@[Thomas Zürcher](kennung)" —
       dieselbe Form wie im Feed, damit api/push.js in beiden Bereichen
       dieselbe Zeichenkette liest. Im Feld stand die ganze Zeit nur der
       Name. */
    const text = erw.markiere(roh, erw.merkeFuer(FELD));

    feld.value = '';
    feld.style.height = 'auto';
    erw.schliessen();
    const { data, error } = await sb.from('nachrichten')
      .insert({ chat_id: offen.id, absender: ich, text })
      .select().single();
    if (error) { feld.value = roh; return toast(error.message, true); }

    erw.vergiss(FELD);
    await nachDemSenden(data, erwaehnungKlartext(text));
  }

  async function nachDemSenden(n, vorschauText) {
    if (n && !nachrichten.some(x => x.id === n.id)) {
      nachrichten.push(n);
      await zeichneVerlauf();
    }
    if (n) aktualisiereVorschau(n);
    /* nachricht ist kein zweiter Weg, sondern die Beilage: api/push.js
       liest daraus den gespeicherten Text und schneidet die Erwähnungen
       selbst heraus. Wer erwähnt ist, bekommt die Meldung auch dann,
       wenn er das Gespräch stumm gestellt hat. */
    pushSenden({
      chat: offen.id,
      nachricht: n?.id,
      titel: offen.art === 'gruppe' ? offen.name : nameVon(ich),
      text: offen.art === 'gruppe' ? `${nameVon(ich).split(' ')[0]}: ${vorschauText}` : vorschauText,
      ziel: `chat.html?chat=${offen.id}`
    });
  }

  async function bildSenden(datei) {
    if (!offen || !datei) return;
    if (!istOnline()) return toast('Bilder brauchen eine Verbindung', true);
    if (!/^image\//.test(datei.type)) return toast('Das ist kein Bild', true);
    if (datei.size > 10 * 1024 * 1024) return toast('Das Bild ist grösser als 10 MB', true);

    const endung = (datei.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
    const pfad = `${offen.id}/${crypto.randomUUID()}.${endung}`;

    toast('Bild wird gesendet…');
    const { error: hoch } = await sb.storage.from('chat-bilder')
      .upload(pfad, datei, { contentType: datei.type });
    if (hoch) return toast(hoch.message, true);

    const ablauf = new Date(Date.now() + 30 * 86400000).toISOString();
    const { data, error } = await sb.from('nachrichten')
      .insert({ chat_id: offen.id, absender: ich, bild_pfad: pfad, bild_ablauf: ablauf })
      .select().single();
    if (error) return toast(error.message, true);

    await nachDemSenden(data, 'Foto gesendet');
  }

  /* --- Neues Gespräch ---------------------------------------------------------- */

  function neuesGespraech() {
    const andere = leute.filter(l => l.user_id !== ich);
    const s = sheet(`
      <div style="font-size:16px; font-weight:800; color:var(--navy); margin-bottom:14px;">Neues Gespräch</div>
      <button type="button" id="n-gruppe" class="pressable" style="display:flex; align-items:center; gap:10px; width:100%; height:48px; border-radius:13px; background:var(--card); border:1.5px solid var(--navy); color:var(--navy); font-weight:700; font-size:14.5px; justify-content:center; margin-bottom:16px;">
        ${svg(IKON.gruppe, 17)} Neue Gruppe erstellen
      </button>
      <div style="font-size:11px; font-weight:700; letter-spacing:.06em; text-transform:uppercase; color:var(--text-dim); margin-bottom:8px;">Direkt schreiben an</div>
      <div class="ch-wahl" style="max-height:46dvh; overflow-y:auto;">
        ${andere.map(l => `
          <button type="button" class="zeile pressable" data-person="${esc(l.user_id)}" aria-checked="false">
            <span class="kreis">${esc(initialen(l.name))}</span>
            <span style="flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${esc(l.name)}</span>
          </button>`).join('')}
      </div>
    `);
    s.el.style.maxHeight = '86dvh';
    s.el.style.overflowY = 'auto';

    $('#n-gruppe', s.el).addEventListener('click', () => { s.schliessen(); gruppeErstellen(); });
    $$('[data-person]', s.el).forEach(el => el.addEventListener('click', async () => {
      s.schliessen();
      await einzelchat(el.dataset.person);
    }));
  }

  /* Ein Einzelchat wird nicht angelegt, er entsteht. Gibt es ihn schon,
     wird er geöffnet; gibt es ihn nicht, wird er hier geboren. Ein eigener
     Knopf "Chat anlegen" wäre ein Schritt, den niemand braucht. */
  async function einzelchat(mitWem) {
    const da = chats.find(c => c.art === 'einzel'
      && c.mitglieder.length === 2 && c.mitglieder.includes(mitWem));
    if (da) return oeffne(da.id);

    if (!istOnline()) return toast('Dafür braucht es eine Verbindung', true);

    /* Die Kennung wird hier gewürfelt und nicht von der Datenbank geholt:
       ein insert mit Rückgabe müsste die Zeile lesen, und lesen darf man
       ein Gespräch erst als Mitglied — die Mitgliedschaft entsteht aber
       erst im nächsten Schritt. */
    const id = crypto.randomUUID();
    const { error: e1 } = await sb.from('chats')
      .insert({ id, art: 'einzel', erstellt_von: ich });
    if (e1) return toast(e1.message, true);

    const { error: e2 } = await sb.from('chat_mitglieder').insert([
      { chat_id: id, user_id: ich },
      { chat_id: id, user_id: mitWem }
    ]);
    if (e2) return toast(e2.message, true);

    chats = await ladeChats();
    zeichneListe();
    await oeffne(id);
  }

  /* --- Gruppen ------------------------------------------------------------------ */

  function gruppeErstellen() {
    const andere = leute.filter(l => l.user_id !== ich);
    const gewaehlt = new Set();

    const s = sheet(`
      <div style="font-size:18px; font-weight:800; color:var(--navy); margin-bottom:14px;">Neue Gruppe erstellen</div>
      <input id="gr-name" type="text" placeholder="Gruppenname" aria-label="Gruppenname"
             style="width:100%; height:48px; border-radius:12px; border:1.5px solid var(--border); padding:0 14px; font-size:15px; color:var(--text); box-sizing:border-box; margin-bottom:16px;">
      <div id="gr-zahl" style="font-size:11px; font-weight:700; letter-spacing:.06em; text-transform:uppercase; color:var(--text-dim); margin-bottom:8px;">Mitglieder — 1 ausgewählt</div>
      <div class="ch-wahl" style="max-height:40dvh; overflow-y:auto;">
        ${andere.map(l => `
          <button type="button" class="zeile pressable" data-wahl="${esc(l.user_id)}" role="checkbox" aria-checked="false">
            <span class="kasten">${svg(IKON.haken, 14)}</span>
            <span class="kreis">${esc(initialen(l.name))}</span>
            <span style="flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${esc(l.name)}</span>
          </button>`).join('')}
      </div>
      <div id="gr-fehler" hidden style="font-size:12.5px; color:var(--red); font-weight:600; margin-top:12px;"></div>
      <button type="button" id="gr-ja" class="btn-primary pressable" style="width:100%; height:50px; border:none; border-radius:13px; background:var(--red); color:#fff; font-weight:700; font-size:15px; margin-top:16px;">Gruppe erstellen</button>
    `);
    s.el.style.maxHeight = '88dvh';
    s.el.style.overflowY = 'auto';

    const zahl = () => {
      // Man selbst zählt mit: eine Gruppe ohne einen selbst gibt es nicht.
      $('#gr-zahl', s.el).textContent = `Mitglieder — ${gewaehlt.size + 1} ausgewählt`;
    };

    $$('[data-wahl]', s.el).forEach(el => el.addEventListener('click', () => {
      const u = el.dataset.wahl;
      if (gewaehlt.has(u)) gewaehlt.delete(u); else gewaehlt.add(u);
      el.setAttribute('aria-checked', gewaehlt.has(u));
      zahl();
    }));

    $('#gr-ja', s.el).addEventListener('click', async () => {
      const fehler = $('#gr-fehler', s.el);
      fehler.hidden = true;
      const name = $('#gr-name', s.el).value.trim();
      if (!name) return zeigeFehler(fehler, 'Die Gruppe braucht einen Namen.');
      if (!gewaehlt.size) return zeigeFehler(fehler, 'Wählen Sie mindestens eine Person aus.');
      if (!istOnline()) return zeigeFehler(fehler, 'Dafür braucht es eine Verbindung.');

      const knopf = $('#gr-ja', s.el);
      knopf.disabled = true;
      knopf.innerHTML = '<span class="spin"></span>';

      const id = crypto.randomUUID();
      const { error: e1 } = await sb.from('chats')
        .insert({ id, art: 'gruppe', name, erstellt_von: ich });
      if (e1) { knopf.disabled = false; knopf.textContent = 'Gruppe erstellen'; return zeigeFehler(fehler, e1.message); }

      const { error: e2 } = await sb.from('chat_mitglieder')
        .insert([{ chat_id: id, user_id: ich }, ...[...gewaehlt].map(u => ({ chat_id: id, user_id: u }))]);
      if (e2) { knopf.disabled = false; knopf.textContent = 'Gruppe erstellen'; return zeigeFehler(fehler, e2.message); }

      s.schliessen();
      chats = await ladeChats();
      zeichneListe();
      await oeffne(id);
      toast('Gruppe erstellt');
    });
  }

  function zeigeFehler(el, text) {
    el.textContent = text;
    el.hidden = false;
  }

  /* In einer Gruppe hängt alles am Admin: Mitglieder pflegen, weitere
     Admins ernennen, die Gruppe für alle löschen. Wer die Gruppe anlegt,
     ist es; die Rolle lässt sich weitergeben.

     Der Grund dafür ist der Unterschied zwischen zwei und acht Leuten. Im
     Einzelchat darf weiterhin jedes der beiden Mitglieder beenden — wer
     mitredet, darf auch Schluss machen. In einer Gruppe löschte sonst eine
     Person den Verlauf von sieben anderen mit.

     Alle anderen können gehen, ohne die Gruppe mitzunehmen. Was hier
     angeboten wird, steht genauso in den Policies; sichtbar gemacht wird
     es nur, damit niemand auf einen Knopf drückt, der ohnehin nichts
     bewirkt. */
  function gespraechMenue() {
    if (!offen) return;
    const gruppe = offen.art === 'gruppe';
    const admins = new Set(offen.admins || []);
    const binAdmin = gruppe && admins.has(ich);
    const drin = new Set(offen.mitglieder);
    const andere = leute.filter(l => l.user_id !== ich);

    const erklaerung = !gruppe
      ? `Einzelgespräch mit ${esc(chatName(offen))}.`
      : (binAdmin
          ? 'Sie sind Admin dieser Gruppe: Mitglieder pflegen, weitere Admins ernennen und die Gruppe für alle löschen.'
          : `Admin ${admins.size === 1 ? 'ist' : 'sind'} ${esc([...admins].map(u => nameVon(u)).join(', ') || nameVon(offen.erstellt_von))}. Sie können die Gruppe verlassen; gelöscht wird sie nur von einem Admin.`);

    const zeile = l => {
      const mit = drin.has(l.user_id);
      const istAdmin = admins.has(l.user_id);
      return `
        <div class="ch-mitzeile">
          <button type="button" class="zeile pressable" data-mit="${esc(l.user_id)}"
                  role="checkbox" aria-checked="${mit}" ${binAdmin ? '' : 'disabled'}>
            <span class="kasten">${svg(IKON.haken, 14)}</span>
            <span class="kreis">${esc(initialen(l.name))}</span>
            <span class="wer">${esc(l.name)}</span>
          </button>
          ${mit && istAdmin && !binAdmin ? '<span class="ch-admin">Admin</span>' : ''}
          ${mit && binAdmin
            ? `<button type="button" class="ch-admin pressable${istAdmin ? ' an' : ''}" data-admin="${esc(l.user_id)}"
                       aria-pressed="${istAdmin}" title="${istAdmin ? 'Admin-Recht wegnehmen' : 'Zum Admin machen'}">Admin</button>`
            : ''}
        </div>`;
    };

    /* Die beiden eigenen Schalter stehen zuoberst und nicht bei den
       Mitgliedern: sie gehen nur einen selbst an, und im Einzelchat gibt
       es die Mitgliederliste gar nicht. */
    const schalter = `
      <div class="ch-schalter">
        <button type="button" class="pressable" data-schalter="stumm"
                role="switch" aria-checked="${meineZeile.stumm}">
          ${svg(meineZeile.stumm ? IKON.stumm : IKON.laut, 17)}
          <span class="mitte">
            <span class="titel">Stumm</span>
            <span class="unter">${meineZeile.stumm
              ? 'Keine Meldung auf dem Bildschirm. Nachrichten und Zähler laufen weiter, und wenn Sie jemand mit @ anspricht, kommt es trotzdem durch.'
              : 'Meldungen aus diesem Gespräch kommen aufs Telefon.'}</span>
          </span>
          <span class="knebel"></span>
        </button>
        <button type="button" class="pressable" data-schalter="fotos_sichern"
                role="switch" aria-checked="${meineZeile.fotos_sichern}">
          ${svg(IKON.sichern, 17)}
          <span class="mitte">
            <span class="titel">Fotos sichern</span>
            <span class="unter">${meineZeile.fotos_sichern
              ? 'Neue Fotos werden gesammelt; ein Tipp auf „Sichern“ legt sie in Ihre Fotos.'
              : 'Neue Fotos bleiben im Gespräch und werden nicht gesammelt.'}</span>
          </span>
          <span class="knebel"></span>
        </button>
      </div>
      <button type="button" id="g-allebilder" class="pressable" style="display:flex; align-items:center; justify-content:center; gap:9px; width:100%; height:46px; border-radius:13px; background:var(--card); border:1.5px solid var(--border); color:var(--navy); font-weight:700; font-size:14.5px; margin-bottom:16px;">
        ${svg(IKON.sichern, 16)} Alle Bilder dieses Chats sichern
      </button>`;

    const s = sheet(`
      <div style="font-size:16px; font-weight:800; color:var(--navy); margin-bottom:4px;">${esc(chatName(offen))}</div>
      <div style="font-size:12.5px; color:var(--text-dim); line-height:1.5; margin-bottom:16px;">${erklaerung}</div>
      ${schalter}
      ${gruppe ? `
      <div class="ch-wahl" style="max-height:44dvh; overflow-y:auto;">
        <div class="ch-mitzeile">
          <div class="zeile" aria-checked="true" style="cursor:default;">
            <span class="kasten">${svg(IKON.haken, 14)}</span>
            <span class="kreis">${esc(initialen(nameVon(ich)))}</span>
            <span class="wer">${esc(nameVon(ich))} (Sie)</span>
          </div>
          ${binAdmin ? '<span class="ch-admin an">Admin</span>' : ''}
        </div>
        ${andere.map(zeile).join('')}
      </div>
      <button type="button" id="g-raus" class="pressable" style="display:flex; align-items:center; justify-content:center; gap:9px; width:100%; height:48px; border-radius:13px; background:var(--card); border:1.5px solid var(--border); color:var(--navy); font-weight:700; font-size:14.5px; margin-top:16px;">
        Gruppe verlassen
      </button>` : ''}
      ${(!gruppe || binAdmin) ? `
      <button type="button" id="g-weg" class="pressable" style="display:flex; align-items:center; justify-content:center; gap:9px; width:100%; height:50px; border-radius:13px; background:var(--card); border:1.5px solid var(--red); color:var(--red); font-weight:700; font-size:14.5px; margin-top:12px;">
        ${svg(IKON.eimer, 16)} Gespräch löschen
      </button>
      <div style="font-size:12px; color:var(--text-dim); line-height:1.5; margin-top:8px;">
        Löscht das Gespräch mit allen Nachrichten und Bildern — auch bei den anderen Beteiligten.
      </div>` : ''}
    `);
    s.el.style.maxHeight = '86dvh';
    s.el.style.overflowY = 'auto';

    $('#g-weg', s.el)?.addEventListener('click', async () => {
      s.schliessen();
      await gespraechLoeschen();
    });
    $('#g-raus', s.el)?.addEventListener('click', async () => {
      s.schliessen();
      await gruppeVerlassen();
    });
    $('#g-allebilder', s.el)?.addEventListener('click', async () => {
      s.schliessen();
      await sichereAlle();
    });

    /* Die beiden Schalter stehen jedem offen, auch ohne Admin-Recht —
       sie ändern nichts am Gespräch, nur an der eigenen Zeile. Deshalb
       vor dem Riegel weiter unten. */
    $$('[data-schalter]', s.el).forEach(el => el.addEventListener('click', async () => {
      const feld = el.dataset.schalter;
      const neu = el.getAttribute('aria-checked') !== 'true';
      el.setAttribute('aria-checked', String(neu));
      if (!await schalterSetzen(feld, neu)) {
        el.setAttribute('aria-checked', String(!neu));
        return;
      }
      /* Wer das Sammeln ausschaltet, will auch den Stapel nicht mehr
         sehen; wer es einschaltet, fängt bei null an und bekommt nicht
         rückwirkend vierzig alte Fotos angeboten. */
      if (feld === 'fotos_sichern') zuSichern = [];
      s.schliessen();
      zeichneListe();
      await zeichneVerlauf();
      gespraechMenue();
    }));

    if (!binAdmin) return;

    $$('[data-mit]', s.el).forEach(el => el.addEventListener('click', async () => {
      const u = el.dataset.mit;
      const war = el.getAttribute('aria-checked') === 'true';
      el.setAttribute('aria-checked', String(!war));
      try {
        if (war) {
          const { error } = await sb.from('chat_mitglieder')
            .delete().eq('chat_id', offen.id).eq('user_id', u);
          if (error) throw error;
          offen.mitglieder = offen.mitglieder.filter(x => x !== u);
          offen.admins = (offen.admins || []).filter(x => x !== u);
          toast(`${nameVon(u).split(' ')[0]} entfernt`);
        } else {
          const { error } = await sb.from('chat_mitglieder')
            .insert({ chat_id: offen.id, user_id: u });
          if (error) throw error;
          offen.mitglieder.push(u);
          toast(`${nameVon(u).split(' ')[0]} hinzugefügt`);
        }
        s.schliessen();
        zeichneKopf();
        zeichneListe();
        gespraechMenue();
      } catch (e) {
        el.setAttribute('aria-checked', String(war));
        toast(e.message, true);
      }
    }));

    /* Das Admin-Recht setzt und nimmt die Datenbank, nicht diese Zeile:
       der Trigger chat_mitglied_schutz() lässt es nur von einem Admin und
       nur an einer fremden Zeile zu, und chat_admin_bleibt() verhindert,
       dass die Gruppe ohne Admin dasteht. */
    $$('[data-admin]', s.el).forEach(el => el.addEventListener('click', async () => {
      const u = el.dataset.admin;
      const war = el.getAttribute('aria-pressed') === 'true';
      const { error } = await sb.from('chat_mitglieder')
        .update({ admin: !war }).eq('chat_id', offen.id).eq('user_id', u);
      if (error) return toast(error.message, true);

      offen.admins = war
        ? (offen.admins || []).filter(x => x !== u)
        : [...(offen.admins || []), u];
      s.schliessen();
      gespraechMenue();
      toast(war ? `${nameVon(u).split(' ')[0]} ist nicht mehr Admin` : `${nameVon(u).split(' ')[0]} ist jetzt Admin`);
    }));
  }

  /* Austreten ist nicht Löschen: die Gruppe läuft für die übrigen weiter,
     nur die eigene Mitgliedszeile geht weg. Der letzte Admin kommt hier
     nicht durch — die Datenbank lässt ihn erst gehen, wenn jemand anderes
     die Gruppe führt. */
  async function gruppeVerlassen() {
    if (!offen || offen.art !== 'gruppe') return;
    const c = offen;
    const ja = await frage({
      titel: 'Gruppe verlassen?',
      text: `„${chatName(c)}“ läuft ohne Sie weiter. Sie sehen den Verlauf danach nicht mehr und bekommen keine neuen Nachrichten. Wieder hinein kommen Sie nur, wenn ein Admin Sie hinzufügt.`,
      knopf: 'Verlassen'
    });
    if (!ja) return;
    if (!istOnline()) return toast('Dafür braucht es eine Verbindung', true);

    const { error } = await sb.from('chat_mitglieder')
      .delete().eq('chat_id', c.id).eq('user_id', ich);
    if (error) return toast(error.message, true);

    chats = chats.filter(x => x.id !== c.id);
    zeigeListe();
    toast('Gruppe verlassen');
  }

  /* --- Löschen -------------------------------------------------------------------- */

  /* Die Dateien zuerst, die Zeile danach. Andersherum wäre das Gespräch
     weg, mit ihm die Mitgliedschaft — und ohne Mitgliedschaft lässt die
     Policy im Bucket kein Bild mehr entfernen. Die Bilder lägen für immer
     dort, ohne dass irgendetwas noch auf sie zeigt. */
  async function gespraechLoeschen() {
    if (!offen) return;
    const c = offen;
    const ja = await frage({
      titel: 'Gespräch löschen?',
      text: `„${chatName(c)}“ verschwindet mit allen Nachrichten und Bildern, auch bei allen anderen Beteiligten. Das lässt sich nicht rückgängig machen.`,
      knopf: 'Für alle löschen'
    });
    if (!ja) return;
    if (!istOnline()) return toast('Dafür braucht es eine Verbindung', true);

    const pfade = nachrichten.filter(n => n.bild_pfad).map(n => n.bild_pfad);
    if (pfade.length) {
      const { error: bilder } = await sb.storage.from('chat-bilder').remove(pfade);
      if (bilder) return toast(bilder.message, true);
    }

    const { error } = await sb.from('chats').delete().eq('id', c.id);
    if (error) return toast(error.message, true);

    chats = chats.filter(x => x.id !== c.id);
    zeigeListe();
    toast('Gespräch gelöscht');
  }

  /* Eine einzelne Nachricht verliert ihren Inhalt und behält ihren Platz.
     Was dabei erlaubt ist, prüft der Trigger in der Datenbank; hier wird
     nur gefragt und aufgeräumt. */
  async function nachrichtLoeschen(id) {
    const n = nachrichten.find(x => x.id === id);
    if (!n || n.absender !== ich || n.geloescht_am) return;

    const ja = await frage({
      titel: 'Nachricht löschen?',
      text: 'Der Inhalt verschwindet für alle. An der Stelle bleibt der Vermerk „Nachricht gelöscht“ stehen.',
      knopf: 'Löschen'
    });
    if (!ja) return;
    if (!istOnline()) return toast('Dafür braucht es eine Verbindung', true);

    if (n.bild_pfad) {
      const { error: bild } = await sb.storage.from('chat-bilder').remove([n.bild_pfad]);
      if (bild) return toast(bild.message, true);
    }

    const jetzt = new Date().toISOString();
    const { error } = await sb.from('nachrichten')
      .update({ text: null, bild_pfad: null, geloescht_am: jetzt }).eq('id', id);
    if (error) return toast(error.message, true);

    Object.assign(n, { text: null, bild_pfad: null, geloescht_am: jetzt });
    await zeichneVerlauf();

    const c = chats.find(x => x.id === n.chat_id);
    if (c && c.letzte?.id === n.id) {
      c.letzte = { ...c.letzte, text: null, bild_pfad: null, geloescht_am: jetzt };
      zeichneListe();
    }
    toast('Nachricht gelöscht');
  }

  /* --- Emoji --------------------------------------------------------------------- */

  function emojiWaehlen() {
    const s = sheet(`
      <div style="font-size:16px; font-weight:800; color:var(--navy); margin-bottom:14px;">Emoji</div>
      <div class="ch-emoji">${EMOJI.map(e => `<button type="button" data-e="${e}">${e}</button>`).join('')}</div>
    `);
    $$('[data-e]', s.el).forEach(el => el.addEventListener('click', () => {
      const feld = $('#e-text');
      feld.value += el.dataset.e;
      s.schliessen();
      feld.focus();
    }));
  }

  /* --- Start ----------------------------------------------------------------------- */

  (async () => {
    if (!await verlangeLogin()) return;

    const s = await session();
    ich = s.user.id;
    leute = await ladeLeute();

    /* Nur wer im Adressbuch steht, chattet mit. Das steht auch in der
       Policy; hier soll niemand vor einer leeren Seite ohne Erklärung
       stehen. */
    if (!leute.some(l => l.user_id === ich)) {
      $('#gespraeche').innerHTML = `<div class="br-leer" style="margin:10px;">Ihr Konto ist mit keinem Eintrag im Bereich Mitarbeiter verknüpft. Der Chat ist dem TRIGA-Team vorbehalten.</div>`;
      $$('[data-neu]').forEach(b => b.hidden = true);
      return;
    }

    chats = await ladeChats();
    zeichneListe();
    horcheAufListe();

    $$('[data-neu]').forEach(b => b.addEventListener('click', neuesGespraech));
    $('#suche').addEventListener('input', zeichneListe);
    $('#e-senden').addEventListener('click', senden);
    $('#e-emoji').addEventListener('click', emojiWaehlen);
    $('#e-bild').addEventListener('click', () => $('#e-datei').click());
    $('#e-datei').addEventListener('change', async e => {
      const datei = e.target.files?.[0];
      e.target.value = '';
      if (datei) await bildSenden(datei);
    });

    const feld = $('#e-text');
    /* Dieselbe Auswahlliste wie im Feed. Ein fester Schlüssel genügt,
       anders als dort: im Feed stehen Beitrag und mehrere
       Kommentarfelder gleichzeitig auf dem Schirm, hier gibt es genau
       ein Eingabefeld. Nach jedem Senden wird die Karte ohnehin
       geleert. */
    erw.helfer(feld, FELD);
    feld.addEventListener('input', () => {
      feld.style.height = 'auto';
      feld.style.height = Math.min(feld.scrollHeight, 120) + 'px';
    });
    // Enter schickt, Umschalt+Enter macht eine neue Zeile. Auf dem Handy
    // hat die Tastatur ihre eigene Taste dafür, da stört das nicht.
    feld.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey && breit()) { e.preventDefault(); senden(); }
    });

    const gewuenscht = new URLSearchParams(location.search).get('chat');
    if (gewuenscht && chats.some(c => c.id === gewuenscht)) await oeffne(gewuenscht);
    else zeigeListe();

    /* Beim ersten Öffnen des Chats einmal nach der Erlaubnis fragen, mit
       Begründung. Lehnt jemand ab, läuft der Chat weiter, nur still. */
    pushFragen({
      grund: 'Damit Sie neue Nachrichten auch sehen, wenn die App gerade nicht offen ist. Ohne funktioniert der Chat genau gleich, es kommt nur keine Meldung auf den Bildschirm.'
    });

    addEventListener('beforeunload', () => {
      if (kanal) sb.removeChannel(kanal);
      if (kanalListe) sb.removeChannel(kanalListe);
    });
  })();
})();
