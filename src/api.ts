import type { Integrations, KnowledgeNote, Material, Order, Settings, Stats } from "../shared/types";

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json", ...init.headers } : init?.headers,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Fehler ${res.status}`);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

const json = (body: unknown) => JSON.stringify(body);

export const api = {
  orders: () => req<Order[]>("/orders"),
  createOrder: (o: Partial<Order>) => req<Order>("/orders", { method: "POST", body: json(o) }),
  updateOrder: (id: string, patch: Partial<Order>) =>
    req<{ order: Order; warning?: string }>(`/orders/${encodeURIComponent(id)}`, { method: "PATCH", body: json(patch) }),
  deleteOrder: (id: string) => req<void>(`/orders/${encodeURIComponent(id)}`, { method: "DELETE" }),
  syncShopify: () => req<{ imported: number; updated: number }>("/shopify/sync", { method: "POST" }),
  stats: () => req<Stats>("/stats"),
  settings: () => req<Settings>("/settings"),
  saveSettings: (s: Partial<Settings>) => req<Settings>("/settings", { method: "PUT", body: json(s) }),
  integrations: () => req<Integrations>("/integrations"),
  materials: () => req<Material[]>("/materials"),
  createMaterial: (m: Partial<Material>) => req<Material>("/materials", { method: "POST", body: json(m) }),
  updateMaterial: (id: string, patch: Partial<Material> & { adjust?: number }) =>
    req<Material>(`/materials/${id}`, { method: "PATCH", body: json(patch) }),
  deleteMaterial: (id: string) => req<void>(`/materials/${id}`, { method: "DELETE" }),
  knowledge: (q = "") => req<{ notes: KnowledgeNote[]; total: number }>(`/knowledge${q ? `?q=${encodeURIComponent(q)}` : ""}`),
  note: (path: string) => req<{ note: KnowledgeNote; body: string }>(`/knowledge/note?path=${encodeURIComponent(path)}`),
  addKnowledge: (k: { type: string; title: string; content: string; file?: { name: string; base64: string } }) =>
    req<KnowledgeNote>("/knowledge", { method: "POST", body: json(k) }),
};

export type AgentEvent =
  | { type: "sources"; sources: KnowledgeNote[] }
  | { type: "text"; text: string }
  | { type: "done" }
  | { type: "error"; error: string };

/** Liest die NDJSON-Antwort des Agenten zeilenweise. */
export async function askAgent(messages: { role: "user" | "assistant"; content: string }[], onEvent: (e: AgentEvent) => void) {
  const res = await fetch("/api/agent/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: json({ messages }) });
  if (!res.ok || !res.body) {
    const body = await res.json().catch(() => ({}));
    onEvent({ type: "error", error: body.error ?? `Fehler ${res.status}` });
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line) onEvent(JSON.parse(line));
    }
  }
}

export const fileToBase64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
