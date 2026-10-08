import Anthropic from "@anthropic-ai/sdk";
import type { Response } from "express";
import { STAGES, statusGroup, stockTone } from "../shared/types";
import { searchNotes } from "./obsidian";
import { getDb } from "./store";

export const claudeConfigured = () => Boolean(process.env.ANTHROPIC_API_KEY?.trim());
export const claudeModel = () => process.env.CLAUDE_MODEL || "claude-opus-5-5";

let client: Anthropic | undefined;
const getClient = () => (client ??= new Anthropic());

const SYSTEM_PROMPT = `Du bist der Textil-Lab Agent einer kleinen Nähwerkstatt. Du antwortest auf Deutsch, präzise und praxisnah.

Deine Quellen:
1. Die Obsidian-Wissensbasis der Werkstatt (Notizen zu Materialien, Schnitten, Maschineneinstellungen, Druckverfahren). Sie hat Vorrang vor Allgemeinwissen. Wenn du dich auf eine Notiz stützt, nenne ihren Titel in eckigen Klammern, z. B. [Materialguide French Terry].
2. Ein aktueller Auszug aus Auftragsmanagement und Textillager (Shopify-Aufträge mit Produktionsstand, Materialbestand, Tagesziel).
3. Dein allgemeines Fachwissen zu Textilien, Nähen und Textildruck. Kennzeichne, wenn eine Antwort nicht aus der Wissensbasis stammt.

Wenn etwas in den Daten fehlt, sag das offen, statt Werte zu erfinden. Halte Antworten kurz; nutze Listen für Einstellungen und Arbeitsschritte. Wenn eine Erkenntnis es wert ist, festgehalten zu werden, schlage am Ende einen kurzen Titel für eine neue Obsidian-Notiz vor.`;

function workshopSnapshot(): string {
  const db = getDb();
  const now = new Date();
  const active = db.orders.filter((o) => o.stage !== "Fertig");
  const lines = active
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    .slice(0, 40)
    .map((o) => {
      const items = o.items.map((i) => `${i.quantity}× ${i.title}${i.variant ? ` (${i.variant})` : ""}`).join(", ");
      const overdue = new Date(o.dueDate) < now ? " ÜBERFÄLLIG" : "";
      return `- ${o.name} · ${o.customer} · ${items} · Stand: ${o.stage} · fällig ${o.dueDate.slice(0, 10)}${overdue}${o.priority ? " · PRIORITÄT" : ""}${o.notes ? ` · Notiz: ${o.notes}` : ""}`;
    });
  const counts = STAGES.map((s) => `${s}: ${db.orders.filter((o) => o.stage === s).length}`).join(", ");
  const stock = db.materials
    .map((m) => `- ${m.name} (${m.detail}): ${m.amount} ${m.unit}, Mindestbestand ${m.minAmount} ${m.unit} → ${stockTone(m)}`)
    .join("\n");
  const open = db.orders.filter((o) => statusGroup(o.stage) !== "abgeschlossen").length;
  return `Stand ${now.toLocaleString("de-DE")}. ${open} offene/aktive Aufträge. Verteilung: ${counts}. Tagesziel: ${db.settings.dailyGoal} Teile.

Aktive Aufträge:
${lines.join("\n") || "- keine"}

Textillager:
${stock || "- leer"}`;
}

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

/** Streamt die Antwort als NDJSON: {type:"sources"} → {type:"text"}* → {type:"done"|"error"} */
export async function streamAgentReply(history: ChatTurn[], res: Response) {
  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  const send = (obj: unknown) => res.write(JSON.stringify(obj) + "\n");

  const question = history[history.length - 1]?.content ?? "";
  const notes = searchNotes(history.filter((t) => t.role === "user").slice(-2).map((t) => t.content).join(" "), 5);
  send({ type: "sources", sources: notes.map(({ body: _b, ...n }) => n) });

  if (!claudeConfigured()) {
    const intro = notes.length
      ? `Claude ist noch nicht verbunden (ANTHROPIC_API_KEY fehlt). Passende Notizen aus deiner Wissensbasis:\n\n${notes.map((n) => `**${n.title}**\n${n.body.replace(/^#\s+.*\n/m, "").trim().slice(0, 500)}`).join("\n\n")}`
      : "Claude ist noch nicht verbunden (ANTHROPIC_API_KEY fehlt) und in der Wissensbasis wurde nichts Passendes gefunden.";
    send({ type: "text", text: intro });
    send({ type: "done" });
    return res.end();
  }

  const context = `<wissensbasis>\n${
    notes.map((n) => `<notiz titel="${n.title}" pfad="${n.path}">\n${n.body}\n</notiz>`).join("\n") || "Keine passenden Notizen gefunden."
  }\n</wissensbasis>\n\n<werkstatt>\n${workshopSnapshot()}\n</werkstatt>`;

  const messages: Anthropic.Beta.BetaMessageParam[] = history.slice(0, -1).map((t) => ({ role: t.role, content: t.content }));
  messages.push({
    role: "user",
    content: [
      { type: "text", text: context },
      { type: "text", text: question },
    ],
  });

  try {
    const stream = getClient().beta.messages.stream({
      model: claudeModel(),
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      output_config: { effort: "medium" },
      // Bei einer Ablehnung durch Sicherheitsfilter übernimmt automatisch ein Ersatzmodell.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: SYSTEM_PROMPT,
      messages,
    });

    stream.on("text", (text) => send({ type: "text", text }));
    const final = await stream.finalMessage();
    if (final.stop_reason === "refusal") send({ type: "text", text: "\n\n_Der Agent konnte diese Anfrage nicht beantworten._" });
    send({ type: "done" });
  } catch (err) {
    const msg =
      err instanceof Anthropic.AuthenticationError
        ? "Der Claude-API-Schlüssel ist ungültig."
        : err instanceof Anthropic.RateLimitError
          ? "Claude ist gerade ausgelastet. Bitte gleich nochmal versuchen."
          : err instanceof Anthropic.APIError
            ? `Claude-Fehler (${err.status ?? "Netzwerk"}): ${err.message}`
            : (err as Error).message;
    send({ type: "error", error: msg });
  }
  res.end();
}
