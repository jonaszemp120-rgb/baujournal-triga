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
    zweiHaken: '<path d="M1 12.5 6 17.5 17 6.5"/><path d="M8 12.5 11 15.5 22 4.5"/>'
  };
  const svg = (d, g = 16) => `<svg viewBox="0 0 24 24" width="${g}" height="${g}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;

  const breit = () => matchMedia('(min-width:1024px)').matches;

  let ich = null;              // auth.users.id
  let leute = [];              // alle Mitarbeitenden mit Konto
  let chats = [];              // { id, art, name, erstellt_von, mitglieder[], letzte, ungelesen, zuletzt_gelesen }
  let offen = null;            // der gerade gezeigte Chat
  let nachrichten = [];
  let kanal = null;            // Echtzeit für das offene Gespräch
  let kanalListe = null;       // Echtzeit für die Liste
  /* Wann hat wer zuletzt gelesen. Die Lesebestätigung rechnet sich daraus
     aus, nicht aus einem Vermerk pro Nachricht — dieselbe Angabe, die
     schon den Ungelesen-Zähler trägt. Ein zweiter Ort dafür würde früher
     oder später abweichen. */
  let lesestand = {};          // user_id -> zuletzt_gelesen (ISO)

  const nameVon = u => leute.find(l => l.user_id === u)?.name || 'Unbekannt';

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
      sb.from('chat_mitglieder').select('chat_id, user_id').in('chat_id', ids),
      sb.from('nachrichten')
        .select('id, chat_id, absender, text, bild_pfad, bild_ablauf, erstellt_am, geloescht_am')
        .in('chat_id', ids).order('erstellt_am', { ascending: false }).limit(500)
    ]);

    const gelesen = Object.fromEntries((meine || []).map(m => [m.chat_id, m.zuletzt_gelesen]));

    return (koepfe || []).map(c => {
      const mit = (alleMitglieder || []).filter(m => m.chat_id === c.id).map(m => m.user_id);
      const eigene = (letzte || []).filter(n => n.chat_id === c.id);
      return {
        ...c,
        mitglieder: mit,
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
      return;
    }
    if (!nachrichten.length) {
      v.innerHTML = `<div class="br-leer" style="margin:auto;">Noch keine Nachricht. Schreiben Sie die erste.</div>`;
      return;
    }

    let letzterTag = '';
    let letzterAbsender = '';
    const teile = [];

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
        teile.push(`<div class="ch-blase geloescht ${meine ? 'ich' : 'andere'}"><span class="wort">Nachricht gelöscht</span>${fuss(n, meine)}</div>`);
        continue;
      }
      if (n.bild_ablauf) teile.push(bildBlase(n, meine));
      if (n.text) teile.push(`<div class="ch-blase ${meine ? 'ich' : 'andere'}"><span class="wort">${esc(n.text)}</span>${fuss(n, meine)}</div>`);
    }

    v.innerHTML = teile.join('');
    $$('#verlauf [data-loeschen]').forEach(el => el.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      nachrichtLoeschen(el.dataset.loeschen);
    }));
    await bilderNachladen();
    v.scrollTop = v.scrollHeight;
  }

  /* Ein Bild lebt 30 Tage. Danach bleibt die Stelle im Gespräch stehen und
     sagt, dass es das Bild einmal gab — keine Lücke, aus der man nicht
     schlau wird. */
  function bildBlase(n, meine) {
    const weg = !n.bild_pfad;
    const ablauf = new Date(n.bild_ablauf).toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit' });
    return `
      <div class="ch-bildblase ${meine ? 'ich' : ''}" data-bild="${esc(n.id)}" data-pfad="${esc(n.bild_pfad || '')}">
        ${weg
          ? '<div class="platzhalter">Bild nicht mehr verfügbar.<br>Bilder werden nach 30 Tagen entfernt.</div>'
          : '<div class="platzhalter">Bild wird geladen…</div>'}
        ${weg ? '' : `<div class="ch-ablauf">${svg(IKON.uhr, 13)}<span>Verfügbar bis ${esc(ablauf)}, danach automatisch gelöscht</span></div>`}
        ${fuss(n, meine)}
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
      if (platz) {
        platz.outerHTML = `<a href="${esc(data.signedUrl)}" download target="_blank" rel="noopener">
          <img src="${esc(data.signedUrl)}" alt="Gesendetes Bild" loading="lazy"></a>`;
      }
    }));
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
      sb.from('chat_mitglieder').select('user_id, zuletzt_gelesen').eq('chat_id', id)
    ]);
    if (meckern('Nachrichten laden', error)) return;
    nachrichten = data || [];
    lesestand = Object.fromEntries((staende || []).map(m => [m.user_id, m.zuletzt_gelesen]));
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
          await zeichneVerlauf();
          if (n.absender !== ich) await alsGelesen(offen);
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
    const text = feld.value.trim();
    if (!text || !offen) return;
    if (!istOnline()) return toast('Nachrichten brauchen eine Verbindung', true);

    feld.value = '';
    feld.style.height = 'auto';
    const { data, error } = await sb.from('nachrichten')
      .insert({ chat_id: offen.id, absender: ich, text })
      .select().single();
    if (error) { feld.value = text; return toast(error.message, true); }

    await nachDemSenden(data, text);
  }

  async function nachDemSenden(n, vorschauText) {
    if (n && !nachrichten.some(x => x.id === n.id)) {
      nachrichten.push(n);
      await zeichneVerlauf();
    }
    if (n) aktualisiereVorschau(n);
    pushSenden({
      chat: offen.id,
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

  /* Mitglieder pflegen darf, wer die Gruppe angelegt hat. Alle anderen
     sehen dieselbe Liste, aber nur zum Lesen — so steht es auch in der
     Policy, hier wird es nur sichtbar gemacht.

     Löschen darf dagegen jedes Mitglied, in der Gruppe wie im Einzelchat.
     Wer mitredet, darf auch beenden; eine Rangordnung dafür hiesse, dass
     ein Gespräch am einen Ende verschwindet und am anderen stehen bleibt. */
  function gespraechMenue() {
    if (!offen) return;
    const gruppe = offen.art === 'gruppe';
    const meine = offen.erstellt_von === ich;
    const drin = new Set(offen.mitglieder);
    const andere = leute.filter(l => l.user_id !== ich);

    const erklaerung = !gruppe
      ? `Einzelgespräch mit ${esc(chatName(offen))}.`
      : (meine ? 'Sie haben diese Gruppe erstellt und können Mitglieder hinzufügen oder entfernen.'
               : `Angelegt von ${esc(nameVon(offen.erstellt_von))}. Mitglieder pflegt, wer die Gruppe erstellt hat.`);

    const s = sheet(`
      <div style="font-size:16px; font-weight:800; color:var(--navy); margin-bottom:4px;">${esc(chatName(offen))}</div>
      <div style="font-size:12.5px; color:var(--text-dim); line-height:1.5; margin-bottom:16px;">${erklaerung}</div>
      ${gruppe ? `
      <div class="ch-wahl" style="max-height:46dvh; overflow-y:auto;">
        <div class="zeile" aria-checked="true" style="cursor:default;">
          <span class="kasten">${svg(IKON.haken, 14)}</span>
          <span class="kreis">${esc(initialen(nameVon(ich)))}</span>
          <span style="flex:1;">${esc(nameVon(ich))} (Sie)</span>
        </div>
        ${andere.map(l => `
          <button type="button" class="zeile pressable" data-mit="${esc(l.user_id)}"
                  role="checkbox" aria-checked="${drin.has(l.user_id)}" ${meine ? '' : 'disabled'}>
            <span class="kasten">${svg(IKON.haken, 14)}</span>
            <span class="kreis">${esc(initialen(l.name))}</span>
            <span style="flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${esc(l.name)}</span>
          </button>`).join('')}
      </div>` : ''}
      <button type="button" id="g-weg" class="pressable" style="display:flex; align-items:center; justify-content:center; gap:9px; width:100%; height:50px; border-radius:13px; background:var(--card); border:1.5px solid var(--red); color:var(--red); font-weight:700; font-size:14.5px; margin-top:16px;">
        ${svg(IKON.eimer, 16)} Gespräch löschen
      </button>
      <div style="font-size:12px; color:var(--text-dim); line-height:1.5; margin-top:8px;">
        Löscht das Gespräch mit allen Nachrichten und Bildern — auch bei den anderen Beteiligten.
      </div>
    `);
    s.el.style.maxHeight = '86dvh';
    s.el.style.overflowY = 'auto';

    $('#g-weg', s.el).addEventListener('click', async () => {
      s.schliessen();
      await gespraechLoeschen();
    });

    if (!gruppe || !meine) return;

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
          toast(`${nameVon(u).split(' ')[0]} entfernt`);
        } else {
          const { error } = await sb.from('chat_mitglieder')
            .insert({ chat_id: offen.id, user_id: u });
          if (error) throw error;
          offen.mitglieder.push(u);
          toast(`${nameVon(u).split(' ')[0]} hinzugefügt`);
        }
        zeichneKopf();
        zeichneListe();
      } catch (e) {
        el.setAttribute('aria-checked', String(war));
        toast(e.message, true);
      }
    }));
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
