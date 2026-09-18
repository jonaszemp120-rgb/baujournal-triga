-- Mein Profil braucht zwei Dinge an der Mitarbeiter-Tabelle.
--
-- 1. user_id: die Verknüpfung zum Login-Konto. Bisher gab es sie nicht,
--    die beiden Tabellen kannten sich nur über die gleiche E-Mail — und
--    genau die soll ab jetzt jede Person selbst ändern dürfen. Wäre die
--    E-Mail weiterhin das Bindeglied, hätte sich jemand mit einem Tippfehler
--    aus dem eigenen Profil ausgesperrt. Darum ein echter Fremdschlüssel.
--    unique, weil ein Konto zu genau einer Person gehört; nullable, weil
--    nicht jeder Mitarbeiter-Eintrag ein Konto haben muss.
--
-- 2. unterschrift: einmal erfasst, danach automatisch dort eingesetzt, wo
--    diese Person etwas bestätigt. Als PNG in einer Data-URL, damit sie
--    ohne zweiten Weg in den Export läuft. Ersetzen überschreibt, es gibt
--    keine Historie — so steht es in der Vorgabe.

alter table public.mitarbeiter
  add column if not exists user_id uuid unique references auth.users(id) on delete set null,
  add column if not exists unterschrift text,
  add column if not exists unterschrift_am timestamptz;

comment on column public.mitarbeiter.user_id is
  'Login-Konto dieser Person. Mein Profil sucht die eigene Zeile darueber, nicht ueber die E-Mail.';
comment on column public.mitarbeiter.unterschrift is
  'Unterschrift als PNG in einer Data-URL. Ersetzen ueberschreibt, keine Historie.';

-- Die zehn bestehenden Personen anhand der E-Mail zuordnen. Einmalig:
-- danach hängt die Zuordnung am Schlüssel und nicht mehr am Text.
update public.mitarbeiter m
   set user_id = u.id
  from auth.users u
 where m.user_id is null
   and m.email is not null
   and lower(u.email) = lower(m.email);

create index if not exists mitarbeiter_user_idx on public.mitarbeiter (user_id);
