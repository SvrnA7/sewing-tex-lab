# Betrieb auf Vercel (mit Neon-Datenbank)

So läuft die App komplett in der Cloud, ohne Rechner in der Werkstatt. Erreichbar ist sie am Laptop und am Handy unter einer Adresse wie `https://stitchflow.vercel.app`. Auf dem Handy kannst du sie über „Zum Home-Bildschirm“ wie eine App installieren.

Was Vercel anders macht als der Werkstatt-Rechner:

| | Werkstatt-Rechner | Vercel |
|---|---|---|
| Daten (Produktionsstand, Lager, Tagesziel) | Datei `data/db.json` | **Neon-Datenbank** (Pflicht, sonst gehen Änderungen verloren) |
| Obsidian | Vault-Ordner auf dem Rechner | Vault in einem **privaten GitHub-Repo** (Obsidian-Git-Plugin) oder Wissensbasis in der App |
| Schutz | Cloudflare Access | **Passwort** der App (`APP_PASSWORD`) |
| Shopify-Abgleich | alle 5 Minuten | Webhooks in Echtzeit, beim Öffnen der App und täglich per Cron |

## 1. Projekt in Vercel anlegen

1. vercel.com → **Add New… → Project** → Repo `SvrnA7/sewing-tex-lab` importieren.
2. Framework wird als **Vite** erkannt, Build-Befehl und Ausgabeordner kommen aus `vercel.json`. Nichts ändern.
3. Noch nicht auf „Deploy“ klicken, erst Schritt 2 und 3.

## 2. Neon-Datenbank verbinden

1. Im Vercel-Projekt → **Storage → Create Database → Neon** (Serverless Postgres), Region **Frankfurt (eu-central-1)**.
2. Mit dem Projekt verbinden. Vercel trägt `DATABASE_URL` automatisch als Umgebungsvariable ein.
3. Die Tabellen legt die App beim ersten Aufruf selbst an.

Der kostenlose Neon-Plan reicht für eine Werkstatt locker aus (0,5 GB; ein Auftrag braucht etwa 1–2 KB).

## 3. Umgebungsvariablen eintragen

Vercel → Project → **Settings → Environment Variables**. Die Namen stehen auch in `.env.example`.

| Name | Wert |
|---|---|
| `APP_PASSWORD` | ein sicheres Passwort für die App (Pflicht) |
| `SHOPIFY_STORE_DOMAIN` | `9f5402-b4.myshopify.com` |
| `SHOPIFY_ADMIN_TOKEN` | `shpat_…` aus der Shopify-App |
| `SHOPIFY_WEBHOOK_SECRET` | Signatur-Schlüssel der Webhooks (Schritt 5) |
| `ANTHROPIC_API_KEY` | Schlüssel von console.anthropic.com |
| `OBSIDIAN_GITHUB_REPO` / `OBSIDIAN_GITHUB_TOKEN` | nur bei Variante A in Schritt 4 |

Optional: `SHOPIFY_WRITE_STAGE_TAGS=true`, `DEFAULT_LEAD_DAYS`, `WORKSHOP_NAME`, `CRON_SECRET`.

Danach **Deploy**. Wenn du später Variablen änderst: Deployments → letztes Deployment → **Redeploy**.

## 4. Obsidian anbinden

Vercel kann nicht auf Ordner auf deinem Rechner zugreifen. Zwei Möglichkeiten:

**Variante A: Vault über GitHub (empfohlen, wenn du Obsidian weiter nutzt)**

1. Auf GitHub ein **privates** Repo anlegen, z. B. `SvrnA7/obsidian-vault`.
2. In Obsidian das Community-Plugin **Git** installieren, den Vault mit dem Repo verbinden und automatisches Commit/Push/Pull einschalten (z. B. alle 10 Minuten).
3. Auf GitHub → Settings → Developer settings → **Fine-grained personal access token**: nur dieses Repo, Berechtigung **Contents: Read and write**.
4. In Vercel `OBSIDIAN_GITHUB_REPO=SvrnA7/obsidian-vault` und `OBSIDIAN_GITHUB_TOKEN=<Token>` eintragen (bei anderem Branch zusätzlich `OBSIDIAN_GITHUB_BRANCH`).

Notizen, die du in der App speicherst, landen als Commit im Repo und kommen über das Plugin in deinen Vault.

**Variante B: Wissensbasis in der App**

Ohne GitHub-Variablen speichert die App Notizen in der Neon-Datenbank. Der Textil-Lab-Agent nutzt sie genauso, nur siehst du sie nicht in Obsidian.

## 5. Shopify-Webhooks

Shopify-Admin → **Einstellungen → Benachrichtigungen → Webhooks**:

- Ereignisse `Bestellungserstellung` und `Bestellungsaktualisierung`, Format JSON
- URL: `https://<deine-vercel-adresse>/api/webhooks/shopify`
- Den angezeigten Signatur-Schlüssel als `SHOPIFY_WEBHOOK_SECRET` in Vercel eintragen und neu deployen.

Ohne Webhooks holt die App neue Bestellungen beim Öffnen (höchstens alle 5 Minuten) und einmal täglich per Vercel Cron.

## 6. Daten vom Werkstatt-Rechner übernehmen (optional)

Wenn die App schon auf dem Werkstatt-Rechner lief und du Produktionsstände behalten willst, auf diesem Rechner im App-Ordner:

```bash
git pull
npm install
```

Dann die Verbindungs-URL kopieren (Neon-Dashboard → **Connect**, oder in Vercel unter Settings → Environment Variables bei `DATABASE_URL`) und in PowerShell ausführen:

```powershell
$env:DATABASE_URL="postgresql://…"; npm run import-db
```

Danach den Werkstatt-Server stoppen und den Cloudflare Tunnel entfernen, damit nicht zwei Versionen parallel laufen.

## Limits

- Datei-Anhänge im Textil-Lab: max. 3 MB (Vercel nimmt höchstens 4,5 MB pro Anfrage an).
- Antworten des Textil-Lab-Agenten dürfen bis zu 5 Minuten dauern (`maxDuration` in `vercel.json`).
- Der tägliche Cron läuft um 5:00 UTC; der kostenlose Vercel-Plan erlaubt einen Lauf pro Tag.
