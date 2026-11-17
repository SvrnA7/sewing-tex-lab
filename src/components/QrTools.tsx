import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import QRCode from "qrcode";
import jsQR from "jsqr";
import { materialCode, type Material } from "../../shared/types";
import { Button, Icon, Modal } from "../ui";

/** Inhalt des QR-Codes: ein Link, der die App direkt bei diesem Stoff öffnet (auch mit der normalen Handy-Kamera). */
export const qrLink = (m: Pick<Material, "id" | "code">) =>
  `${window.location.origin}/?stoff=${encodeURIComponent(materialCode(m))}`;

/** QR-Code als reines SVG, ohne Canvas – druckt gestochen scharf. */
export function QrSvg({ text, size = 120, className }: { text: string; size?: number | string; className?: string }) {
  const { path, count } = useMemo(() => {
    const qr = QRCode.create(text, { errorCorrectionLevel: "M" });
    const n = qr.modules.size;
    let d = "";
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (qr.modules.get(y, x)) d += `M${x + 4} ${y + 4}h1v1h-1z`;
    return { path: d, count: n + 8 };
  }, [text]);
  return (
    <svg className={className} width={size} height={size} viewBox={`0 0 ${count} ${count}`} shapeRendering="crispEdges" role="img" aria-label="QR-Code">
      <rect width={count} height={count} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}

// ── Kamera-Scanner ─────────────────────────────────────

interface Detector { detect(src: CanvasImageSource): Promise<{ rawValue: string }[]> }
type DetectorCtor = { new (o?: { formats: string[] }): Detector; getSupportedFormats?: () => Promise<string[]> };

async function nativeDetector(): Promise<Detector | null> {
  const Ctor = (window as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector;
  if (!Ctor) return null;
  try {
    const wanted = ["qr_code", "ean_13", "ean_8", "code_128", "code_39", "upc_a", "data_matrix"];
    const supported = (await Ctor.getSupportedFormats?.()) ?? wanted;
    const formats = wanted.filter((f) => supported.includes(f));
    return formats.length ? new Ctor({ formats }) : null;
  } catch {
    return null;
  }
}

export function ScannerModal({ onResult, onClose }: { onResult: (text: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [manual, setManual] = useState("");
  const done = useRef(false);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer = 0;
    let stopped = false;
    const canvas = document.createElement("canvas");
    const c2d = canvas.getContext("2d", { willReadFrequently: true });

    const finish = (text: string) => {
      if (done.current || !text) return;
      done.current = true;
      navigator.vibrate?.(60);
      onResult(text);
    };

    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError("Die Kamera ist nur über eine sichere Verbindung (https) verfügbar. Code unten eintippen geht immer.");
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
      } catch (err) {
        const name = (err as DOMException).name;
        setError(name === "NotAllowedError"
          ? "Kamerazugriff wurde verweigert. Bitte in den Browser-Einstellungen für diese Seite erlauben."
          : "Keine Kamera gefunden. Du kannst den Code unten eintippen.");
        return;
      }
      if (stopped) return stream.getTracks().forEach((t) => t.stop());
      const video = videoRef.current!;
      video.srcObject = stream;
      await video.play().catch(() => undefined);
      setReady(true);
      const detector = await nativeDetector();

      const tick = async () => {
        if (stopped || done.current) return;
        if (video.readyState >= 2 && video.videoWidth) {
          try {
            if (detector) {
              const [hit] = await detector.detect(video);
              if (hit?.rawValue) return finish(hit.rawValue);
            } else if (c2d) {
              const scale = Math.min(1, 720 / video.videoWidth);
              canvas.width = Math.round(video.videoWidth * scale);
              canvas.height = Math.round(video.videoHeight * scale);
              c2d.drawImage(video, 0, 0, canvas.width, canvas.height);
              const img = c2d.getImageData(0, 0, canvas.width, canvas.height);
              const hit = jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" });
              if (hit?.data) return finish(hit.data);
            }
          } catch { /* nächster Versuch */ }
        }
        timer = window.setTimeout(tick, 140);
      };
      tick();
    })();

    return () => {
      stopped = true;
      window.clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [onResult]);

  function submitManual(e: FormEvent) {
    e.preventDefault();
    if (manual.trim()) { done.current = true; onResult(manual.trim()); }
  }

  return (
    <Modal eyebrow="TEXTILLAGER" title="Stoff scannen" subtitle="QR-Etikett oder Barcode des Lieferanten vor die Kamera halten" onClose={onClose}>
      <div className="scanner-frame">
        {!error && <video ref={videoRef} playsInline muted autoPlay />}
        {!error && <div className="scanner-target" aria-hidden="true"><span /></div>}
        {!error && !ready && <p className="scanner-hint">Kamera wird gestartet …</p>}
        {error && <p className="scanner-error"><Icon name="alert" size={18} /> {error}</p>}
      </div>
      <form className="scanner-manual" onSubmit={submitManual}>
        <label className="field-label">Code manuell eingeben
          <input value={manual} onChange={(e) => setManual(e.target.value)} placeholder="z. B. STF-7K2Q" autoCapitalize="characters" />
        </label>
        <Button className="secondary-button" type="submit"><Icon name="arrow" size={14} /> Öffnen</Button>
      </form>
    </Modal>
  );
}

// ── Etiketten drucken ──────────────────────────────────

type LabelFormat = "a4" | "einzeln";

const FORMATS: Record<LabelFormat, { label: string; hint: string; page: string }> = {
  a4: { label: "A4-Bogen", hint: "24 Etiketten 70 × 37 mm (z. B. Avery/Herma)", page: "@page { size: A4; margin: 4.5mm 0; }" },
  einzeln: { label: "Etikettendrucker", hint: "ein Etikett 62 × 40 mm pro Seite (z. B. Brother QL)", page: "@page { size: 62mm 40mm; margin: 0; }" },
};

export function LabelModal({ materials, preselect, onClose }: { materials: Material[]; preselect?: string[]; onClose: () => void }) {
  const [picked, setPicked] = useState<Set<string>>(() => new Set(preselect ?? materials.map((m) => m.id)));
  const [format, setFormat] = useState<LabelFormat>(preselect?.length === 1 ? "einzeln" : "a4");
  const [copies, setCopies] = useState("1");
  const [printing, setPrinting] = useState(false);

  const chosen = materials.filter((m) => picked.has(m.id));
  const n = Math.max(1, Math.min(50, Number(copies) || 1));
  const labels = chosen.flatMap((m) => Array.from({ length: n }, (_, i) => ({ m, key: `${m.id}-${i}` })));

  useEffect(() => {
    if (!printing) return;
    const after = () => setPrinting(false);
    window.addEventListener("afterprint", after);
    const t = window.setTimeout(() => window.print(), 50);
    return () => { window.clearTimeout(t); window.removeEventListener("afterprint", after); };
  }, [printing]);

  const toggle = (id: string) => setPicked((s) => { const x = new Set(s); if (x.has(id)) x.delete(id); else x.add(id); return x; });

  return (
    <Modal eyebrow="TEXTILLAGER" title="QR-Etiketten drucken" subtitle="Scannen öffnet den Stoff direkt in der App" onClose={onClose} wide>
      <div className="label-layout">
        <div>
          <p className="field-caption">Format</p>
          <div className="segmented">
            {(Object.keys(FORMATS) as LabelFormat[]).map((f) => (
              <button type="button" key={f} className={format === f ? "active" : ""} onClick={() => setFormat(f)}>
                <strong>{FORMATS[f].label}</strong><small>{FORMATS[f].hint}</small>
              </button>
            ))}
          </div>
          <label className="field-label">Etiketten pro Stoff<input inputMode="numeric" value={copies} onChange={(e) => setCopies(e.target.value)} /></label>
          <div className="label-picklist">
            <div className="label-picklist-head">
              <span>{chosen.length} von {materials.length} Stoffen</span>
              <button type="button" className="link-button" onClick={() => setPicked(chosen.length === materials.length ? new Set() : new Set(materials.map((m) => m.id)))}>
                {chosen.length === materials.length ? "Keine" : "Alle"}
              </button>
            </div>
            {materials.map((m) => (
              <label key={m.id} className="check-row">
                <input type="checkbox" checked={picked.has(m.id)} onChange={() => toggle(m.id)} />
                <span><strong>{m.name}</strong><small>{materialCode(m)}</small></span>
              </label>
            ))}
          </div>
        </div>
        <div className="label-preview-wrap">
          <p className="field-caption">Vorschau</p>
          {chosen[0] ? <StockLabel m={chosen[0]} /> : <p className="muted-note">Keinen Stoff gewählt.</p>}
        </div>
      </div>
      <div className="modal-actions">
        <Button className="secondary-button" onClick={onClose}>Schließen</Button>
        <Button className="primary-button" disabled={!labels.length} onClick={() => setPrinting(true)}>
          <Icon name="printer" size={15} /> {labels.length} Etikett{labels.length === 1 ? "" : "en"} drucken
        </Button>
      </div>
      {printing && createPortal(
        <div className={`print-sheet ${format}`}>
          <style>{FORMATS[format].page}</style>
          {labels.map(({ m, key }) => <StockLabel m={m} key={key} />)}
        </div>,
        document.body,
      )}
    </Modal>
  );
}

export function StockLabel({ m }: { m: Material }) {
  return (
    <div className="stock-label">
      <QrSvg text={qrLink(m)} size="100%" className="stock-label-qr" />
      <div className="stock-label-text">
        <strong>{m.name}</strong>
        {m.detail && <span>{m.detail}</span>}
        {m.supplier && <span>{m.supplier}</span>}
        <b>{materialCode(m)}</b>
      </div>
    </div>
  );
}
