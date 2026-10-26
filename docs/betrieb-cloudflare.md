# Betrieb mit Cloudflare Tunnel + Access

Die App besteht aus zwei Teilen: dem Frontend (React) und dem Server (`server/`), der Shopify abruft, Claude fragt, den Obsidian-Vault liest und die Daten in `data/db.json` speichert.
Netlify liefert nur das Frontend aus, der Server läuft dort nicht. Deshalb läuft die App am besten auf einem Rechner in der Werkstatt (Mac, PC oder Mini-PC, auf dem auch der Obsidian-Vault liegt) und wird über einen **Cloudflare Tunnel** erreichbar gemacht. **Cloudflare Access** davor sorgt dafür, dass nur du (bzw. freigegebene E-Mail-Adressen) hineinkommst.

Voraussetzung: Eine eigene Domain, die bei Cloudflare verwaltet wird (kostenloser Plan reicht).

## 1. App auf dem Werkstatt-Rechner starten

```bash
git clone https://github.com/SvrnA7/sewing-tex-lab.git
cd sewing-tex-lab
npm install
cp .env.example .env      # dann .env mit einem Editor öffnen und Zugangsdaten eintragen
npm run build
npm start                 # läuft jetzt unter http://localhost:8787
```

In `.env` gehören die echten Werte, z. B.:

```
SHOPIFY_STORE_DOMAIN=dein-shop.myshopify.com
SHOPIFY_ADMIN_TOKEN=shpat_...
ANTHROPIC_API_KEY=sk-ant-...
OBSIDIAN_VAULT_PATH=/Users/sven/Obsidian/Werkstatt
```

`.env` steht in `.gitignore` und wird nie zu GitHub hochgeladen. Trage Tokens niemals in `.env.example` ein, die Datei ist öffentlich im Repo.

Damit die App nach einem Neustart automatisch läuft, z. B. mit pm2:

```bash
npm install -g pm2
pm2 start npm --name stitchflow -- start
pm2 save && pm2 startup   # den ausgegebenen Befehl einmal ausführen
```

**Windows:** `pm2 startup` gibt es dort nicht. Einfacher ist die Aufgabenplanung: Neue Aufgabe → Trigger „Beim Anmelden“ → Aktion „Programm starten“ mit `cmd.exe`, Argumente `/c npm start`, „Starten in“ = der Ordner `sewing-tex-lab`.

## 2. Cloudflare Tunnel einrichten

1. dash.cloudflare.com → **Zero Trust** → **Networks** → **Tunnels** → **Create a tunnel** → Typ **Cloudflared**.
2. Name vergeben (z. B. `werkstatt`), dann den angezeigten Installationsbefehl für dein Betriebssystem auf dem Werkstatt-Rechner ausführen. Der Tunnel erscheint danach als „Healthy“.
3. Unter **Public hostname** eintragen:
   - Subdomain: `naehen` (frei wählbar), Domain: deine Domain
   - Service: Typ `HTTP`, URL `localhost:8787`
4. Speichern. Die App ist jetzt unter `https://naehen.deine-domain.de` erreichbar, noch ohne Schutz, deshalb direkt Schritt 3.

## 3. Cloudflare Access davor schalten

1. **Zero Trust** → **Access** → **Applications** → **Add an application** → **Self-hosted**.
2. Application domain: `naehen.deine-domain.de`.
3. Policy anlegen: Action **Allow**, Include → **Emails** → deine E-Mail-Adresse (weitere Mitarbeitende hier ergänzen).
4. Login-Methode: **One-time PIN** (Code per E-Mail) ist ohne weitere Einrichtung verfügbar.
5. Speichern und die Adresse im privaten Browserfenster testen: Es muss die Cloudflare-Anmeldung erscheinen.

### Ausnahme für Shopify-Webhooks

Shopify kann sich nicht bei Cloudflare Access anmelden. Wenn du Webhooks nutzt, lege eine zweite Self-hosted-Application an:

- Domain: `naehen.deine-domain.de`, Pfad: `api/webhooks/shopify`
- Policy: Action **Bypass**, Include → **Everyone**

Der Webhook-Pfad ist trotzdem geschützt: Die App akzeptiert nur Anfragen mit gültiger Shopify-Signatur (`SHOPIFY_WEBHOOK_SECRET`). Ohne Webhooks entfällt dieser Schritt, die App holt Bestellungen dann alle 5 Minuten selbst ab.

## Netlify

Die Netlify-Seite kann danach gelöscht oder pausiert werden, sie wird nicht mehr gebraucht.
