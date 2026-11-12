import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { STAGES, type Material, type Order, type Settings, type Stage } from "../shared/types.js";

/**
 * Datenspeicher der App. Zwei Varianten mit derselben Schnittstelle:
 * - Postgres (z. B. Neon), sobald DATABASE_URL gesetzt ist. Nötig auf Vercel,
 *   weil dort das Dateisystem nicht dauerhaft ist.
 * - JSON-Datei data/db.json für den lokalen Betrieb ohne Datenbank.
 */
export interface StoredFile {
  path: string;
  content: string;
  encoding: "utf8" | "base64";
  updatedAt: string;
}

export interface Store {
  kind: "postgres" | "datei";
  /** false, wenn Daten nur vorübergehend liegen (Vercel ohne Datenbank) */
  persistent: boolean;
  listOrders(): Promise<Order[]>;
  getOrder(id: string): Promise<Order | undefined>;
  putOrders(orders: Order[]): Promise<void>;
  deleteOrders(ids: string[]): Promise<void>;
  listMaterials(): Promise<Material[]>;
  getMaterial(id: string): Promise<Material | undefined>;
  putMaterial(m: Material): Promise<void>;
  deleteMaterial(id: string): Promise<void>;
  getSettings(): Promise<Settings>;
  putSettings(s: Settings): Promise<void>;
  getMeta(key: string): Promise<string | undefined>;
  setMeta(key: string, value: string): Promise<void>;
  /** Notizen der eingebauten Wissensbasis (wenn kein Obsidian-Vault angebunden ist) */
  listFiles(): Promise<StoredFile[]>;
  getFile(path: string): Promise<StoredFile | undefined>;
  putFile(file: Omit<StoredFile, "updatedAt">): Promise<void>;
}

// ── Demo-Daten ─────────────────────────────────────────
function iso(daysFromNow: number, hour = 12) {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

function demoOrder(
  n: number,
  title: string,
  customer: string,
  variant: string,
  qty: number,
  total: number,
  createdDaysAgo: number,
  dueInDays: number,
  stage: Stage,
  priority = false,
): Order {
  const createdAt = iso(-createdDaysAgo, 9);
  const stageIndex = STAGES.indexOf(stage);
  const history = STAGES.slice(0, stageIndex + 1).map((s, i) => ({
    stage: s,
    at: iso(-createdDaysAgo + Math.min(i, createdDaysAgo), 9 + i),
  }));
  const order: Order = {
    id: `demo-${n}`,
    name: `#${n}`,
    source: "shopify",
    customer,
    items: [{ title, variant, quantity: qty }],
    total,
    currency: "EUR",
    createdAt,
    dueDate: iso(dueInDays, dueInDays === 0 ? 16 : 18),
    stage,
    priority,
    notes: "",
    financialStatus: "PAID",
    fulfillmentStatus: stage === "Fertig" ? "FULFILLED" : "UNFULFILLED",
    stageHistory: history,
  };
  if (stage === "Fertig") order.completedAt = history[history.length - 1].at;
  return order;
}

function demoOrders(): Order[] {
  const orders: Order[] = [
    demoOrder(1048, "Oversize Hoodie Studio", "Mara Klein", "Sand · M · Rückenprint", 1, 129, 3, 0, "In Näharbeit", true),
    demoOrder(1047, "Workwear Jacke Custom", "Lukas Werner", "Navy · L · Stickerei", 1, 189, 4, 0, "Bedruckt"),
    demoOrder(1046, "Bucket Hat Canvas", "Jana Roth", "Natur · Einheitsgröße", 2, 78, 2, 2, "Offen"),
    demoOrder(1045, "Canvas Shopper", "Studio Cobalt", "Natur · Siebdruck", 12, 348, 5, 1, "Zuschnitt"),
    demoOrder(1044, "Boxy T-Shirt Essential", "Nina Sommer", "Offwhite · S · Brustprint", 1, 79, 6, 3, "Verpackt"),
    demoOrder(1043, "Crewneck French Terry", "Felix Brandt", "Navy · XL", 1, 99, 1, 4, "Offen"),
    demoOrder(1042, "Schürze Werkstatt", "Café Lindgrün", "Olive · Stickerei", 6, 294, 1, 6, "Offen"),
    demoOrder(1041, "Oversize Hoodie Studio", "Tom Becker", "Schwarz · L", 1, 129, 7, -1, "Fertig"),
    demoOrder(1040, "Boxy T-Shirt Essential", "Lea Hoffmann", "Sand · M · Rückenprint", 3, 237, 8, -2, "Fertig"),
    demoOrder(1039, "Canvas Shopper", "Buchladen Ost", "Natur · Siebdruck", 20, 560, 12, -4, "Fertig"),
    demoOrder(1038, "Workwear Jacke Custom", "Paul Kraus", "Olive · M", 1, 189, 34, -28, "Fertig"),
    demoOrder(1037, "Crewneck French Terry", "Emma Vogt", "Grau · S", 2, 198, 40, -33, "Fertig"),
  ];
  // Fertigstellungen der letzten Tage, damit Tagesziel und Verlauf im Demo-Modus leben
  const completeOn = (o: Order, daysAgo: number, hour: number) => {
    o.completedAt = iso(-daysAgo, hour);
    o.stageHistory[o.stageHistory.length - 1].at = o.completedAt;
  };
  completeOn(orders[7], 0, 10); // 1 Teil heute
  completeOn(orders[8], 0, 11); // 3 Teile heute
  completeOn(orders[9], 3, 15);
  orders.push(demoOrder(1036, "Kissenhülle Leinen", "Hotel Seeblick", "Natur · 40×40", 4, 156, 6, 0, "Fertig"));
  completeOn(orders[orders.length - 1], 0, 9); // 4 Teile heute → 8 / 12
  // Ältere Monate für die Umsatzkurve
  const titles = ["Oversize Hoodie Studio", "Canvas Shopper", "Boxy T-Shirt Essential", "Workwear Jacke Custom"];
  for (let i = 0; i < 26; i++) {
    const daysAgo = 14 + i * 6;
    const qty = 1 + (i % 4);
    const o = demoOrder(1010 + i, titles[i % 4], `Kunde ${i + 1}`, "Archiv", qty, 79 + (i % 5) * 37 + qty * 20, daysAgo + 5, -daysAgo, "Fertig");
    completeOn(o, daysAgo, 14);
    orders.push(o);
  }
  for (const [i, d] of [1, 2, 4, 5, 6].entries()) {
    const o = demoOrder(1100 + i, titles[i % 4], `Stammkunde ${i + 1}`, "Archiv", 6 + (i % 3) * 3, 120 + i * 30, d + 4, -d, "Fertig");
    completeOn(o, d, 16);
    orders.push(o);
  }
  return orders;
}

function demoMaterials(): Material[] {
  const now = new Date().toISOString();
  return [
    { id: "m1", name: "Heavy Jersey · Offwhite", detail: "220 g/m² · Rollenware", unit: "m", amount: 18.4, minAmount: 8, capacity: 25, supplier: "Stoffkontor Hamburg", pricePerUnit: 9.8, updatedAt: now },
    { id: "m2", name: "French Terry · Navy", detail: "320 g/m² · Rollenware", unit: "m", amount: 6.2, minAmount: 8, capacity: 22, supplier: "Stoffkontor Hamburg", pricePerUnit: 13.5, updatedAt: now },
    { id: "m3", name: "Bio Canvas · Natur", detail: "450 g/m² · Rollenware", unit: "m", amount: 3.8, minAmount: 8, capacity: 24, supplier: "Organic Textiles GmbH", pricePerUnit: 11.2, updatedAt: now },
    { id: "m4", name: "Bündchenware · Schwarz", detail: "Rippstrick · Schlauch", unit: "m", amount: 9.5, minAmount: 3, capacity: 12, supplier: "Stoffkontor Hamburg", pricePerUnit: 7.4, updatedAt: now },
    { id: "m5", name: "Nähgarn Polyester · Navy", detail: "5.000 m Kone", unit: "Kone", amount: 4, minAmount: 2, capacity: 8, supplier: "Amann", pricePerUnit: 6.9, updatedAt: now },
  ];
}

const defaultSettings = (): Settings => ({
  dailyGoal: 12,
  workshopName: process.env.WORKSHOP_NAME || "Studio Nord",
  ownerName: process.env.OWNER_NAME || "Sven",
});

const DEMO_NOTES: Record<string, string> = {
  "Textil-Lab/Materialguide French Terry.md": `---
typ: Hinweis
tags: [material, french-terry]
---
# Materialguide French Terry

- Gewicht 280–340 g/m², Schlingenseite innen.
- Nadel: Jersey/Stretch 90/14, bei 320 g+ eher 100/16.
- Overlock: Differentialtransport 1,3–1,5, damit die Kante nicht wellt.
- Covermaschine für Säume, Stichlänge 3,5 mm.
- Vor dem Zuschnitt waschen (Einsprung bis 5 %).
`,
  "Textil-Lab/Nahtzugaben Hoodie V3.md": `---
typ: Produktionsnotiz
tags: [hoodie, schnitt]
---
# Nahtzugaben · Hoodie V3

- Seitennähte & Ärmel: 1 cm (Overlock).
- Kapuze Mittelnaht: 1 cm, mit Flachnaht absteppen.
- Bündchen: 0,75 cm, Bündchen 15 % kürzer als Öffnung zuschneiden.
- Kängurutasche: 2 cm Umschlag oben.
`,
  "Textil-Lab/Siebdruck Raster & Belichtung.md": `---
typ: Referenz
tags: [siebdruck, druck]
---
# Siebdruck Raster & Belichtung

- Canvas 450 g: Gewebe 43T, Plastisol oder Wasserbasis mit Fixierer.
- Belichtung 120 s bei 4.000 W LED, Abstand 50 cm.
- Raster 35 lpi für Halbtöne auf grobem Gewebe.
- Fixieren: 160 °C, 3 min im Tunneltrockner bzw. 2× Bügelpresse 20 s.
- Canvas vor dem Druck glatt pressen, damit die Farbe nicht bricht.
`,
  "Textil-Lab/Heavy Jersey Verarbeitung.md": `---
typ: Hinweis
tags: [material, jersey, t-shirt]
---
# Heavy Jersey Verarbeitung

- 220 g/m², Ringgarn, geringe Rollneigung.
- Nadel 80/12 Jersey, Overlock DT 1,2.
- Halsbündchen 1x1 Rib, 85 % der Halsausschnittlänge.
- DTF-Druck: 150 °C, 12 s, kalt abziehen.
`,
};

const shopifyConfiguredForSeed = () => Boolean(process.env.SHOPIFY_STORE_DOMAIN?.trim() && process.env.SHOPIFY_ADMIN_TOKEN?.trim());

/** Startdaten für einen leeren Speicher: Demo-Aufträge und -Lager nur ohne Shopify-Anbindung. */
async function seed(store: Store) {
  if (await store.getMeta("seeded")) return;
  await store.putSettings(defaultSettings());
  if (!shopifyConfiguredForSeed()) {
    await store.putOrders(demoOrders());
    for (const m of demoMaterials()) await store.putMaterial(m);
  }
  for (const [path, content] of Object.entries(DEMO_NOTES)) await store.putFile({ path, content, encoding: "utf8" });
  await store.setMeta("seeded", new Date().toISOString());
}

// ── Variante 1: JSON-Datei ─────────────────────────────
interface FileDb {
  orders: Order[];
  materials: Material[];
  settings: Settings;
  meta: Record<string, string>;
  files: StoredFile[];
}

function fileStore(path: string, persistent: boolean): Store {
  let db: FileDb | undefined;
  const load = (): FileDb => {
    if (db) return db;
    const empty: FileDb = { orders: [], materials: [], settings: defaultSettings(), meta: {}, files: [] };
    if (existsSync(path)) {
      const raw = JSON.parse(readFileSync(path, "utf8"));
      db = { ...empty, ...raw };
      // Ältere db.json (vor der Umstellung) hatte lastShopifySync auf oberster Ebene
      if (raw.lastShopifySync && !db!.meta.lastShopifySync) db!.meta.lastShopifySync = raw.lastShopifySync;
      if (!db!.meta.seeded && raw.orders) db!.meta.seeded = "migriert";
    } else db = empty;
    return db!;
  };
  const save = () => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(`${path}.tmp`, JSON.stringify(db, null, 2));
    renameSync(`${path}.tmp`, path);
  };
  const upsert = <T extends { id: string }>(list: T[], item: T) => {
    const i = list.findIndex((x) => x.id === item.id);
    if (i === -1) list.push(item);
    else list[i] = item;
  };
  return {
    kind: "datei",
    persistent,
    listOrders: async () => load().orders,
    getOrder: async (id) => load().orders.find((o) => o.id === id),
    putOrders: async (orders) => { const d = load(); for (const o of orders) upsert(d.orders, o); save(); },
    deleteOrders: async (ids) => { const d = load(); d.orders = d.orders.filter((o) => !ids.includes(o.id)); save(); },
    listMaterials: async () => load().materials,
    getMaterial: async (id) => load().materials.find((m) => m.id === id),
    putMaterial: async (m) => { upsert(load().materials, m); save(); },
    deleteMaterial: async (id) => { const d = load(); d.materials = d.materials.filter((m) => m.id !== id); save(); },
    getSettings: async () => load().settings,
    putSettings: async (s) => { load().settings = s; save(); },
    getMeta: async (key) => load().meta[key],
    setMeta: async (key, value) => { load().meta[key] = value; save(); },
    listFiles: async () => load().files,
    getFile: async (p) => load().files.find((f) => f.path === p),
    putFile: async (f) => {
      const d = load();
      d.files = d.files.filter((x) => x.path !== f.path);
      d.files.push({ ...f, updatedAt: new Date().toISOString() });
      save();
    },
  };
}

// ── Variante 2: Postgres (Neon) ────────────────────────
type Query = (text: string, params?: unknown[]) => Promise<any[]>;

async function connect(url: string): Promise<Query> {
  // Lokale Postgres-Instanz (Entwicklung) über pg, sonst Neons HTTP-Treiber für Serverless
  if (/@(localhost|127\.0\.0\.1)[:/]/.test(url)) {
    const { default: pg } = await import("pg");
    const pool = new pg.Pool({ connectionString: url });
    return async (text, params) => (await pool.query(text, params)).rows;
  }
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(url);
  return (text, params) => sql.query(text, params ?? []) as Promise<any[]>;
}

const SCHEMA = `
create table if not exists orders (id text primary key, data jsonb not null, updated_at timestamptz not null default now());
create table if not exists materials (id text primary key, data jsonb not null);
create table if not exists kv (key text primary key, value jsonb not null);
create table if not exists files (path text primary key, content text not null, encoding text not null default 'utf8', updated_at timestamptz not null default now());
`;

async function postgresStore(url: string): Promise<Store> {
  const q = await connect(url);
  for (const stmt of SCHEMA.split(";").map((s) => s.trim()).filter(Boolean)) await q(stmt);
  const getKv = async (key: string) => (await q("select value from kv where key = $1", [key]))[0]?.value;
  const setKv = (key: string, value: unknown) =>
    q("insert into kv (key, value) values ($1, $2) on conflict (key) do update set value = excluded.value", [key, JSON.stringify(value)]);
  const toFile = (r: any): StoredFile => ({ path: r.path, content: r.content, encoding: r.encoding, updatedAt: new Date(r.updated_at).toISOString() });
  return {
    kind: "postgres",
    persistent: true,
    listOrders: async () => (await q("select data from orders")).map((r) => r.data),
    getOrder: async (id) => (await q("select data from orders where id = $1", [id]))[0]?.data,
    putOrders: async (orders) => {
      if (!orders.length) return;
      await q(
        `insert into orders (id, data, updated_at)
         select x->>'id', x, now() from jsonb_array_elements($1::jsonb) as x
         on conflict (id) do update set data = excluded.data, updated_at = now()`,
        [JSON.stringify(orders)],
      );
    },
    deleteOrders: async (ids) => { if (ids.length) await q("delete from orders where id = any($1::text[])", [ids]); },
    listMaterials: async () => (await q("select data from materials")).map((r) => r.data),
    getMaterial: async (id) => (await q("select data from materials where id = $1", [id]))[0]?.data,
    putMaterial: async (m) => {
      await q("insert into materials (id, data) values ($1, $2) on conflict (id) do update set data = excluded.data", [m.id, JSON.stringify(m)]);
    },
    deleteMaterial: async (id) => { await q("delete from materials where id = $1", [id]); },
    getSettings: async () => ({ ...defaultSettings(), ...(await getKv("settings")) }),
    putSettings: async (s) => { await setKv("settings", s); },
    getMeta: async (key) => (await getKv(`meta:${key}`)) ?? undefined,
    setMeta: async (key, value) => { await setKv(`meta:${key}`, value); },
    listFiles: async () => (await q("select path, content, encoding, updated_at from files")).map(toFile),
    getFile: async (p) => {
      const r = (await q("select path, content, encoding, updated_at from files where path = $1", [p]))[0];
      return r ? toFile(r) : undefined;
    },
    putFile: async (f) => {
      await q(
        `insert into files (path, content, encoding, updated_at) values ($1, $2, $3, now())
         on conflict (path) do update set content = excluded.content, encoding = excluded.encoding, updated_at = now()`,
        [f.path, f.content, f.encoding],
      );
    },
  };
}

// ── Auswahl ────────────────────────────────────────────
export const onVercel = () => Boolean(process.env.VERCEL);

let ready: Promise<Store> | undefined;

/** Liefert den Speicher; beim ersten Aufruf werden Tabellen angelegt und Startdaten eingespielt. */
export function getStore(): Promise<Store> {
  ready ??= (async () => {
    const url = process.env.DATABASE_URL?.trim() || process.env.POSTGRES_URL?.trim();
    const store = url
      ? await postgresStore(url)
      : onVercel()
        ? fileStore("/tmp/stitchflow-db.json", false) // Vercel: nur /tmp ist beschreibbar und wird regelmäßig geleert
        : fileStore(resolve(process.env.DATA_DIR ?? "data", "db.json"), true);
    await seed(store);
    return store;
  })();
  ready.catch(() => (ready = undefined));
  return ready;
}

/** Entfernt Demo-Aufträge, sobald echte Shopify-Daten kommen. */
export async function dropDemoOrders(store: Store) {
  const demo = (await store.listOrders()).filter((o) => o.id.startsWith("demo-")).map((o) => o.id);
  await store.deleteOrders(demo);
}
