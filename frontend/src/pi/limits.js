// Free vs Pro tier limits. Everything runs client-side, so these caps
// are enforced in the browser UI (a determined user could bypass them —
// that is acceptable for a free utility; the Pro entitlement itself is
// verified server-side and is what the payment buys). Keep the numbers
// here in one place so the tools, the Pro page and the tests agree.
export const FREE_LIMITS = {
  maxFileBytes: 10 * 1024 * 1024, // 10 MB per file
  maxMergeFiles: 3, // merge up to 3 PDFs at once
  maxImages: 5, // images-to-PDF: up to 5 images
  ocrPages: 2, // OCR: first 2 pages
  convertPages: 5, // PDF-to-images/text/Word: first 5 pages
  maxPages: 20, // single-file tools: documents up to 20 pages
  maxHtmlBytes: 50 * 1024, // HTML-to-PDF: 50 KB of HTML
  savedSignature: false,
};

export const PRO_LIMITS = {
  maxFileBytes: 20 * 1024 * 1024, // 20 MB per file
  maxMergeFiles: 20,
  maxImages: 20,
  ocrPages: 10,
  convertPages: Infinity, // full document
  maxPages: Infinity,
  maxHtmlBytes: 500 * 1024,
  savedSignature: true,
};

export function limitsFor(isPro) {
  return isPro ? PRO_LIMITS : FREE_LIMITS;
}

// "5 pages" / "unlimited" — for upsell copy.
export function formatLimit(n, unit = "pages") {
  if (n === Infinity) return "unlimited";
  return `${n} ${unit}`;
}
