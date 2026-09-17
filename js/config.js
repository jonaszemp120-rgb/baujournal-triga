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
 */
window.BJ_CONFIG = {
  url: 'https://yslpkgndveoltmnmhjrf.supabase.co',
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlzbHBrZ25kdmVvbHRtbm1oanJmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk2NDI4OTYsImV4cCI6MjEwNTIxODg5Nn0.lLTX_AkB-6u7hqT28kSRDmm-QELen5JIZh3lWw2c5Ek'
};
