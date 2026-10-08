import { useState, type ChangeEvent, type FormEvent } from "react";
import type { KnowledgeNote } from "../../shared/types";
import { api, fileToBase64 } from "../api";
import { Button, Icon, Modal, type IconName } from "../ui";

const TYPES: [string, IconName][] = [["Hinweis", "book"], ["Dokument", "file"], ["Bild", "image"]];

export function KnowledgeModal({ preset, onClose, onSaved, toast }: {
  preset: { title?: string; content?: string };
  onClose: () => void;
  onSaved: (n: KnowledgeNote) => void;
  toast: (m: string) => void;
}) {
  const [type, setType] = useState("Hinweis");
  const [title, setTitle] = useState(preset.title ?? "");
  const [content, setContent] = useState(preset.content ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  function selectFile(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    if (f && f.size > 20 * 1024 * 1024) return toast("Die Datei ist größer als 20 MB.");
    setFile(f);
    if (f && !title) setTitle(f.name.replace(/\.[^.]+$/, ""));
    if (f?.type.startsWith("image/")) setType("Bild");
    else if (f) setType("Dokument");
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    try {
      const note = await api.addKnowledge({
        type, title, content,
        file: file ? { name: file.name, base64: await fileToBase64(file) } : undefined,
      });
      onSaved(note);
    } catch (err) {
      toast((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal eyebrow="CLAUDE + OBSIDIAN" title="Textil-Wissen ergänzen" subtitle="Dokumentiere Materialien, Techniken und Produktionshinweise." onClose={onClose}>
      <form onSubmit={submit}>
        <div className="type-tabs">
          {TYPES.map(([label, icon]) => (
            <Button className={type === label ? "selected" : ""} key={label} onClick={() => setType(label)}>
              <Icon name={icon} size={18} /> {label}
            </Button>
          ))}
        </div>
        <label className="field-label">Titel<input onChange={(e) => setTitle(e.target.value)} placeholder="z. B. Verarbeitungshinweis Heavy Jersey" required value={title} /></label>
        <label className="field-label">Inhalt<textarea onChange={(e) => setContent(e.target.value)} placeholder="Material, Verarbeitung, Maschineneinstellung oder Kontext …" rows={5} value={content} /></label>
        <label className="upload-zone">
          <input accept="image/*,.pdf,.txt,.md" onChange={selectFile} type="file" />
          <span className="upload-symbol"><Icon name="upload" size={21} /></span>
          <span><strong>{file?.name || "Datei hier ablegen"}</strong><small>{file ? "Wird als Anhang im Vault gespeichert" : "Bild, PDF oder Markdown · max. 20 MB"}</small></span>
        </label>
        <div className="modal-actions">
          <Button className="secondary-button" onClick={onClose}>Abbrechen</Button>
          <Button className="primary-button" type="submit" disabled={saving}><Icon name="plus" size={17} /> {saving ? "Speichere …" : "Wissen speichern"}</Button>
        </div>
      </form>
    </Modal>
  );
}
