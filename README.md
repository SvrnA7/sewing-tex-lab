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

Daten (Produktionsstand, Lager, Einstellungen) liegen in `data/db.json`.

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
`OBSIDIAN_VAULT_PATH` auf den Ordner deines Vaults setzen (der Server muss auf demselben Rechner laufen oder den Vault per Sync/Netzlaufwerk sehen).
Gelesen werden alle `.md`-Dateien (Ordner mit Punkt wie `.obsidian` werden ignoriert). Neue Einträge landen in `Textil-Lab/` (änderbar über `OBSIDIAN_NOTES_FOLDER`), Anhänge in `Textil-Lab/Anhänge/` und werden per `![[…]]` eingebettet.
Frontmatter `typ:` und `tags:` werden ausgewertet.

## Aufbau

```
server/   Express-API (Shopify-Sync, Webhooks, Lager, Kennzahlen, Obsidian, Claude-Streaming)
shared/   Gemeinsame Typen und Produktionsstufen
src/      React-Frontend (Ansichten in src/views, Detailansicht & Dialoge in src/components)
data/     Lokale Datenbank (db.json) und Demo-Vault
```

Die Produktionsstufen stehen in `shared/types.ts` (`STAGES`) und lassen sich dort anpassen.

## Hosting & Sicherheit
Die App braucht einen laufenden Node-Server (`npm start`). Reine Static-Hoster wie Netlify liefern nur das Frontend aus, ohne Server bleiben Aufträge, Lager und der Agent leer.
Empfohlen: auf einem Rechner in der Werkstatt laufen lassen (dort liegt auch der Obsidian-Vault) und per Cloudflare Tunnel + Cloudflare Access geschützt erreichbar machen. Schritt-für-Schritt: [docs/betrieb-cloudflare.md](docs/betrieb-cloudflare.md).

Die App hat selbst keine Anmeldung, deshalb nie ohne Zugriffsschutz öffentlich betreiben. Zugangsdaten gehören nur in `.env`, nie in `.env.example` oder ins Repository.
