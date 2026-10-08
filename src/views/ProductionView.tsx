import { useState } from "react";
import { STAGES, type Order, type Stage } from "../../shared/types";
import type { AppCtx } from "../App";
import { Button, Icon, dueLabel, isOverdue, orderTitle, orderVariant, stageIndex } from "../ui";
import { matches } from "./Overview";

export function ProductionView({ ctx }: { ctx: AppCtx }) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<Stage | null>(null);
  const [showDone, setShowDone] = useState(false);

  const recent = Date.now() - 3 * 86400000;
  const visible = ctx.orders.filter(
    (o) => matches(o, ctx.query) && (o.stage !== "Fertig" || showDone || new Date(o.completedAt ?? o.createdAt).getTime() > recent),
  );

  function drop(stage: Stage) {
    const order = ctx.orders.find((o) => o.id === dragId);
    setDragId(null);
    setOver(null);
    if (order && order.stage !== stage) ctx.setStage(order, stage);
  }

  return (
    <>
      <section className="welcome">
        <div>
          <p className="eyebrow">PRODUKTION</p>
          <h1>Produktionsboard</h1>
          <p>Ziehe Aufträge in die nächste Station oder nutze den Pfeil auf der Karte.</p>
        </div>
        <label className="check-row"><input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> Alle fertigen Aufträge zeigen</label>
      </section>

      <div className="kanban">
        {STAGES.map((stage) => {
          const cards = visible
            .filter((o) => o.stage === stage)
            .sort((a, b) => Number(b.priority) - Number(a.priority) || a.dueDate.localeCompare(b.dueDate));
          const pieces = cards.reduce((n, o) => n + o.items.reduce((m, i) => m + i.quantity, 0), 0);
          return (
            <section
              key={stage}
              className={`kanban-col ${over === stage ? "over" : ""}`}
              onDragOver={(e) => { e.preventDefault(); setOver(stage); }}
              onDragLeave={() => setOver((s) => (s === stage ? null : s))}
              onDrop={() => drop(stage)}
            >
              <header>
                <span className={`status-pill stage-${stageIndex(stage)}`}>{stage}</span>
                <small>{cards.length} · {pieces} Teile</small>
              </header>
              <div className="kanban-cards">
                {cards.map((o) => <KanbanCard key={o.id} order={o} ctx={ctx} onDrag={setDragId} />)}
                {cards.length === 0 && <p className="kanban-empty">Leer</p>}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}

function KanbanCard({ order: o, ctx, onDrag }: { order: Order; ctx: AppCtx; onDrag: (id: string | null) => void }) {
  const idx = stageIndex(o.stage);
  return (
    <article
      className={`kanban-card ${o.priority ? "prio" : ""}`}
      draggable
      onDragStart={() => onDrag(o.id)}
      onDragEnd={() => onDrag(null)}
      onClick={() => ctx.openOrder(o)}
    >
      <div className="order-title">
        <strong>{orderTitle(o)}</strong>
        {o.priority && <em>Priorität</em>}
      </div>
      <p>{o.name} · {o.customer}</p>
      {orderVariant(o) && <p className="muted">{orderVariant(o)}</p>}
      <footer>
        <span className={isOverdue(o) ? "danger" : ""}><Icon name="clock" size={13} /> {dueLabel(o.dueDate)}</span>
        {o.stage !== "Fertig" && (
          <Button
            className="advance-button"
            aria-label={`Weiter zu ${STAGES[idx + 1]}`}
            title={`Weiter zu „${STAGES[idx + 1]}“`}
            onClick={(e) => { e.stopPropagation(); ctx.setStage(o, STAGES[idx + 1]); }}
          >
            <Icon name="chevron" size={15} />
          </Button>
        )}
      </footer>
    </article>
  );
}
