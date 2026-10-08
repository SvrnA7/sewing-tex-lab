import type { ButtonHTMLAttributes, ReactNode } from "react";
import { STAGES, type Order, type Stage } from "../shared/types";

export type IconName =
  | "alert" | "arrow" | "book" | "box" | "cart" | "check" | "chevron" | "clock" | "close" | "dashboard"
  | "file" | "image" | "package" | "plus" | "revenue" | "search" | "shirt" | "sparkles" | "sync" | "target"
  | "upload" | "minus" | "trash" | "edit" | "flag" | "kanban";

const iconPaths: Record<IconName, ReactNode> = {
  alert: <><path d="M12 3 2.8 20h18.4z" /><path d="M12 9v4M12 17h.01" /></>,
  arrow: <><path d="M5 12h14M13 6l6 6-6 6" /></>,
  book: <><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H11v16H6.5A2.5 2.5 0 0 0 4 21.5z" /><path d="M20 5.5A2.5 2.5 0 0 0 17.5 3H13v16h4.5a2.5 2.5 0 0 1 2.5 2.5z" /></>,
  box: <><path d="m4 7 8-4 8 4-8 4z" /><path d="m4 7 8 4 8-4v10l-8 4-8-4zM12 11v10" /></>,
  cart: <><path d="M3 4h2l2 11h10l3-8H6" /><circle cx="9" cy="19" r="1.5" /><circle cx="17" cy="19" r="1.5" /></>,
  check: <path d="m5 12 4 4L19 6" />,
  chevron: <path d="m9 18 6-6-6-6" />,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  close: <><path d="m6 6 12 12M18 6 6 18" /></>,
  dashboard: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
  file: <><path d="M6 2h8l4 4v16H6z" /><path d="M14 2v5h5M9 12h6M9 16h6" /></>,
  image: <><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="2" /><path d="m21 15-5-4-7 7" /></>,
  package: <><path d="M4 8h16v12H4zM4 8l3-4h10l3 4M9 12h6" /></>,
  plus: <><path d="M12 5v14M5 12h14" /></>,
  minus: <path d="M5 12h14" />,
  revenue: <><circle cx="12" cy="12" r="9" /><path d="M15.5 8.5A4 4 0 1 0 15.5 15.5M7 11h7M7 14h6" /></>,
  search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></>,
  shirt: <><path d="m8 4-5 3 2 5 3-1v9h8v-9l3 1 2-5-5-3c-.7 1.3-2 2-4 2S8.7 5.3 8 4Z" /></>,
  sparkles: <><path d="m12 3 1.2 3.8L17 8l-3.8 1.2L12 13l-1.2-3.8L7 8l3.8-1.2zM6 14l.7 2.3L9 17l-2.3.7L6 20l-.7-2.3L3 17l2.3-.7zM18 14l.7 2.3L21 17l-2.3.7L18 20l-.7-2.3L15 17l2.3-.7z" /></>,
  sync: <><path d="M20 7h-5V2M4 17h5v5" /><path d="M19 12a7 7 0 0 0-12-5L4 10M5 12a7 7 0 0 0 12 5l3-3" /></>,
  target: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1" /></>,
  upload: <><path d="M12 16V4M7 9l5-5 5 5M5 14v6h14v-6" /></>,
  trash: <><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" /></>,
  edit: <><path d="M4 20h4L19 9l-4-4L4 16z" /><path d="m13 7 4 4" /></>,
  flag: <><path d="M5 21V4M5 4h11l-2 4 2 4H5" /></>,
  kanban: <><rect x="3" y="4" width="5" height="16" rx="1" /><rect x="10" y="4" width="5" height="10" rx="1" /><rect x="17" y="4" width="4" height="13" rx="1" /></>,
};

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg aria-hidden="true" className="icon" fill="none" height={size} viewBox="0 0 24 24" width={size}>
      {iconPaths[name]}
    </svg>
  );
}

export function Button({ children, className = "", type = "button", ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className={className} type={type} {...props}>{children}</button>;
}

export function Modal({ eyebrow, title, subtitle, onClose, children, wide }: {
  eyebrow?: string; title: string; subtitle?: string; onClose: () => void; children: ReactNode; wide?: boolean;
}) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div className={`modal ${wide ? "wide" : ""}`} role="dialog" aria-modal="true" aria-label={title} onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            {eyebrow && <p className="eyebrow">{eyebrow}</p>}
            <h2>{title}</h2>
            {subtitle && <span>{subtitle}</span>}
          </div>
          <Button className="icon-button" aria-label="Schließen" onClick={onClose}><Icon name="close" size={20} /></Button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

export const stageIndex = (s: Stage) => STAGES.indexOf(s);
export const nextStage = (s: Stage): Stage => STAGES[Math.min(stageIndex(s) + 1, STAGES.length - 1)];

export function StagePill({ stage }: { stage: Stage }) {
  return <span className={`status-pill stage-${stageIndex(stage)}`}>{stage}</span>;
}

export function StageTrack({ stage }: { stage: Stage }) {
  return <div className="stage-track"><span style={{ width: `${((stageIndex(stage) + 1) / STAGES.length) * 100}%` }}></span></div>;
}

export const money = (n: number, currency = "EUR") =>
  n.toLocaleString("de-DE", { style: "currency", currency, maximumFractionDigits: n % 1 === 0 ? 0 : 2 });

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

export function dueLabel(iso: string) {
  const d = new Date(iso);
  const diff = Math.round((startOfDay(d) - startOfDay(new Date())) / 86400000);
  const time = d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  if (diff === 0) return `Heute, ${time}`;
  if (diff === 1) return "Morgen";
  if (diff === -1) return "Gestern";
  return d.toLocaleDateString("de-DE", { day: "numeric", month: "long" });
}

export const isOverdue = (o: Order) => o.stage !== "Fertig" && startOfDay(new Date(o.dueDate)) < startOfDay(new Date());
export const isDueToday = (o: Order) => o.stage !== "Fertig" && startOfDay(new Date(o.dueDate)) <= startOfDay(new Date());

export const orderTitle = (o: Order) =>
  o.items.length === 1 ? o.items[0].title : `${o.items[0]?.title ?? "Auftrag"} +${o.items.length - 1}`;
export const orderVariant = (o: Order) =>
  o.items.map((i) => [i.quantity > 1 ? `${i.quantity} Stück` : "", i.variant].filter(Boolean).join(" · ")).filter(Boolean).join(" / ");

export const timeAgo = (iso: string) => {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 2) return "gerade eben";
  if (mins < 60) return `vor ${mins} Min.`;
  const h = Math.round(mins / 60);
  if (h < 24) return `vor ${h} Std.`;
  const d = Math.round(h / 24);
  return d === 1 ? "gestern" : `vor ${d} Tagen`;
};
