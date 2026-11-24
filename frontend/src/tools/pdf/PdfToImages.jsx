import { useState } from "react";
import { formatBytes, validatePdfFile, parsePageRanges } from "./pdfSmall.js";
import { downloadBlob } from "../../utils/format.js";
import { usePi } from "../../pi/PiContext.jsx";
import ProUpsell from "../../pi/ProUpsell.jsx";

export default function PdfToImages() {
  const [file, setFile] = useState(null);
  const [pageCount, setPageCount] = useState(0);
  const [format, setFormat] = useState("png");
  const [scale, setScale] = useState(2);
  const [range, setRange] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [out, setOut] = useState(null);
  const { limits } = usePi();
  const [needsPro, setNeedsPro] = useState("");

  const onFile = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const err = validatePdfFile(f, limits.maxFileBytes);
    if (err) { setError(err); return; }
    setError(""); setNeedsPro(""); setFile(f); setOut(null); setPageCount(0);
    try {
      const { getPdfPageCountJs } = await import("./pdfRender.js");
      const { readFileBytes } = await import("./pdfUtils.js");
      setPageCount(await getPdfPageCountJs(await readFileBytes(f)));
    } catch {
      setError("That file could not be read. It may be damaged or password-protected — encrypted PDFs cannot be converted in the browser.");
      setFile(null);
    }
  };

  const base = file ? file.name.replace(/\.pdf$/i, "") : "document";
  const convert = async () => {
    if (!file || !pageCount) { setError("Upload a PDF first."); return; }
    let pages = [];
    for (let i = 1; i <= pageCount; i++) pages.push(i);
    if (range.trim()) {
      const { pages: picked, error: rangeErr } = parsePageRanges(range, pageCount);
      if (rangeErr) { setError(rangeErr); return; }
      pages = picked;
    }
    let capped = false;
    if (pages.length > limits.convertPages) {
      pages = pages.slice(0, limits.convertPages);
      capped = true;
      setNeedsPro(`The free tier converts the first ${limits.convertPages} pages — Pro converts the whole document.`);
    }
    setBusy(true); setError(""); setOut(null);
    try {
      const { renderPdfPageToBlob } = await import("./pdfRender.js");
      const { readFileBytes } = await import("./pdfUtils.js");
      const bytes = await readFileBytes(file);
      const parts = [];
      for (let i = 0; i < pages.length; i++) {
        setProgress(`Rendering page ${pages[i]} of ${pageCount}…`);
        const blob = await renderPdfPageToBlob(bytes, pages[i], { scale, format });
        parts.push({ blob, name: `${base}-page-${pages[i]}.${format === "jpg" ? "jpg" : "png"}`, url: URL.createObjectURL(blob), page: pages[i] });
      }
      setProgress("");
      setOut({ parts, note: `Converted ${parts.length} page${parts.length > 1 ? "s" : ""} to ${format.toUpperCase()} at ${scale === 2 ? "144 dpi (2x)" : "72 dpi (1x)"}.${capped ? ` First ${limits.convertPages} pages only — Pro converts all ${pageCount}.` : ""}` });
    } catch (err) {
      setError("Conversion failed. The file may be damaged or password-protected. (" + (err?.message || "unknown error") + ")");
      setProgress("");
    } finally { setBusy(false); }
  };

  const downloadAll = async () => {
    if (!out) return;
    for (const p of out.parts) {
      downloadBlob(p.name, p.blob);
      await new Promise((r) => setTimeout(r, 400));
    }
  };

  return (
    <div>
      <p className="notice info">Convert PDF pages to PNG or JPG images — free, in your browser. Nothing is uploaded: pages are rendered locally with PDF.js. PNG is best for text and screenshots; JPG is smaller for photos.</p>
      <label htmlFor="pi-file">Upload a PDF (up to {formatBytes(limits.maxFileBytes)})</label>
      <input id="pi-file" type="file" accept="application/pdf,.pdf" onChange={onFile} />
      {file && <p>{file.name} — {formatBytes(file.size)}{pageCount ? ` · ${pageCount} pages` : " · reading…"}</p>}
      <div className="toolbar">
        <label htmlFor="pi-format">Image format</label>
        <select id="pi-format" value={format} onChange={(e) => setFormat(e.target.value)}>
          <option value="png">PNG (sharp text)</option>
          <option value="jpg">JPG (smaller files)</option>
        </select>
        <label htmlFor="pi-scale">Resolution</label>
        <select id="pi-scale" value={scale} onChange={(e) => setScale(Number(e.target.value))}>
          <option value={1}>Standard (72 dpi)</option>
          <option value={2}>High (144 dpi)</option>
        </select>
      </div>
      <label htmlFor="pi-range">Pages (optional — leave blank for all pages, e.g. 1-3, 5)</label>
      <input id="pi-range" type="text" placeholder="All pages" value={range} onChange={(e) => setRange(e.target.value)} />
      <div className="toolbar"><button type="button" className="btn" disabled={busy || !file || !pageCount} onClick={convert}>{busy ? "Converting…" : "Convert PDF to Images"}</button></div>
      {progress && <p role="status">{progress}</p>}
      {error && <p className="error" role="alert">{error}</p>}
      {needsPro && <ProUpsell reason={needsPro} />}
      {out && (
        <div className="output">
          <p className="success">{out.note}</p>
          <div className="grid">
            {out.parts.map((p) => (
              <article className="card" key={p.name}>
                <p><img className="preview" src={p.url} alt={`Page ${p.page} rendered as an image`} /></p>
                <p>{p.name}</p>
                <button type="button" className="btn btn-sm secondary" onClick={() => downloadBlob(p.name, p.blob)}>Download</button>
              </article>
            ))}
          </div>
          {out.parts.length > 1 && (
            <div className="toolbar" style={{ marginTop: 12 }}><button type="button" className="btn secondary" onClick={downloadAll}>Download all ({out.parts.length} images)</button><span style={{ fontSize: ".9rem", opacity: .8 }}>Your browser may ask permission for multiple downloads.</span></div>
          )}
        </div>
      )}
    </div>
  );
}
