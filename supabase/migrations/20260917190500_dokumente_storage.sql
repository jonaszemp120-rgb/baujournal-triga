-- Ablage fuer die Dateien. Nicht oeffentlich: heruntergeladen wird
-- ueber eine kurzlebige signierte Adresse, die der Client fuer den
-- angemeldeten Nutzer erzeugt.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('dokumente', 'dokumente', false, 52428800, array['application/pdf'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Lesen und Hochladen duerfen alle Angemeldeten. Loeschen und
-- Ueberschreiben bewusst niemand: eine Datei, die im Papierkorb liegt,
-- soll wirklich noch da sein. Aufraeumen geht nur ueber das Dashboard.
drop policy if exists dokumente_lesen on storage.objects;
create policy dokumente_lesen on storage.objects
  for select to authenticated using (bucket_id = 'dokumente');

drop policy if exists dokumente_hochladen on storage.objects;
create policy dokumente_hochladen on storage.objects
  for insert to authenticated with check (bucket_id = 'dokumente');
