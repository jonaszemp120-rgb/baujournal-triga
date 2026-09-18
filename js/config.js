/* Zugangsdaten zum Supabase-Projekt "baujournal-triga" (Region eu-central-1).
 *
 * Beide Werte gehoeren in den Client und sind oeffentlich, das ist bei
 * Supabase so vorgesehen. Der anon key allein gibt keinen Zugriff auf
 * Daten: auf projekte, eintraege, eintraege_korrekturen und profile ist
 * Row Level Security aktiv, und jede Policy verlangt die Rolle
 * "authenticated". Ohne gueltige Session liefert jede Abfrage leer
 * zurueck und jeder Schreibversuch scheitert.
 *
 * Der service_role key darf niemals in diese Datei. Der umgeht RLS
 * vollstaendig und gehoert ausschliesslich ins Supabase-Dashboard.
 *
 * vapid ist der oeffentliche Schluessel fuer Push-Benachrichtigungen. Auch
 * der gehoert in den Client, so ist Web Push gebaut: er sagt dem Browser,
 * an wen das Abo ausgestellt wird. Das Gegenstueck, der private
 * Schluessel, steht als VAPID_PRIVAT in den Umgebungsvariablen von Vercel
 * und verlaesst api/push.js nie.
 */
window.BJ_CONFIG = {
  url: 'https://yslpkgndveoltmnmhjrf.supabase.co',
  vapid: 'BJwToTRmPJy97puyQD3cquX3Q78mIA7r8Z_g64YfJkuVLkeTP4jjE6BNGB2w5dmxitcfyVo67xNWpw6GujHGjFw',
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlzbHBrZ25kdmVvbHRtbm1oanJmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk2NDI4OTYsImV4cCI6MjEwNTIxODg5Nn0.lLTX_AkB-6u7hqT28kSRDmm-QELen5JIZh3lWw2c5Ek'
};
