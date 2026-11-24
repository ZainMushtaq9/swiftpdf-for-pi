import { useState } from "react";
import { Link } from "react-router-dom";
import { formatBytes, validatePdfFile } from "./pdfSmall.js";
import { downloadText, copyText } from "../../utils/format.js";
import { usePi } from "../../pi/PiContext.jsx";
import ProUpsell from "../../pi/ProUpsell.jsx";

export default function PdfToText() {
  const [file, setFile] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [text, setText] = useState("");
  const [msg, setMsg] = useState("");
  const [empty, setEmpty] = useState(false);
  const { limits } = usePi();
  const [needsPro, setNeedsPro] = useState("");
  const [truncated, setTruncated] = useState(false);

  const onFile = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const err = validatePdfFile(f, limits.maxFileBytes);
    if (err) { setError(err); return; }
    setError(""); setNeedsPro(""); setTruncated(false); setFile(f); setText(""); setEmpty(false); setMsg("");
  };

  const extract = async () => {
    if (!file) { setError("Upload a PDF first."); return; }
    setBusy(true); setError(""); setText(""); setEmpty(false);
    try {
      const { extractPdfText } = await import("./pdfRender.js");
      const { readFileBytes } = await import("./pdfUtils.js");
      const result = await extractPdfText(await readFileBytes(file), (done, total) => setProgress(`Reading page ${done} of ${total}…`), limits.convertPages);
      const pages = result.pages;
      setTruncated(result.truncated);
      if (result.truncated) setNeedsPro(`Only the first ${limits.convertPages} pages were read — Pro reads the full document.`);
      setProgress("");
      const joined = pages.map((p) => p.text).join("\n\n").trim();
      if (!joined) {
        setEmpty(true);
        setText("");
      } else {
        setText(joined);
      }
    } catch (err) {
      setError("Extraction failed. The file may be damaged or password-protected — encrypted PDFs cannot be read in the browser. (" + (err?.message || "unknown error") + ")");
      setProgress("");
    } finally { setBusy(false); }
  };

  return (
    <div>
      <p className="notice info">Extract the text from a PDF — free, in your browser. Nothing is uploaded: text is read locally with PDF.js. Works on text-based PDFs; scanned/image PDFs have no text layer, so they return nothing — use the OCR tool for those.</p>
      <label htmlFor="pt-file">Upload a PDF (up to {formatBytes(limits.maxFileBytes)})</label>
      <input id="pt-file" type="file" accept="application/pdf,.pdf" onChange={onFile} />
      {file && <p>{file.name} — {formatBytes(file.size)}</p>}
      <div className="toolbar"><button type="button" className="btn" disabled={busy || !file} onClick={extract}>{busy ? "Extracting…" : "Extract Text"}</button></div>
      {progress && <p role="status">{progress}</p>}
      {error && <p className="error" role="alert">{error}</p>}
      {needsPro && <ProUpsell reason={needsPro} />}
      {empty && (
        <div className="output">
          <p className="notice info">No text was found in this PDF. It is probably a scanned document (pages are images, not text). Try the <Link to="/tools/ocr-pdf">OCR PDF &amp; Images tool</Link> instead — it reads text from scanned pages.</p>
        </div>
      )}
      {text && (
        <div className="output">
          <p className="success">Extracted {text.length.toLocaleString()} characters.{truncated ? ` First ${limits.convertPages} pages only.` : ""}</p>
          <label htmlFor="pt-out">Extracted text</label>
          <textarea id="pt-out" readOnly value={text} rows={12} style={{ width: "100%" }} />
          <div className="toolbar">
            <button type="button" className="btn secondary" onClick={() => copyText(text, setMsg)}>Copy Text</button>
            <button type="button" className="btn secondary" onClick={() => downloadText((file?.name || "document").replace(/\.pdf$/i, "") + ".txt", text)}>Download .txt</button>
          </div>
          {msg && <p className="success" role="status">{msg}</p>}
        </div>
      )}
    </div>
  );
}
