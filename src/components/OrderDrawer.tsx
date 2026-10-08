import { useEffect, useState } from "react";
import { STAGES, type Order, type Stage } from "../../shared/types";
import { api } from "../api";
import { Button, Icon, StagePill, StageTrack, dueLabel, isOverdue, money, orderTitle, stageIndex } from "../ui";

const toLocalInput = (iso: string) => {
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

export function OrderDrawer({ order, onClose, onStage, onSaved, onDeleted, onAsk, toast }: {
  order: Order;
  onClose: () => void;
  onStage: (o: Order, s: Stage) => Promise<void>;
  onSaved: (o: Order) => void;
  onDeleted: (id: string) => void;
  onAsk: (q: string) => void;
  toast: (m: string) => void;
}) {
  const [notes, setNotes] = useState(order.notes);
  const [due, setDue] = useState(toLocalInput(order.dueDate));
  const [priority, setPriority] = useState(order.priority);
  useEffect(() => { setNotes(order.notes); setDue(toLocalInput(order.dueDate)); setPriority(order.priority); }, [order.id]);

  const dirty = notes !== order.notes || due !== toLocalInput(order.dueDate) || priority !== order.priority;

  async function save() {
    try {
      const { order: o } = await api.updateOrder(order.id, { notes, priority, dueDate: new Date(due).toISOString() });
      onSaved(o);
      toast(`${o.name} gespeichert.`);
    } catch (err) {
      toast((err as Error).message);
    }
  }

  async function remove() {
    if (!confirm(`${order.name} wirklich löschen?`)) return;
    try {
      await api.deleteOrder(order.id);
      onDeleted(order.id);
    } catch (err) {
      toast((err as Error).message);
    }
  }

  const items = order.items.map((i) => `${i.quantity}× ${i.title}${i.variant ? ` (${i.variant})` : ""}`).join(", ");

  return (
    <div className="drawer-backdrop" role="presentation" onMouseDown={onClose}>
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={`Auftrag ${order.name}`} onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <p className="eyebrow">{order.source === "shopify" ? "SHOPIFY-AUFTRAG" : "MANUELLER AUFTRAG"} · {order.name}</p>
            <h2>{orderTitle(order)}</h2>
            <span>{order.customer} · {money(order.total, order.currency)}</span>
          </div>
          <Button className="icon-button" aria-label="Schließen" onClick={onClose}><Icon name="close" size={20} /></Button>
        </div>

        <div className="drawer-body">
          <section className="drawer-section">
            <div className="stage-top"><StagePill stage={order.stage} /><small>{stageIndex(order.stage) + 1}/{STAGES.length}</small></div>
            <StageTrack stage={order.stage} />
            <div className="stage-picker">
              {STAGES.map((s) => (
                <Button key={s} className={s === order.stage ? "selected" : stageIndex(s) < stageIndex(order.stage) ? "passed" : ""} onClick={() => onStage(order, s)}>
                  {stageIndex(s) < stageIndex(order.stage) && <Icon name="check" size={13} />} {s}
                </Button>
              ))}
            </div>
          </section>

          <section className="drawer-section">
            <h3>Positionen</h3>
            <ul className="item-list">
              {order.items.map((i, idx) => (
                <li key={idx}><span className="qty">{i.quantity}×</span><div><strong>{i.title}</strong><small>{i.variant || "—"}</small></div></li>
              ))}
            </ul>
            <dl className="meta-grid">
              <div><dt>Bestellt</dt><dd>{new Date(order.createdAt).toLocaleDateString("de-DE")}</dd></div>
              <div><dt>Fällig</dt><dd className={isOverdue(order) ? "danger" : ""}>{dueLabel(order.dueDate)}</dd></div>
              <div><dt>Zahlung</dt><dd>{order.financialStatus ?? "—"}</dd></div>
              <div><dt>Versand</dt><dd>{order.fulfillmentStatus ?? "—"}</dd></div>
            </dl>
          </section>

          <section className="drawer-section">
            <h3>Produktion</h3>
            <label className="field-label">Fälligkeit<input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} /></label>
            <label className="check-row"><input type="checkbox" checked={priority} onChange={(e) => setPriority(e.target.checked)} /> Priorität</label>
            <label className="field-label">Produktionsnotiz<textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="z. B. Druckdatei geprüft, Stoff aus Charge 12 …" /></label>
            <div className="modal-actions">
              {order.source === "manuell" && <Button className="secondary-button danger" onClick={remove}><Icon name="trash" size={15} /> Löschen</Button>}
              <Button className="primary-button" disabled={!dirty} onClick={save}>Speichern</Button>
            </div>
          </section>

          <section className="drawer-section">
            <h3>Verlauf</h3>
            <ol className="timeline">
              {[...order.stageHistory].reverse().map((e, i) => (
                <li key={i}><StagePill stage={e.stage} /><small>{new Date(e.at).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" })}</small></li>
              ))}
            </ol>
          </section>

          <Button className="lab-ask" onClick={() => onAsk(`Worauf muss ich bei Auftrag ${order.name} achten? Positionen: ${items}. Aktueller Stand: ${order.stage}.`)}>
            <Icon name="sparkles" size={17} /> Textil-Lab zu diesem Auftrag fragen
          </Button>
        </div>
      </aside>
    </div>
  );
}
