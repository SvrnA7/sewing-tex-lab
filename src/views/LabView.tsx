import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import type { KnowledgeNote } from "../../shared/types";
import type { AppCtx } from "../App";
import { api, askAgent } from "../api";
import { Button, Icon, Modal, timeAgo } from "../ui";

interface Turn {
  role: "user" | "assistant";
  content: string;
  sources?: KnowledgeNote[];
  error?: boolean;
}

/** Sehr kleines Markdown: Überschriften, Listen, **fett**, `code`, [Notiz]. */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\])/g).map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`")) return <code key={i}>{part.slice(1, -1)}</code>;
    if (part.startsWith("[") && part.endsWith("]")) return <span className="cite" key={i}>{part.slice(1, -1)}</span>;
    return <Fragment key={i}>{part}</Fragment>;
  });
}

export function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => {
    if (!list) return;
    const items = list.items.map((it, i) => <li key={i}>{inline(it)}</li>);
    blocks.push(list.ordered ? <ol key={blocks.length}>{items}</ol> : <ul key={blocks.length}>{items}</ul>);
    list = null;
  };
  for (const line of text.split("\n")) {
    const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
    const num = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (bullet || num) {
      const ordered = Boolean(num);
      if (!list || list.ordered !== ordered) { flush(); list = { ordered, items: [] }; }
      list.items.push((bullet ?? num)![1]);
      continue;
    }
    flush();
    const h = line.match(/^#{1,4}\s+(.*)$/);
    if (h) blocks.push(<h4 key={blocks.length}>{inline(h[1])}</h4>);
    else if (line.trim()) blocks.push(<p key={blocks.length}>{inline(line)}</p>);
  }
  flush();
  return <div className="md">{blocks}</div>;
}

export function LabView({ ctx }: { ctx: AppCtx }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<KnowledgeNote[] | null>(null);
  const [openNote, setOpenNote] = useState<{ note: KnowledgeNote; body: string } | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (ctx.pendingQuestion) {
      send(ctx.pendingQuestion);
      ctx.clearPendingQuestion();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.pendingQuestion]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [turns]);

  useEffect(() => {
    if (!search.trim()) return setResults(null);
    const t = window.setTimeout(() => api.knowledge(search).then((r) => setResults(r.notes)).catch(() => {}), 250);
    return () => window.clearTimeout(t);
  }, [search]);

  async function send(text?: string) {
    const q = (text ?? input).trim();
    if (!q || busy) return;
    setInput("");
    setBusy(true);
    const history = [...turns.filter((t) => !t.error), { role: "user" as const, content: q }];
    setTurns((t) => [...t, { role: "user", content: q }, { role: "assistant", content: "" }]);
    const patchLast = (fn: (t: Turn) => Turn) => setTurns((list) => list.map((t, i) => (i === list.length - 1 ? fn(t) : t)));
    try {
      await askAgent(history.map(({ role, content }) => ({ role, content })), (e) => {
        if (e.type === "sources") patchLast((t) => ({ ...t, sources: e.sources }));
        else if (e.type === "text") patchLast((t) => ({ ...t, content: t.content + e.text }));
        else if (e.type === "error") patchLast((t) => ({ ...t, content: t.content + (t.content ? "\n\n" : "") + e.error, error: true }));
      });
    } catch (err) {
      patchLast((t) => ({ ...t, content: (err as Error).message, error: true }));
    } finally {
      setBusy(false);
    }
  }

  async function show(path: string) {
    try {
      setOpenNote(await api.note(path));
    } catch (err) {
      ctx.toast((err as Error).message);
    }
  }

  const lastAnswer = [...turns].reverse().find((t) => t.role === "assistant" && t.content && !t.error);
  const lastQuestion = [...turns].reverse().find((t) => t.role === "user");
  const noteList = results ?? ctx.notes;
  const integ = ctx.integrations;

  return (
    <>
      <section className="welcome">
        <div>
          <p className="eyebrow">TEXTIL-LAB AGENT</p>
          <h1>Wissen, das mitarbeitet.</h1>
          <p>Frag nach Materialien, Maschineneinstellungen, Druckverfahren oder deinen aktuellen Aufträgen.</p>
        </div>
        <div className="lab-status">
          <span className={`live-pill ${integ?.claude.connected ? "" : "off"}`}><i></i> {integ?.claude.connected ? integ.claude.model : "Claude nicht verbunden"}</span>
          <span className={`live-pill ${integ?.obsidian.demo ? "off" : ""}`}><i></i> {integ?.obsidian.demo ? "Demo-Vault" : "Obsidian-Vault"} · {ctx.notesTotal} Notizen</span>
        </div>
      </section>

      <section className="lab-grid">
        <div className="panel chat-panel">
          <div className="chat-scroll" ref={scroller}>
            {turns.length === 0 && (
              <div className="chat-empty">
                <div className="assistant-symbol"><Icon name="sparkles" size={22} /></div>
                <p>Der Agent durchsucht deine Obsidian-Notizen und kennt den aktuellen Stand deiner Aufträge und deines Lagers.</p>
                <div className="suggestions">
                  {["Welche Nadel für 320 g French Terry?", "Welche Aufträge sind heute kritisch und warum?", "Welche Stoffe muss ich diese Woche nachbestellen?", "Siebdruck auf Canvas vorbereiten"].map((s) => (
                    <Button key={s} onClick={() => send(s)}><span>{s}</span><Icon name="arrow" size={15} /></Button>
                  ))}
                </div>
              </div>
            )}
            {turns.map((t, i) => (
              <div className={`bubble ${t.role} ${t.error ? "error" : ""}`} key={i}>
                {t.role === "assistant" ? (t.content ? <Markdown text={t.content} /> : <span className="typing"><i></i><i></i><i></i></span>) : <p>{t.content}</p>}
                {t.sources && t.sources.length > 0 && (
                  <div className="sources">
                    <small>Quellen aus Obsidian:</small>
                    {t.sources.map((s) => <Button key={s.path} onClick={() => show(s.path)}><Icon name="book" size={12} /> {s.title}</Button>)}
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="chat-input">
            <textarea
              rows={1}
              aria-label="Frage an den Textil-Lab Agenten"
              placeholder="Material oder Prozess erfragen …"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            />
            <Button className="send-button" aria-label="Frage senden" disabled={busy} onClick={() => send()}><Icon name="arrow" size={17} /></Button>
          </div>
          {lastAnswer && !busy && (
            <div className="chat-actions">
              <Button className="text-button" onClick={() => ctx.openKnowledge({ title: lastQuestion?.content.slice(0, 80), content: lastAnswer.content })}>
                <Icon name="plus" size={14} /> Antwort als Obsidian-Notiz speichern
              </Button>
              <Button className="text-button" onClick={() => setTurns([])}>Neues Gespräch</Button>
            </div>
          )}
        </div>

        <aside className="panel notes-panel">
          <div className="compact-heading">
            <div><p className="eyebrow">WISSENSBASIS</p><h2>Obsidian-Notizen</h2></div>
            <Button className="icon-button" aria-label="Wissen ergänzen" onClick={() => ctx.openKnowledge()}><Icon name="plus" size={17} /></Button>
          </div>
          <div className="notes-search">
            <Icon name="search" size={15} />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Notizen durchsuchen …" aria-label="Notizen durchsuchen" />
          </div>
          <div className="notes-list">
            {noteList.map((n) => (
              <button className="note-item" key={n.path} onClick={() => show(n.path)}>
                <strong>{n.title}</strong>
                <small>{n.type} · {timeAgo(n.updatedAt)}{n.tags.length ? ` · #${n.tags.slice(0, 2).join(" #")}` : ""}</small>
                <p>{n.excerpt}</p>
              </button>
            ))}
            {noteList.length === 0 && <p className="empty-state">Keine Notizen gefunden.</p>}
          </div>
        </aside>
      </section>

      {openNote && (
        <Modal eyebrow={`OBSIDIAN · ${openNote.note.path}`} title={openNote.note.title} subtitle={`${openNote.note.type} · ${timeAgo(openNote.note.updatedAt)}`} onClose={() => setOpenNote(null)} wide>
          <Markdown text={openNote.body.replace(/^#\s+.*\n/, "")} />
          <div className="modal-actions">
            <Button className="primary-button" onClick={() => { const t = openNote.note.title; setOpenNote(null); send(`Erkläre mir die Notiz „${t}“ und wende sie auf meine aktuellen Aufträge an.`); }}>
              <Icon name="sparkles" size={16} /> Agent dazu fragen
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
