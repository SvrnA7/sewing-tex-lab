# Stitchflow · Textil Ops

Projekt- und Auftragsmanagement für Nähaufträge aus Shopify, mit Textillager, Tagesziel und dem **Textil-Lab KI-Agenten** (Claude + Obsidian) als Wissensdatenbank.
Das UI basiert auf deinem Figma-Make-Entwurf „Sewing Project management tool“.

## Funktionen

| Bereich | Was es kann |
|---|---|
| **Übersicht** | Offene Aufträge, in Bearbeitung, abgeschlossen, Umsatz im Monat, Tagesziel-Ring, aktuelle Nähaufträge, Lager-Ampel, Agent-Schnellfragen, zuletzt ergänzte Notizen |
| **Aufträge** | Filter Alle / Offen / In Bearbeitung / Abgeschlossen / Überfällig, Suche (⌘K), Sortierung, Detailansicht mit Produktionsstand, Fälligkeit, Priorität, Notiz und Verlauf; manuelle Aufträge anlegen |
| **Produktion** | Kanban-Board mit den Stationen Offen → Zuschnitt → In Näharbeit → Bedruckt → Verpackt → Fertig (Drag & Drop oder Pfeil) |
| **Tagesziel** | Fertige Teile heute vs. Ziel (einstellbar), letzte 7 Tage, heute fällige Aufträge, Umsatz der letzten 6 Monate |
| **Lager** | Stoffe/Material mit Bestand, Mindestbestand, Preis, Lieferant; Verbrauch/Zugang buchen; Ampel (ausreichend / knapp / nachbestellen) |
| **Textil-Lab** | Chat mit Claude, der deine Obsidian-Notizen durchsucht und den aktuellen Auftrags- und Lagerstand kennt; Quellen anklickbar; Antworten als neue Obsidian-Notiz speichern; Wissen inkl. Bild/PDF ergänzen |

Ohne Zugangsdaten läuft die App im **Demo-Modus** (Beispielaufträge, Demo-Vault), damit du sie sofort ansehen kannst.

## Starten

Voraussetzung: Node.js 20 oder neuer.

```bash
npm install
cp .env.example .env      # Zugangsdaten eintragen (siehe unten)
npm run dev               # Frontend: http://localhost:5173 · API: http://localhost:8787
```

Für den Dauerbetrieb (z. B. auf einem Mini-PC in der Werkstatt):

```bash
npm run build
npm start                 # alles unter http://localhost:8787
```

Daten (Produktionsstand, Lager, Einstellungen) liegen in `data/db.json` oder, wenn `DATABASE_URL` gesetzt ist, in Postgres (z. B. Neon).

## Anbindungen

### Shopify
1. Shopify-Admin → Einstellungen → Apps und Vertriebskanäle → **Apps entwickeln** → App erstellen.
2. Admin-API-Scopes: `read_orders`, `read_customers` und (für Status-Tags) `write_orders`.
3. App installieren, **Admin-API-Zugriffstoken** kopieren und in `.env` eintragen:
   `SHOPIFY_STORE_DOMAIN=dein-shop.myshopify.com`, `SHOPIFY_ADMIN_TOKEN=shpat_…`

Die App lädt Bestellungen der letzten 120 Tage beim Start, alle 5 Minuten und per Button „Shopify Sync“.
Shopify liefert Kunde, Positionen, Betrag und Zahlungs-/Versandstatus; Produktionsstand, Notizen und Fälligkeit werden in der App gepflegt und beim Sync nicht überschrieben.

- **Fälligkeit**: wird aus einem Bestell-Attribut wie „Liefertermin“, „Fällig“ oder „Deadline“ gelesen (z. B. per Warenkorb-Feld im Theme), sonst Bestelldatum + `DEFAULT_LEAD_DAYS`.
- **Priorität**: Bestellungen mit Tag `prio`, `eilig` oder `express`.
- **Status zurück an Shopify** (optional): `SHOPIFY_WRITE_STAGE_TAGS=true` setzt an der Bestellung den Tag `naehstatus:<Stufe>`.
- **Echtzeit per Webhook** (optional): Webhooks `orders/create` und `orders/updated` auf `https://<deine-domain>/api/webhooks/shopify` zeigen lassen und das Signatur-Secret als `SHOPIFY_WEBHOOK_SECRET` eintragen.

### Claude (Textil-Lab Agent)
API-Schlüssel unter console.anthropic.com erstellen und als `ANTHROPIC_API_KEY` in `.env` eintragen. Standardmodell ist `claude-opus-5-5` (änderbar über `CLAUDE_MODEL`).
Bei jeder Frage sucht der Server die passendsten Obsidian-Notizen heraus und gibt sie zusammen mit dem aktuellen Auftrags- und Lagerstand an Claude. Die Antwort wird live gestreamt.

### Obsidian (Wissensdatenbank)
Lokal: `OBSIDIAN_VAULT_PATH` auf den Ordner deines Vaults setzen (der Server muss auf demselben Rechner laufen).
Auf Vercel: Vault per Obsidian-Git-Plugin in ein privates GitHub-Repo synchronisieren und `OBSIDIAN_GITHUB_REPO` + `OBSIDIAN_GITHUB_TOKEN` setzen (siehe [docs/vercel.md](docs/vercel.md)).
Ohne beides speichert die App das Wissen in ihrer eigenen Datenbank.
Gelesen werden alle `.md`-Dateien (Ordner mit Punkt wie `.obsidian` werden ignoriert). Neue Einträge landen in `Textil-Lab/` (änderbar über `OBSIDIAN_NOTES_FOLDER`), Anhänge in `Textil-Lab/Anhänge/` und werden per `![[…]]` eingebettet.
Frontmatter `typ:` und `tags:` werden ausgewertet.

## Aufbau

```
api/      Einstieg für Vercel (leitet alle /api-Anfragen an server/app.ts)
server/   Express-API (Shopify-Sync, Webhooks, Lager, Kennzahlen, Obsidian, Claude-Streaming, Login)
shared/   Gemeinsame Typen und Produktionsstufen
src/      React-Frontend (Ansichten in src/views, Detailansicht & Dialoge in src/components)
data/     Lokale Datenbank (db.json), wenn keine DATABASE_URL gesetzt ist
```

Die Produktionsstufen stehen in `shared/types.ts` (`STAGES`) und lassen sich dort anpassen.

## Hosting & Sicherheit
Zwei Wege, die App dauerhaft zu betreiben:

- **Vercel + Neon** (Cloud, am Laptop und Handy erreichbar): Daten in einer Neon-Postgres-Datenbank, Obsidian über ein GitHub-Repo, Schutz per App-Passwort. Anleitung: [docs/vercel.md](docs/vercel.md).
- **Werkstatt-Rechner** mit Cloudflare Tunnel + Access: Daten in `data/db.json`, Obsidian-Vault direkt als Ordner. Anleitung: [docs/betrieb-cloudflare.md](docs/betrieb-cloudflare.md).

Netlify liefert nur das Frontend aus und reicht deshalb nicht. Mit gesetztem `APP_PASSWORD` fragt die App beim Öffnen ein Passwort ab; auf Vercel ist das Pflicht. Zugangsdaten gehören nur in `.env` bzw. die Vercel-Umgebungsvariablen, nie in `.env.example` oder ins Repository.
