import { useState } from "react";
import { formatBytes, validatePdfFile } from "./pdfSmall.js";
import { downloadBlob } from "../../utils/format.js";
import { usePi } from "../../pi/PiContext.jsx";
import ProUpsell from "../../pi/ProUpsell.jsx";

export default function CompressPdf() {
  const [file, setFile] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState(null);
  const { limits } = usePi();
  const [needsPro, setNeedsPro] = useState("");

  const onFile = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const err = validatePdfFile(f, limits.maxFileBytes);
    if (err) { setError(err); return; }
    setError(""); setNeedsPro(""); setFile(f); setOut(null);
  };

  const compress = async () => {
    if (!file) { setError("Upload a PDF first."); return; }
    setBusy(true); setError("");
    try {
      const { compressPdf, readFileBytes, getPdfPageCount } = await import("./pdfUtils.js");
      const bytes = await readFileBytes(file);
      const pages = await getPdfPageCount(bytes);
      if (pages > limits.maxPages) { setError(`This PDF has ${pages} pages — the free tier handles documents up to ${limits.maxPages} pages.`); setNeedsPro("Pro handles documents of any length."); setBusy(false); return; }
      const result = await compressPdf(bytes);
      const blob = new Blob([result.bytes], { type: "application/pdf" });
      const pct = result.saved > 0 ? Math.round((result.saved / file.size) * 100) : 0;
      setOut({
        blob,
        name: file.name.replace(/\.pdf$/i, "") + "-compressed.pdf",
        size: result.bytes.length,
        pct,
        smaller: result.smaller,
      });
    } catch (err) {
      setError("Compression failed. The file may be damaged or password-protected — encrypted PDFs cannot be compressed in the browser. (" + (err?.message || "unknown error") + ")");
    } finally { setBusy(false); }
  };

  return (
    <div>
      <p className="notice info">Reduce a PDF&apos;s file size in your browser — free, no upload. Honest limits: this re-saves the PDF with compressed object streams, so typical savings are small (often 0–20%) because most PDFs are already compressed. It does not re-encode embedded images.</p>
      <label htmlFor="cp-file">Upload a PDF (up to {formatBytes(limits.maxFileBytes)})</label>
      <input id="cp-file" type="file" accept="application/pdf,.pdf" onChange={onFile} />
      {file && <p>Original: {file.name} — {formatBytes(file.size)}</p>}
      <div className="toolbar"><button type="button" className="btn" disabled={busy || !file} onClick={compress}>{busy ? "Compressing…" : "Compress PDF"}</button></div>
      {error && <p className="error" role="alert">{error}</p>}
      {needsPro && <ProUpsell reason={needsPro} />}
      {out && (
        <div className="output">
          {out.smaller ? (
            <p className="success">Compressed: {formatBytes(out.size)} — saved {out.pct}% vs the original ({formatBytes(file.size)}).</p>
          ) : (
            <p className="success">No saving this time — your PDF was already compressed, so the file is unchanged at {formatBytes(out.size)}. The download below is the original file.</p>
          )}
          <div className="toolbar"><button type="button" className="btn" onClick={() => downloadBlob(out.name, out.blob)}>Download Compressed PDF</button></div>
        </div>
      )}
    </div>
  );
}
