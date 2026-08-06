# Reisekosten-App auf Vercel deployen

Diese Anleitung führt dich einmalig durch die Einrichtung. Danach läuft die App
dauerhaft unter einer eigenen Adresse, unabhängig von Claude.

## Schritt 1 — Supabase-Projekt anlegen (Datenbank, kostenlos)

1. Gehe auf https://supabase.com und melde dich an (z. B. mit GitHub).
2. Klicke auf "New Project". Name z. B. "reisekosten", Passwort frei wählen,
   Region "Frankfurt (eu-central-1)" auswählen (Daten bleiben in Deutschland).
3. Warte, bis das Projekt fertig eingerichtet ist (ca. 1–2 Minuten).
4. Gehe links auf "SQL Editor" → "New query" und füge das Folgende ein,
   dann auf "Run" klicken:

```sql
create table kv_store (
  key text primary key,
  value text
);

alter table kv_store enable row level security;

create policy "Erlaube Lesen und Schreiben für alle"
on kv_store
for all
using (true)
with check (true);
```

   Hinweis: Diese Policy erlaubt jedem mit dem App-Link Lese-/Schreibzugriff,
   passend zur Vertrauensbasis der App (kein Passwort-Login). Für höhere
   Sicherheitsanforderungen später gerne melden, dann rüsten wir echte
   Authentifizierung nach.

5. Gehe links auf "Project Settings" → "API". Dort findest du:
   - **Project URL** (z. B. https://abcdefgh.supabase.co)
   - **anon public key** (langer Code)

   Diese zwei Werte brauchst du gleich für Vercel.

## Schritt 2 — Code zu GitHub hochladen

1. Lade den Ordner, den Claude dir bereitgestellt hat, herunter und entpacke ihn.
2. Erstelle auf https://github.com ein neues, privates Repository, z. B. "reisekosten-app".
3. Lade den kompletten Ordnerinhalt hoch (auf GitHub über "Add file" → "Upload files",
   oder falls du Git-Erfahrung hast, per `git push`).

## Schritt 3 — Auf Vercel deployen

1. Gehe auf https://vercel.com/new und wähle das gerade erstellte GitHub-Repository aus.
2. Vercel erkennt automatisch, dass es sich um ein Vite-Projekt handelt.
3. Bevor du auf "Deploy" klickst, öffne "Environment Variables" und trage ein:
   - `VITE_SUPABASE_URL` → deine Project URL aus Schritt 1
   - `VITE_SUPABASE_ANON_KEY` → dein anon public key aus Schritt 1
4. Klicke auf "Deploy". Nach ca. 1 Minute bekommst du eine Live-URL,
   z. B. `reisekosten-app.vercel.app`.

## Schritt 4 — In Teams einbinden

1. Öffne den gewünschten Teams-Kanal.
2. Klicke oben auf "+" (Tab hinzufügen) → "Website".
3. Füge deine Vercel-URL ein, gib dem Tab einen Namen (z. B. "Reisekosten").
4. Fertig — die App ist jetzt direkt als Tab in Teams erreichbar, für alle
   Kanalmitglieder.

## Login in der App

Genau wie bisher: Name/Kürzel eingeben. Mit dem Namen "Admin" bekommt man die
Freigabe-Ansicht für alle Anträge.

## Spätere Änderungen

Wenn du oder ich später etwas an der App ändern wollen: Datei im GitHub-Repo
bearbeiten (oder neue Version hochladen) — Vercel deployt automatisch bei
jeder Änderung neu, keine weiteren Schritte nötig.
