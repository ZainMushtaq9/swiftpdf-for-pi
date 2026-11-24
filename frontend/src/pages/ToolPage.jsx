import { lazy, Suspense, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { getTool, APP_NAME } from "../config/site.js";
import { usePi } from "../pi/PiContext.jsx";
import NotFound from "./NotFound.jsx";

// Lazy per-tool imports keep the landing page bundle light; each tool
// chunk (and its heavy libraries) loads only when its page opens.
const MAP = {
  "merge-pdf": lazy(() => import("../tools/pdf/MergePdf.jsx")),
  "split-pdf": lazy(() => import("../tools/pdf/SplitPdf.jsx")),
  "compress-pdf": lazy(() => import("../tools/pdf/CompressPdf.jsx")),
  "rotate-pdf": lazy(() => import("../tools/pdf/RotatePdf.jsx")),
  "images-to-pdf": lazy(() => import("../tools/pdf/ImagesToPdf.jsx")),
  "pdf-to-images": lazy(() => import("../tools/pdf/PdfToImages.jsx")),
  "pdf-to-text": lazy(() => import("../tools/pdf/PdfToText.jsx")),
  "watermark-pdf": lazy(() => import("../tools/pdf/WatermarkPdf.jsx")),
  "add-page-numbers": lazy(() => import("../tools/pdf/AddPageNumbers.jsx")),
  "sign-pdf": lazy(() => import("../tools/pdf/SignPdf.jsx")),
  "pdf-to-word": lazy(() => import("../tools/pdf/PdfToWord.jsx")),
  "ocr-pdf": lazy(() => import("../tools/pdf/OcrPdf.jsx")),
  "html-to-pdf": lazy(() => import("../tools/pdf/HtmlToPdf.jsx")),
};

export default function ToolPage() {
  const { slug } = useParams();
  const tool = getTool(slug);
  const { isPro } = usePi();

  useEffect(() => {
    document.title = tool ? `${tool.name} — ${APP_NAME}` : `Not found — ${APP_NAME}`;
  }, [tool]);

  if (!tool) return <NotFound />;
  const Tool = MAP[slug];
  if (!Tool) return <NotFound />;

  return (
    <div className="container section">
      <p className="breadcrumbs"><Link to="/">All tools</Link> / {tool.name}</p>
      <h1>{tool.name}</h1>
      <p className="lede">
        {tool.description}{" "}
        {isPro ? (
          <span className="category-badge">Pro active — no caps</span>
        ) : (
          <span>Free tier applies — <Link to="/pro">Pro removes the caps</Link>.</span>
        )}
      </p>
      <div className="tool-layout">
        <div className="tool-box">
          <Suspense fallback={<p>Loading tool…</p>}>
            <Tool />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
