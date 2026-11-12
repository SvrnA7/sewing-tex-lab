import "dotenv/config";
import express from "express";
import { randomUUID } from "node:crypto";
import { STAGES, statusGroup, stockTone, type Integrations, type Material, type Order, type Stage, type Stats } from "../shared/types.js";
import { claudeConfigured, claudeModel, streamAgentReply, type ChatTurn } from "./agent.js";
import { authEnabled, login, logout, requireLogin } from "./auth.js";
import { addNote, listNotes, obsidianConfigured, readNote, searchNotes, vaultLabel, vaultSource } from "./obsidian.js";
import { pushStageTag, shopifyConfigured, shopifyLastError, syncShopifyOrders, upsertFromWebhook, verifyWebhook } from "./shopify.js";
import { getStore, onVercel } from "./store.js";

export const app = express();
app.set("trust proxy", true);

/** Express 4 fängt Fehler aus async-Handlern nicht ab – dieser Wrapper leitet sie weiter. */
type Handler = (req: express.Request, res: express.Response) => unknown;
const h = (fn: Handler): express.RequestHandler => (req, res, next) => {
  Promise.resolve(fn(req, res)).catch(next);
};

// Shopify-Webhooks brauchen den Rohtext für die HMAC-Prüfung – daher vor express.json().
app.post("/api/webhooks/shopify", express.raw({ type: "*/*", limit: "2mb" }), h(async (req, res) => {
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from(typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? {}));
  if (!verifyWebhook(raw, req.header("X-Shopify-Hmac-Sha256"))) return res.status(401).send("invalid hmac");
  const topic = req.header("X-Shopify-Topic") ?? "";
  if (topic.startsWith("orders/")) await upsertFromWebhook(JSON.parse(raw.toString("utf8")));
  res.status(200).send("ok");
}));

// Vercel-Limit für Anfragen liegt bei 4,5 MB
app.use(express.json({ limit: onVercel() ? "4mb" : "25mb" }));

// Täglicher Abgleich per Vercel Cron (zusätzlich zu Webhooks und dem Abgleich beim Öffnen der App)
app.get("/api/cron/shopify-sync", h(async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (secret && req.header("authorization") !== `Bearer ${secret}`) return res.status(401).end();
  if (!shopifyConfigured()) return res.json({ skipped: true });
  res.json(await syncShopifyOrders());
}));

app.post("/api/login", login);
app.post("/api/logout", logout);
app.get("/api/session", (req, res) => res.json({ authEnabled: authEnabled() }));
app.use("/api", requireLogin);

// Tage werden in der Zeitzone der Werkstatt gezählt (Vercel-Server laufen in UTC).
const dayFormat = new Intl.DateTimeFormat("en-CA", { timeZone: process.env.APP_TIMEZONE || "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit" });
const dayKey = (d: Date | string) => dayFormat.format(new Date(d));
const monthKey = (d: Date | string) => dayKey(d).slice(0, 7);
const pieces = (o: Order) => o.items.reduce((n, i) => n + i.quantity, 0) || 1;

async function computeStats(): Promise<Stats> {
  const store = await getStore();
  const db = { orders: await store.listOrders(), materials: await store.listMaterials(), settings: await store.getSettings() };
  const now = new Date();
  const today = dayKey(now);
  const thisMonth = monthKey(now);
  const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 15);
  const lastMonth = monthKey(lastMonthDate);

  const done = db.orders.filter((o) => o.stage === "Fertig");
  const piecesOn = (key: string) => done.filter((o) => o.completedAt && dayKey(o.completedAt) === key).reduce((n, o) => n + pieces(o), 0);
  const todayDone = piecesOn(today);
  const goal = db.settings.dailyGoal;

  const revenueIn = (key: string) => db.orders.filter((o) => monthKey(o.createdAt) === key).reduce((s, o) => s + o.total, 0);
  const revenueByMonth = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - 5 + i, 15);
    return { month: monthKey(d), revenue: Math.round(revenueIn(monthKey(d)) * 100) / 100 };
  });
  const last7Days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(now);
    d.setDate(d.getDate() - 6 + i);
    return { date: dayKey(d), done: piecesOn(dayKey(d)) };
  });
  const inProgress = db.orders.filter((o) => statusGroup(o.stage) === "in_bearbeitung");

  return {
    open: db.orders.filter((o) => o.stage === "Offen").length,
    inProgress: inProgress.length,
    completed: done.length,
    dueToday: db.orders.filter((o) => o.stage !== "Fertig" && dayKey(o.dueDate) <= today).length,
    activeStations: new Set(inProgress.map((o) => o.stage)).size,
    completedThisMonth: done.filter((o) => o.completedAt && monthKey(o.completedAt) === thisMonth).length,
    completedLastMonth: done.filter((o) => o.completedAt && monthKey(o.completedAt) === lastMonth).length,
    revenueMonth: revenueIn(thisMonth),
    revenueLastMonth: revenueIn(lastMonth),
    currency: db.orders[0]?.currency ?? "EUR",
    today: { done: todayDone, goal, remaining: Math.max(goal - todayDone, 0), percent: goal ? Math.min(Math.round((todayDone / goal) * 100), 100) : 0 },
    last7Days,
    revenueByMonth,
    lowStock: db.materials.filter((m) => stockTone(m) !== "good").length,
  };
}

// ── Aufträge ───────────────────────────────────────────
const SYNC_EVERY_MS = 5 * 60 * 1000;
let syncing: Promise<unknown> | undefined;

/** Ersetzt den 5-Minuten-Timer: Beim Laden der Aufträge wird nachgeholt, wenn der letzte Abgleich zu alt ist. */
async function syncIfStale() {
  if (!shopifyConfigured()) return;
  const last = await (await getStore()).getMeta("lastShopifySync");
  if (last && Date.now() - new Date(last).getTime() < SYNC_EVERY_MS) return;
  syncing ??= syncShopifyOrders().catch(() => {}).finally(() => (syncing = undefined));
  await syncing;
}

app.get("/api/orders", h(async (_req, res) => {
  await syncIfStale();
  const orders = await (await getStore()).listOrders();
  res.json(orders.sort((a, b) => a.dueDate.localeCompare(b.dueDate)));
}));

app.post("/api/orders", h(async (req, res) => {
  const store = await getStore();
  const b = req.body as Partial<Order>;
  if (!b.customer || !b.items?.length) return res.status(400).json({ error: "Kunde und mindestens eine Position sind nötig." });
  const now = new Date().toISOString();
  const maxNo = Math.max(1000, ...(await store.listOrders()).map((o) => Number(o.name.replace(/\D/g, "")) || 0));
  const order: Order = {
    id: `local-${randomUUID()}`,
    name: `#${maxNo + 1}`,
    source: "manuell",
    customer: b.customer,
    items: b.items,
    total: Number(b.total) || 0,
    currency: b.currency || "EUR",
    createdAt: now,
    dueDate: b.dueDate || now,
    stage: "Offen",
    priority: Boolean(b.priority),
    notes: b.notes ?? "",
    stageHistory: [{ stage: "Offen", at: now }],
  };
  await store.putOrders([order]);
  res.status(201).json(order);
}));

app.patch("/api/orders/:id", h(async (req, res) => {
  const store = await getStore();
  const order = await store.getOrder(req.params.id);
  if (!order) return res.status(404).json({ error: "Auftrag nicht gefunden" });
  const { stage, notes, priority, dueDate } = req.body as Partial<Order>;
  const previous = order.stage;
  if (stage && stage !== order.stage) {
    if (!STAGES.includes(stage as Stage)) return res.status(400).json({ error: "Unbekannte Stufe" });
    order.stage = stage;
    const at = new Date().toISOString();
    order.stageHistory.push({ stage, at });
    order.completedAt = stage === "Fertig" ? at : undefined;
  }
  if (notes !== undefined) order.notes = notes;
  if (priority !== undefined) order.priority = priority;
  if (dueDate) order.dueDate = dueDate;
  await store.putOrders([order]);
  let warning: string | undefined;
  if (order.stage !== previous) {
    try {
      await pushStageTag(order, previous);
    } catch (err) {
      warning = `Shopify-Tag konnte nicht gesetzt werden: ${(err as Error).message}`;
    }
  }
  res.json({ order, warning });
}));

app.delete("/api/orders/:id", h(async (req, res) => {
  const store = await getStore();
  const order = await store.getOrder(req.params.id);
  if (!order) return res.status(404).end();
  if (order.source === "shopify" && order.id.startsWith("gid://")) return res.status(400).json({ error: "Shopify-Aufträge werden in Shopify storniert." });
  await store.deleteOrders([order.id]);
  res.status(204).end();
}));

app.post("/api/shopify/sync", h(async (_req, res) => {
  if (!shopifyConfigured()) return res.status(400).json({ error: "Shopify ist nicht verbunden. Trage SHOPIFY_STORE_DOMAIN und SHOPIFY_ADMIN_TOKEN als Umgebungsvariablen ein." });
  try {
    res.json(await syncShopifyOrders());
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
}));

// ── Kennzahlen & Einstellungen ─────────────────────────
app.get("/api/stats", h(async (_req, res) => res.json(await computeStats())));

app.get("/api/settings", h(async (_req, res) => res.json(await (await getStore()).getSettings())));
app.put("/api/settings", h(async (req, res) => {
  const store = await getStore();
  const settings = await store.getSettings();
  const { dailyGoal, workshopName, ownerName } = req.body;
  if (dailyGoal !== undefined) settings.dailyGoal = Math.max(1, Math.round(Number(dailyGoal)) || 1);
  if (workshopName) settings.workshopName = String(workshopName);
  if (ownerName) settings.ownerName = String(ownerName);
  await store.putSettings(settings);
  res.json(settings);
}));

app.get("/api/integrations", h(async (_req, res) => {
  const store = await getStore();
  const error = await shopifyLastError();
  let notes = 0;
  let vaultError: string | undefined;
  try {
    notes = (await listNotes(0)).total;
  } catch (err) {
    vaultError = (err as Error).message;
  }
  const body: Integrations = {
    shopify: {
      connected: shopifyConfigured() && !error,
      shop: process.env.SHOPIFY_STORE_DOMAIN || undefined,
      lastSync: await store.getMeta("lastShopifySync"),
      error,
      demo: !shopifyConfigured(),
    },
    claude: { connected: claudeConfigured(), model: claudeModel() },
    obsidian: { connected: obsidianConfigured() && !vaultError, vault: vaultError ?? vaultLabel(), notes, demo: !obsidianConfigured(), source: vaultSource() },
    storage: { kind: store.kind, persistent: store.persistent },
    auth: { enabled: authEnabled(), hosted: onVercel() },
  };
  res.json(body);
}));

// ── Textillager ────────────────────────────────────────
app.get("/api/materials", h(async (_req, res) => res.json(await (await getStore()).listMaterials())));

app.post("/api/materials", h(async (req, res) => {
  const b = req.body as Partial<Material>;
  if (!b.name) return res.status(400).json({ error: "Name fehlt" });
  const m: Material = {
    id: randomUUID(),
    name: b.name,
    detail: b.detail ?? "",
    unit: b.unit || "m",
    amount: Number(b.amount) || 0,
    minAmount: Number(b.minAmount) || 0,
    capacity: Number(b.capacity) || Math.max(Number(b.amount) || 0, 1),
    supplier: b.supplier ?? "",
    pricePerUnit: Number(b.pricePerUnit) || 0,
    updatedAt: new Date().toISOString(),
  };
  await (await getStore()).putMaterial(m);
  res.status(201).json(m);
}));

app.patch("/api/materials/:id", h(async (req, res) => {
  const store = await getStore();
  const m = await store.getMaterial(req.params.id);
  if (!m) return res.status(404).end();
  const b = req.body as Partial<Material> & { adjust?: number };
  if (typeof b.adjust === "number") m.amount = Math.max(0, Math.round((m.amount + b.adjust) * 100) / 100);
  for (const k of ["name", "detail", "unit", "supplier"] as const) if (b[k] !== undefined) m[k] = String(b[k]);
  for (const k of ["amount", "minAmount", "capacity", "pricePerUnit"] as const) if (b[k] !== undefined) m[k] = Number(b[k]) || 0;
  m.updatedAt = new Date().toISOString();
  await store.putMaterial(m);
  res.json(m);
}));

app.delete("/api/materials/:id", h(async (req, res) => {
  await (await getStore()).deleteMaterial(req.params.id);
  res.status(204).end();
}));

// ── Textil-Lab: Wissen & Agent ─────────────────────────
app.get("/api/knowledge", h(async (req, res) => {
  const q = String(req.query.q ?? "").trim();
  if (q) return res.json({ notes: (await searchNotes(q, 30)).map(({ body: _b, ...n }) => n), total: (await listNotes(0)).total });
  res.json(await listNotes(Number(req.query.limit) || 200));
}));

app.get("/api/knowledge/note", h(async (req, res) => {
  const note = await readNote(String(req.query.path ?? ""));
  if (!note) return res.status(404).json({ error: "Notiz nicht gefunden" });
  res.json(note);
}));

app.post("/api/knowledge", h(async (req, res) => {
  const { type, title, content, file } = req.body ?? {};
  if (!title?.trim()) return res.status(400).json({ error: "Titel fehlt" });
  try {
    res.status(201).json(await addNote({ type: type || "Hinweis", title: title.trim(), content: content ?? "", file }));
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
}));

app.post("/api/agent/chat", h(async (req, res) => {
  const history = (req.body?.messages ?? []) as ChatTurn[];
  const clean = history
    .filter((t) => (t.role === "user" || t.role === "assistant") && typeof t.content === "string" && t.content.trim())
    .slice(-20);
  if (!clean.length || clean[clean.length - 1].role !== "user") return res.status(400).json({ error: "Frage fehlt" });
  await streamAgentReply(clean, res);
}));

app.use((err: Error & { type?: string }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err.type === "entity.too.large") return res.status(413).json({ error: "Die Datei ist zu groß (auf Vercel max. ca. 3 MB)." });
  console.error(err);
  if (!res.headersSent) res.status(500).json({ error: err.message || "Serverfehler" });
});
