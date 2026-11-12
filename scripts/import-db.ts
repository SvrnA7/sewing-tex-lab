// Überträgt eine lokale data/db.json (Betrieb auf dem Werkstatt-Rechner) in die Postgres-Datenbank.
// Aufruf: DATABASE_URL=… npm run import-db [pfad/zur/db.json]
import "dotenv/config";
import { readFileSync } from "node:fs";
import { getStore } from "../server/store.js";

const path = process.argv[2] ?? "data/db.json";
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL fehlt (Verbindungs-URL aus Neon bzw. Vercel → Storage).");
  process.exit(1);
}
const local = JSON.parse(readFileSync(path, "utf8"));
const store = await getStore();

const orders = local.orders ?? [];
await store.putOrders(orders);
const keep = new Set(orders.map((o: { id: string }) => o.id));
await store.deleteOrders((await store.listOrders()).filter((o) => !keep.has(o.id)).map((o) => o.id));

const materials = local.materials ?? [];
for (const m of materials) await store.putMaterial(m);
for (const m of await store.listMaterials()) if (!materials.some((x: { id: string }) => x.id === m.id)) await store.deleteMaterial(m.id);

if (local.settings) await store.putSettings(local.settings);
const lastSync = local.meta?.lastShopifySync ?? local.lastShopifySync;
if (lastSync) await store.setMeta("lastShopifySync", lastSync);
for (const f of local.files ?? []) await store.putFile(f);

console.log(`Übertragen: ${orders.length} Aufträge, ${materials.length} Materialien, Einstellungen.`);
process.exit(0);
