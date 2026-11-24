#!/usr/bin/env node
// End-to-end verification for SwiftPDF for Pi (Pi Next 2026 entry).
// Starts the FastAPI backend in PI_MOCK_MODE and the built frontend
// (vite preview, dist built with VITE_PI_MOCK=true + VITE_API_URL), then
// drives the real app in headless Chromium: all 13 tools, the free-tier
// cap, mock sign-in, mock Pro payment, and cap lift. Takes listing
// screenshots into assets/previews/.
//
// Run: npm run build (with mock env) first, then:
//   node scripts/e2e-verify.mjs
// Exit code 0 = all checks passed (OCR is reported separately if the
// CDN engine download fails — see the summary).
import { createRequire } from "node:module";
// playwright-core is installed in frontend/node_modules; resolve it from
// there (this script lives at the project root, which has no node_modules).
const requireFrontend = createRequire(new URL("../frontend/package.json", import.meta.url));
const { chromium } = requireFrontend("playwright-core");
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TMP = "/tmp/pi-e2e";
const PREVIEWS = path.join(ROOT, "assets", "previews");
const API_URL = "http://localhost:8000";
const WEB_URL = "http://localhost:4173";

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

async function waitFor(url, label, timeoutMs = 30000) {
  const start = Date.now();
  for (;;) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch { /* not up yet */ }
    if (Date.now() - start > timeoutMs) throw new Error(`${label} did not start in ${timeoutMs / 1000}s (${url})`);
    await new Promise((r) => setTimeout(r, 500));
  }
}

function startServer(cmd, args, cwd, env, label) {
  const child = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  child.stdout.on("data", (d) => { out += d; });
  child.stderr.on("data", (d) => { out += d; });
  child.on("exit", (code) => { if (code !== 0 && code !== null) console.log(`[${label} exited ${code}] ${out.slice(-2000)}`); });
  return child;
}

// --- fixtures (pdf-lib from the frontend's node_modules) -----------------
async function makeFixtures() {
  fs.mkdirSync(TMP, { recursive: true });
  fs.mkdirSync(PREVIEWS, { recursive: true });
  const pkg = (await import(`file://${ROOT}/frontend/node_modules/pdf-lib/cjs/index.js`)).default;
  const { PDFDocument, StandardFonts } = pkg;
  async function makePdf(file, pages, label) {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    for (let i = 0; i < pages; i++) {
      const page = doc.addPage([400, 300]);
      page.drawText(`Hello ${label} page ${i + 1}`, { x: 10, y: 150, size: 20, font });
    }
    fs.writeFileSync(file, await doc.save());
  }
  await makePdf(path.join(TMP, "a-2pages.pdf"), 2, "A");
  await makePdf(path.join(TMP, "b-1page.pdf"), 1, "B");
  await makePdf(path.join(TMP, "c-3pages.pdf"), 3, "C");
  // 8x8 PNG (blue) — enough for images-to-PDF.
  const pngB64 = "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAFklEQVR4nGOUqzjxnwEPYMInOXwUAABx7AJtOn2KvAAAAABJRU5ErkJggg==";
  fs.writeFileSync(path.join(TMP, "img1.png"), Buffer.from(pngB64, "base64"));
  fs.writeFileSync(path.join(TMP, "img2.png"), Buffer.from(pngB64, "base64"));
}

async function makeOcrFixture(page) {
  // Big clean black-on-white text, drawn on a canvas — ideal OCR input.
  await page.goto("about:blank");
  const dataUrl = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 900;
    c.height = 300;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, 900, 300);
    ctx.fillStyle = "#000000";
    ctx.font = "bold 72px sans-serif";
    ctx.fillText("HELLO WORLD 2027", 40, 160);
    return c.toDataURL("image/png");
  });
  const file = path.join(TMP, "ocr-text.png");
  fs.writeFileSync(file, Buffer.from(dataUrl.split(",")[1], "base64"));
  return file;
}

async function main() {
  await makeFixtures();
  const f = (n) => path.join(TMP, n);

  // --- servers ------------------------------------------------------------
  const dbPath = path.join(TMP, "e2e.db");
  try { fs.unlinkSync(dbPath); } catch { /* first run */ }
  const backend = startServer(
    path.join(ROOT, "backend/.venv/bin/uvicorn"),
    ["app.main:app", "--port", "8000"],
    path.join(ROOT, "backend"),
    { PI_MOCK_MODE: "true", DATABASE_PATH: dbPath, CORS_ORIGINS: "http://localhost:4173" },
    "backend",
  );
  // Spawn the vite binary directly (not via npm) so SIGTERM in the
  // finally block actually stops the server — killing npm leaves vite
  // running and the port stays held.
  const preview = startServer(
    path.join(ROOT, "frontend/node_modules/.bin/vite"),
    ["preview", "--port", "4173", "--strictPort"],
    path.join(ROOT, "frontend"),
    {},
    "preview",
  );
  const errors = [];
  let browser;
  try {
    await waitFor(`${API_URL}/api/health`, "backend");
    await waitFor(WEB_URL, "frontend preview");

    // The VM's internet egress goes through an authenticated proxy (env
    // HTTPS_PROXY); Chromium launched without it cannot reach the
    // internet at all, which breaks the OCR engine's CDN download. Pass
    // the proxy through (credentials parsed from the env URL, never
    // logged), bypassing it for localhost traffic.
    const proxy = (() => {
      const raw = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || "";
      if (!raw) return undefined;
      try {
        const u = new URL(raw);
        const p = { server: `${u.protocol}//${u.hostname}:${u.port}`, bypass: process.env.NO_PROXY || process.env.no_proxy || "localhost,127.0.0.1" };
        if (u.username) p.username = decodeURIComponent(u.username);
        if (u.password) p.password = decodeURIComponent(u.password);
        return p;
      } catch { return undefined; }
    })();
    browser = await chromium.launch({ proxy });
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });

    // The OCR engine (tesseract.js) loads its worker, wasm core and
    // language data from cdn.jsdelivr.net at runtime. Chromium cannot
    // reach the internet on this VM (the egress proxy's CONNECT tunnel
    // fails for it, with or without launch proxy settings — curl works,
    // Node fetch hangs, Chromium gets ERR_TUNNEL_CONNECTION_FAILED).
    // Route those requests through curl, which does work through the
    // proxy. This verifies the real OCR engine end to end; the CDN
    // itself was verified separately (curl: HTTP 200). Real users on
    // phones reach the CDN directly, so no app change is needed.
    // NOTE: this must be context.route, not page.route — page.route
    // does not see requests from inside the OCR Web Worker (the worker
    // loads its own script via importScripts), so the route silently
    // never fires and OCR fails with the CDN unreachable.
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execFileAsync = promisify(execFile);
    await context.route("https://cdn.jsdelivr.net/**", async (route) => {
      const url = route.request().url();
      try {
        const { stdout } = await execFileAsync("curl", ["-sL", "--max-time", "120", url], { maxBuffer: 64 * 1024 * 1024, encoding: "buffer" });
        // importScripts enforces the MIME type: a worker script served
        // without a JavaScript content-type is rejected ("failed to
        // load"), so map the type from the URL like the CDN does.
        const contentType = url.endsWith(".js") ? "text/javascript"
          : url.endsWith(".wasm") ? "application/wasm"
          : url.endsWith(".gz") ? "application/gzip"
          : "application/octet-stream";
        await route.fulfill({ status: 200, body: stdout, contentType, headers: { "access-control-allow-origin": "*" } });
      } catch (e) {
        console.log(`[route] curl failed for ${url}: ${e.message.slice(0, 120)}`);
        await route.abort("failed");
      }
    });

    // --- 1. home -----------------------------------------------------------
    await page.goto(WEB_URL, { waitUntil: "networkidle" });
    const cards = await page.locator("a.card.tool-card").count();
    check("home shows 13 tool cards", cards === 13, `found ${cards}`);
    check("home hero renders", await page.locator(".hero h1").count() === 1);
    await page.screenshot({ path: path.join(PREVIEWS, "home-desktop.png") });

    // --- 2. every tool page loads ------------------------------------------
    const tools = [
      ["merge-pdf", "Merge PDF"], ["split-pdf", "Split PDF"], ["compress-pdf", "Compress PDF"],
      ["rotate-pdf", "Rotate PDF"], ["images-to-pdf", "Images to PDF"], ["pdf-to-images", "PDF to Images"],
      ["pdf-to-text", "PDF to Text"], ["watermark-pdf", "Watermark PDF"], ["add-page-numbers", "Add Page Numbers"],
      ["sign-pdf", "Sign PDF"], ["pdf-to-word", "PDF to Word"], ["ocr-pdf", "OCR PDF & Images"], ["html-to-pdf", "HTML to PDF"],
    ];
    for (const [slug, name] of tools) {
      await page.goto(`${WEB_URL}/tools/${slug}`, { waitUntil: "domcontentloaded" });
      const h1 = await page.locator("h1").first().textContent();
      const box = await page.locator(".tool-box").count();
      check(`tool page loads: ${slug}`, h1 === name && box === 1, `h1=${JSON.stringify(h1)}`);
    }

    // --- 3. merge (2 + 1 = 3 pages) ----------------------------------------
    await page.goto(`${WEB_URL}/tools/merge-pdf`, { waitUntil: "networkidle" });
    await page.setInputFiles("#mp-files", [f("a-2pages.pdf"), f("b-1page.pdf")]);
    await page.getByRole("button", { name: "Merge PDFs" }).click();
    await page.locator(".success", { hasText: "Merged 2 PDFs (3 pages)" }).waitFor({ timeout: 15000 });
    check("merge: 2 + 1 = 3 pages", true);
    await page.screenshot({ path: path.join(PREVIEWS, "tool-merge.png") });

    // --- 4. free-tier merge cap (4 files -> error + upsell) ----------------
    await page.goto(`${WEB_URL}/tools/merge-pdf`, { waitUntil: "networkidle" });
    await page.setInputFiles("#mp-files", [f("a-2pages.pdf"), f("b-1page.pdf"), f("a-2pages.pdf"), f("b-1page.pdf")]);
    await page.locator(".error", { hasText: "Merge at most 3 PDFs" }).waitFor({ timeout: 10000 });
    const upsell = await page.locator(".notice", { hasText: "Pro feature" }).count();
    check("free cap blocks 4-file merge + shows Pro upsell", upsell >= 1);

    // --- 5. split range ------------------------------------------------------
    await page.goto(`${WEB_URL}/tools/split-pdf`, { waitUntil: "networkidle" });
    await page.setInputFiles("#sp-file", f("c-3pages.pdf"));
    await page.fill("#sp-range", "1-2");
    await page.getByRole("button", { name: "Split PDF" }).click();
    await page.locator(".success", { hasText: "Extracted pages 1–2 (2 pages)" }).waitFor({ timeout: 15000 });
    check("split: extract pages 1-2", true);

    // --- 6. compress ---------------------------------------------------------
    await page.goto(`${WEB_URL}/tools/compress-pdf`, { waitUntil: "networkidle" });
    await page.setInputFiles("#cp-file", f("a-2pages.pdf"));
    await page.getByRole("button", { name: "Compress PDF" }).click();
    await page.locator(".success").first().waitFor({ timeout: 15000 });
    check("compress: produces a result", true);

    // --- 7. rotate -----------------------------------------------------------
    await page.goto(`${WEB_URL}/tools/rotate-pdf`, { waitUntil: "networkidle" });
    await page.setInputFiles("#rp-file", f("a-2pages.pdf"));
    await page.getByRole("button", { name: "Rotate PDF" }).click();
    await page.locator(".success", { hasText: "Rotated all 2 pages" }).waitFor({ timeout: 15000 });
    check("rotate: all pages 90°", true);

    // --- 8. watermark --------------------------------------------------------
    await page.goto(`${WEB_URL}/tools/watermark-pdf`, { waitUntil: "networkidle" });
    await page.setInputFiles("#wm-file", f("a-2pages.pdf"));
    await page.getByRole("button", { name: "Add Watermark" }).click();
    await page.locator(".success", { hasText: "Watermark" }).waitFor({ timeout: 15000 });
    check("watermark: applied to all pages", true);

    // --- 9. page numbers -----------------------------------------------------
    await page.goto(`${WEB_URL}/tools/add-page-numbers`, { waitUntil: "networkidle" });
    await page.setInputFiles("#pn-file", f("a-2pages.pdf"));
    await page.getByRole("button", { name: "Add Page Numbers" }).click();
    await page.locator(".success", { hasText: "Page numbers added to all 2 pages" }).waitFor({ timeout: 15000 });
    check("page numbers: added", true);

    // --- 10. images to PDF ---------------------------------------------------
    await page.goto(`${WEB_URL}/tools/images-to-pdf`, { waitUntil: "networkidle" });
    await page.setInputFiles("#ip-files", [f("img1.png"), f("img2.png")]);
    await page.getByRole("button", { name: "Convert Images to PDF" }).click();
    await page.locator(".success", { hasText: "Converted 2 images" }).waitFor({ timeout: 15000 });
    check("images to PDF: 2 images -> 2-page PDF", true);

    // --- 11. PDF to images ---------------------------------------------------
    await page.goto(`${WEB_URL}/tools/pdf-to-images`, { waitUntil: "networkidle" });
    await page.setInputFiles("#pi-file", f("a-2pages.pdf"));
    await page.getByRole("button", { name: "Convert PDF to Images" }).click();
    await page.locator(".success", { hasText: "Converted 2 pages" }).waitFor({ timeout: 30000 });
    const previews = await page.locator("img.preview").count();
    check("PDF to images: 2 pages rendered", previews === 2, `found ${previews}`);

    // --- 12. PDF to text -----------------------------------------------------
    await page.goto(`${WEB_URL}/tools/pdf-to-text`, { waitUntil: "networkidle" });
    await page.setInputFiles("#pt-file", f("a-2pages.pdf"));
    await page.getByRole("button", { name: "Extract Text" }).click();
    await page.locator(".success", { hasText: "Extracted" }).waitFor({ timeout: 30000 });
    const text = await page.locator("#pt-out").inputValue();
    check("PDF to text: extracts page text", text.includes("Hello A page 1"), `got ${JSON.stringify(text.slice(0, 40))}`);

    // --- 13. PDF to Word ------------------------------------------------------
    await page.goto(`${WEB_URL}/tools/pdf-to-word`, { waitUntil: "networkidle" });
    await page.setInputFiles("#pw-file", f("a-2pages.pdf"));
    await page.getByRole("button", { name: "Convert PDF to Word" }).click();
    await page.locator(".success", { hasText: "Converted 2 pages to an editable Word document" }).waitFor({ timeout: 30000 });
    check("PDF to Word: converts 2 pages", true);

    // --- 14. HTML to PDF -------------------------------------------------------
    await page.goto(`${WEB_URL}/tools/html-to-pdf`, { waitUntil: "networkidle" });
    const dl = page.waitForEvent("download", { timeout: 30000 }).catch(() => null);
    await page.getByRole("button", { name: "Convert HTML to PDF" }).click();
    await page.locator(".success", { hasText: "PDF downloaded" }).waitFor({ timeout: 30000 });
    const download = await dl;
    check("HTML to PDF: renders + downloads", download !== null, download ? download.suggestedFilename() : "no download event");

    // --- 15. sign (draw + stamp) ----------------------------------------------
    await page.goto(`${WEB_URL}/tools/sign-pdf`, { waitUntil: "networkidle" });
    await page.setInputFiles("#sg-file", f("a-2pages.pdf"));
    const canvas = page.locator('canvas[aria-label="Draw your signature here"]');
    // The canvas sits below the fold: scroll it into view first, or the
    // mouse events land outside the viewport and nothing is drawn.
    await canvas.scrollIntoViewIfNeeded();
    const box = await canvas.boundingBox();
    await page.mouse.move(box.x + 40, box.y + 80);
    await page.mouse.down();
    for (let i = 0; i < 10; i++) await page.mouse.move(box.x + 40 + i * 20, box.y + 80 + (i % 2 ? -12 : 12));
    await page.mouse.up();
    await page.getByRole("button", { name: "Sign PDF" }).click();
    await page.locator(".success", { hasText: "Signature placed on page 1" }).waitFor({ timeout: 15000 });
    check("sign: drawn signature stamped", true);

    // --- 16. OCR (CDN engine download; best-effort) -----------------------------
    try {
      const ocrFile = await makeOcrFixture(page);
      await page.goto(`${WEB_URL}/tools/ocr-pdf`, { waitUntil: "networkidle" });
      await page.setInputFiles("#oc-file", ocrFile);
      await page.getByRole("button", { name: "Read Text (OCR)" }).click();
      await page.locator(".success", { hasText: "Recognised" }).waitFor({ timeout: 180000 });
      const ocrText = await page.locator("#oc-out").inputValue();
      // "HELLO WORLD 2027" — words Tesseract reads reliably in a
      // sans-serif font ("PI" misreads as "Pl" in this fixture).
      check("OCR: reads text from image", /HELLO/i.test(ocrText) && /WORLD/i.test(ocrText), `got ${JSON.stringify(ocrText.slice(0, 60))}`);
    } catch (err) {
      check("OCR: reads text from image", false, `OCR did not complete in 180s (engine CDN download?) — ${err.message.slice(0, 120)}`);
    }

    // --- 17. mock sign-in -------------------------------------------------------
    await page.goto(WEB_URL, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Sign in with Pi" }).click();
    await page.locator("header", { hasText: "@mockpioneer" }).waitFor({ timeout: 15000 });
    check("sign-in (mock Pi): @mockpioneer in header", true);

    // --- 18. mock Pro payment -----------------------------------------------------
    await page.goto(`${WEB_URL}/pro`, { waitUntil: "networkidle" });
    await page.screenshot({ path: path.join(PREVIEWS, "pro-page.png") });
    await page.getByRole("button", { name: /Unlock Pro/ }).click();
    await page.locator(".success", { hasText: "Pro unlocked" }).waitFor({ timeout: 20000 });
    const badge = await page.locator("header .category-badge", { hasText: "Pro" }).count();
    check("Pro payment (mock): unlocks + badge shows", badge >= 1);

    // --- 19. cap lifted after Pro --------------------------------------------------
    await page.goto(`${WEB_URL}/tools/merge-pdf`, { waitUntil: "networkidle" });
    await page.setInputFiles("#mp-files", [f("a-2pages.pdf"), f("b-1page.pdf"), f("a-2pages.pdf"), f("b-1page.pdf")]);
    // Wait for React to render the file list before counting it.
    await page.locator("ol.result-list li").nth(3).waitFor({ timeout: 10000 });
    const items = await page.locator("ol.result-list li").count();
    await page.getByRole("button", { name: "Merge PDFs" }).click();
    await page.locator(".success", { hasText: "Merged 4 PDFs (6 pages)" }).waitFor({ timeout: 15000 });
    check("Pro: 4-file merge now works", items === 4, `list had ${items} files`);

    // --- 20. privacy page ------------------------------------------------------------
    await page.goto(`${WEB_URL}/privacy`, { waitUntil: "networkidle" });
    const privacyText = await page.locator("main").textContent();
    check("privacy page renders", privacyText.includes("Your files never leave your device"));

    // --- 21. mobile screenshot ---------------------------------------------------------
    const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
    const mpage = await mobile.newPage();
    await mpage.goto(WEB_URL, { waitUntil: "networkidle" });
    await mpage.screenshot({ path: path.join(PREVIEWS, "home-mobile.png") });
    const mobileCards = await mpage.locator("a.card.tool-card").count();
    check("mobile home shows 13 tool cards", mobileCards === 13, `found ${mobileCards}`);
    await mobile.close();

    // --- console errors ---------------------------------------------------------------
    const realErrors = errors.filter((e) => !e.includes("favicon"));
    check("no page/console errors during the run", realErrors.length === 0, realErrors.slice(0, 3).join(" | "));
  } catch (err) {
    console.log(`FATAL: ${err.message}`);
    results.push({ name: "run completed", ok: false, detail: err.message });
  } finally {
    if (browser) await browser.close().catch(() => {});
    backend.kill("SIGTERM");
    preview.kill("SIGTERM");
    try { fs.unlinkSync(path.join(TMP, "e2e.db")); } catch { /* already gone */ }
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  if (failed.length) {
    console.log("Failed checks:");
    for (const f of failed) console.log(` - ${f.name}: ${f.detail}`);
    process.exit(1);
  }
}

main();
