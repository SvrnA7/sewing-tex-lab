import { existsSync } from "node:fs";
import { resolve } from "node:path";
import express from "express";
import { app } from "./app.js";
import { claudeConfigured, claudeModel } from "./agent.js";
import { vaultLabel } from "./obsidian.js";
import { shopifyConfigured, syncShopifyOrders } from "./shopify.js";
import { getStore } from "./store.js";

// Lokaler Betrieb (npm start / npm run dev). Auf Vercel übernimmt api/index.ts.
const dist = resolve("dist");
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(resolve(dist, "index.html")));
}

const port = Number(process.env.PORT || 8787);
app.listen(port, async () => {
  const store = await getStore();
  console.log(`Stitchflow API läuft auf http://localhost:${port}`);
  console.log(`  Speicher: ${store.kind === "postgres" ? "Postgres (DATABASE_URL)" : "JSON-Datei (data/db.json)"}`);
  console.log(`  Shopify:  ${shopifyConfigured() ? process.env.SHOPIFY_STORE_DOMAIN : "Demo-Daten (nicht verbunden)"}`);
  console.log(`  Claude:   ${claudeConfigured() ? claudeModel() : "nicht verbunden"}`);
  console.log(`  Wissen:   ${vaultLabel()}`);
  if (shopifyConfigured()) {
    syncShopifyOrders().then(
      (r) => console.log(`  Shopify-Sync: ${r.imported} neu, ${r.updated} aktualisiert`),
      (e) => console.warn(`  Shopify-Sync fehlgeschlagen: ${e.message}`),
    );
  }
});
