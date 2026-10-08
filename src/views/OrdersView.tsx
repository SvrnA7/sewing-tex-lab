import { useMemo, useState, type FormEvent } from "react";
import { statusGroup, type LineItem, type StatusGroup } from "../../shared/types";
import type { AppCtx } from "../App";
import { api } from "../api";
import { Button, Icon, Modal, isOverdue, money } from "../ui";
import { OrderRow, matches } from "./Overview";

const TABS: { key: "alle" | StatusGroup | "ueberfaellig"; label: string }[] = [
  { key: "alle", label: "Alle" },
  { key: "offen", label: "Offen" },
  { key: "in_bearbeitung", label: "In Bearbeitung" },
  { key: "abgeschlossen", label: "Abgeschlossen" },
  { key: "ueberfaellig", label: "Überfällig" },
];

type Sort = "faellig" | "neu" | "wert";

export function OrdersView({ ctx }: { ctx: AppCtx }) {
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("alle");
  const [sort, setSort] = useState<Sort>("faellig");
  const [creating, setCreating] = useState(false);

  const counts = useMemo(() => {
    const c: Record<string, number> = { alle: ctx.orders.length, offen: 0, in_bearbeitung: 0, abgeschlossen: 0, ueberfaellig: 0 };
    for (const o of ctx.orders) {
      c[statusGroup(o.stage)]++;
      if (isOverdue(o)) c.ueberfaellig++;
    }
    return c;
  }, [ctx.orders]);

  const list = useMemo(() => {
    const filtered = ctx.orders.filter((o) => {
      if (!matches(o, ctx.query)) return false;
      if (tab === "alle") return true;
      if (tab === "ueberfaellig") return isOverdue(o);
      return statusGroup(o.stage) === tab;
    });
    const sorters: Record<Sort, (a: (typeof filtered)[number], b: (typeof filtered)[number]) => number> = {
      faellig: (a, b) =>
        Number(a.stage === "Fertig") - Number(b.stage === "Fertig") ||
        (a.stage === "Fertig" ? (b.completedAt ?? "").localeCompare(a.completedAt ?? "") : a.dueDate.localeCompare(b.dueDate)),
      neu: (a, b) => b.createdAt.localeCompare(a.createdAt),
      wert: (a, b) => b.total - a.total,
    };
    return filtered.sort(sorters[sort]);
  }, [ctx.orders, ctx.query, tab, sort]);

  const sum = list.reduce((s, o) => s + o.total, 0);

  return (
    <>
      <section className="welcome">
        <div>
          <p className="eyebrow">AUFTRAGSMANAGEMENT</p>
          <h1>Aufträge</h1>
          <p>Shopify-Bestellungen und manuelle Aufträge mit ihrem Produktionsstand.</p>
        </div>
        <Button className="primary-button" onClick={() => setCreating(true)}><Icon name="plus" size={17} /> Auftrag anlegen</Button>
      </section>

      <div className="toolbar">
        <div className="segmented">
          {TABS.map((t) => (
            <Button key={t.key} className={tab === t.key ? "selected" : ""} onClick={() => setTab(t.key)}>
              {t.label} <em>{counts[t.key]}</em>
            </Button>
          ))}
        </div>
        <label className="select-label">
          Sortieren
          <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
            <option value="faellig">nach Fälligkeit</option>
            <option value="neu">neueste zuerst</option>
            <option value="wert">nach Wert</option>
          </select>
        </label>
      </div>

      <div className="panel orders-panel">
        <div className="order-table-head"><span>Auftrag</span><span>Fälligkeit</span><span>Produktionsstand</span><span></span></div>
        <div className="order-list">
          {list.map((o) => <OrderRow key={o.id} order={o} ctx={ctx} />)}
          {list.length === 0 && <p className="empty-state">Keine Aufträge in dieser Ansicht.</p>}
        </div>
        {list.length > 0 && (
          <div className="panel-footer"><span>{list.length} Aufträge</span><strong>{money(sum, list[0]?.currency)}</strong></div>
        )}
      </div>

      {creating && <NewOrderModal onClose={() => setCreating(false)} onCreated={async (name) => { setCreating(false); ctx.toast(`Auftrag ${name} angelegt.`); await ctx.refresh(); }} toast={ctx.toast} />}
    </>
  );
}

function NewOrderModal({ onClose, onCreated, toast }: { onClose: () => void; onCreated: (name: string) => void; toast: (m: string) => void }) {
  const inDays = (n: number) => {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const [customer, setCustomer] = useState("");
  const [items, setItems] = useState<LineItem[]>([{ title: "", variant: "", quantity: 1 }]);
  const [total, setTotal] = useState("");
  const [due, setDue] = useState(inDays(5));
  const [priority, setPriority] = useState(false);
  const [notes, setNotes] = useState("");

  const setItem = (i: number, patch: Partial<LineItem>) => setItems((list) => list.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));

  async function submit(e: FormEvent) {
    e.preventDefault();
    const clean = items.filter((i) => i.title.trim());
    if (!customer.trim() || !clean.length) return toast("Kunde und mindestens ein Artikel sind nötig.");
    try {
      const o = await api.createOrder({
        customer, items: clean, total: Number(total.replace(",", ".")) || 0, priority, notes,
        dueDate: new Date(`${due}T18:00`).toISOString(),
      });
      onCreated(o.name);
    } catch (err) {
      toast((err as Error).message);
    }
  }

  return (
    <Modal eyebrow="MANUELLER AUFTRAG" title="Auftrag anlegen" subtitle="Für Aufträge, die nicht über Shopify kommen (z. B. Abholung, B2B)." onClose={onClose}>
      <form onSubmit={submit}>
        <label className="field-label">Kunde<input value={customer} onChange={(e) => setCustomer(e.target.value)} placeholder="Name oder Firma" required /></label>
        <div className="field-label">Artikel</div>
        {items.map((it, i) => (
          <div className="item-row" key={i}>
            <input className="qty-input" type="number" min={1} value={it.quantity} onChange={(e) => setItem(i, { quantity: Math.max(1, Number(e.target.value)) })} aria-label="Menge" />
            <input value={it.title} onChange={(e) => setItem(i, { title: e.target.value })} placeholder="Artikel, z. B. Hoodie Studio" aria-label="Artikel" />
            <input value={it.variant} onChange={(e) => setItem(i, { variant: e.target.value })} placeholder="Farbe · Größe · Veredelung" aria-label="Variante" />
            {items.length > 1 && <Button className="icon-button" aria-label="Position entfernen" onClick={() => setItems((l) => l.filter((_, idx) => idx !== i))}><Icon name="minus" size={16} /></Button>}
          </div>
        ))}
        <Button className="text-button add-line" onClick={() => setItems((l) => [...l, { title: "", variant: "", quantity: 1 }])}><Icon name="plus" size={14} /> Position hinzufügen</Button>
        <div className="field-grid">
          <label className="field-label">Betrag (€)<input inputMode="decimal" value={total} onChange={(e) => setTotal(e.target.value)} placeholder="0,00" /></label>
          <label className="field-label">Fällig am<input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></label>
        </div>
        <label className="check-row"><input type="checkbox" checked={priority} onChange={(e) => setPriority(e.target.checked)} /> Priorität</label>
        <label className="field-label">Notiz<textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
        <div className="modal-actions">
          <Button className="secondary-button" onClick={onClose}>Abbrechen</Button>
          <Button className="primary-button" type="submit"><Icon name="plus" size={17} /> Anlegen</Button>
        </div>
      </form>
    </Modal>
  );
}
