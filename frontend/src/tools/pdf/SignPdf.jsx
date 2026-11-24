import { useState, useRef, useEffect } from "react";
import { formatBytes, validatePdfFile, validateImageFile } from "./pdfSmall.js";
import { downloadBlob } from "../../utils/format.js";
import { usePi } from "../../pi/PiContext.jsx";
import ProUpsell from "../../pi/ProUpsell.jsx";

// Sign PDF: draw a signature on a canvas, or upload a signature image
// (PNG with transparency works best), then stamp it onto one page.
// This is a visible signature image, NOT a certified digital signature —
// it does not add cryptographic signing, and the page says so.
export default function SignPdf() {
  const [file, setFile] = useState(null);
  const [pageCount, setPageCount] = useState(0);
  const [source, setSource] = useState("draw");
  const [sigImage, setSigImage] = useState(null);
  const [page, setPage] = useState(1);
  const [position, setPosition] = useState("bottom-right");
  const [width, setWidth] = useState(180);
  const [hasDrawn, setHasDrawn] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState(null);
  const { limits, isPro } = usePi();
  const [needsPro, setNeedsPro] = useState("");
  // Pro: a signature saved in this browser's local storage, reusable on
  // any PDF. It never leaves the device and is never sent to our server.
  const SAVED_SIG_KEY = "pi-pdf-saved-signature";
  const [savedSig, setSavedSig] = useState(() => {
    try { return localStorage.getItem(SAVED_SIG_KEY); } catch { return null; }
  });
  const [sigMsg, setSigMsg] = useState("");
  const canvasRef = useRef(null);
  const drawingRef = useRef(false);
  const lastRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#10243a";
  }, []);

  const onFile = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const err = validatePdfFile(f, limits.maxFileBytes);
    if (err) { setError(err); return; }
    setError(""); setNeedsPro(""); setFile(f); setOut(null); setPageCount(0);
    try {
      const { getPdfPageCount, readFileBytes } = await import("./pdfUtils.js");
      setPageCount(await getPdfPageCount(await readFileBytes(f)));
    } catch {
      setError("That file could not be read. It may be damaged or password-protected — encrypted PDFs cannot be signed in the browser.");
      setFile(null);
    }
  };

  const onSigImage = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const err = validateImageFile(f, limits.maxFileBytes);
    if (err) { setError(err); return; }
    setError(""); setSigImage(f);
  };

  const pos = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const t = e.touches?.[0] || e;
    return { x: t.clientX - rect.left, y: t.clientY - rect.top };
  };
  const startDraw = (e) => { e.preventDefault(); drawingRef.current = true; lastRef.current = pos(e); };
  const draw = (e) => {
    if (!drawingRef.current) return;
    e.preventDefault();
    const ctx = canvasRef.current.getContext("2d");
    const p = pos(e);
    ctx.beginPath();
    ctx.moveTo(lastRef.current.x, lastRef.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    lastRef.current = p;
    setHasDrawn(true);
  };
  const stopDraw = () => { drawingRef.current = false; };
  const clearCanvas = () => {
    const canvas = canvasRef.current;
    canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
    setHasDrawn(false);
  };

  const canvasToBytes = () => new Promise((resolve) => {
    canvasRef.current.toBlob(async (blob) => resolve(new Uint8Array(await blob.arrayBuffer())), "image/png");
  });

  const saveSignature = async () => {
    setSigMsg("");
    try {
      let dataUrl = null;
      if (source === "draw") {
        if (!hasDrawn) { setSigMsg("Draw your signature first, then save it."); return; }
        dataUrl = canvasRef.current.toDataURL("image/png");
      } else {
        if (!sigImage) { setSigMsg("Upload a signature image first, then save it."); return; }
        dataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(new Error("Could not read the image."));
          reader.readAsDataURL(sigImage);
        });
      }
      localStorage.setItem(SAVED_SIG_KEY, dataUrl);
      setSavedSig(dataUrl);
      setSigMsg("Signature saved on this device — Pro can reuse it on any PDF.");
    } catch {
      setSigMsg("Could not save the signature on this device.");
    }
  };

  const removeSavedSignature = () => {
    try { localStorage.removeItem(SAVED_SIG_KEY); } catch { /* ignore */ }
    setSavedSig(null);
    if (source === "saved") setSource("draw");
    setSigMsg("Saved signature removed.");
  };

  const sign = async () => {
    if (!file || !pageCount) { setError("Upload a PDF first."); return; }
    if (page < 1 || page > pageCount) { setError(`Page must be between 1 and ${pageCount}.`); return; }
    setBusy(true); setError("");
    try {
      let imageBytes;
      let imageType = "png";
      if (source === "saved") {
        if (!savedSig) { setError("No saved signature on this device yet."); setBusy(false); return; }
        const res = await fetch(savedSig);
        imageBytes = new Uint8Array(await res.arrayBuffer());
      } else if (source === "draw") {
        if (!hasDrawn) { setError("Draw your signature in the box first, or switch to uploading a signature image."); setBusy(false); return; }
        imageBytes = await canvasToBytes();
      } else {
        if (!sigImage) { setError("Upload a signature image first (PNG with transparency works best)."); setBusy(false); return; }
        imageType = /\.png$/i.test(sigImage.name) || sigImage.type === "image/png" ? "png" : "jpg";
        imageBytes = new Uint8Array(await sigImage.arrayBuffer());
      }
      const { signPdf, readFileBytes } = await import("./pdfUtils.js");
      const bytes = await signPdf(await readFileBytes(file), { imageBytes, imageType, page, position, width });
      const blob = new Blob([bytes], { type: "application/pdf" });
      setOut({ blob, name: file.name.replace(/\.pdf$/i, "") + "-signed.pdf", note: `Signature placed on page ${page}.` });
    } catch (err) {
      setError("Signing failed. The file may be damaged or password-protected. (" + (err?.message || "unknown error") + ")");
    } finally { setBusy(false); }
  };

  return (
    <div>
      <p className="notice info">Sign a PDF by drawing your signature or uploading a signature image, then placing it on the page. Free, in your browser; nothing is uploaded. Note: this adds a visible signature image — it is not a certified digital signature.</p>
      <label htmlFor="sg-file">Upload a PDF (up to {formatBytes(limits.maxFileBytes)})</label>
      <input id="sg-file" type="file" accept="application/pdf,.pdf" onChange={onFile} />
      {file && <p>{file.name} — {formatBytes(file.size)}{pageCount ? ` · ${pageCount} pages` : " · reading…"}</p>}
      <fieldset>
        <legend>Signature source</legend>
        <label><input type="radio" name="sg-source" value="draw" checked={source === "draw"} onChange={() => setSource("draw")} /> Draw it</label>
        <label style={{ marginLeft: 16 }}><input type="radio" name="sg-source" value="upload" checked={source === "upload"} onChange={() => setSource("upload")} /> Upload an image</label>
        {isPro && savedSig && (
          <label style={{ marginLeft: 16 }}><input type="radio" name="sg-source" value="saved" checked={source === "saved"} onChange={() => setSource("saved")} /> Use saved signature (Pro)</label>
        )}
      </fieldset>
      {source === "saved" ? (
        <div>
          <p>Your saved signature:</p>
          <p><img src={savedSig} alt="Your saved signature" style={{ maxWidth: 300, border: "1px solid var(--border, #ccc)", borderRadius: 6, background: "#fff" }} /></p>
          <div className="toolbar"><button type="button" className="btn btn-sm ghost" onClick={removeSavedSignature}>Remove saved signature</button></div>
          {sigMsg && <p className="success" role="status">{sigMsg}</p>}
        </div>
      ) : source === "draw" ? (
        <div>
          <p>Draw your signature in the box (mouse or touch):</p>
          <canvas
            ref={canvasRef}
            width={420}
            height={160}
            style={{ border: "1px solid var(--border, #ccc)", borderRadius: 6, touchAction: "none", maxWidth: "100%" }}
            onMouseDown={startDraw}
            onMouseMove={draw}
            onMouseUp={stopDraw}
            onMouseLeave={stopDraw}
            onTouchStart={startDraw}
            onTouchMove={draw}
            onTouchEnd={stopDraw}
            aria-label="Draw your signature here"
          />
          <div className="toolbar">
            <button type="button" className="btn btn-sm ghost" onClick={clearCanvas}>Clear signature</button>
            {isPro ? (
              <button type="button" className="btn btn-sm secondary" disabled={!hasDrawn} onClick={saveSignature}>Save signature for reuse (Pro)</button>
            ) : (
              <span style={{ fontSize: ".9rem", opacity: 0.8 }}>Pro can save this signature and reuse it on any PDF.</span>
            )}
          </div>
          {sigMsg && <p className="success" role="status">{sigMsg}</p>}
        </div>
      ) : (
        <div>
          <label htmlFor="sg-image">Upload a signature image (JPG or PNG — PNG with transparency works best)</label>
          <input id="sg-image" type="file" accept="image/jpeg,image/png" onChange={onSigImage} />
          {sigImage && <p>{sigImage.name} — {formatBytes(sigImage.size)}</p>}
          {isPro ? (
            <div className="toolbar"><button type="button" className="btn btn-sm secondary" disabled={!sigImage} onClick={saveSignature}>Save signature for reuse (Pro)</button></div>
          ) : (
            <p style={{ fontSize: ".9rem", opacity: 0.8 }}>Pro can save this signature and reuse it on any PDF.</p>
          )}
          {sigMsg && <p className="success" role="status">{sigMsg}</p>}
        </div>
      )}
      <div className="toolbar">
        <label htmlFor="sg-page">Page</label>
        <input id="sg-page" type="number" min="1" max={Math.max(1, pageCount)} value={page} onChange={(e) => setPage(Number(e.target.value))} style={{ width: 80 }} />
        <label htmlFor="sg-position">Position</label>
        <select id="sg-position" value={position} onChange={(e) => setPosition(e.target.value)}>
          <option value="bottom-right">Bottom right</option>
          <option value="bottom-left">Bottom left</option>
          <option value="bottom-center">Bottom centre</option>
          <option value="top-right">Top right</option>
          <option value="top-left">Top left</option>
          <option value="center">Centre</option>
        </select>
        <label htmlFor="sg-width">Width: {width} pt</label>
        <input id="sg-width" type="range" min="80" max="360" step="10" value={width} onChange={(e) => setWidth(Number(e.target.value))} />
      </div>
      <div className="toolbar"><button type="button" className="btn" disabled={busy || !file || !pageCount} onClick={sign}>{busy ? "Signing…" : "Sign PDF"}</button></div>
      {error && <p className="error" role="alert">{error}</p>}
      {needsPro && <ProUpsell reason={needsPro} />}
      {out && (
        <div className="output">
          <p className="success">{out.note}</p>
          <div className="toolbar"><button type="button" className="btn" onClick={() => downloadBlob(out.name, out.blob)}>Download Signed PDF</button></div>
        </div>
      )}
    </div>
  );
}
