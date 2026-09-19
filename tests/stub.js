/* Testdoppel des Supabase-Clients. Nur fuer den Browsertest, liegt nicht
   im Repo. Haelt Projekte, Eintraege und Korrekturen im sessionStorage,
   damit sie ueber Seitenwechsel hinweg bestehen. */
(() => {
  const K = '__stub_db';

  /* Normalerweise haelt jeder Tab seine eigene Datenbank im
     sessionStorage — so starten die Testlaeufe sauber nebeneinander.
     Fuer den Echtzeit-Test braucht es das Gegenteil: zwei Tabs, eine
     Datenbank. Dann schaltet __stub_geteilt auf localStorage um, und die
     Aenderungen des einen Tabs loesen im anderen ein storage-Ereignis
     aus. Genau daraus wird hier der Postgres-Change-Feed nachgebaut. */
  const geteilt = () => { try { return localStorage.getItem('__stub_geteilt') === '1'; } catch { return false; } };
  const lager = () => (geteilt() ? localStorage : sessionStorage);

  /* Die Dateiinhalte liegen im Arbeitsspeicher und nicht im
     sessionStorage: ein gerenderter Grundriss und ein PDF-Protokoll
     sprengen dessen Grenze auf der Stelle. In der Ablage steht nur, dass
     es die Datei gibt und wie gross sie ist. */
  const INHALTE = new Map();
  window.__stub_inhalte = INHALTE;

  /* Der Grundbestand. Die Zeile im Adressbuch gehoert dazu und ist kein
     Beiwerk: in der echten Datenbank hat jede Person, die sich anmelden
     und ein Journal fuehren kann, eine — daran haengen ist_triga_person()
     und darf_eintrag_aendern(). Ohne sie stuende hier ein Zustand, den
     es in Wirklichkeit nicht gibt, und die Suiten pruefen etwas
     Freundlicheres als das Original. */
  const leer = {
    profile: [{ id: 'u1', name: 'Jonas Zemp' }],
    mitarbeiter: [{ id: 'ich', name: 'Jonas Zemp', rolle: 'Bauleitung',
                    user_id: 'u1', berechtigung: 'mitarbeiter',
                    geloescht_am: null, zustaendig_fuer: [] }],
    projekte: [], eintraege: [], eintraege_korrekturen: []
  };
  const db = () => { try { return JSON.parse(lager().getItem(K)) || structuredClone(leer); } catch { return structuredClone(leer); } };
  const setz = d => lager().setItem(K, JSON.stringify(d));
  if (!lager().getItem(K)) setz(leer);

  /* --- Echtzeit ---------------------------------------------------------- */

  const kanaele = [];
  let zaehler = 0;

  function melde(tabelle, reihen, art = 'INSERT') {
    const ereignis = { tabelle, reihen, art, n: ++zaehler };
    verteile(ereignis);
    if (geteilt()) {
      try { localStorage.setItem('__stub_ereignis', JSON.stringify(ereignis)); } catch {}
    }
  }

  /* Ein Haken für die Tests: eine Zeile anlegen und sie im selben Atemzug
     als Echtzeit-Meldung verteilen. Damit lässt sich prüfen, was passiert,
     wenn von aussen etwas hereinkommt — ohne dafür einen zweiten Tab und
     eine Dateiauswahl zu brauchen. Steht nur im Stub und nirgends in der
     App. */
  window.__stubMelde = (tabelle, reihe, art = 'INSERT') => {
    const d = db();
    d[tabelle] = d[tabelle] || [];
    if (art === 'INSERT') d[tabelle].push(reihe);
    else if (art === 'DELETE') {
      d[tabelle] = d[tabelle].filter(r => JSON.stringify(r) !== JSON.stringify(reihe));
    }
    setz(d);
    melde(tabelle, [reihe], art);
  };

  function verteile(ereignis) {
    const art = ereignis.art || 'INSERT';
    for (const k of kanaele) {
      for (const h of k.horcher) {
        if (h.opt.table !== ereignis.tabelle) continue;
        if (h.opt.event !== art && h.opt.event !== '*') continue;
        for (const r of ereignis.reihen) {
          // Die App nutzt nur die eine Form: "spalte=eq.wert".
          const f = h.opt.filter && /^(\w+)=eq\.(.+)$/.exec(h.opt.filter);
          if (f && String(r[f[1]]) !== f[2]) continue;
          try {
            h.cb(art === 'DELETE'
              ? { eventType: 'DELETE', new: {}, old: r }
              : { eventType: art, new: r, old: {} });
          } catch {}
        }
      }
    }
  }

  /* Rundruf ueber den Kanal, ohne Tabelle dahinter. Der Feed meldet damit
     eine neue Stimme: die Zeile selbst gibt die Policy bei einer anonymen
     Umfrage nicht heraus, also kann sie den Anstoss nicht tragen.
     Wie beim echten Client bekommt der Absender seinen eigenen Rundruf
     nicht zurueck. */
  function rundruf(r, ausser) {
    for (const k of kanaele) {
      if (k === ausser) continue;
      for (const h of k.horcher) {
        if (h.opt.table) continue;              // das sind die Tabellen-Horcher
        if (h.opt.event !== r.event) continue;
        try { h.cb({ event: r.event, payload: r.payload }); } catch {}
      }
    }
  }

  addEventListener('storage', e => {
    if (e.key === '__stub_ereignis' && e.newValue) {
      try { verteile(JSON.parse(e.newValue)); } catch {}
      return;
    }
    if (e.key === '__stub_rundruf' && e.newValue) {
      try { rundruf(JSON.parse(e.newValue), null); } catch {}
    }
  });

  const USER = { id: 'u1', email: 'test.durchlauf@triga.ch' };
  const SESSION = { user: USER, access_token: 'stub' };
  let angemeldet = sessionStorage.getItem('__stub_auth') === '1';

  const namen = id => (db().profile.find(p => p.id === id) || {}).name || null;

  /* Der Schreibschutz auf mitarbeiter, so wie ihn die Datenbank hat:
     RLS-Policy plus Trigger mitarbeiter_schutz(). Nachgebaut, damit der
     Browsertest gegen dieselbe Zusage läuft wie die echte App. */
  const MA_ERLAUBT = ['telefon', 'email', 'unterschrift', 'unterschrift_am'];
  const darfVerwaltenMA = () => {
    const m = (db().mitarbeiter || []).find(x => x.user_id === USER.id && !x.geloescht_am);
    return ['geschaeftsleitung', 'entwickler'].includes(m?.berechtigung);
  };

  /* Der Schreibschutz auf den Chat-Tabellen, so wie ihn die Policies haben.
     Nachgebaut, weil genau hier ein Fehler steckte, den der Browsertest
     nicht sehen konnte: eintragen darf nur, wer das Gespraech angelegt hat.
     Mitgliedschaft allein genuegt nicht, und in ein fremdes Gespraech
     kommt niemand hinein. */
  /* Die Regeln des Feeds, so wie sie in der Datenbank stehen: loeschen
     darf, wer geschrieben hat, und zusaetzlich die erweiterte Stufe.
     Nachgebaut, weil der Browsertest sonst nur pruefen koennte, ob ein
     Knopf da ist — und nicht, ob er etwas bewirkt. */
  const istFeedAutor = id =>
    (db().feed_beitraege || []).some(b => b.id === id && b.erstellt_von === USER.id);
  const darfFeedLoeschen = id => istFeedAutor(id) || darfVerwaltenMA();

  const istChatErsteller = chatId =>
    (db().chats || []).some(c => c.id === chatId && c.erstellt_von === USER.id);
  const istChatMitglied = chatId =>
    (db().chat_mitglieder || []).some(m => m.chat_id === chatId && m.user_id === USER.id);

  /* Die Admin-Regeln der Gruppenchats, so wie sie in der Datenbank
     stehen: ist_chat_admin(), der Trigger chat_ersteller_ist_admin() und
     die Policies auf chats und chat_mitglieder. Nachgebaut, weil sich
     sonst am Bildschirm nur pruefen liesse, ob ein Knopf fehlt — und
     nicht, ob der Aufruf dahinter abgewiesen wird. */
  const istChatAdmin = chatId =>
    (db().chat_mitglieder || []).some(m => m.chat_id === chatId && m.user_id === USER.id && m.admin);
  const istGruppe = chatId =>
    (db().chats || []).some(c => c.id === chatId && c.art === 'gruppe');

  /* --- Pruefspur ---------------------------------------------------------- */

  /* Die sechs AFTER-Trigger auf pruefspur_schreiben(), nachgebaut. Zu
     jeder Tabelle: in welchen Bereich sie gehoert und in welcher Spalte
     die Kennung des Vorgangs steht. */
  const SPUR = {
    abnahmen:             ['abnahme',   'id'],
    abnahme_plaene:       ['abnahme',   'abnahme_id'],
    maengel:              ['abnahme',   'abnahme_id'],
    protokolle:           ['protokoll', 'id'],
    protokoll_teilnehmer: ['protokoll', 'protokoll_id'],
    protokoll_traktanden: ['protokoll', 'protokoll_id']
  };

  const spurBezug = (tabelle, r) => ({
    abnahmen:             `Abnahme ${r.titel ?? ''}`,
    abnahme_plaene:       `Plan ${r.titel ?? ''}`,
    maengel:              `Mangel ${r.nummer ?? '?'}: ${String(r.beschrieb ?? '').slice(0, 80)}`,
    protokolle:           `Protokoll ${r.nummer ?? '?'}`,
    protokoll_traktanden: `Traktandum ${r.reihenfolge ?? '?'}: ${String(r.titel ?? '').slice(0, 80)}`,
    protokoll_teilnehmer: `Teilnehmer ${r.name ?? ''}`
  }[tabelle] || tabelle);

  const spurKurz = v =>
    (typeof v === 'string' && v.length > 200) ? v.slice(0, 200) + '…' : (v ?? null);

  function spurSchreiben(d, tabelle, was, zeilen, alte = new Map()) {
    const eintrag = SPUR[tabelle];
    if (!eintrag) return;
    const [bereich, spalte] = eintrag;
    d.pruefspur = d.pruefspur || [];

    for (const r of zeilen) {
      let aenderungen = null;
      if (was === 'geaendert') {
        const alt = alte.get(r.id) || {};
        aenderungen = {};
        for (const k of new Set([...Object.keys(alt), ...Object.keys(r)])) {
          if ((alt[k] ?? null) !== (r[k] ?? null)) {
            aenderungen[k] = { vorher: spurKurz(alt[k]), nachher: spurKurz(r[k]) };
          }
        }
        // Ein Update, das nichts aendert, ist kein Vorgang.
        if (!Object.keys(aenderungen).length) continue;
      }
      const vorgang = r[spalte];
      const projekt = bereich === 'abnahme'
        ? (d.abnahmen || []).find(a => a.id === vorgang)?.projekt_id
        : (d.protokolle || []).find(p => p.id === vorgang)?.projekt_id;

      d.pruefspur.push({
        id: crypto.randomUUID(), bereich, vorgang_id: vorgang, projekt_id: projekt ?? null,
        tabelle, zeile_id: r.id, was, bezug: spurBezug(tabelle, r), aenderungen,
        wer: USER.id,
        wer_name: (d.mitarbeiter || []).find(m => m.user_id === USER.id && !m.geloescht_am)?.name ?? null,
        wann: new Date().toISOString()
      });
    }
  }

  function erweitere(tabelle, reihe) {
    const r = { ...reihe };
    if (tabelle === 'eintraege') {
      r.profile = r.ersteller_id ? { name: namen(r.ersteller_id) } : null;
      r.projekte = db().projekte.find(p => p.id === r.projekt_id) || null;
    }
    if (tabelle === 'eintraege_korrekturen') r.profile = { name: namen(r.geaendert_von) };
    if (tabelle === 'projekteinsaetze') {
      r.firmen = db().firmen?.find(f => f.id === r.firma_id) || null;
      r.projekte = db().projekte.find(p => p.id === r.projekt_id) || null;
    }
    if (tabelle === 'pendenzen') {
      r.firmen = r.firma_id ? (db().firmen?.find(f => f.id === r.firma_id) || null) : null;
    }
    if (tabelle === 'projekt_mitarbeiter') {
      r.mitarbeiter = db().mitarbeiter?.find(m => m.id === r.mitarbeiter_id) || null;
      r.projekte = db().projekte.find(p => p.id === r.projekt_id) || null;
    }
    if (tabelle === 'projekte') r.eintraege = db().eintraege.filter(e => e.projekt_id === r.id).map(e => ({ datum: e.datum, geloescht_am: e.geloescht_am ?? null }));
    return r;
  }

  function bauer(tabelle) {
    const zustand = { op: 'select', filter: [], sort: [], daten: null, einzeln: null, zaehlen: false, grenze: 0 };
    const b = {
      select(_, opt) { if (opt && opt.count) zustand.zaehlen = true; return b; },
      insert(v) { zustand.op = 'insert'; zustand.daten = Array.isArray(v) ? v : [v]; return b; },
      update(v) { zustand.op = 'update'; zustand.daten = v; return b; },
      delete() { zustand.op = 'delete'; return b; },
      eq(sp, w) { zustand.filter.push(r => r[sp] === w); return b; },
      in(sp, liste) { const menge = new Set(liste); zustand.filter.push(r => menge.has(r[sp])); return b; },
      upsert(v, opt) {
        zustand.op = 'upsert';
        zustand.daten = Array.isArray(v) ? v : [v];
        zustand.schluessel = (opt && opt.onConflict) || 'id';
        return b;
      },
      is(sp, w) { zustand.filter.push(r => (r[sp] ?? null) === w); return b; },
      not(sp, op, w) { zustand.filter.push(r => (r[sp] ?? null) !== w); return b; },
      order(sp, o) { zustand.sort.push([sp, o?.ascending !== false]); return b; },
      limit(n) { zustand.grenze = n; return b; },
      or(ausdruck) {
        // Nur die Form, die die App nutzt: "sp.ilike.%text%,sp2.ilike.%text%"
        const teile = String(ausdruck).split(',').map(t => {
          const [sp, op, wert] = t.split('.');
          return { sp, op, wert: String(wert || '').replace(/%/g, '').toLowerCase() };
        });
        zustand.filter.push(r => teile.some(t =>
          String(r[t.sp] ?? '').toLowerCase().includes(t.wert)));
        return b;
      },
      maybeSingle() { zustand.einzeln = 'maybe'; return b; },
      single() { zustand.einzeln = 'single'; return b; },
      then(ok, err) { return lauf().then(ok, err); }
    };

    async function lauf() {
      const d = db();
      if (!angemeldet) return { data: null, error: { message: 'Not authenticated' } };

      /* Ein Schreibfehler auf Bestellung. Nur fuer den Test: es geht
         darum, ob die App einen gescheiterten Schreibversuch auch zeigt
         statt ihn zu verschlucken. */
      const erzwungen = (() => { try { return sessionStorage.getItem('__stub_fehler'); } catch { return null; } })();
      if (erzwungen === tabelle && zustand.op !== 'select') {
        return { data: null, error: { code: '23505', message: 'Testfehler beim Schreiben' } };
      }
      let reihen = d[tabelle] || (d[tabelle] = []);

      if (zustand.op === 'upsert') {
        const schluessel = zustand.schluessel;
        const raus = [];
        for (const v of zustand.daten) {
          const i = reihen.findIndex(r => r[schluessel] === v[schluessel]);
          if (i >= 0) { reihen[i] = { ...reihen[i], ...v }; raus.push(reihen[i]); }
          else { const n = { ...v, id: v.id || crypto.randomUUID() }; reihen.push(n); raus.push(n); }
        }
        d[tabelle] = reihen; setz(d);
        return { data: raus, error: null };
      }

      if (zustand.op === 'insert' && tabelle === 'mitarbeiter' && !darfVerwaltenMA()) {
        return { data: null, error: { message: 'new row violates row-level security policy for table "mitarbeiter"' } };
      }

      if (zustand.op === 'insert' && tabelle === 'chat_mitglieder') {
        if (zustand.daten.some(r => !istChatErsteller(r.chat_id) && !istChatAdmin(r.chat_id))) {
          return { data: null, error: { message: 'new row violates row-level security policy for table "chat_mitglieder"' } };
        }
        // der Trigger chat_ersteller_ist_admin(): wer die Gruppe anlegt, fuehrt sie
        zustand.daten = zustand.daten.map(r => ({
          ...r,
          admin: r.admin || ((d.chats || []).some(c =>
            c.id === r.chat_id && c.art === 'gruppe' && c.erstellt_von === r.user_id))
        }));
      }

      /* Der Trigger chat_mitglied_schutz(): an der eigenen Zeile nur der
         Lesestand, an einer fremden nur das Haekchen und das nur als
         Admin. Dazu die Policy mitglieder_update. */
      if (zustand.op === 'update' && tabelle === 'chat_mitglieder') {
        zustand.filter.push(r => r.user_id === USER.id || istChatAdmin(r.chat_id));
        const betroffen = reihen.filter(r => zustand.filter.every(f => f(r)));
        const neu = zustand.daten || {};
        for (const r of betroffen) {
          const anders = k => k in neu && (neu[k] ?? null) !== (r[k] ?? null);
          if (r.user_id === USER.id) {
            if (anders('admin')) {
              return { data: null, error: { message: 'Zum Admin macht einen nur ein anderer Admin.' } };
            }
          } else {
            if (anders('zuletzt_gelesen')) {
              return { data: null, error: { message: 'Den Lesestand setzt jede Person nur bei sich selbst.' } };
            }
            if (anders('stumm') || anders('fotos_sichern')) {
              return { data: null, error: { message: 'Stumm und das Sichern von Fotos stellt jede Person nur bei sich selbst.' } };
            }
            if (!istChatAdmin(r.chat_id)) {
              return { data: null, error: { message: 'Admins ernennt nur, wer selbst Admin ist.' } };
            }
          }
          // chat_admin_bleibt(): der letzte Admin geht nicht einfach
          if (r.admin && neu.admin === false && istGruppe(r.chat_id)) {
            const andere = (d.chat_mitglieder || []).filter(m => m.chat_id === r.chat_id && m.user_id !== r.user_id);
            if (andere.length && !andere.some(m => m.admin)) {
              return { data: null, error: { message: 'Die Gruppe braucht einen Admin. Machen Sie zuerst jemand anderen zum Admin.' } };
            }
          }
        }
      }

      if (zustand.op === 'insert' && tabelle === 'nachrichten'
          && zustand.daten.some(r => !istChatMitglied(r.chat_id))) {
        return { data: null, error: { message: 'new row violates row-level security policy for table "nachrichten"' } };
      }

      /* Die Policies auf nachrichten_reaktionen, nachgebaut: im eigenen
         Namen, nur im eigenen Gespraech — und der Primaerschluessel aus
         Nachricht, Person und Emoji. */
      if (tabelle === 'nachrichten_reaktionen') {
        const chatVon = nid => (d.nachrichten || []).find(n => n.id === nid)?.chat_id || null;
        if (zustand.op === 'insert') {
          for (const r of zustand.daten) {
            if (r.user_id !== USER.id) {
              return { data: null, error: { message: 'new row violates row-level security policy for table "nachrichten_reaktionen"' } };
            }
            const c = chatVon(r.nachricht_id);
            if (!c || !istChatMitglied(c)) {
              return { data: null, error: { message: 'new row violates row-level security policy for table "nachrichten_reaktionen"' } };
            }
            if (!['\u{1F44D}', '\u2764\uFE0F', '\u2705', '\u{1F602}', '\u2757'].includes(r.emoji)) {
              return { data: null, error: { message: 'new row for relation "nachrichten_reaktionen" violates check constraint "nachrichten_reaktionen_emoji_werte"' } };
            }
            if ((d.nachrichten_reaktionen || []).some(x =>
                  x.nachricht_id === r.nachricht_id && x.user_id === r.user_id && x.emoji === r.emoji)) {
              return { data: null, error: { message: 'duplicate key value violates unique constraint "nachrichten_reaktionen_pkey"' } };
            }
          }
        }
        // Lesen nur im eigenen Gespraech, Zuruecknehmen nur die eigene.
        if (zustand.op === 'select') {
          zustand.filter.push(r => { const c = chatVon(r.nachricht_id); return !!c && istChatMitglied(c); });
        }
        if (zustand.op === 'delete') zustand.filter.push(r => r.user_id === USER.id);
      }

      /* Eine Stimme pro Person und Umfrage, und nur auf eine Option, die
         zu dieser Umfrage gehoert. Das erste ist in der Datenbank der
         Primaerschluessel, das zweite die Policy. */
      /* --- Antraege, Abnahmen, Maengel ---------------------------------
         Die Policies und die beiden Trigger antrag_schutz() und
         abnahme_gesperrt(), nachgebaut. Genau daran haengt hier alles:
         ein entschiedener Antrag und eine unterschriebene Abnahme sind
         Nachweise und keine Entwuerfe mehr. */
      const abnahmeZu = id => (d.abnahmen || []).some(a => a.id === id && a.abgeschlossen_am);

      /* Seit der Migration eintraege_nur_ueber_funktionen: das Recht auf
         die Spalten ist weg und die Policy steht auf false. Postgres
         meldet dabei nicht "keine Zeile getroffen", sondern weist die
         Anweisung rundheraus ab — und genau so muss es sich hier
         anfühlen, sonst prüft die Suite etwas Freundlicheres als die
         Wirklichkeit. */
      if (tabelle === 'eintraege' && zustand.op === 'update') {
        return { data: null, error: { message: 'permission denied for table eintraege', code: '42501' } };
      }

      if (tabelle === 'antraege' && zustand.op === 'select') {
        zustand.filter.push(r => r.erstellt_von === USER.id || darfVerwaltenMA());
      }
      if (tabelle === 'antraege' && zustand.op === 'insert'
          && zustand.daten.some(r => r.erstellt_von !== USER.id)) {
        return { data: null, error: { message: 'new row violates row-level security policy for table "antraege"' } };
      }
      if (tabelle === 'antraege' && zustand.op === 'update') {
        if (!darfVerwaltenMA()) { zustand.filter.push(() => false); }
        else {
          const betroffen = reihen.filter(r => zustand.filter.every(f => f(r)));
          const neu = zustand.daten || {};
          if (betroffen.some(r => r.status !== 'eingereicht')) {
            return { data: null, error: { message: 'Ein entschiedener Antrag laesst sich nicht mehr aendern.' } };
          }
          /* pdf_pfad steht mit in der Liste: das PDF zeigt den Antrag,
             wie er eingereicht wurde, und laesst sich nicht austauschen. */
          const verboten = ['art', 'betrag', 'beschrieb', 'beleg_pfad', 'pdf_pfad', 'von', 'bis', 'bemerkung', 'erstellt_von', 'erstellt_am']
            .filter(k => k in neu && betroffen.some(r => (r[k] ?? null) !== (neu[k] ?? null)));
          if (verboten.length) {
            return { data: null, error: { message: 'An einem Antrag laesst sich nur der Entscheid setzen, nicht sein Inhalt.' } };
          }
          if (neu.status === 'eingereicht') {
            return { data: null, error: { message: 'Ein Entscheid nimmt sich nicht zurueck.' } };
          }
          /* Die Pruefregel antraege_kommentar_nur_mit_entscheid: eine
             Begruendung ohne Entscheid waere ein Vorwurf ohne Anlass. */
          if ('entscheid_kommentar' in neu && neu.entscheid_kommentar
              && !['genehmigt', 'abgelehnt'].includes(neu.status)) {
            return { data: null, error: { message: 'new row for relation "antraege" violates check constraint "antraege_kommentar_nur_mit_entscheid"' } };
          }
          // wie der Trigger: wer entscheidet, steht in der Zeile
          zustand.daten = { ...neu, entschieden_von: USER.id, entschieden_am: new Date().toISOString() };
        }
      }
      if (tabelle === 'antraege' && zustand.op === 'delete') {
        zustand.filter.push(r => r.erstellt_von === USER.id && r.status === 'eingereicht');
      }

      if (tabelle === 'abnahmen' && (zustand.op === 'update' || zustand.op === 'delete')) {
        const betroffen = reihen.filter(r => zustand.filter.every(f => f(r)));
        if (betroffen.some(r => r.abgeschlossen_am)) {
          return { data: null, error: { message: zustand.op === 'delete'
            ? 'Eine abgeschlossene Abnahme laesst sich nicht loeschen.'
            : 'Diese Abnahme ist abgeschlossen und laesst sich nicht mehr aendern.' } };
        }
      }
      if (tabelle === 'maengel' || tabelle === 'abnahme_plaene') {
        const treffer = zustand.op === 'insert'
          ? zustand.daten.map(r => r.abnahme_id)
          : reihen.filter(r => zustand.filter.every(f => f(r))).map(r => r.abnahme_id);
        if (zustand.op !== 'select' && treffer.some(abnahmeZu)) {
          return { data: null, error: { message: tabelle === 'maengel'
            ? 'Die Abnahme ist abgeschlossen, an ihren Maengeln laesst sich nichts mehr aendern.'
            : 'Diese Abnahme ist abgeschlossen und laesst sich nicht mehr aendern.' } };
        }
        if (tabelle === 'maengel' && zustand.op === 'delete') zustand.filter.push(r => !r.erledigt_am);
      }

      /* Der zusammengesetzte Fremdschluessel maengel_plan_passt: die
         Nadel steckt auf einem Plan, und der Plan gehoert zur selben
         Abnahme. Ohne Plan geht gar nichts — plan_id ist Pflicht. */
      if (tabelle === 'maengel' && zustand.op === 'insert') {
        for (const r of zustand.daten) {
          if (!r.plan_id) {
            return { data: null, error: { code: '23502',
              message: 'null value in column "plan_id" of relation "maengel" violates not-null constraint' } };
          }
          if (!(d.abnahme_plaene || []).some(p => p.id === r.plan_id && p.abnahme_id === r.abnahme_id)) {
            return { data: null, error: { code: '23503',
              message: 'insert or update on table "maengel" violates foreign key constraint "maengel_plan_passt"' } };
          }
        }
      }

      /* Der Trigger plan_nur_ohne_maengel(): ein Plan mit Nadeln darauf
         geht nicht weg, die Maengel gingen sonst still mit ihm. */
      if (tabelle === 'abnahme_plaene' && zustand.op === 'delete') {
        for (const p of reihen.filter(r => zustand.filter.every(f => f(r)))) {
          const daran = (d.maengel || []).filter(m => m.plan_id === p.id).length;
          if (daran) {
            return { data: null, error: { message:
              `Auf diesem Plan stecken ${daran} Maengel. Erst die Nadeln entfernen, dann den Plan.` } };
          }
        }
      }

      /* Auf pruefspur gibt es ausser select keine Policy: geschrieben
         wird nur vom Trigger, und der laeuft security definer. Von aussen
         kommt nichts hinein und nichts heraus. */
      if (tabelle === 'pruefspur') {
        if (zustand.op === 'insert' || zustand.op === 'upsert') {
          return { data: null, error: { code: '42501',
            message: 'new row violates row-level security policy for table "pruefspur"' } };
        }
        if (zustand.op !== 'select') zustand.filter.push(() => false);
      }

      /* --- Sitzungsprotokolle ------------------------------------------
         Der Trigger protokoll_gesperrt() und die Nummernvergabe,
         nachgebaut. Ein abgeschlossenes Protokoll ist ein Nachweis: kein
         Traktandum kommt dazu, keines verschwindet, keines aendert sich. */
      const protokollZu = id => (d.protokolle || []).some(x => x.id === id && x.abgeschlossen_am);

      if (tabelle === 'protokolle' && (zustand.op === 'update' || zustand.op === 'delete')) {
        const betroffen = reihen.filter(r => zustand.filter.every(f => f(r)));
        if (betroffen.some(r => r.abgeschlossen_am)) {
          return { data: null, error: { message: zustand.op === 'delete'
            ? 'Ein abgeschlossenes Protokoll laesst sich nicht loeschen.'
            : 'Dieses Protokoll ist abgeschlossen und laesst sich nicht mehr aendern.' } };
        }
      }
      if ((tabelle === 'protokoll_teilnehmer' || tabelle === 'protokoll_traktanden')
          && zustand.op !== 'select') {
        const treffer = zustand.op === 'insert'
          ? zustand.daten.map(r => r.protokoll_id)
          : reihen.filter(r => zustand.filter.every(f => f(r))).map(r => r.protokoll_id);
        if (treffer.some(protokollZu)) {
          return { data: null, error: { message: 'Das Protokoll ist abgeschlossen, daran laesst sich nichts mehr aendern.' } };
        }
      }
      // Der Trigger protokoll_nummer(): fortlaufend je Projekt.
      if (zustand.op === 'insert' && tabelle === 'protokolle') {
        zustand.daten = zustand.daten.map(r => r.nummer != null ? r : {
          ...r,
          nummer: reihen.filter(x => x.projekt_id === r.projekt_id)
            .reduce((m, x) => Math.max(m, x.nummer || 0), 0) + 1
        });
      }

      if (zustand.op === 'insert' && tabelle === 'feed_stimmen') {
        for (const r of zustand.daten) {
          if ((d.feed_stimmen || []).some(s => s.beitrag_id === r.beitrag_id && s.user_id === r.user_id)) {
            return { data: null, error: { code: '23505',
              message: 'duplicate key value violates unique constraint "feed_stimmen_pkey"' } };
          }
          if (!(d.feed_optionen || []).some(o => o.id === r.option_id && o.beitrag_id === r.beitrag_id)) {
            return { data: null, error: {
              message: 'new row violates row-level security policy for table "feed_stimmen"' } };
          }
        }
      }

      if (zustand.op === 'insert' && tabelle === 'feed_reaktionen'
          && zustand.daten.some(r => (d.feed_reaktionen || [])
               .some(x => x.beitrag_id === r.beitrag_id && x.user_id === r.user_id))) {
        return { data: null, error: { code: '23505',
          message: 'duplicate key value violates unique constraint "feed_reaktionen_pkey"' } };
      }

      /* Spaltenvorgaben, wie sie in der Tabelle stehen. Ohne die fehlte
         einer frisch eingefuegten Zeile genau das, was die Datenbank von
         selbst setzt — und der Test liefe gegen etwas anderes als die
         echte App. */
      const VORGABE = {
        antraege: { status: 'eingereicht' },
        abnahme_plaene: { seite: 1, reihenfolge: 0 },
        protokolle: { status: 'vorbereitet', bezeichnung: 'Baubesprechung' },
        protokoll_teilnehmer: { status: 'anwesend' },
        protokoll_traktanden: { beschluss: false }
      };

      if (zustand.op === 'insert') {
        const neu = zustand.daten.map(r => ({
          ...(VORGABE[tabelle] || {}), ...r,
          id: r.id || crypto.randomUUID(),
          erstellt_am: r.erstellt_am || new Date().toISOString()
        }));
        d[tabelle] = [...reihen, ...neu];
        spurSchreiben(d, tabelle, 'erstellt', neu);
        setz(d);
        melde(tabelle, neu);
        const raus = neu.map(r => erweitere(tabelle, r));
        return { data: zustand.einzeln ? raus[0] : raus, error: null };
      }

      /* Die Policy nachrichten_update und der Trigger nachricht_nur_loeschen.
         Die Policy blendet fremde Nachrichten aus — sie schlaegt nicht
         fehl, sie trifft einfach keine Zeile, genau wie in Postgres. Der
         Trigger dagegen meldet sich. */
      if (zustand.op === 'update' && tabelle === 'nachrichten') {
        zustand.filter.push(r => r.absender === USER.id);
        const betroffen = reihen.filter(r => zustand.filter.every(f => f(r)));
        const daten = zustand.daten || {};
        if (betroffen.some(r => r.geloescht_am)) {
          return { data: null, error: { message: 'Diese Nachricht ist bereits geloescht.' } };
        }
        if (betroffen.length && (!daten.geloescht_am
            || (daten.text ?? null) !== null || (daten.bild_pfad ?? null) !== null)) {
          return { data: null, error: { message: 'Nachrichten lassen sich nur loeschen, nicht aendern.' } };
        }
      }

      if (zustand.op === 'update') {
        let getroffen = [];
        if (tabelle === 'mitarbeiter' && !darfVerwaltenMA()) {
          // Die Policy: nur die eigene Zeile.
          const eigene = reihen.filter(r => zustand.filter.every(f => f(r)) && r.user_id === USER.id);
          // Der Trigger: nur diese Spalten.
          const verboten = Object.keys(zustand.daten).filter(k =>
            !MA_ERLAUBT.includes(k) && eigene.some(r => (r[k] ?? null) !== (zustand.daten[k] ?? null)));
          if (verboten.length) {
            return { data: null, error: { message:
              `Ohne erweiterte Stufe lassen sich nur Telefon, E-Mail und Unterschrift der eigenen Zeile aendern. Abgelehnt: ${verboten.join(', ')}.` } };
          }
          zustand.filter.push(r => r.user_id === USER.id);
        }
        const vorher = new Map();
        d[tabelle] = reihen.map(r => {
          if (zustand.filter.every(f => f(r))) {
            const n = { ...r, ...zustand.daten };
            // wie der Trigger setze_loeschspur in der Datenbank
            if ('geloescht_am' in zustand.daten && (n.geloescht_am ?? null) !== (r.geloescht_am ?? null)) {
              n.geloescht_von = n.geloescht_am ? USER.id : null;
            }
            vorher.set(r.id, r);
            getroffen.push(n); return n;
          }
          return r;
        });
        spurSchreiben(d, tabelle, 'geaendert', getroffen, vorher);
        setz(d);
        if (getroffen.length) melde(tabelle, getroffen, 'UPDATE');
        const raus = getroffen.map(r => erweitere(tabelle, r));
        return { data: zustand.einzeln ? (raus[0] ?? null) : raus, error: null };
      }

      if (zustand.op === 'delete') {
        /* chats_delete: in der Gruppe nur als Admin, im Einzelchat wie
           bisher als Mitglied. Trifft die Bedingung nicht, verschwindet
           nichts — die Policy meldet sich nicht. */
        if (tabelle === 'chats') {
          zustand.filter.push(r => r.art === 'gruppe' ? istChatAdmin(r.id) : istChatMitglied(r.id));
        }
        /* mitglieder_delete: ein Admin traegt jede Person aus, jede
           Person sich selbst. Das Zweite ist das Austreten. */
        if (tabelle === 'chat_mitglieder') {
          zustand.filter.push(r => r.user_id === USER.id || istChatAdmin(r.chat_id));
          // chat_admin_bleibt(): der letzte Admin geht nicht, solange andere bleiben
          const gehen = reihen.filter(r => zustand.filter.every(f => f(r)));
          for (const r of gehen) {
            if (!r.admin || !istGruppe(r.chat_id)) continue;
            const rest = (d.chat_mitglieder || []).filter(m => m.chat_id === r.chat_id && m.user_id !== r.user_id);
            if (rest.length && !rest.some(m => m.admin)) {
              return { data: null, error: { message: 'Die Gruppe braucht einen Admin. Machen Sie zuerst jemand anderen zum Admin.' } };
            }
          }
        }
        /* Die Policies des Feeds. Sie schlagen nicht fehl, sie treffen
           einfach keine Zeile — genau wie in Postgres. */
        if (tabelle === 'feed_beitraege') zustand.filter.push(r => darfFeedLoeschen(r.id));
        if (tabelle === 'feed_kommentare') zustand.filter.push(r => r.verfasser === USER.id || darfVerwaltenMA());
        if (tabelle === 'feed_reaktionen') zustand.filter.push(r => r.user_id === USER.id);

        const weg = reihen.filter(r => zustand.filter.every(f => f(r)));
        d[tabelle] = reihen.filter(r => !zustand.filter.every(f => f(r)));
        spurSchreiben(d, tabelle, 'geloescht', weg);

        // on delete cascade: Teilnehmende und Traktanden gehen mit.
        if (tabelle === 'protokolle' && weg.length) {
          const ids = new Set(weg.map(p => p.id));
          for (const t of ['protokoll_teilnehmer', 'protokoll_traktanden']) {
            d[t] = (d[t] || []).filter(r => !ids.has(r.protokoll_id));
          }
        }

        /* on delete set null: verschwindet eine Pendenz, verblasst ihre
           Spur im Traktandum — auch dann, wenn das Protokoll laengst
           abgeschlossen ist. Ohne diese eine Luecke liesse sich eine
           Pendenz aus einem fertigen Protokoll nie mehr loeschen. */
        if (tabelle === 'pendenzen' && weg.length) {
          const ids = new Set(weg.map(p => p.id));
          d.protokoll_traktanden = (d.protokoll_traktanden || [])
            .map(t => ids.has(t.pendenz_id) ? { ...t, pendenz_id: null } : t);
        }

        // on delete cascade: alles, was an einem Beitrag haengt.
        if (tabelle === 'feed_beitraege' && weg.length) {
          const ids = new Set(weg.map(b => b.id));
          for (const t of ['feed_optionen', 'feed_bilder', 'feed_stimmen', 'feed_reaktionen', 'feed_kommentare']) {
            d[t] = (d[t] || []).filter(r => !ids.has(r.beitrag_id));
          }
        }

        /* on delete cascade: die Fremdschluessel haengen an chats. Die
           Datenbank meldet beim Entfernen nur den Schluessel, mehr steht
           ohne replica identity full auch nicht im Protokoll. */
        if (tabelle === 'chats' && weg.length) {
          const ids = new Set(weg.map(c => c.id));
          const mit = (d.chat_mitglieder || []).filter(m => ids.has(m.chat_id));
          d.chat_mitglieder = (d.chat_mitglieder || []).filter(m => !ids.has(m.chat_id));
          const wegN = new Set((d.nachrichten || []).filter(n => ids.has(n.chat_id)).map(n => n.id));
          d.nachrichten = (d.nachrichten || []).filter(n => !ids.has(n.chat_id));
          d.nachrichten_reaktionen = (d.nachrichten_reaktionen || []).filter(r => !wegN.has(r.nachricht_id));
          setz(d);
          melde('chat_mitglieder', mit.map(m => ({ chat_id: m.chat_id, user_id: m.user_id })), 'DELETE');
          return { data: weg, error: null };
        }

        setz(d);
        if (weg.length) {
          melde(tabelle, tabelle === 'chat_mitglieder'
            ? weg.map(m => ({ chat_id: m.chat_id, user_id: m.user_id })) : weg, 'DELETE');
        }
        return { data: weg, error: null };
      }

      let treffer = reihen.filter(r => zustand.filter.every(f => f(r))).map(r => erweitere(tabelle, r));
      for (const [sp, auf] of [...zustand.sort].reverse()) {
        treffer.sort((x, y) => {
          const a = x[sp], b = y[sp];
          // Zahlen als Zahlen: sonst stuende die 10 vor der 2.
          const n = (typeof a === 'number' && typeof b === 'number')
            ? a - b
            : String(a ?? '').localeCompare(String(b ?? ''));
          return n * (auf ? 1 : -1);
        });
      }
      if (zustand.grenze) treffer = treffer.slice(0, zustand.grenze);
      if (zustand.zaehlen) return { data: null, count: treffer.length, error: null };
      if (zustand.einzeln === 'single') return treffer.length ? { data: treffer[0], error: null } : { data: null, error: { message: 'no rows' } };
      if (zustand.einzeln === 'maybe') return { data: treffer[0] ?? null, error: null };
      return { data: treffer, error: null };
    }
    return b;
  }

  window.supabase = {
    createClient() {
      return {
        from: bauer,
        channel(name) {
          const k = { name, horcher: [] };
          const api = {
            on(_typ, opt, cb) { k.horcher.push({ opt, cb }); return api; },
            subscribe() { kanaele.push(k); return api; },
            send(m) {
              const r = { event: m && m.event, payload: m && m.payload, n: ++zaehler };
              rundruf(r, k);
              if (geteilt()) {
                try { localStorage.setItem('__stub_rundruf', JSON.stringify(r)); } catch {}
              }
              return Promise.resolve('ok');
            },
            __k: k
          };
          return api;
        },
        removeChannel(k) {
          const i = kanaele.indexOf(k && k.__k ? k.__k : k);
          if (i >= 0) kanaele.splice(i, 1);
        },
        rpc: async (name, p) => {
          /* feed_ergebnisse(): je Umfrage und Option die Anzahl Stimmen,
             sonst nichts. Genau darin liegt die Anonymitaet — wer wie
             gestimmt hat, verlaesst die Datenbank nie. */
          if (name === 'feed_ergebnisse') {
            const d = db();
            const zaehler = new Map();
            for (const s of d.feed_stimmen || []) {
              const k = `${s.beitrag_id}|${s.option_id}`;
              zaehler.set(k, (zaehler.get(k) || 0) + 1);
            }
            return {
              data: [...zaehler].map(([k, n]) => {
                const [beitrag_id, option_id] = k.split('|');
                return { beitrag_id, option_id, stimmen: n };
              }),
              error: null
            };
          }
          /* traktandum_schieben(): zwei Traktanden tauschen die Plaetze,
             und zwar in einem Zug. Genau dafuer gibt es die Funktion. */
          if (name === 'traktandum_schieben') {
            const d = db();
            const alle = d.protokoll_traktanden || [];
            const mich = alle.find(t => t.id === p.p_traktandum);
            if (!mich) return { data: null, error: { message: 'Dieses Traktandum gibt es nicht.' } };
            if ((d.protokolle || []).some(x => x.id === mich.protokoll_id && x.abgeschlossen_am)) {
              return { data: null, error: { message: 'Das Protokoll ist abgeschlossen, daran laesst sich nichts mehr aendern.' } };
            }
            const geschwister = alle.filter(t => t.protokoll_id === mich.protokoll_id)
              .sort((a, b) => (a.reihenfolge - b.reihenfolge)
                || String(a.erstellt_am).localeCompare(String(b.erstellt_am)));
            const i = geschwister.indexOf(mich);
            const j = p.p_hoch ? i - 1 : i + 1;
            if (j < 0 || j >= geschwister.length) return { data: null, error: null };
            const andere = geschwister[j];
            const merk = mich.reihenfolge;
            mich.reihenfolge = andere.reihenfolge;
            andere.reihenfolge = merk;
            setz(d);
            return { data: null, error: null };
          }
          /* darf_eintrag_aendern(): wer im Adressbuch steht, darf. Die
             drei Funktionen laufen als security definer und bringen die
             Pruefung selbst mit — ohne sie kaeme jedes angemeldete Konto
             an jeden Eintrag. */
          if (['korrigiere_eintrag', 'loesche_eintrag', 'stelle_eintrag_wieder_her'].includes(name)) {
            const imBuch = (db().mitarbeiter || [])
              .some(m => m.user_id === USER.id && !m.geloescht_am);
            if (!imBuch) {
              return { data: null, error: {
                message: 'Eintraege aendert nur, wer im Adressbuch steht.', code: '42501' } };
            }
          }

          if (name === 'loesche_eintrag' || name === 'stelle_eintrag_wieder_her') {
            const d = db();
            const e = d.eintraege.find(x => x.id === p.p_id);
            if (!e) return { data: null, error: { message: 'Eintrag nicht gefunden' } };
            if (name === 'loesche_eintrag') { e.geloescht_am = new Date().toISOString(); e.geloescht_von = USER.id; }
            else { e.geloescht_am = null; e.geloescht_von = null; }
            setz(d);
            return { data: null, error: null };
          }
          if (name !== 'korrigiere_eintrag') return { data: null, error: { message: 'unbekannt' } };
          const d = db();
          const e = d.eintraege.find(x => x.id === p.p_id);
          if (!e) return { data: null, error: { message: 'Eintrag nicht gefunden' } };
          for (const l of p.p_log) {
            d.eintraege_korrekturen.push({ id: crypto.randomUUID(), eintrag_id: p.p_id, geaendert_von: USER.id, geaendert_am: new Date().toISOString(), ...l });
          }
          /* Die Erlaubnisliste der Funktion. Was nicht darin steht,
             kommt auch ueber den Korrektursatz nicht hinein — die vier
             Wetterspalten zum Beispiel. */
          const ERLAUBT = ['datum', 'wetter', 'temperatur', 'kontrolle', 'betrifft_gebaeude',
                           'firmen', 'fortschritt', 'feststellungen', 'anweisungen', 'fotos_hinweis'];
          for (const [k, v] of Object.entries(p.p_neu || {})) {
            if (ERLAUBT.includes(k)) e[k] = v;
          }
          /* Wie korrigiere_eintrag() in der Datenbank: korrigierte Chips
             heben die Abfrage auf, samt Quelle. Von Hand geaendert ist
             nicht abgefragt. */
          if ('wetter' in p.p_neu || 'temperatur' in p.p_neu) {
            e.wetter_grad = null;
            e.wetter_gemessen_am = null;
            e.wetter_quelle = null;
            e.wetter_rohwerte = null;
          }
          setz(d);
          return { data: null, error: null };
        },
        storage: {
          from: () => ({
            /* Der Inhalt wird als Data-URL mitgelegt, nicht nur der Name.
               Sonst waere jedes Bild im Test ein kaputtes Bild, und alles,
               was mit seiner Groesse rechnet — die Stecknadeln auf dem
               Plan zum Beispiel —, rechnete mit null. */
            upload: async (pfad, datei, opt) => {
              const d = db();
              d.__objekte = d.__objekte || {};
              const inhalt = await new Promise(ok => {
                const l = new FileReader();
                l.onload = () => ok(l.result);
                l.onerror = () => ok(null);
                l.readAsDataURL(datei);
              });
              INHALTE.set(pfad, inhalt);
              d.__objekte[pfad] = {
                name: datei.name || pfad.split('/').pop(),
                groesse: datei.size,
                typ: (opt && opt.contentType) || datei.type || '',
                /* Kleines kommt zusaetzlich in die Ablage und ueberlebt
                   damit einen Seitenwechsel — ein hochgeladener Plan zum
                   Beispiel. Grosses bliebe dort ohnehin nicht liegen,
                   der sessionStorage ist schnell voll. */
                inhalt: inhalt && inhalt.length < 300000 ? inhalt : null
              };
              setz(d);
              return { data: { path: pfad }, error: null };
            },
            download: async (pfad) => {
              const d = db();
              const roh = INHALTE.get(pfad) || (d.__objekte && d.__objekte[pfad] && d.__objekte[pfad].inhalt);
              if (!roh) return { data: null, error: { message: 'nicht gefunden' } };
              const antwort = await fetch(roh);
              return { data: await antwort.blob(), error: null };
            },
            createSignedUrl: async (pfad) => {
              const d = db();
              const o = d.__objekte && d.__objekte[pfad];
              if (!o) return { data: null, error: { message: 'nicht gefunden' } };
              return {
                data: { signedUrl: INHALTE.get(pfad) || o.inhalt || ('data:text/plain,stub-' + encodeURIComponent(pfad)) },
                error: null
              };
            },
            remove: async (pfade) => {
              const d = db();
              d.__objekte = d.__objekte || {};
              const weg = [];
              for (const p of (Array.isArray(pfade) ? pfade : [pfade])) {
                if (d.__objekte[p]) { weg.push({ name: p }); delete d.__objekte[p]; INHALTE.delete(p); }
              }
              setz(d);
              return { data: weg, error: null };
            }
          })
        },
        auth: {
          getSession: async () => ({ data: { session: angemeldet ? SESSION : null } }),
          signInWithPassword: async ({ email, password }) => {
            if (email === 'test.durchlauf@triga.ch' && password === 'TestDurchlauf!2026') {
              angemeldet = true; sessionStorage.setItem('__stub_auth', '1');
              return { data: { session: SESSION }, error: null };
            }
            return { data: null, error: { message: 'Invalid login credentials' } };
          },
          signOut: async () => { angemeldet = false; sessionStorage.removeItem('__stub_auth'); return { error: null }; }
        }
      };
    }
  };
})();
