export const STAGES = ["Offen", "Zuschnitt", "In Näharbeit", "Bedruckt", "Verpackt", "Fertig"] as const;
export type Stage = (typeof STAGES)[number];

/** Gruppierung für Übersicht: offen / in Bearbeitung / abgeschlossen */
export type StatusGroup = "offen" | "in_bearbeitung" | "abgeschlossen";

export function statusGroup(stage: Stage): StatusGroup {
  if (stage === "Offen") return "offen";
  if (stage === "Fertig") return "abgeschlossen";
  return "in_bearbeitung";
}

export interface LineItem {
  title: string;
  variant: string;
  quantity: number;
}

export interface StageEvent {
  stage: Stage;
  at: string;
}

export interface Order {
  /** Shopify GID oder lokale ID */
  id: string;
  /** Anzeigename, z. B. "#1048" */
  name: string;
  source: "shopify" | "manuell";
  customer: string;
  items: LineItem[];
  total: number;
  currency: string;
  createdAt: string;
  dueDate: string;
  stage: Stage;
  priority: boolean;
  notes: string;
  financialStatus?: string;
  fulfillmentStatus?: string;
  stageHistory: StageEvent[];
  completedAt?: string;
}

export type StockTone = "good" | "low" | "critical";

export interface Material {
  id: string;
  name: string;
  detail: string;
  unit: string;
  amount: number;
  /** Ab dieser Menge gilt der Bestand als knapp */
  minAmount: number;
  /** Volle Rolle / Zielbestand für die Füllstandsanzeige */
  capacity: number;
  supplier: string;
  pricePerUnit: number;
  updatedAt: string;
  /** Code auf dem QR-Etikett (oder Barcode des Lieferanten), eindeutig */
  code?: string;
  /** Letzte Lagerbewegungen, neueste zuerst */
  history?: StockMove[];
}

export interface StockMove {
  at: string;
  /** Veränderung (+ Zugang, − Verbrauch) */
  delta: number;
  /** Bestand danach */
  amount: number;
  kind: "zugang" | "verbrauch" | "inventur" | "anlage";
  note?: string;
}

/** Code, der auf dem Etikett steht und im QR-Code steckt */
export const materialCode = (m: Pick<Material, "id" | "code">) => m.code || m.id;

/** Liest aus einem gescannten Text den Stoff-Code: App-Link (?stoff=…) oder roher Code/Barcode */
export function parseScan(raw: string): string {
  const text = raw.trim();
  try {
    const url = new URL(text);
    const c = url.searchParams.get("stoff");
    if (c) return c.trim();
  } catch { /* kein Link */ }
  return text;
}

export function findByCode(list: Material[], code: string): Material | undefined {
  const c = code.trim().toLowerCase();
  return list.find((m) => materialCode(m).toLowerCase() === c || m.id.toLowerCase() === c);
}

export function stockTone(m: Material): StockTone {
  if (m.amount <= m.minAmount * 0.6) return "critical";
  if (m.amount <= m.minAmount) return "low";
  return "good";
}

export interface Settings {
  dailyGoal: number;
  workshopName: string;
  ownerName: string;
}

export interface Stats {
  open: number;
  inProgress: number;
  completed: number;
  dueToday: number;
  activeStations: number;
  completedThisMonth: number;
  completedLastMonth: number;
  revenueMonth: number;
  revenueLastMonth: number;
  currency: string;
  today: { done: number; goal: number; remaining: number; percent: number };
  last7Days: { date: string; done: number }[];
  revenueByMonth: { month: string; revenue: number }[];
  lowStock: number;
}

export interface KnowledgeNote {
  /** Pfad relativ zum Vault */
  path: string;
  title: string;
  type: string;
  updatedAt: string;
  excerpt: string;
  tags: string[];
}

export interface Integrations {
  shopify: { connected: boolean; shop?: string; lastSync?: string; error?: string; demo: boolean };
  claude: { connected: boolean; model: string };
  obsidian: { connected: boolean; vault?: string; notes: number; demo: boolean; source: "github" | "ordner" | "app" };
  storage: { kind: "postgres" | "datei"; persistent: boolean };
  auth: { enabled: boolean; hosted: boolean };
}
