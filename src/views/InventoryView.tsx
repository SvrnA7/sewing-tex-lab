import { useState, type FormEvent } from "react";
import { stockTone, type Material } from "../../shared/types";
import type { AppCtx } from "../App";
import { api } from "../api";
import { Button, Icon, Modal, money, timeAgo } from "../ui";

const TONE_LABEL = { good: "Ausreichend", low: "Knapp", critical: "Nachbestellen" } as const;

export function InventoryView({ ctx, setMaterials }: { ctx: AppCtx; setMaterials: (fn: (m: Material[]) => Material[]) => void }) {
  const [editing, setEditing] = useState<Partial<Material> | null>(null);
  const [step, setStep] = useState<Record<string, string>>({});
  const q = ctx.query.toLowerCase();
  const list = ctx.materials
    .filter((m) => !q || `${m.name} ${m.detail} ${m.supplier}`.toLowerCase().includes(q))
    .sort((a, b) => a.amount / (a.minAmount || 1) - b.amount / (b.minAmount || 1));
  const value = ctx.materials.reduce((s, m) => s + m.amount * m.pricePerUnit, 0);

  async function adjust(m: Material, sign: 1 | -1) {
    const amount = Number((step[m.id] ?? "1").replace(",", ".")) || 0;
    if (!amount) return;
    try {
      const updated = await api.updateMaterial(m.id, { adjust: sign * amount });
      setMaterials((list) => list.map((x) => (x.id === m.id ? updated : x)));
      ctx.refresh();
    } catch (err) {
      ctx.toast((err as Error).message);
    }
  }

  return (
    <>
      <section className="welcome">
        <div>
          <p className="eyebrow">TEXTILLAGER</p>
          <h1>Materialbestand</h1>
          <p>{ctx.materials.length} Materialien · Lagerwert {money(value)} · {ctx.stats?.lowStock ?? 0} unter Mindestbestand</p>
        </div>
        <Button className="primary-button" onClick={() => setEditing({ unit: "m" })}><Icon name="plus" size={17} /> Material anlegen</Button>
      </section>

      <div className="material-grid">
        {list.map((m) => {
          const tone = stockTone(m);
          return (
            <article className="panel material-card" key={m.id}>
              <div className="inventory-top">
                <span className={`stock-icon ${tone}`}><Icon name={tone === "critical" ? "alert" : "box"} size={16} /></span>
                <div><strong>{m.name}</strong><small>{m.detail}</small></div>
                <Button className="icon-button" aria-label="Bearbeiten" onClick={() => setEditing(m)}><Icon name="edit" size={15} /></Button>
              </div>
              <div className="material-amount">
                <strong>{m.amount.toLocaleString("de-DE")} <span>{m.unit}</span></strong>
                <span className={`tone-pill ${tone}`}>{TONE_LABEL[tone]}</span>
              </div>
              <div className={`stock-track ${tone} flush`}><span style={{ width: `${Math.min((m.amount / (m.capacity || 1)) * 100, 100)}%` }}></span></div>
              <dl className="meta-grid">
                <div><dt>Mindestbestand</dt><dd>{m.minAmount.toLocaleString("de-DE")} {m.unit}</dd></div>
                <div><dt>Preis</dt><dd>{money(m.pricePerUnit)} / {m.unit}</dd></div>
                <div><dt>Lieferant</dt><dd>{m.supplier || "—"}</dd></div>
                <div><dt>Geändert</dt><dd>{timeAgo(m.updatedAt)}</dd></div>
              </dl>
              <div className="adjust-row">
                <Button className="secondary-button" onClick={() => adjust(m, -1)}><Icon name="minus" size={14} /> Verbrauch</Button>
                <input aria-label="Menge" inputMode="decimal" value={step[m.id] ?? "1"} onChange={(e) => setStep((s) => ({ ...s, [m.id]: e.target.value }))} />
                <Button className="secondary-button" onClick={() => adjust(m, 1)}><Icon name="plus" size={14} /> Zugang</Button>
              </div>
            </article>
          );
        })}
        {list.length === 0 && <p className="empty-state">Keine Materialien gefunden.</p>}
      </div>

      {editing && (
        <MaterialModal
          material={editing}
          onClose={() => setEditing(null)}
          onSaved={(m, isNew) => {
            setMaterials((list) => (isNew ? [...list, m] : list.map((x) => (x.id === m.id ? m : x))));
            setEditing(null);
            ctx.refresh();
          }}
          onDeleted={(id) => {
            setMaterials((list) => list.filter((x) => x.id !== id));
            setEditing(null);
            ctx.refresh();
          }}
          toast={ctx.toast}
        />
      )}
    </>
  );
}

function MaterialModal({ material, onClose, onSaved, onDeleted, toast }: {
  material: Partial<Material>;
  onClose: () => void;
  onSaved: (m: Material, isNew: boolean) => void;
  onDeleted: (id: string) => void;
  toast: (m: string) => void;
}) {
  const [form, setForm] = useState<Record<string, string>>({
    name: material.name ?? "",
    detail: material.detail ?? "",
    unit: material.unit ?? "m",
    amount: String(material.amount ?? ""),
    minAmount: String(material.minAmount ?? ""),
    capacity: String(material.capacity ?? ""),
    supplier: material.supplier ?? "",
    pricePerUnit: String(material.pricePerUnit ?? ""),
  });
  const set = (k: string) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const num = (k: string) => Number(form[k].replace(",", ".")) || 0;

  async function submit(e: FormEvent) {
    e.preventDefault();
    const body = { ...form, amount: num("amount"), minAmount: num("minAmount"), capacity: num("capacity") || num("amount"), pricePerUnit: num("pricePerUnit") };
    try {
      if (material.id) onSaved(await api.updateMaterial(material.id, body), false);
      else onSaved(await api.createMaterial(body), true);
    } catch (err) {
      toast((err as Error).message);
    }
  }

  async function remove() {
    if (!material.id || !confirm(`${material.name} löschen?`)) return;
    await api.deleteMaterial(material.id);
    onDeleted(material.id);
  }

  return (
    <Modal eyebrow="TEXTILLAGER" title={material.id ? "Material bearbeiten" : "Material anlegen"} onClose={onClose}>
      <form onSubmit={submit}>
        <label className="field-label">Name<input value={form.name} onChange={set("name")} placeholder="z. B. French Terry · Navy" required /></label>
        <label className="field-label">Details<input value={form.detail} onChange={set("detail")} placeholder="Grammatur, Zusammensetzung, Aufmachung" /></label>
        <div className="field-grid three">
          <label className="field-label">Bestand<input inputMode="decimal" value={form.amount} onChange={set("amount")} /></label>
          <label className="field-label">Einheit<input value={form.unit} onChange={set("unit")} /></label>
          <label className="field-label">Mindestbestand<input inputMode="decimal" value={form.minAmount} onChange={set("minAmount")} /></label>
        </div>
        <div className="field-grid three">
          <label className="field-label">Volle Menge<input inputMode="decimal" value={form.capacity} onChange={set("capacity")} placeholder="für Füllstand" /></label>
          <label className="field-label">Preis / Einheit (€)<input inputMode="decimal" value={form.pricePerUnit} onChange={set("pricePerUnit")} /></label>
          <label className="field-label">Lieferant<input value={form.supplier} onChange={set("supplier")} /></label>
        </div>
        <div className="modal-actions">
          {material.id && <Button className="secondary-button danger" onClick={remove}><Icon name="trash" size={15} /> Löschen</Button>}
          <Button className="secondary-button" onClick={onClose}>Abbrechen</Button>
          <Button className="primary-button" type="submit">Speichern</Button>
        </div>
      </form>
    </Modal>
  );
}
