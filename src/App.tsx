import { useCallback, useEffect, useMemo, useState } from "react";
import type { Integrations, KnowledgeNote, Material, Order, Settings, Stage, Stats } from "../shared/types";
import { api } from "./api";
import { Button, Icon, type IconName } from "./ui";
import { KnowledgeModal } from "./components/KnowledgeModal";
import { OrderDrawer } from "./components/OrderDrawer";
import { Overview } from "./views/Overview";
import { OrdersView } from "./views/OrdersView";
import { ProductionView } from "./views/ProductionView";
import { GoalView } from "./views/GoalView";
import { InventoryView } from "./views/InventoryView";
import { LabView } from "./views/LabView";

export type View = "Übersicht" | "Aufträge" | "Produktion" | "Tagesziel" | "Lager" | "Textil-Lab";

export interface AppCtx {
  orders: Order[];
  stats: Stats | null;
  materials: Material[];
  notes: KnowledgeNote[];
  notesTotal: number;
  settings: Settings | null;
  integrations: Integrations | null;
  query: string;
  go: (v: View) => void;
  refresh: () => Promise<void>;
  setStage: (order: Order, stage: Stage) => Promise<void>;
  openOrder: (order: Order) => void;
  openKnowledge: (preset?: { title?: string; content?: string }) => void;
  askLab: (question: string) => void;
  toast: (msg: string) => void;
  pendingQuestion: string | null;
  clearPendingQuestion: () => void;
}

const NAV: [View, IconName][] = [
  ["Übersicht", "dashboard"],
  ["Aufträge", "cart"],
  ["Produktion", "kanban"],
  ["Tagesziel", "target"],
  ["Lager", "box"],
  ["Textil-Lab", "sparkles"],
];

export default function App() {
  const [view, setView] = useState<View>("Übersicht");
  const [query, setQuery] = useState("");
  const [orders, setOrders] = useState<Order[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [notes, setNotes] = useState<KnowledgeNote[]>([]);
  const [notesTotal, setNotesTotal] = useState(0);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [integrations, setIntegrations] = useState<Integrations | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [selected, setSelected] = useState<Order | null>(null);
  const [knowledgePreset, setKnowledgePreset] = useState<{ title?: string; content?: string } | null>(null);
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const toast = useCallback((msg: string) => {
    setToastMsg(msg);
    window.setTimeout(() => setToastMsg((m) => (m === msg ? null : m)), 4200);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [o, s, m, k, st, i] = await Promise.all([
        api.orders(), api.stats(), api.materials(), api.knowledge(), api.settings(), api.integrations(),
      ]);
      setOrders(o); setStats(s); setMaterials(m); setNotes(k.notes); setNotesTotal(k.total); setSettings(st); setIntegrations(i);
    } catch (err) {
      toast(`Server nicht erreichbar: ${(err as Error).message}`);
    }
  }, [toast]);

  useEffect(() => {
    refresh();
    const t = window.setInterval(refresh, 60_000);
    return () => window.clearInterval(t);
  }, [refresh]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        document.getElementById("global-search")?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const setStage = useCallback(async (order: Order, stage: Stage) => {
    setOrders((list) => list.map((o) => (o.id === order.id ? { ...o, stage } : o)));
    try {
      const { order: updated, warning } = await api.updateOrder(order.id, { stage });
      setOrders((list) => list.map((o) => (o.id === updated.id ? updated : o)));
      setSelected((s) => (s?.id === updated.id ? updated : s));
      if (warning) toast(warning);
      api.stats().then(setStats);
    } catch (err) {
      toast((err as Error).message);
      refresh();
    }
  }, [refresh, toast]);

  async function syncShopify() {
    setSyncing(true);
    try {
      const r = await api.syncShopify();
      toast(`Shopify synchronisiert: ${r.imported} neu, ${r.updated} aktualisiert.`);
      await refresh();
    } catch (err) {
      toast((err as Error).message);
    } finally {
      setSyncing(false);
    }
  }

  const ctx: AppCtx = {
    orders, stats, materials, notes, notesTotal, settings, integrations, query,
    go: setView,
    refresh,
    setStage,
    openOrder: setSelected,
    openKnowledge: (preset) => setKnowledgePreset(preset ?? {}),
    askLab: (q) => { setPendingQuestion(q); setView("Textil-Lab"); },
    toast,
    pendingQuestion,
    clearPendingQuestion: () => setPendingQuestion(null),
  };

  const openCount = useMemo(() => orders.filter((o) => o.stage !== "Fertig").length, [orders]);
  const shopify = integrations?.shopify;
  const shopifyLabel = !shopify ? "…" : shopify.demo ? "Demo-Daten" : shopify.error ? "Sync-Fehler" : "Shop synchronisiert";
  const labLabel = !integrations ? "…" : `${integrations.claude.connected ? "Claude" : "Claude offline"} + ${integrations.obsidian.demo ? "Demo-Vault" : "Obsidian"}`;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div>
          <div className="brand">
            <div className="brand-mark"><span></span><span></span></div>
            <div><strong>STITCHFLOW</strong><small>TEXTIL OPS</small></div>
          </div>

          <div className="workspace-switcher">
            <div className="avatar">{(settings?.workshopName ?? "SN").split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()}</div>
            <div><small>Werkstatt</small><strong>{settings?.workshopName ?? "…"}</strong></div>
          </div>

          <nav className="nav-list" aria-label="Hauptnavigation">
            {NAV.map(([label, icon]) => (
              <Button className={`nav-item ${view === label ? "active" : ""}`} key={label} onClick={() => setView(label)}>
                <Icon name={icon} size={19} />
                <span>{label}</span>
                {label === "Aufträge" && openCount > 0 && <em>{openCount}</em>}
              </Button>
            ))}
          </nav>
        </div>

        <div className="integration-stack">
          <div className="shopify-status" title={shopify?.error ?? shopify?.shop}>
            <span className="shopify-mark">S</span>
            <div><small>Shopify</small><strong>{shopifyLabel}</strong></div>
            <span className={`status-dot ${shopify && (shopify.demo || shopify.error) ? "off" : ""}`}></span>
          </div>
          <div className="agent-source">
            <div className="source-orb"><Icon name="sparkles" size={18} /></div>
            <div><small>Textil-Lab {integrations?.claude.connected ? "aktiv" : "eingeschränkt"}</small><strong>{labLabel}</strong></div>
            <span className={`status-dot ${integrations && !integrations.claude.connected ? "off" : ""}`}></span>
          </div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="search-wrap">
            <Icon name="search" size={18} />
            <input
              id="global-search"
              aria-label="Aufträge durchsuchen"
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && view !== "Aufträge" && view !== "Übersicht" && setView("Aufträge")}
              placeholder="Aufträge, Kunden oder Artikel suchen …"
              value={query}
            />
            <kbd>⌘ K</kbd>
          </div>
          <div className="topbar-actions">
            <Button className={`sync-button ${syncing ? "syncing" : ""}`} onClick={syncShopify} disabled={syncing}>
              <Icon name="sync" size={16} /> {syncing ? "Synchronisiere …" : "Shopify Sync"}
            </Button>
            <Button className="primary-button" onClick={() => setKnowledgePreset({})}>
              <Icon name="plus" size={17} /> Wissen ergänzen
            </Button>
          </div>
        </header>

        <div className="page">
          {view === "Übersicht" && <Overview ctx={ctx} />}
          {view === "Aufträge" && <OrdersView ctx={ctx} />}
          {view === "Produktion" && <ProductionView ctx={ctx} />}
          {view === "Tagesziel" && <GoalView ctx={ctx} onSettings={setSettings} />}
          {view === "Lager" && <InventoryView ctx={ctx} setMaterials={setMaterials} />}
          {view === "Textil-Lab" && <LabView ctx={ctx} />}
        </div>
      </main>

      {selected && (
        <OrderDrawer
          order={orders.find((o) => o.id === selected.id) ?? selected}
          onClose={() => setSelected(null)}
          onStage={setStage}
          onSaved={(o) => { setOrders((list) => list.map((x) => (x.id === o.id ? o : x))); api.stats().then(setStats); }}
          onDeleted={(id) => { setSelected(null); setOrders((list) => list.filter((o) => o.id !== id)); api.stats().then(setStats); }}
          onAsk={(q) => { setSelected(null); ctx.askLab(q); }}
          toast={toast}
        />
      )}

      {knowledgePreset && (
        <KnowledgeModal
          preset={knowledgePreset}
          onClose={() => setKnowledgePreset(null)}
          onSaved={(note) => {
            setNotes((n) => [note, ...n]);
            setNotesTotal((t) => t + 1);
            setKnowledgePreset(null);
            toast(`„${note.title}“ in Obsidian gespeichert.`);
          }}
          toast={toast}
        />
      )}

      {toastMsg && <div className="toast" role="status">{toastMsg}</div>}
    </div>
  );
}
