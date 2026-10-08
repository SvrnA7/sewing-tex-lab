import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { STAGES, type Material, type Order, type Settings, type Stage } from "../shared/types";

export interface Db {
  orders: Order[];
  materials: Material[];
  settings: Settings;
  /** Datum (YYYY-MM-DD) → fertiggestellte Teile, als Historie fürs Tagesziel */
  lastShopifySync?: string;
}

const DB_PATH = resolve(process.env.DATA_DIR ?? "data", "db.json");

let db: Db;

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

function seed(): Db {
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

  const now = new Date().toISOString();
  const materials: Material[] = [
    { id: "m1", name: "Heavy Jersey · Offwhite", detail: "220 g/m² · Rollenware", unit: "m", amount: 18.4, minAmount: 8, capacity: 25, supplier: "Stoffkontor Hamburg", pricePerUnit: 9.8, updatedAt: now },
    { id: "m2", name: "French Terry · Navy", detail: "320 g/m² · Rollenware", unit: "m", amount: 6.2, minAmount: 8, capacity: 22, supplier: "Stoffkontor Hamburg", pricePerUnit: 13.5, updatedAt: now },
    { id: "m3", name: "Bio Canvas · Natur", detail: "450 g/m² · Rollenware", unit: "m", amount: 3.8, minAmount: 8, capacity: 24, supplier: "Organic Textiles GmbH", pricePerUnit: 11.2, updatedAt: now },
    { id: "m4", name: "Bündchenware · Schwarz", detail: "Rippstrick · Schlauch", unit: "m", amount: 9.5, minAmount: 3, capacity: 12, supplier: "Stoffkontor Hamburg", pricePerUnit: 7.4, updatedAt: now },
    { id: "m5", name: "Nähgarn Polyester · Navy", detail: "5.000 m Kone", unit: "Kone", amount: 4, minAmount: 2, capacity: 8, supplier: "Amann", pricePerUnit: 6.9, updatedAt: now },
  ];
  return {
    orders,
    materials,
    settings: {
      dailyGoal: 12,
      workshopName: process.env.WORKSHOP_NAME || "Studio Nord",
      ownerName: process.env.OWNER_NAME || "Sven",
    },
  };
}

export function loadDb(): Db {
  if (existsSync(DB_PATH)) {
    db = JSON.parse(readFileSync(DB_PATH, "utf8"));
  } else {
    db = seed();
    saveDb();
  }
  return db;
}

export function getDb(): Db {
  return db ?? loadDb();
}

export function saveDb() {
  mkdirSync(dirname(DB_PATH), { recursive: true });
  const tmp = `${DB_PATH}.tmp`;
  writeFileSync(tmp, JSON.stringify(db, null, 2));
  renameSync(tmp, DB_PATH);
}

/** Entfernt Demo-Aufträge, sobald echte Shopify-Daten kommen. */
export function dropDemoOrders() {
  db.orders = db.orders.filter((o) => !o.id.startsWith("demo-"));
}
