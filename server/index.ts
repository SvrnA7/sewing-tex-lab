import "dotenv/config";
import express from "express";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { STAGES, statusGroup, stockTone, type Integrations, type Material, type Order, type Stage, type Stats } from "../shared/types";
import { claudeConfigured, claudeModel, streamAgentReply, type ChatTurn } from "./agent";
import { addNote, listNotes, obsidianConfigured, readNote, searchNotes, vaultPath } from "./obsidian";
import { pushStageTag, shopifyConfigured, shopifyLastError, syncShopifyOrders, upsertFromWebhook, verifyWebhook } from "./shopify";
import { getDb, loadDb, saveDb } from "./store";

loadDb();
const app = express();

// Shopify-Webhooks brauchen den Rohtext für die HMAC-Prüfung – daher vor express.json().
app.post("/api/webhooks/shopify", express.raw({ type: "*/*", limit: "2mb" }), (req, res) => {
  if (!verifyWebhook(req.body as Buffer, req.header("X-Shopify-Hmac-Sha256"))) return res.status(401).send("invalid hmac");
  const topic = req.header("X-Shopify-Topic") ?? "";
  if (topic.startsWith("orders/")) upsertFromWebhook(JSON.parse((req.body as Buffer).toString("utf8")));
  res.status(200).send("ok");
});

app.use(express.json({ limit: "25mb" }));

const dayKey = (d: Date | string) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
};
const monthKey = (d: Date | string) => dayKey(d).slice(0, 7);
const pieces = (o: Order) => o.items.reduce((n, i) => n + i.quantity, 0) || 1;

function computeStats(): Stats {
  const db = getDb();
  const now = new Date();
  const today = dayKey(now);
  const thisMonth = monthKey(now);
  const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonth = monthKey(lastMonthDate);

  const done = db.orders.filter((o) => o.stage === "Fertig");
  const piecesOn = (key: string) => done.filter((o) => o.completedAt && dayKey(o.completedAt) === key).reduce((n, o) => n + pieces(o), 0);
  const todayDone = piecesOn(today);
  const goal = db.settings.dailyGoal;

  const revenueIn = (key: string) => db.orders.filter((o) => monthKey(o.createdAt) === key).reduce((s, o) => s + o.total, 0);
  const revenueByMonth = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - 5 + i, 1);
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
app.get("/api/orders", (_req, res) => {
  res.json([...getDb().orders].sort((a, b) => a.dueDate.localeCompare(b.dueDate)));
});

app.post("/api/orders", (req, res) => {
  const db = getDb();
  const b = req.body as Partial<Order>;
  if (!b.customer || !b.items?.length) return res.status(400).json({ error: "Kunde und mindestens eine Position sind nötig." });
  const now = new Date().toISOString();
  const maxNo = Math.max(1000, ...db.orders.map((o) => Number(o.name.replace(/\D/g, "")) || 0));
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
  db.orders.push(order);
  saveDb();
  res.status(201).json(order);
});

app.patch("/api/orders/:id", async (req, res) => {
  const db = getDb();
  const order = db.orders.find((o) => o.id === req.params.id);
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
  saveDb();
  let warning: string | undefined;
  if (order.stage !== previous) {
    try {
      await pushStageTag(order, previous);
    } catch (err) {
      warning = `Shopify-Tag konnte nicht gesetzt werden: ${(err as Error).message}`;
    }
  }
  res.json({ order, warning });
});

app.delete("/api/orders/:id", (req, res) => {
  const db = getDb();
  const order = db.orders.find((o) => o.id === req.params.id);
  if (!order) return res.status(404).end();
  if (order.source === "shopify" && order.id.startsWith("gid://")) return res.status(400).json({ error: "Shopify-Aufträge werden in Shopify storniert." });
  db.orders = db.orders.filter((o) => o.id !== order.id);
  saveDb();
  res.status(204).end();
});

app.post("/api/shopify/sync", async (_req, res) => {
  if (!shopifyConfigured()) return res.status(400).json({ error: "Shopify ist nicht verbunden. Trage SHOPIFY_STORE_DOMAIN und SHOPIFY_ADMIN_TOKEN in .env ein." });
  try {
    res.json(await syncShopifyOrders());
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

// ── Kennzahlen & Einstellungen ─────────────────────────
app.get("/api/stats", (_req, res) => res.json(computeStats()));

app.get("/api/settings", (_req, res) => res.json(getDb().settings));
app.put("/api/settings", (req, res) => {
  const db = getDb();
  const { dailyGoal, workshopName, ownerName } = req.body;
  if (dailyGoal !== undefined) db.settings.dailyGoal = Math.max(1, Math.round(Number(dailyGoal)) || 1);
  if (workshopName) db.settings.workshopName = String(workshopName);
  if (ownerName) db.settings.ownerName = String(ownerName);
  saveDb();
  res.json(db.settings);
});

app.get("/api/integrations", (_req, res) => {
  const db = getDb();
  const body: Integrations = {
    shopify: {
      connected: shopifyConfigured() && !shopifyLastError(),
      shop: process.env.SHOPIFY_STORE_DOMAIN || undefined,
      lastSync: db.lastShopifySync,
      error: shopifyLastError(),
      demo: !shopifyConfigured(),
    },
    claude: { connected: claudeConfigured(), model: claudeModel() },
    obsidian: { connected: obsidianConfigured() && existsSync(vaultPath()), vault: obsidianConfigured() ? vaultPath() : undefined, notes: listNotes(0).total, demo: !obsidianConfigured() },
  };
  res.json(body);
});

// ── Textillager ────────────────────────────────────────
app.get("/api/materials", (_req, res) => res.json(getDb().materials));

app.post("/api/materials", (req, res) => {
  const db = getDb();
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
  db.materials.push(m);
  saveDb();
  res.status(201).json(m);
});

app.patch("/api/materials/:id", (req, res) => {
  const db = getDb();
  const m = db.materials.find((x) => x.id === req.params.id);
  if (!m) return res.status(404).end();
  const b = req.body as Partial<Material> & { adjust?: number };
  if (typeof b.adjust === "number") m.amount = Math.max(0, Math.round((m.amount + b.adjust) * 100) / 100);
  for (const k of ["name", "detail", "unit", "supplier"] as const) if (b[k] !== undefined) m[k] = String(b[k]);
  for (const k of ["amount", "minAmount", "capacity", "pricePerUnit"] as const) if (b[k] !== undefined) m[k] = Number(b[k]) || 0;
  m.updatedAt = new Date().toISOString();
  saveDb();
  res.json(m);
});

app.delete("/api/materials/:id", (req, res) => {
  const db = getDb();
  db.materials = db.materials.filter((m) => m.id !== req.params.id);
  saveDb();
  res.status(204).end();
});

// ── Textil-Lab: Wissen & Agent ─────────────────────────
app.get("/api/knowledge", (req, res) => {
  const q = String(req.query.q ?? "").trim();
  if (q) return res.json({ notes: searchNotes(q, 30).map(({ body: _b, ...n }) => n), total: listNotes(0).total });
  res.json(listNotes(Number(req.query.limit) || 200));
});

app.get("/api/knowledge/note", (req, res) => {
  const note = readNote(String(req.query.path ?? ""));
  if (!note) return res.status(404).json({ error: "Notiz nicht gefunden" });
  res.json(note);
});

app.post("/api/knowledge", (req, res) => {
  const { type, title, content, file } = req.body ?? {};
  if (!title?.trim()) return res.status(400).json({ error: "Titel fehlt" });
  try {
    res.status(201).json(addNote({ type: type || "Hinweis", title: title.trim(), content: content ?? "", file }));
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post("/api/agent/chat", async (req, res) => {
  const history = (req.body?.messages ?? []) as ChatTurn[];
  const clean = history
    .filter((t) => (t.role === "user" || t.role === "assistant") && typeof t.content === "string" && t.content.trim())
    .slice(-20);
  if (!clean.length || clean[clean.length - 1].role !== "user") return res.status(400).json({ error: "Frage fehlt" });
  await streamAgentReply(clean, res);
});

// ── Produktion: gebautes Frontend ausliefern ───────────
const dist = resolve("dist");
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(resolve(dist, "index.html")));
}

const port = Number(process.env.PORT || 8787);
app.listen(port, () => {
  console.log(`Stitchflow API läuft auf http://localhost:${port}`);
  console.log(`  Shopify:  ${shopifyConfigured() ? process.env.SHOPIFY_STORE_DOMAIN : "Demo-Daten (nicht verbunden)"}`);
  console.log(`  Claude:   ${claudeConfigured() ? claudeModel() : "nicht verbunden"}`);
  console.log(`  Obsidian: ${obsidianConfigured() ? vaultPath() : `Demo-Vault (${vaultPath()})`}`);
  if (shopifyConfigured()) {
    syncShopifyOrders().then(
      (r) => console.log(`  Shopify-Sync: ${r.imported} neu, ${r.updated} aktualisiert`),
      (e) => console.warn(`  Shopify-Sync fehlgeschlagen: ${e.message}`),
    );
    // Alle 5 Minuten nachladen, falls keine Webhooks eingerichtet sind
    setInterval(() => syncShopifyOrders().catch(() => {}), 5 * 60 * 1000);
  }
});
