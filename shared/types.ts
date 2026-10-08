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
  obsidian: { connected: boolean; vault?: string; notes: number; demo: boolean };
}
