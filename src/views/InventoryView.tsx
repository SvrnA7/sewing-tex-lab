import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { findByCode, materialCode, parseScan, stockTone, type Material, type StockMove } from "../../shared/types";
import type { AppCtx } from "../App";
import { api } from "../api";
import { Button, Icon, Modal, money, timeAgo } from "../ui";
import { LabelModal, QrSvg, qrLink, ScannerModal } from "../components/QrTools";

const TONE_LABEL = { good: "Ausreichend", low: "Knapp", critical: "Nachbestellen" } as const;

export function InventoryView({ ctx, setMaterials }: { ctx: AppCtx; setMaterials: (fn: (m: Material[]) => Material[]) => void }) {
  const [editing, setEditing] = useState<Partial<Material> | null>(null);
  const [step, setStep] = useState<Record<string, string>>({});
  const [scanning, setScanning] = useState(false);
  const [booking, setBooking] = useState<{ id: string; fromScan: boolean } | null>(null);
  const [labels, setLabels] = useState<string[] | null>(null);
  const bookingMaterial = booking ? ctx.materials.find((m) => m.id === booking.id) : undefined;

  const materialsRef = useRef(ctx.materials);
  materialsRef.current = ctx.materials;

  /** Gescannter oder per Link übergebener Code → Stoff öffnen oder neu anlegen */
  const openCode = useCallback((raw: string, fromScan: boolean) => {
    const code = parseScan(raw);
    setScanning(false);
    if (!code) return;
    const hit = findByCode(materialsRef.current, code);
    if (hit) setBooking({ id: hit.id, fromScan });
    else {
      ctx.toast(`Code ${code} ist noch keinem Stoff zugeordnet. Lege ihn jetzt an.`);
      setEditing({ unit: "m", code });
    }
  }, [ctx]);

  // Link vom Etikett (?stoff=CODE), z. B. mit der normalen Handy-Kamera gescannt
  const linkHandled = useRef(false);
  useEffect(() => {
    if (linkHandled.current || !ctx.materials.length) return;
    const code = new URLSearchParams(window.location.search).get("stoff");
    linkHandled.current = true;
    if (!code) return;
    window.history.replaceState(null, "", window.location.pathname);
    openCode(code, false);
  }, [ctx.materials, openCode]);
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
        <div className="welcome-actions">
          <Button className="secondary-button" onClick={() => setLabels(list.map((m) => m.id))}><Icon name="printer" size={15} /> Etiketten</Button>
          <Button className="secondary-button" onClick={() => setEditing({ unit: "m" })}><Icon name="plus" size={15} /> Material anlegen</Button>
          <Button className="primary-button" onClick={() => setScanning(true)}><Icon name="scan" size={17} /> Scannen</Button>
        </div>
      </section>

      <div className="material-grid">
        {list.map((m) => {
          const tone = stockTone(m);
          return (
            <article className="panel material-card" key={m.id}>
              <div className="inventory-top">
                <span className={`stock-icon ${tone}`}><Icon name={tone === "critical" ? "alert" : "box"} size={16} /></span>
                <div><strong>{m.name}</strong><small>{m.detail}</small></div>
                <Button className="icon-button" aria-label="QR-Etikett" title="QR-Etikett drucken" onClick={() => setLabels([m.id])}><Icon name="qr" size={15} /></Button>
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
                <div><dt>Code</dt><dd><button type="button" className="code-chip" onClick={() => setBooking({ id: m.id, fromScan: false })}>{materialCode(m)}</button></dd></div>
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

      {scanning && <ScannerModal onResult={(t) => openCode(t, true)} onClose={() => setScanning(false)} />}

      {labels && <LabelModal materials={ctx.materials} preselect={labels} onClose={() => setLabels(null)} />}

      {booking && bookingMaterial && (
        <QuickBookModal
          material={bookingMaterial}
          fromScan={booking.fromScan}
          onClose={() => setBooking(null)}
          onUpdated={(m) => { setMaterials((list) => list.map((x) => (x.id === m.id ? m : x))); ctx.refresh(); }}
          onEdit={() => { setEditing(bookingMaterial); setBooking(null); }}
          onLabel={() => { setLabels([bookingMaterial.id]); setBooking(null); }}
          onScanNext={() => { setBooking(null); setScanning(true); }}
          toast={ctx.toast}
        />
      )}

      {editing && (
        <MaterialModal
          material={editing}
          onClose={() => setEditing(null)}
          onSaved={(m, isNew) => {
            setMaterials((list) => (isNew ? [...list, m] : list.map((x) => (x.id === m.id ? m : x))));
            setEditing(null);
            if (isNew) setBooking({ id: m.id, fromScan: false });
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
    code: material.code ?? "",
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
        <label className="field-label">Etiketten-Code
          <input value={form.code} onChange={set("code")} placeholder="leer lassen = automatisch (z. B. STF-7K2Q)" />
          <small className="field-help">Steht auf dem QR-Etikett. Du kannst auch den Barcode des Lieferanten verwenden.</small>
        </label>
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

const MOVE_LABEL: Record<StockMove["kind"], string> = { zugang: "Zugang", verbrauch: "Verbrauch", inventur: "Inventur", anlage: "Angelegt" };
const QUICK = [0.5, 1, 2, 5, 10];

function QuickBookModal({ material: m, fromScan, onClose, onUpdated, onEdit, onLabel, onScanNext, toast }: {
  material: Material;
  fromScan: boolean;
  onClose: () => void;
  onUpdated: (m: Material) => void;
  onEdit: () => void;
  onLabel: () => void;
  onScanNext: () => void;
  toast: (msg: string) => void;
}) {
  const [mode, setMode] = useState<"buchen" | "inventur">("buchen");
  const [value, setValue] = useState("1");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const tone = stockTone(m);
  const num = Number(value.replace(",", ".")) || 0;
  const fmt = (n: number) => n.toLocaleString("de-DE", { maximumFractionDigits: 2 });

  async function send(patch: { adjust?: number; amount?: number }, msg: string) {
    setBusy(true);
    try {
      const updated = await api.updateMaterial(m.id, { ...patch, note: note.trim() || undefined });
      onUpdated(updated);
      setNote("");
      toast(`${m.name}: ${msg} · Bestand ${fmt(updated.amount)} ${m.unit}`);
    } catch (err) {
      toast((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const book = (sign: 1 | -1) => num > 0 && send({ adjust: sign * num }, `${sign > 0 ? "+" : "−"}${fmt(num)} ${m.unit}`);
  const count = () => value.trim() !== "" && send({ amount: Math.max(0, num) }, "Inventur gespeichert");

  return (
    <Modal eyebrow={fromScan ? "STOFF GESCANNT" : "TEXTILLAGER"} title={m.name} subtitle={[materialCode(m), m.detail].filter(Boolean).join(" · ")} onClose={onClose}>
      <div className="quick-head">
        <div>
          <div className="material-amount">
            <strong>{fmt(m.amount)} <span>{m.unit}</span></strong>
            <span className={`tone-pill ${tone}`}>{tone === "good" ? "Ausreichend" : tone === "low" ? "Knapp" : "Nachbestellen"}</span>
          </div>
          <div className={`stock-track ${tone} flush`}><span style={{ width: `${Math.min((m.amount / (m.capacity || 1)) * 100, 100)}%` }}></span></div>
          <small className="field-help">Mindestbestand {fmt(m.minAmount)} {m.unit}{m.supplier ? ` · ${m.supplier}` : ""}</small>
        </div>
        <button type="button" className="quick-qr" onClick={onLabel} title="Etikett drucken" aria-label="Etikett drucken">
          <QrSvg text={qrLink(m)} size={64} />
        </button>
      </div>

      <div className="segmented small">
        <button type="button" className={mode === "buchen" ? "active" : ""} onClick={() => { setMode("buchen"); setValue("1"); }}><strong>Zu- / Abbuchen</strong></button>
        <button type="button" className={mode === "inventur" ? "active" : ""} onClick={() => { setMode("inventur"); setValue(String(m.amount)); }}><strong>Bestand zählen</strong></button>
      </div>

      <label className="field-label">{mode === "buchen" ? `Menge (${m.unit})` : `Gezählter Bestand (${m.unit})`}
        <input className="quick-input" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} onFocus={(e) => e.target.select()} />
      </label>
      {mode === "buchen" && (
        <div className="quick-chips">
          {QUICK.map((q) => <button type="button" key={q} className={num === q ? "active" : ""} onClick={() => setValue(String(q))}>{fmt(q)}</button>)}
        </div>
      )}
      <label className="field-label">Notiz (optional)<input value={note} onChange={(e) => setNote(e.target.value)} placeholder="z. B. Auftrag #1048, Lieferung Stoffkontor" /></label>

      {mode === "buchen" ? (
        <div className="quick-actions">
          <Button className="secondary-button" disabled={busy || !num} onClick={() => book(-1)}><Icon name="minus" size={16} /> Verbrauch</Button>
          <Button className="primary-button" disabled={busy || !num} onClick={() => book(1)}><Icon name="plus" size={16} /> Zugang</Button>
        </div>
      ) : (
        <div className="quick-actions one">
          <Button className="primary-button" disabled={busy} onClick={count}><Icon name="check" size={16} /> Bestand auf {fmt(Math.max(0, num))} {m.unit} setzen</Button>
        </div>
      )}

      {!!m.history?.length && (
        <div className="move-list">
          <p className="field-caption">Letzte Bewegungen</p>
          {m.history.slice(0, 6).map((h) => (
            <div className="move-row" key={h.at + h.kind}>
              <span className={`move-delta ${h.delta >= 0 ? "plus" : "minus"}`}>{h.kind === "inventur" ? "=" : h.delta >= 0 ? "+" : "−"}{fmt(h.kind === "inventur" ? h.amount : Math.abs(h.delta))}</span>
              <span><strong>{MOVE_LABEL[h.kind]}</strong>{h.note && <small>{h.note}</small>}</span>
              <time>{timeAgo(h.at)}</time>
            </div>
          ))}
        </div>
      )}

      <div className="modal-actions">
        <Button className="secondary-button" onClick={onEdit}><Icon name="edit" size={14} /> Bearbeiten</Button>
        <Button className="secondary-button" onClick={onLabel}><Icon name="printer" size={14} /> Etikett</Button>
        <Button className={fromScan ? "primary-button" : "secondary-button"} onClick={onScanNext}><Icon name="scan" size={14} /> Nächsten scannen</Button>
      </div>
    </Modal>
  );
}
