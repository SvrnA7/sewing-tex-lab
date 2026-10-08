import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, extname, join, relative, resolve, sep } from "node:path";
import type { KnowledgeNote } from "../shared/types";

const DEMO_VAULT = resolve(process.env.DATA_DIR ?? "data", "demo-vault");

export const obsidianConfigured = () => Boolean(process.env.OBSIDIAN_VAULT_PATH?.trim());
export const vaultPath = () => (obsidianConfigured() ? resolve(process.env.OBSIDIAN_VAULT_PATH!.trim()) : DEMO_VAULT);
const notesFolder = () => process.env.OBSIDIAN_NOTES_FOLDER || "Textil-Lab";

interface RawNote extends KnowledgeNote {
  body: string;
  mtime: number;
}

const DEMO_NOTES: Record<string, string> = {
  "Textil-Lab/Materialguide French Terry.md": `---
typ: Hinweis
tags: [material, french-terry]
---
# Materialguide French Terry

- Gewicht 280–340 g/m², Schlingenseite innen.
- Nadel: Jersey/Stretch 90/14, bei 320 g+ eher 100/16.
- Overlock: Differentialtransport 1,3–1,5, damit die Kante nicht wellt.
- Covermaschine für Säume, Stichlänge 3,5 mm.
- Vor dem Zuschnitt waschen (Einsprung bis 5 %).
`,
  "Textil-Lab/Nahtzugaben Hoodie V3.md": `---
typ: Produktionsnotiz
tags: [hoodie, schnitt]
---
# Nahtzugaben · Hoodie V3

- Seitennähte & Ärmel: 1 cm (Overlock).
- Kapuze Mittelnaht: 1 cm, mit Flachnaht absteppen.
- Bündchen: 0,75 cm, Bündchen 15 % kürzer als Öffnung zuschneiden.
- Kängurutasche: 2 cm Umschlag oben.
`,
  "Textil-Lab/Siebdruck Raster & Belichtung.md": `---
typ: Referenz
tags: [siebdruck, druck]
---
# Siebdruck Raster & Belichtung

- Canvas 450 g: Gewebe 43T, Plastisol oder Wasserbasis mit Fixierer.
- Belichtung 120 s bei 4.000 W LED, Abstand 50 cm.
- Raster 35 lpi für Halbtöne auf grobem Gewebe.
- Fixieren: 160 °C, 3 min im Tunneltrockner bzw. 2× Bügelpresse 20 s.
- Canvas vor dem Druck glatt pressen, damit die Farbe nicht bricht.
`,
  "Textil-Lab/Heavy Jersey Verarbeitung.md": `---
typ: Hinweis
tags: [material, jersey, t-shirt]
---
# Heavy Jersey Verarbeitung

- 220 g/m², Ringgarn, geringe Rollneigung.
- Nadel 80/12 Jersey, Overlock DT 1,2.
- Halsbündchen 1x1 Rib, 85 % der Halsausschnittlänge.
- DTF-Druck: 150 °C, 12 s, kalt abziehen.
`,
};

function ensureDemoVault() {
  if (obsidianConfigured() || existsSync(DEMO_VAULT)) return;
  for (const [path, content] of Object.entries(DEMO_NOTES)) {
    const full = join(DEMO_VAULT, path);
    mkdirSync(resolve(full, ".."), { recursive: true });
    writeFileSync(full, content);
  }
}

function parseNote(full: string, root: string): RawNote {
  const raw = readFileSync(full, "utf8");
  const st = statSync(full);
  let body = raw;
  let type = "Notiz";
  let tags: string[] = [];
  const fm = raw.match(/^---\n([\s\S]*?)\n---\n?/);
  if (fm) {
    body = raw.slice(fm[0].length);
    const typ = fm[1].match(/^(?:typ|type):\s*(.+)$/m);
    if (typ) type = typ[1].trim();
    const t = fm[1].match(/^tags:\s*\[?(.*?)\]?$/m);
    if (t) tags = t[1].split(",").map((s) => s.trim().replace(/^#/, "")).filter(Boolean);
  }
  tags.push(...[...body.matchAll(/(?:^|\s)#([\p{L}\d_/-]+)/gu)].map((m) => m[1]));
  const heading = body.match(/^#\s+(.+)$/m);
  const title = heading?.[1].trim() ?? basename(full, extname(full));
  const excerpt = body.replace(/^#.*$/m, "").replace(/[#*_>`-]/g, " ").replace(/\s+/g, " ").trim().slice(0, 180);
  return {
    path: relative(root, full).split(sep).join("/"),
    title,
    type,
    tags: [...new Set(tags)],
    excerpt,
    updatedAt: st.mtime.toISOString(),
    body,
    mtime: st.mtimeMs,
  };
}

function walk(dir: string, out: string[], depth = 0) {
  if (depth > 8 || out.length > 3000) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue; // .obsidian, .trash, …
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out, depth + 1);
    else if (entry.name.endsWith(".md")) out.push(full);
  }
}

function allNotes(): RawNote[] {
  ensureDemoVault();
  const root = vaultPath();
  if (!existsSync(root)) return [];
  const files: string[] = [];
  walk(root, files);
  return files.map((f) => parseNote(f, root)).sort((a, b) => b.mtime - a.mtime);
}

const strip = ({ body: _b, mtime: _m, ...note }: RawNote): KnowledgeNote => note;

export function listNotes(limit = 200): { notes: KnowledgeNote[]; total: number } {
  const notes = allNotes();
  return { notes: notes.slice(0, limit).map(strip), total: notes.length };
}

const tokenize = (s: string) =>
  s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").split(/[^\p{L}\d]+/u).filter((t) => t.length > 2);

/** Einfache Schlüsselwort-Suche (Titel und Tags zählen stärker als Text). */
export function searchNotes(query: string, k = 5): (KnowledgeNote & { body: string })[] {
  const terms = tokenize(query);
  if (!terms.length) return [];
  return allNotes()
    .map((n) => {
      const title = tokenize(n.title + " " + n.tags.join(" "));
      const body = tokenize(n.body);
      let score = 0;
      for (const t of terms) {
        score += title.filter((w) => w.startsWith(t)).length * 4;
        score += body.filter((w) => w.startsWith(t)).length;
      }
      return { n, score };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map(({ n }) => ({ ...strip(n), body: n.body.slice(0, 6000) }));
}

export function readNote(path: string): { note: KnowledgeNote; body: string } | undefined {
  const root = vaultPath();
  const full = resolve(root, path);
  if (!full.startsWith(root + sep) || !existsSync(full)) return undefined;
  const n = parseNote(full, root);
  return { note: strip(n), body: n.body };
}

const safeName = (s: string) => s.replace(/[\\/:*?"<>|#^[\]]/g, "-").replace(/\s+/g, " ").trim().slice(0, 120) || "Notiz";

/** Legt eine neue Notiz (optional mit Anhang) im Vault an. */
export function addNote(input: { type: string; title: string; content: string; file?: { name: string; base64: string } }): KnowledgeNote {
  ensureDemoVault();
  const root = vaultPath();
  const folder = join(root, notesFolder());
  mkdirSync(folder, { recursive: true });

  let embed = "";
  if (input.file) {
    const attDir = join(folder, "Anhänge");
    mkdirSync(attDir, { recursive: true });
    const fileName = `${Date.now()}-${safeName(input.file.name)}`;
    writeFileSync(join(attDir, fileName), Buffer.from(input.file.base64, "base64"));
    embed = `\n\n![[${notesFolder()}/Anhänge/${fileName}]]\n`;
  }

  let name = safeName(input.title);
  let target = join(folder, `${name}.md`);
  for (let i = 2; existsSync(target); i++) target = join(folder, `${name} ${i}.md`);

  const today = new Date().toISOString().slice(0, 10);
  const md = `---\ntyp: ${input.type}\nerstellt: ${today}\nquelle: Stitchflow\ntags: [textil-lab]\n---\n# ${input.title}\n\n${input.content.trim()}${embed}`;
  writeFileSync(target, md);
  return strip(parseNote(target, root));
}
