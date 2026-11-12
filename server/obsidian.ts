import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, extname, join, relative, resolve, sep } from "node:path";
import type { KnowledgeNote } from "../shared/types.js";
import { getStore } from "./store.js";

/**
 * Wissensbasis (Obsidian). Drei Quellen, je nach Konfiguration:
 * - "github": Vault liegt in einem GitHub-Repo (Obsidian-Git-Plugin synchronisiert) – passt zu Vercel.
 * - "ordner": Vault-Ordner auf demselben Rechner wie der Server (lokaler Betrieb).
 * - "app":    eingebaute Wissensbasis in der App-Datenbank, solange kein Vault angebunden ist.
 */
export type VaultSource = "github" | "ordner" | "app";

const env = (k: string) => process.env[k]?.trim() || undefined;
export const vaultSource = (): VaultSource =>
  env("OBSIDIAN_GITHUB_REPO") && env("OBSIDIAN_GITHUB_TOKEN") ? "github" : env("OBSIDIAN_VAULT_PATH") ? "ordner" : "app";
export const obsidianConfigured = () => vaultSource() !== "app";
export const vaultLabel = () =>
  vaultSource() === "github" ? `GitHub: ${gh().repo}` : vaultSource() === "ordner" ? resolve(env("OBSIDIAN_VAULT_PATH")!) : "In der App";
const notesFolder = () => env("OBSIDIAN_NOTES_FOLDER") || "Textil-Lab";

interface RawFile {
  path: string;
  content: string;
  updatedAt: string;
}

interface RawNote extends KnowledgeNote {
  body: string;
}

// ── Quelle: Ordner ─────────────────────────────────────
function walk(dir: string, out: string[], depth = 0) {
  if (depth > 8 || out.length > 3000) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue; // .obsidian, .trash, …
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out, depth + 1);
    else if (entry.name.endsWith(".md")) out.push(full);
  }
}

const folderRoot = () => resolve(env("OBSIDIAN_VAULT_PATH")!);

function folderFiles(): RawFile[] {
  const root = folderRoot();
  if (!existsSync(root)) return [];
  const files: string[] = [];
  walk(root, files);
  return files.map((f) => ({
    path: relative(root, f).split(sep).join("/"),
    content: readFileSync(f, "utf8"),
    updatedAt: statSync(f).mtime.toISOString(),
  }));
}

// ── Quelle: GitHub-Repo ────────────────────────────────
const gh = () => ({
  repo: env("OBSIDIAN_GITHUB_REPO")!.replace(/^https:\/\/github\.com\//, "").replace(/\.git$/, ""),
  branch: env("OBSIDIAN_GITHUB_BRANCH") || "main",
  // Optional: Vault liegt in einem Unterordner des Repos
  dir: (env("OBSIDIAN_GITHUB_DIR") || "").replace(/^\/|\/$/g, ""),
});

async function ghFetch(path: string, init?: RequestInit) {
  const res = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${env("OBSIDIAN_GITHUB_TOKEN")}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "stitchflow",
      ...init?.headers,
    },
  });
  if (!res.ok) throw new Error(`GitHub ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

const blobCache = new Map<string, string>(); // sha → Inhalt, hält sich solange die Funktion warm ist
let treeCache: { at: number; files: RawFile[] } | undefined;

async function githubFiles(): Promise<RawFile[]> {
  if (treeCache && Date.now() - treeCache.at < 60_000) return treeCache.files;
  const { repo, branch, dir } = gh();
  const tree = await ghFetch(`/repos/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`);
  const prefix = dir ? `${dir}/` : "";
  const entries = (tree.tree as { path: string; type: string; sha: string }[]).filter(
    (e) => e.type === "blob" && e.path.endsWith(".md") && e.path.startsWith(prefix) && !e.path.split("/").some((p) => p.startsWith(".")),
  ).slice(0, 1500);

  const missing = entries.filter((e) => !blobCache.has(e.sha));
  for (let i = 0; i < missing.length; i += 16) {
    await Promise.all(
      missing.slice(i, i + 16).map(async (e) => {
        const blob = await ghFetch(`/repos/${repo}/git/blobs/${e.sha}`);
        blobCache.set(e.sha, Buffer.from(blob.content, "base64").toString("utf8"));
      }),
    );
  }
  // GitHub liefert im Baum kein Datum; Reihenfolge = Commit-Zeit wäre teuer, daher Zeitpunkt des Abrufs
  const now = new Date().toISOString();
  const files = entries.map((e) => ({ path: e.path.slice(prefix.length), content: blobCache.get(e.sha)!, updatedAt: now }));
  treeCache = { at: Date.now(), files };
  return files;
}

async function githubPut(path: string, base64: string, message: string) {
  const { repo, branch, dir } = gh();
  const full = (dir ? `${dir}/` : "") + path;
  const url = `/repos/${repo}/contents/${full.split("/").map(encodeURIComponent).join("/")}`;
  await ghFetch(url, { method: "PUT", body: JSON.stringify({ message, content: base64, branch }) });
  treeCache = undefined;
}

// ── Gemeinsam ──────────────────────────────────────────
async function rawFiles(): Promise<RawFile[]> {
  switch (vaultSource()) {
    case "github":
      return githubFiles();
    case "ordner":
      return folderFiles();
    default:
      return (await (await getStore()).listFiles()).filter((f) => f.path.endsWith(".md") && f.encoding === "utf8");
  }
}

function parseNote(file: RawFile): RawNote {
  const raw = file.content.replace(/\r\n/g, "\n");
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
  const title = heading?.[1].trim() ?? basename(file.path, extname(file.path));
  const excerpt = body.replace(/^#.*$/m, "").replace(/[#*_>`-]/g, " ").replace(/\s+/g, " ").trim().slice(0, 180);
  return { path: file.path, title, type, tags: [...new Set(tags)], excerpt, updatedAt: file.updatedAt, body };
}

async function allNotes(): Promise<RawNote[]> {
  return (await rawFiles()).map(parseNote).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

const strip = ({ body: _b, ...note }: RawNote): KnowledgeNote => note;

export async function listNotes(limit = 200): Promise<{ notes: KnowledgeNote[]; total: number }> {
  const notes = await allNotes();
  return { notes: notes.slice(0, limit).map(strip), total: notes.length };
}

const tokenize = (s: string) =>
  s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").split(/[^\p{L}\d]+/u).filter((t) => t.length > 2);

/** Einfache Schlüsselwort-Suche (Titel und Tags zählen stärker als Text). */
export async function searchNotes(query: string, k = 5): Promise<(KnowledgeNote & { body: string })[]> {
  const terms = tokenize(query);
  if (!terms.length) return [];
  return (await allNotes())
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

export async function readNote(path: string): Promise<{ note: KnowledgeNote; body: string } | undefined> {
  const file = (await rawFiles()).find((f) => f.path === path);
  if (!file) return undefined;
  const n = parseNote(file);
  return { note: strip(n), body: n.body };
}

const safeName = (s: string) => s.replace(/[\\/:*?"<>|#^[\]]/g, "-").replace(/\s+/g, " ").trim().slice(0, 120) || "Notiz";

/** Legt eine neue Notiz (optional mit Anhang) in der Wissensbasis an. */
export async function addNote(input: { type: string; title: string; content: string; file?: { name: string; base64: string } }): Promise<KnowledgeNote> {
  const folder = notesFolder();
  const source = vaultSource();
  const existing = new Set((await rawFiles()).map((f) => f.path));

  const write = async (path: string, data: { text?: string; base64?: string }) => {
    const base64 = data.base64 ?? Buffer.from(data.text!, "utf8").toString("base64");
    if (source === "github") return githubPut(path, base64, `Textil-Lab: ${input.title}`);
    if (source === "ordner") {
      const full = join(folderRoot(), path);
      mkdirSync(resolve(full, ".."), { recursive: true });
      return writeFileSync(full, Buffer.from(base64, "base64"));
    }
    const store = await getStore();
    return store.putFile(data.text !== undefined ? { path, content: data.text, encoding: "utf8" } : { path, content: base64, encoding: "base64" });
  };

  let embed = "";
  if (input.file) {
    const fileName = `${Date.now()}-${safeName(input.file.name)}`;
    const attPath = `${folder}/Anhänge/${fileName}`;
    await write(attPath, { base64: input.file.base64 });
    embed = `\n\n![[${attPath}]]\n`;
  }

  const name = safeName(input.title);
  let path = `${folder}/${name}.md`;
  for (let i = 2; existing.has(path); i++) path = `${folder}/${name} ${i}.md`;

  const today = new Date().toISOString().slice(0, 10);
  const md = `---\ntyp: ${input.type}\nerstellt: ${today}\nquelle: Stitchflow\ntags: [textil-lab]\n---\n# ${input.title}\n\n${input.content.trim()}${embed}`;
  await write(path, { text: md });
  return strip(parseNote({ path, content: md, updatedAt: new Date().toISOString() }));
}
