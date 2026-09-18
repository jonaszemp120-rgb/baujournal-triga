/* Mein Profil.
 *
 * Die eigenen Kontaktdaten und die eigene Unterschrift. Wichtig dabei:
 * das hier ist keine zweite Kopie. Es ist genau die Zeile aus der
 * Mitarbeiter-Tabelle, die auch in der Mitarbeiter-Liste steht, bei den
 * Projektzuordnungen und überall sonst, wo diese Person auftaucht. Wer
 * hier die Telefonnummer ändert, ändert sie dort mit.
 *
 * Gefunden wird die Zeile über mitarbeiter.user_id = auth.uid(). Die
 * Seite nimmt keine ID aus der Adresszeile entgegen, es gibt also gar
 * keinen Weg, über diese Seite an fremde Daten zu kommen.
 */

(() => {
  const MA_CACHE = 'bj_cache_mitarbeiter';

  let ich = null;

  /* --- Zeichnen ------------------------------------------------------------ */

  function zeichne() {
    $('#inhalt').innerHTML = `
      <div class="pr-karte pr-kopfkarte">
        <span class="kreis">${esc(initialen(ich.name))}</span>
        <span class="mitte">
          <span class="name" style="display:block;">${esc(ich.name)}</span>
          <span class="rolle" style="display:block;">${esc(ich.rolle || 'Keine Funktion erfasst')}</span>
        </span>
        <span class="pj-marke klein stufe">${esc(badgeTitel(ich))}</span>
      </div>

      <div class="pr-karte">
        <h2>Kontaktdaten</h2>
        <div class="pr-feld">
          <label for="p-telefon">Telefon</label>
          <input id="p-telefon" type="tel" inputmode="tel" autocomplete="tel"
                 value="${esc(ich.telefon || '')}" placeholder="079 000 00 00">
        </div>
        <div class="pr-feld">
          <label for="p-email">E-Mail</label>
          <input id="p-email" type="email" inputmode="email" autocomplete="email"
                 value="${esc(ich.email || '')}" placeholder="vorname.name@triga.ch">
        </div>
        <div class="pr-hinweis">Name und Funktion werden von der Administration verwaltet.</div>
        <div id="p-fehler" hidden style="font-size:12.5px; color:var(--red); font-weight:600; margin-bottom:12px;"></div>
        <button type="button" id="p-speichern" class="btn-primary pressable pr-rot">Speichern</button>
      </div>

      <div class="pr-karte">
        <h2>Meine Unterschrift</h2>
        <p class="unter">Wird automatisch dort eingesetzt, wo Sie etwas bestätigen, zum Beispiel bei der Bauabnahme. Einmal erfassen genügt.</p>
        <div class="pr-unterschrift">
          ${ich.unterschrift
            ? `<img src="${esc(ich.unterschrift)}" alt="Ihre erfasste Unterschrift">`
            : '<span class="leer">Noch keine Unterschrift erfasst.</span>'}
        </div>
        ${ich.unterschrift_am
          ? `<div class="pr-hinweis">Erfasst am ${new Date(ich.unterschrift_am).toLocaleDateString('de-CH')}.</div>`
          : ''}
        <div style="display:flex; gap:10px; flex-wrap:wrap;">
          <button type="button" id="p-unterschreiben" class="pressable pr-weiss">
            ${ich.unterschrift ? 'Unterschrift neu erfassen' : 'Unterschrift erfassen'}
          </button>
          ${ich.unterschrift
            ? '<button type="button" id="p-us-weg" class="pressable pr-weiss" style="border-color:var(--border); color:var(--red);">Entfernen</button>'
            : ''}
        </div>
      </div>`;

    $('#p-speichern').addEventListener('click', speichern);
    $('#p-unterschreiben').addEventListener('click', unterschreiben);
    $('#p-us-weg')?.addEventListener('click', unterschriftEntfernen);
  }

  function ohneZeile(email) {
    $('#inhalt').innerHTML = `
      <div class="pr-karte">
        <h2>Kein Mitarbeiter-Eintrag zu diesem Konto</h2>
        <p class="unter">Ihr Konto (${esc(email || '')}) ist noch mit keiner Zeile im Bereich Mitarbeiter verknüpft.
        Solange das so ist, gibt es hier nichts zu pflegen. Die Administration stellt die Verknüpfung her.</p>
      </div>`;
  }

  /* --- Speichern ----------------------------------------------------------- */

  /* Die Zeile wird zusätzlich über user_id eingegrenzt, nicht nur über die
     id. Das ist doppelt gemoppelt, weil die id ohnehin aus der eigenen
     Zeile stammt — aber so trifft dieser Aufruf auch dann nur die eigene
     Zeile, wenn jemand später anfängt, ihm eine ID mitzugeben. */
  async function speichern() {
    const fehler = $('#p-fehler');
    fehler.hidden = true;

    const telefon = $('#p-telefon').value.trim() || null;
    const email = $('#p-email').value.trim() || null;

    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      fehler.textContent = 'Diese E-Mail-Adresse sieht nicht richtig aus.';
      fehler.hidden = false;
      $('#p-email').focus();
      return;
    }

    const knopf = $('#p-speichern');
    knopf.disabled = true;
    knopf.innerHTML = '<span class="spin"></span>';
    try {
      if (!istOnline()) throw new Error('Das Profil lässt sich nur online ändern');
      const { data, error } = await sb.from('mitarbeiter')
        .update({ telefon, email })
        .eq('id', ich.id).eq('user_id', ich.user_id)
        .select().single();
      if (error) throw error;
      ich = { ...ich, ...data };
      // Der Spiegel der Mitarbeiter-Liste ist jetzt veraltet. Wegwerfen
      // statt nachführen: die Liste lädt ihn online ohnehin neu, und ein
      // zweiter Ort zum Nachführen wäre ein zweiter Ort zum Vergessen.
      localStorage.removeItem(MA_CACHE);
      zeichne();
      toast('Gespeichert');
    } catch (e) {
      fehler.textContent = e.message || 'Speichern hat nicht geklappt.';
      fehler.hidden = false;
      knopf.disabled = false;
      knopf.textContent = 'Speichern';
    }
  }

  /* --- Unterschrift --------------------------------------------------------- */

  async function unterschreiben() {
    const bild = await unterschriftSheet();
    if (!bild) return;
    try {
      if (!istOnline()) throw new Error('Die Unterschrift lässt sich nur online speichern');
      const { data, error } = await sb.from('mitarbeiter')
        .update({ unterschrift: bild, unterschrift_am: new Date().toISOString() })
        .eq('id', ich.id).eq('user_id', ich.user_id)
        .select().single();
      if (error) throw error;
      ich = { ...ich, ...data };
      zeichne();
      toast('Unterschrift gespeichert');
    } catch (e) {
      toast(e.message, true);
    }
  }

  async function unterschriftEntfernen() {
    const ja = await frage({
      titel: 'Unterschrift entfernen?',
      text: 'Ohne hinterlegte Unterschrift müssen Sie bei der nächsten Bestätigung von Hand unterschreiben. Erfassen lässt sie sich jederzeit wieder.',
      knopf: 'Entfernen'
    });
    if (!ja) return;
    try {
      if (!istOnline()) throw new Error('Das geht nur online');
      const { data, error } = await sb.from('mitarbeiter')
        .update({ unterschrift: null, unterschrift_am: null })
        .eq('id', ich.id).eq('user_id', ich.user_id)
        .select().single();
      if (error) throw error;
      ich = { ...ich, ...data };
      zeichne();
      toast('Unterschrift entfernt');
    } catch (e) {
      toast(e.message, true);
    }
  }

  /* Das Feld zum Unterschreiben. Liefert eine Data-URL oder null.
     Gezeichnet wird mit Pointer-Ereignissen: die decken Finger, Stift und
     Maus mit demselben Code ab. */
  function unterschriftSheet() {
    return new Promise(fertig => {
      const s = sheet(`
        <div style="font-size:16px; font-weight:800; color:var(--navy); margin-bottom:6px;">Unterschreiben</div>
        <div style="font-size:12.5px; color:var(--text-dim); line-height:1.5; margin-bottom:14px;">Mit dem Finger oder einem Stift ins Feld schreiben.</div>
        <div id="us-rahmen" style="border:1.5px dashed var(--border); border-radius:14px; background:#fafbfb; padding:6px; margin-bottom:14px;">
          <canvas id="us-feld" style="display:block; width:100%; height:190px; touch-action:none; cursor:crosshair;"></canvas>
        </div>
        <div style="display:flex; gap:10px;">
          <button type="button" id="us-ja" class="btn-primary pressable" style="flex:1; height:48px; border:none; border-radius:12px; background:var(--red); color:#fff; font-weight:700; font-size:15px;">Übernehmen</button>
          <button type="button" id="us-leer" class="pressable" style="flex:1; height:48px; border-radius:12px; background:var(--card); border:1.5px solid var(--border); color:var(--navy); font-weight:700; font-size:15px;">Nochmal</button>
          <button type="button" id="us-nein" class="pressable" style="flex:1; height:48px; border-radius:12px; background:var(--card); border:1.5px solid var(--border); color:var(--navy); font-weight:700; font-size:15px;">Abbrechen</button>
        </div>
      `);

      const feld = $('#us-feld', s.el);
      const punkt = window.devicePixelRatio || 1;
      let ctx = null;
      let gezeichnet = false;

      /* Erst nach der Einblendung messen: vorher ist das Sheet noch
         ausserhalb des Bildes und clientWidth wäre 0. */
      function aufspannen() {
        const b = feld.getBoundingClientRect();
        feld.width = Math.round(b.width * punkt);
        feld.height = Math.round(b.height * punkt);
        ctx = feld.getContext('2d');
        ctx.scale(punkt, punkt);
        ctx.lineWidth = 2.4;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = '#11223a';
      }
      setTimeout(aufspannen, 220);

      let malt = false;
      let letzter = null;
      const stelle = e => {
        const b = feld.getBoundingClientRect();
        return { x: e.clientX - b.left, y: e.clientY - b.top };
      };

      /* Pro Bewegung ein kurzes Stück zeichnen, nicht den ganzen Zug neu.
         Ein einziger langer Pfad würde bei jeder Bewegung komplett neu
         gestrichen — das wird gegen Ende einer Unterschrift zäh. */
      function strich(von, bis) {
        ctx.beginPath();
        ctx.moveTo(von.x, von.y);
        ctx.lineTo(bis.x, bis.y);
        ctx.stroke();
      }

      feld.addEventListener('pointerdown', e => {
        if (!ctx) aufspannen();
        malt = true;
        gezeichnet = true;
        feld.setPointerCapture(e.pointerId);
        letzter = stelle(e);
        // Ein einzelner Tipp soll auch einen Punkt hinterlassen.
        strich(letzter, { x: letzter.x + 0.1, y: letzter.y });
      });
      feld.addEventListener('pointermove', e => {
        if (!malt) return;
        e.preventDefault();
        const p = stelle(e);
        strich(letzter, p);
        letzter = p;
      });
      const loslassen = () => { malt = false; letzter = null; };
      feld.addEventListener('pointerup', loslassen);
      feld.addEventListener('pointercancel', loslassen);
      feld.addEventListener('pointerleave', loslassen);

      $('#us-leer', s.el).addEventListener('click', () => {
        if (!ctx) return;
        ctx.clearRect(0, 0, feld.width, feld.height);
        gezeichnet = false;
      });
      $('#us-nein', s.el).addEventListener('click', () => { s.schliessen(); fertig(null); });
      $('#us-ja', s.el).addEventListener('click', () => {
        if (!gezeichnet) return toast('Das Feld ist noch leer', true);
        const bild = zuschneiden(feld);
        s.schliessen();
        fertig(bild);
      });
    });
  }

  /* Auf den beschriebenen Bereich zuschneiden. Ohne das wäre die halbe
     Datei leerer Rand, und die Unterschrift stünde später irgendwo im
     Protokoll statt dort, wo sie hingehört. */
  function zuschneiden(feld) {
    const ctx = feld.getContext('2d');
    const d = ctx.getImageData(0, 0, feld.width, feld.height).data;
    let oben = feld.height, unten = 0, links = feld.width, rechts = 0;

    for (let y = 0; y < feld.height; y++) {
      for (let x = 0; x < feld.width; x++) {
        if (d[(y * feld.width + x) * 4 + 3] > 8) {
          if (y < oben) oben = y;
          if (y > unten) unten = y;
          if (x < links) links = x;
          if (x > rechts) rechts = x;
        }
      }
    }
    if (rechts < links || unten < oben) return feld.toDataURL('image/png');

    const rand = Math.round(8 * (window.devicePixelRatio || 1));
    links = Math.max(0, links - rand);
    oben = Math.max(0, oben - rand);
    rechts = Math.min(feld.width - 1, rechts + rand);
    unten = Math.min(feld.height - 1, unten + rand);

    const aus = document.createElement('canvas');
    aus.width = rechts - links + 1;
    aus.height = unten - oben + 1;
    aus.getContext('2d').drawImage(feld, links, oben, aus.width, aus.height,
                                   0, 0, aus.width, aus.height);
    return aus.toDataURL('image/png');
  }

  /* --- Start ---------------------------------------------------------------- */

  (async () => {
    if (!await verlangeLogin()) return;

    function hinweisZeigen() {
      const el = $('#hinweis');
      el.hidden = istOnline();
      if (!istOnline()) el.textContent = 'Offline. Das Profil lässt sich nur mit Verbindung ändern.';
    }
    beiStatuswechsel(hinweisZeigen);

    const s = await session();
    const { data, error } = await sb.from('mitarbeiter')
      .select('id, user_id, name, rolle, telefon, email, berechtigung, badge_label, unterschrift, unterschrift_am')
      .eq('user_id', s.user.id)
      .is('geloescht_am', null)
      .maybeSingle();

    if (meckern('Profil laden', error)) return;
    if (!data) { ohneZeile(s.user.email); return; }

    ich = data;
    zeichne();
  })();
})();
