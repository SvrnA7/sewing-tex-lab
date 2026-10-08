import { useMemo, useState } from "react";
import { STAGES, stockTone } from "../../shared/types";
import type { AppCtx } from "../App";
import { Button, Icon, StagePill, StageTrack, dueLabel, isOverdue, money, orderTitle, orderVariant, stageIndex, timeAgo, type IconName } from "../ui";

const SUGGESTIONS = ["Welche Nadel für 320 g French Terry?", "Alle dringenden Aufträge analysieren", "Siebdruck auf Canvas vorbereiten"];

export function greeting() {
  const h = new Date().getHours();
  return h < 11 ? "Guten Morgen" : h < 17 ? "Hallo" : "Guten Abend";
}

export const pct = (now: number, before: number) =>
  before ? `${now >= before ? "+" : ""}${(((now - before) / before) * 100).toLocaleString("de-DE", { maximumFractionDigits: 1 })} % zum Vormonat` : "erster Monat";

export function matches(o: { name: string; customer: string; items: { title: string; variant: string }[] }, q: string) {
  if (!q) return true;
  return `${o.name} ${o.customer} ${o.items.map((i) => `${i.title} ${i.variant}`).join(" ")}`.toLowerCase().includes(q.toLowerCase());
}

export function GoalRing({ done, goal, size = 54 }: { done: number; goal: number; size?: number }) {
  const p = goal ? Math.min(done / goal, 1) * 100 : 0;
  return (
    <div className="progress-ring" style={{ width: size, height: size, background: `radial-gradient(closest-side, var(--ring-bg, var(--canvas)) 77%, transparent 78% 99%), conic-gradient(var(--green) ${p}%, var(--line) 0)` }}>
      <strong>{done}</strong><span>/ {goal}</span>
    </div>
  );
}

export function Overview({ ctx }: { ctx: AppCtx }) {
  const { orders, stats, materials, notes, notesTotal, settings, query } = ctx;
  const [message, setMessage] = useState("");

  const active = useMemo(
    () =>
      orders
        .filter((o) => o.stage !== "Fertig" && matches(o, query))
        .sort((a, b) => Number(b.priority) - Number(a.priority) || a.dueDate.localeCompare(b.dueDate))
        .slice(0, 6),
    [orders, query],
  );
  const urgent = orders.filter((o) => o.stage !== "Fertig" && (o.priority || isOverdue(o))).length;
  const stockList = [...materials].sort((a, b) => a.amount / a.minAmount - b.amount / b.minAmount).slice(0, 3);
  const monthName = new Date().toLocaleDateString("de-DE", { month: "long" });
  const dateLine = new Date().toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" }).toUpperCase();

  const cards: { icon: IconName; tone: string; label: string; value: string; meta: string; onClick: () => void }[] = stats
    ? [
        { icon: "cart", tone: "blue", label: "Offene Aufträge", value: String(stats.open), meta: `${stats.dueToday} heute fällig`, onClick: () => ctx.go("Aufträge") },
        { icon: "clock", tone: "amber", label: "In Bearbeitung", value: String(stats.inProgress), meta: `${stats.activeStations} Stationen aktiv`, onClick: () => ctx.go("Produktion") },
        { icon: "check", tone: "mint", label: "Abgeschlossen", value: String(stats.completed), meta: `${stats.completedThisMonth} in diesem Monat`, onClick: () => ctx.go("Aufträge") },
        { icon: "revenue", tone: "lilac", label: `Umsatz im ${monthName}`, value: money(stats.revenueMonth, stats.currency), meta: pct(stats.revenueMonth, stats.revenueLastMonth), onClick: () => ctx.go("Tagesziel") },
      ]
    : [];

  function ask(q?: string) {
    const text = (q ?? message).trim();
    if (!text) return;
    setMessage("");
    ctx.askLab(text);
  }

  return (
    <>
      <section className="welcome">
        <div>
          <p className="eyebrow">PRODUKTION · {dateLine}</p>
          <h1>{greeting()}, {settings?.ownerName ?? ""}.</h1>
          <p>
            {urgent === 0
              ? "Deine Werkstatt ist im Plan. Kein Auftrag ist überfällig."
              : `${urgent} ${urgent === 1 ? "Auftrag benötigt" : "Aufträge benötigen"} heute besondere Aufmerksamkeit.`}
          </p>
        </div>
        {stats && (
          <button className="today-progress" onClick={() => ctx.go("Tagesziel")}>
            <GoalRing done={stats.today.done} goal={stats.today.goal} />
            <div><small>Tagesziel</small><strong>{stats.today.percent} % abgeschlossen</strong><p>{stats.today.remaining ? `${stats.today.remaining} Teile verbleibend` : "Ziel erreicht 🎉"}</p></div>
          </button>
        )}
      </section>

      <section className="stats-grid">
        {cards.map((c) => (
          <button className="stat-card" key={c.label} onClick={c.onClick}>
            <div className={`stat-icon ${c.tone}`}><Icon name={c.icon} size={20} /></div>
            <div><small>{c.label}</small><strong>{c.value}</strong><p>{c.meta}</p></div>
          </button>
        ))}
      </section>

      <section className="dashboard-grid">
        <div className="panel orders-panel">
          <div className="panel-heading">
            <div><p className="eyebrow">LIVE AUS SHOPIFY</p><h2>Aktuelle Nähaufträge</h2></div>
            <Button className="text-button" onClick={() => ctx.go("Aufträge")}>Alle Aufträge <Icon name="arrow" size={16} /></Button>
          </div>
          <div className="order-table-head"><span>Auftrag</span><span>Fälligkeit</span><span>Produktionsstand</span><span></span></div>
          <div className="order-list">
            {active.map((o) => (
              <OrderRow key={o.id} order={o} ctx={ctx} />
            ))}
            {active.length === 0 && <p className="empty-state">{query ? "Keine passenden Aufträge gefunden." : "Keine offenen Aufträge. Zeit für einen Kaffee."}</p>}
          </div>
        </div>

        <div className="right-rail">
          <aside className="assistant-card">
            <div className="assistant-top">
              <div className="assistant-symbol"><Icon name="sparkles" size={22} /></div>
              <div><span>TEXTIL-LAB AGENT</span><strong>Wissen, das mitarbeitet.</strong></div>
              <span className={`live-pill ${ctx.integrations?.claude.connected ? "" : "off"}`}><i></i> {ctx.integrations?.claude.connected ? "Bereit" : "Offline"}</span>
            </div>
            <p>Claude durchsucht deine Obsidian-Wissensbasis und hilft bei Materialien, Verarbeitung und Produktion.</p>
            <div className="suggestions">
              {SUGGESTIONS.map((s) => (
                <Button key={s} onClick={() => ask(s)}><span>{s}</span><Icon name="arrow" size={15} /></Button>
              ))}
            </div>
            <div className="agent-input">
              <input aria-label="Frage an den Textil-Lab Agenten" onChange={(e) => setMessage(e.target.value)} onKeyDown={(e) => e.key === "Enter" && ask()} placeholder="Material oder Prozess erfragen …" value={message} />
              <Button aria-label="Frage senden" className="send-button" onClick={() => ask()}><Icon name="arrow" size={17} /></Button>
            </div>
            <div className="agent-meta"><span>CLAUDE API</span><span>OBSIDIAN · {notesTotal} NOTIZEN</span></div>
          </aside>

          <aside className="inventory-card">
            <div className="compact-heading">
              <div><p className="eyebrow">TEXTILLAGER</p><h2>Materialbestand</h2></div>
              <Button className="icon-button" aria-label="Zum Lager" onClick={() => ctx.go("Lager")}><Icon name="arrow" size={17} /></Button>
            </div>
            <div className="inventory-list">
              {stockList.map((m) => {
                const tone = stockTone(m);
                return (
                  <div className="inventory-item" key={m.id}>
                    <div className="inventory-top">
                      <span className={`stock-icon ${tone}`}><Icon name={tone === "critical" ? "alert" : "box"} size={16} /></span>
                      <div><strong>{m.name}</strong><small>{m.detail}</small></div>
                      <b>{m.amount.toLocaleString("de-DE")} {m.unit}</b>
                    </div>
                    <div className={`stock-track ${tone}`}><span style={{ width: `${Math.min((m.amount / m.capacity) * 100, 100)}%` }}></span></div>
                  </div>
                );
              })}
            </div>
            {stats && stats.lowStock > 0 && (
              <p className="stock-alert"><Icon name="alert" size={14} /> {stats.lowStock} {stats.lowStock === 1 ? "Material sollte" : "Materialien sollten"} nachbestellt werden.</p>
            )}
          </aside>
        </div>
      </section>

      <section className="knowledge-section">
        <div className="panel-heading">
          <div><p className="eyebrow">TEXTIL-LAB WISSEN</p><h2>Zuletzt ergänzt</h2></div>
          <Button className="text-button" onClick={() => ctx.go("Textil-Lab")}>Wissensbasis öffnen <Icon name="arrow" size={16} /></Button>
        </div>
        <div className="knowledge-grid">
          {notes.slice(0, 3).map((n, i) => (
            <Button className="knowledge-card" key={n.path} onClick={() => ctx.askLab(`Fasse die Notiz „${n.title}“ kurz zusammen.`)}>
              <span className={`knowledge-icon ${["lilac", "mint", "blue"][i % 3]}`}><Icon name={n.type === "Bild" ? "image" : n.type === "Dokument" || n.type === "Produktionsnotiz" ? "file" : "book"} size={20} /></span>
              <span><strong>{n.title}</strong><small>{n.type} · {timeAgo(n.updatedAt)}</small></span>
              <Icon name="chevron" size={17} />
            </Button>
          ))}
          {notes.length === 0 && <p className="empty-state">Noch keine Notizen in der Wissensbasis.</p>}
        </div>
      </section>
    </>
  );
}

export function OrderRow({ order: o, ctx }: { order: import("../../shared/types").Order; ctx: AppCtx }) {
  const idx = stageIndex(o.stage);
  return (
    <div className="order-row" onClick={() => ctx.openOrder(o)} role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && ctx.openOrder(o)}>
      <div className="order-main">
        <div className="product-thumb"><Icon name="shirt" size={19} /></div>
        <div>
          <div className="order-title">
            <strong>{orderTitle(o)}</strong><span>{o.name}</span>
            {o.priority && <em>Priorität</em>}
            {isOverdue(o) && <em>Überfällig</em>}
          </div>
          <p>{o.customer}{orderVariant(o) ? ` · ${orderVariant(o)}` : ""}</p>
        </div>
      </div>
      <div className="order-due"><small>Fällig</small><strong className={isOverdue(o) ? "danger" : ""}>{dueLabel(o.dueDate)}</strong><span>{money(o.total, o.currency)}</span></div>
      <div className="stage-cell">
        <div className="stage-top"><StagePill stage={o.stage} /><small>{idx + 1}/{STAGES.length}</small></div>
        <StageTrack stage={o.stage} />
      </div>
      <Button
        aria-label={`${o.name} weiterbewegen`}
        className="advance-button"
        disabled={o.stage === "Fertig"}
        title={o.stage === "Fertig" ? "Fertig" : `Weiter zu „${STAGES[idx + 1]}“`}
        onClick={(e) => { e.stopPropagation(); ctx.setStage(o, STAGES[Math.min(idx + 1, STAGES.length - 1)]); }}
      >
        {o.stage === "Fertig" ? <Icon name="check" size={16} /> : <Icon name="chevron" size={16} />}
      </Button>
    </div>
  );
}
