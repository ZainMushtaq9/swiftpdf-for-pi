import { useState } from "react";
import { formatBytes, validateImageFile } from "./pdfSmall.js";
import { downloadBlob } from "../../utils/format.js";
import { usePi } from "../../pi/PiContext.jsx";
import ProUpsell from "../../pi/ProUpsell.jsx";

export default function ImagesToPdf() {
  const [files, setFiles] = useState([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState(null);
  const { limits, isPro } = usePi();
  const [needsPro, setNeedsPro] = useState("");

  const onFiles = (e) => {
    const picked = [...(e.target.files || [])];
    if (!picked.length) return;
    for (const f of picked) {
      const err = validateImageFile(f, limits.maxFileBytes);
      if (err) { setError(err); return; }
    }
    if (files.length + picked.length > limits.maxImages) {
      setError(`Convert at most ${limits.maxImages} images at a time.`);
      if (!isPro) setNeedsPro(`The free tier converts up to ${limits.maxImages} images at once — Pro converts up to 20.`);
      return;
    }
    setError(""); setNeedsPro("");
    setFiles((prev) => [...prev, ...picked]);
    setOut(null);
    e.target.value = "";
  };
  const move = (i, dir) => {
    setFiles((prev) => {
      const next = [...prev];
      const j = i + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  };
  const remove = (i) => setFiles((prev) => prev.filter((_, k) => k !== i));

  const convert = async () => {
    if (!files.length) { setError("Add at least one image."); return; }
    setBusy(true); setError("");
    try {
      const { imagesToPdf, readFileBytes } = await import("./pdfUtils.js");
      const images = [];
      for (const f of files) {
        const type = /\.png$/i.test(f.name) || f.type === "image/png" ? "png" : "jpg";
        images.push({ bytes: await readFileBytes(f), type });
      }
      const bytes = await imagesToPdf(images);
      const blob = new Blob([bytes], { type: "application/pdf" });
      setOut({ blob, name: "images.pdf", note: `Converted ${files.length} image${files.length > 1 ? "s" : ""} into a ${files.length}-page PDF (one image per A4 page).` });
    } catch (err) {
      setError("Conversion failed. One of the images may be damaged or in an unsupported format — use JPG or PNG. (" + (err?.message || "unknown error") + ")");
    } finally { setBusy(false); }
  };

  return (
    <div>
      <p className="notice info">Turn JPG and PNG images into a PDF — one image per A4 page, in the order you choose. Free, in your browser; nothing is uploaded.</p>
      <label htmlFor="ip-files">Add images (JPG or PNG, up to {limits.maxImages}, {formatBytes(limits.maxFileBytes)} each)</label>
      <input id="ip-files" type="file" accept="image/jpeg,image/png" multiple onChange={onFiles} />
      {files.length > 0 && (
        <ol className="result-list" aria-label="Images in page order">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`}>
              <span>{i + 1}. {f.name} — {formatBytes(f.size)}</span>
              <span className="toolbar" style={{ display: "inline-flex", gap: 4, marginLeft: 8 }}>
                <button type="button" className="btn btn-sm secondary" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move ${f.name} up`}>↑</button>
                <button type="button" className="btn btn-sm secondary" disabled={i === files.length - 1} onClick={() => move(i, 1)} aria-label={`Move ${f.name} down`}>↓</button>
                <button type="button" className="btn btn-sm ghost" onClick={() => remove(i)} aria-label={`Remove ${f.name}`}>Remove</button>
              </span>
            </li>
          ))}
        </ol>
      )}
      <div className="toolbar"><button type="button" className="btn" disabled={busy || !files.length} onClick={convert}>{busy ? "Converting…" : "Convert Images to PDF"}</button></div>
      {error && <p className="error" role="alert">{error}</p>}
      {needsPro && <ProUpsell reason={needsPro} />}
      {out && (
        <div className="output">
          <p className="success">{out.note}</p>
          <div className="toolbar"><button type="button" className="btn" onClick={() => downloadBlob(out.name, out.blob)}>Download PDF</button></div>
        </div>
      )}
    </div>
  );
}
