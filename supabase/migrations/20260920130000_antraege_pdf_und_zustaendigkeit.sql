-- Anträge: ein PDF am Antrag, ein Grund bei der Ablehnung, und wer
-- zuständig ist.
--
-- Der Weg über Mail fällt weg — es gibt keine verifizierte Absenderdomain,
-- und eine Mail von einer nicht verifizierten Adresse landet entweder im
-- Spam oder gar nicht. Stattdessen bleibt alles in der App: das PDF liegt
-- beim Antrag, und wer es sehen soll, bekommt eine Push-Meldung.

/* --- Das PDF und der Grund ------------------------------------------------ */

alter table public.antraege
  add column if not exists pdf_pfad text,
  add column if not exists entscheid_kommentar text;

comment on column public.antraege.pdf_pfad is
  'Das beim Einreichen erzeugte PDF, im Bucket antrag-belege unter der Kennung des Antrags. Null bei Antraegen von vor dieser Migration.';

comment on column public.antraege.entscheid_kommentar is
  'Die Begruendung, die beim Entscheid mitgegeben wurde. Gedacht ist sie fuer die Ablehnung; bei einer Genehmigung ist sie erlaubt und selten noetig.';

/* Das PDF liegt im selben Bucket wie der Beleg, unter derselben Kennung.
   Die Policy dort prüft den ersten Ordner gegen antrag_darf_beleg() und
   deckt damit jede Datei des Antrags ab — für das PDF ist also nichts
   Neues zu öffnen. Wer den Antrag sehen darf, sieht auch sein PDF; wer
   ihn nicht sieht, kommt an beides nicht heran. */

/* Ein Grund ohne Entscheid wäre ein Vorwurf ohne Anlass. */
alter table public.antraege drop constraint if exists antraege_kommentar_nur_mit_entscheid;
alter table public.antraege add constraint antraege_kommentar_nur_mit_entscheid check (
  entscheid_kommentar is null
  or (status <> 'eingereicht' and length(btrim(entscheid_kommentar)) between 1 and 1000)
);

/* --- Was sich am Antrag noch ändern darf ---------------------------------- */

/* Zwei Ergänzungen an einer Stelle, die sonst bleibt, wie sie war:
   pdf_pfad wandert in die Liste der Dinge, die feststehen — es entsteht
   beim Einreichen und beschreibt den Antrag, wie er eingereicht wurde.
   Liesse es sich nachträglich austauschen, wäre das PDF als Nachweis
   nichts mehr wert.
   entscheid_kommentar dagegen gehört zum Entscheid und darf deshalb
   zusammen mit ihm gesetzt werden — aber auch nur dann, denn danach ist
   der Antrag ohnehin zu. */
create or replace function public.antrag_schutz()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if old.status <> 'eingereicht' then
    raise exception 'Ein entschiedener Antrag laesst sich nicht mehr aendern.';
  end if;

  if new.art          is distinct from old.art
     or new.betrag    is distinct from old.betrag
     or new.beschrieb is distinct from old.beschrieb
     or new.beleg_pfad is distinct from old.beleg_pfad
     or new.pdf_pfad  is distinct from old.pdf_pfad
     or new.von       is distinct from old.von
     or new.bis       is distinct from old.bis
     or new.bemerkung is distinct from old.bemerkung
     or new.erstellt_von is distinct from old.erstellt_von
     or new.erstellt_am  is distinct from old.erstellt_am then
    raise exception 'An einem Antrag laesst sich nur der Entscheid setzen, nicht sein Inhalt.';
  end if;

  if new.status = 'eingereicht' then
    raise exception 'Ein Entscheid nimmt sich nicht zurueck.';
  end if;

  new.entschieden_von := auth.uid();
  new.entschieden_am  := coalesce(new.entschieden_am, now());
  return new;
end $function$;

/* --- Wer zuständig ist ----------------------------------------------------- */

/* Nicht im Code, sondern in den Daten. Zwei Namen fest in eine Datei zu
   schreiben hiesse: wer die Zuständigkeit abgibt, braucht dafür einen
   Entwickler und eine neue Bereitstellung. So genügt eine Zeile im
   Dashboard, und bei Ferien oder Wechsel lässt sich die Zuständigkeit
   auch auf zwei Personen legen.

   Eine Liste und nicht eine Spalte je Art: wer beides betreut, steht
   einmal da statt zweimal, und eine dritte Antragsart käme ohne
   Schemaänderung dazu. */
alter table public.mitarbeiter
  add column if not exists zustaendig_fuer text[] not null default '{}';

alter table public.mitarbeiter drop constraint if exists mitarbeiter_zustaendig_fuer_werte;
alter table public.mitarbeiter add constraint mitarbeiter_zustaendig_fuer_werte check (
  zustaendig_fuer <@ array['spesen', 'ferien']::text[]
);

comment on column public.mitarbeiter.zustaendig_fuer is
  'Welche Antragsarten diese Person entscheidet. Nur daraus ergibt sich, wer bei einer Einreichung eine Meldung bekommt. Aendern darf das nur die erweiterte Stufe - mitarbeiter_schutz() laesst die Spalte nicht in seiner Erlaubnisliste stehen.';

/* Der Schutztrigger auf mitarbeiter führt eine Erlaubnisliste und weist
   alles andere ab. Die neue Spalte steht nicht darin und ist damit ohne
   weiteres Zutun der erweiterten Stufe vorbehalten — niemand macht sich
   selbst zum Genehmiger der eigenen Spesen. */

/* Der Anfangsbestand, wie besprochen: David entscheidet die Spesen,
   Thomas die Ferien. Über den Namen und nicht über eine Kennung, damit
   diese Datei auch in einer frischen Datenbank läuft; gibt es die Person
   dort nicht, passiert schlicht nichts. */
update public.mitarbeiter set zustaendig_fuer = array['spesen']
 where name = 'David Schmid' and geloescht_am is null;

update public.mitarbeiter set zustaendig_fuer = array['ferien']
 where name = 'Thomas Zürcher' and geloescht_am is null;

/* --- Nachschlagen ---------------------------------------------------------- */

/* Wer für eine Antragsart zuständig ist. Als eigene Funktion, weil die
   Frage an zwei Orten gestellt wird: in der App, um zu zeigen, wohin der
   Antrag geht, und in api/push.js, um zu wissen, wen es zu melden gilt.
   Zwei Abfragen nebeneinander liefen früher oder später auseinander. */
create or replace function public.zustaendig_fuer_antrag(p_art text)
returns table (user_id uuid, name text)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select m.user_id, m.name
    from public.mitarbeiter m
   where m.geloescht_am is null
     and m.user_id is not null
     and p_art = any (m.zustaendig_fuer)
   order by m.name;
$function$;

comment on function public.zustaendig_fuer_antrag(text) is
  'Die Personen, die Antraege dieser Art entscheiden. Grundlage fuer die Meldung bei der Einreichung.';

revoke all on function public.zustaendig_fuer_antrag(text) from public, anon;
grant execute on function public.zustaendig_fuer_antrag(text) to authenticated;
