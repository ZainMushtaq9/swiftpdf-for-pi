// Site config — single place for the app name and the tool registry.
// APP NAME (chosen by the user, 24 Nov 2026): "SwiftPDF for Pi".
// It follows Pi's trademark form "<Name> for Pi". Note: using "Pi" in
// the app name requires executing Pi's Trademark Licensing Agreement
// (via the Developer Portal) before listing — see README. Change
// APP_NAME here and the header, footer, page titles and privacy policy
// all follow.
export const APP_NAME = "SwiftPDF for Pi";
export const APP_TAGLINE = "Free PDF tools in your browser — nothing is uploaded.";

export const TOOLS = [
  { slug: "merge-pdf", name: "Merge PDF", description: "Combine several PDFs into one file, in the order you choose." },
  { slug: "split-pdf", name: "Split PDF", description: "Split a PDF into single pages, or extract just the pages you need." },
  { slug: "compress-pdf", name: "Compress PDF", description: "Reduce a PDF's file size with compressed object streams." },
  { slug: "rotate-pdf", name: "Rotate PDF", description: "Rotate pages by 90, 180 or 270 degrees — all pages or a range." },
  { slug: "images-to-pdf", name: "Images to PDF", description: "Turn JPG and PNG images into a PDF, one image per A4 page." },
  { slug: "pdf-to-images", name: "PDF to Images", description: "Convert PDF pages to PNG or JPG images, at the resolution you pick." },
  { slug: "pdf-to-text", name: "PDF to Text", description: "Extract the text from a PDF — copy it or download a .txt file." },
  { slug: "watermark-pdf", name: "Watermark PDF", description: "Add a text watermark diagonally across every page." },
  { slug: "add-page-numbers", name: "Add Page Numbers", description: "Number every page — 1, Page 1, or 1 of 12 — where you choose." },
  { slug: "sign-pdf", name: "Sign PDF", description: "Draw your signature or upload one, then place it on the page." },
  { slug: "pdf-to-word", name: "PDF to Word", description: "Convert a PDF to an editable Word (.docx) file — text-based." },
  { slug: "ocr-pdf", name: "OCR PDF & Images", description: "Read text from scanned PDFs and photos of documents." },
  { slug: "html-to-pdf", name: "HTML to PDF", description: "Convert HTML code into a PDF, with a live preview." },
];

export function getTool(slug) {
  return TOOLS.find((t) => t.slug === slug) || null;
}

// What Pro unlocks — shown on the Pro page and in upsell boxes.
export const PRO_FEATURES = [
  "Batch processing — merge up to 20 PDFs and convert up to 20 images at once",
  "OCR on up to 10 pages per document (free tier: first 2 pages)",
  "Full-document conversions — PDF to images, text and Word without the 5-page cap",
  "Larger files — up to 20 MB per file (free tier: 10 MB)",
  "Saved signature — keep your signature and reuse it on any PDF",
  "No page caps on single-file tools (free tier: 20 pages)",
];
