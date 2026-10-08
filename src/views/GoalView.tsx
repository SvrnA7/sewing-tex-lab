import { useState } from "react";
import type { Settings } from "../../shared/types";
import type { AppCtx } from "../App";
import { api } from "../api";
import { Button, Icon, money } from "../ui";
import { GoalRing, OrderRow, pct } from "./Overview";

const sameDay = (iso: string) => new Date(iso).toDateString() === new Date().toDateString();

export function GoalView({ ctx, onSettings }: { ctx: AppCtx; onSettings: (s: Settings) => void }) {
  const { stats, orders, settings } = ctx;
  const [goal, setGoal] = useState(String(settings?.dailyGoal ?? 12));
  if (!stats) return null;

  const dueToday = orders
    .filter((o) => o.stage !== "Fertig" && new Date(o.dueDate) <= new Date(new Date().setHours(23, 59, 59)))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const doneToday = orders.filter((o) => o.stage === "Fertig" && o.completedAt && sameDay(o.completedAt));
  const maxDay = Math.max(stats.today.goal, ...stats.last7Days.map((d) => d.done), 1);
  const maxRev = Math.max(...stats.revenueByMonth.map((m) => m.revenue), 1);
  const avg7 = stats.last7Days.reduce((s, d) => s + d.done, 0) / 7;

  async function saveGoal() {
    try {
      onSettings(await api.saveSettings({ dailyGoal: Number(goal) }));
      await ctx.refresh();
      ctx.toast("Tagesziel gespeichert.");
    } catch (err) {
      ctx.toast((err as Error).message);
    }
  }

  return (
    <>
      <section className="welcome">
        <div>
          <p className="eyebrow">TAGESZIEL & UMSATZ</p>
          <h1>Heute in der Werkstatt</h1>
          <p>Fertiggestellte Teile zählen zum Tagesziel, sobald ein Auftrag auf „Fertig“ gesetzt wird.</p>
        </div>
      </section>

      <section className="goal-grid">
        <div className="panel goal-hero">
          <GoalRing done={stats.today.done} goal={stats.today.goal} size={132} />
          <div>
            <p className="eyebrow">TAGESZIEL</p>
            <h2>{stats.today.percent} % geschafft</h2>
            <p className="muted">{stats.today.remaining ? `Noch ${stats.today.remaining} Teile bis zum Ziel.` : "Tagesziel erreicht."} Ø letzte 7 Tage: {avg7.toLocaleString("de-DE", { maximumFractionDigits: 1 })} Teile.</p>
            <div className="goal-edit">
              <label className="field-label">Teile pro Tag<input type="number" min={1} value={goal} onChange={(e) => setGoal(e.target.value)} /></label>
              <Button className="primary-button" disabled={Number(goal) === stats.today.goal} onClick={saveGoal}>Ziel speichern</Button>
            </div>
          </div>
        </div>

        <div className="panel chart-panel">
          <div className="compact-heading"><div><p className="eyebrow">LETZTE 7 TAGE</p><h2>Fertige Teile</h2></div></div>
          <div className="bar-chart">
            <div className="goal-line" style={{ bottom: `${(stats.today.goal / maxDay) * 100}%` }}><span>Ziel {stats.today.goal}</span></div>
            {stats.last7Days.map((d) => (
              <div className="bar" key={d.date} title={`${d.done} Teile`}>
                <span className={d.done >= stats.today.goal ? "hit" : ""} style={{ height: `${(d.done / maxDay) * 100}%` }}><b>{d.done || ""}</b></span>
                <small>{new Date(d.date).toLocaleDateString("de-DE", { weekday: "short" })}</small>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="goal-grid">
        <div className="panel orders-panel">
          <div className="panel-heading"><div><p className="eyebrow">HEUTE FÄLLIG</p><h2>{dueToday.length ? `${dueToday.length} Aufträge` : "Nichts mehr fällig"}</h2></div></div>
          <div className="order-list">
            {dueToday.map((o) => <OrderRow key={o.id} order={o} ctx={ctx} />)}
          </div>
          {doneToday.length > 0 && (
            <div className="done-today">
              <Icon name="check" size={15} /> Heute fertig: {doneToday.map((o) => o.name).join(", ")}
            </div>
          )}
        </div>

        <div className="panel chart-panel">
          <div className="compact-heading">
            <div><p className="eyebrow">UMSATZ ERWIRTSCHAFTET</p><h2>{money(stats.revenueMonth, stats.currency)} im {new Date().toLocaleDateString("de-DE", { month: "long" })}</h2></div>
          </div>
          <p className="chart-meta">{pct(stats.revenueMonth, stats.revenueLastMonth)} · {stats.completedThisMonth} Aufträge abgeschlossen</p>
          <div className="bar-chart revenue">
            {stats.revenueByMonth.map((m) => (
              <div className="bar" key={m.month} title={money(m.revenue, stats.currency)}>
                <span style={{ height: `${(m.revenue / maxRev) * 100}%` }}><b>{m.revenue ? `${(m.revenue / 1000).toLocaleString("de-DE", { maximumFractionDigits: 1 })} Tsd.` : ""}</b></span>
                <small>{new Date(`${m.month}-01`).toLocaleDateString("de-DE", { month: "short" })}</small>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
