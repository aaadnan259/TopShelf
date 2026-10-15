// Capture the Chrome Web Store screenshots (store-assets/screenshots/README.md)
// from a REAL Amazon search, with the unpacked extension loaded.
//
//   npm i -D playwright            (uses Playwright's bundled Chromium; branded
//                                   Chrome no longer honours --load-extension)
//   node scripts/capture-screenshots.mjs [--query "smart watch"]
//                                        [--value-query "usb c cable"]
//                                        [--domain www.amazon.com]
//
// Runs a VISIBLE browser on purpose: Amazon sometimes shows a "are you a
// robot" check to automated browsers. If it does, solve it in the window and
// the script carries on (it waits up to 3 minutes for TopShelf's badges).
//
// Dev tooling only -- never shipped (package.sh excludes scripts/). It talks to
// Amazon because it is driving a browser; the extension itself still makes
// zero network requests.
import { chromium } from "playwright";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "store-assets", "screenshots");
const W = 1280;
const H = 800;
// Hero (01) pane size: (1280 - 2*32 padding - 24 gap) / 2 wide, .shot height.
const PANE_W = 596;
const PANE_H = 666;
const CROP_H = 1200;

// Shared by the composed slides (01, 05). Defined up here because the
// top-level await below runs before anything declared further down.
const BASE_CSS =
  "*{box-sizing:border-box;margin:0}" +
  "body{width:" + W + "px;height:" + H + "px;overflow:hidden;background:#131921;" +
  "font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:#fff}";

function arg(name, fallback) {
  const i = process.argv.indexOf("--" + name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const DOMAIN = arg("domain", "www.amazon.com");
const QUERY = arg("query", "smart watch");
const VALUE_QUERY = arg("value-query", "usb c cable");

const profile = mkdtempSync(join(tmpdir(), "topshelf-shots-"));
const ctx = await chromium.launchPersistentContext(profile, {
  headless: false,
  viewport: { width: W, height: H },
  deviceScaleFactor: 1, // store wants exactly 1280x800 pixels
  args: [
    "--disable-extensions-except=" + ROOT,
    "--load-extension=" + ROOT,
  ],
});

try {
  const page = ctx.pages()[0] || (await ctx.newPage());
  const extId = await findExtensionId(page);
  console.log("TopShelf extension id:", extId);

  // Known starting point regardless of what a previous run left in storage.
  await setSettings(page, extId, {
    enabled: true, mode: "quality", floor: "standard", sponsored: "demote", badges: true,
  });

  // ---- 01: before/after hero ----
  // Each pane shows a full-width results crop (the rank badges sit at the
  // tile's right edge) scaled down to fit, so it needs a taller-than-800px
  // crop to fill the pane's height.
  await page.setViewportSize({ width: W, height: CROP_H });
  await search(page, QUERY);
  await page.click(".ts-btn-original");
  await page.waitForTimeout(400);
  await scrollToFirstResult(page);
  const before = await resultsCrop(page);
  await page.click(".ts-btn-ranked");
  await page.waitForTimeout(400);
  await scrollToFirstResult(page);
  const after = await resultsCrop(page);
  await page.setViewportSize({ width: W, height: H });
  await composeHero(page, before, after, QUERY);
  console.log("wrote 01-before-after.png");

  // ---- 02: #1 badge popover open ----
  await search(page, QUERY);
  await page.evaluate(() => {
    const b = document.querySelector(".ts-badge-1");
    b.scrollIntoView({ block: "start" });
    window.scrollBy(0, -140); // room above the tile; popover opens below
  });
  await page.click(".ts-badge-1");
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(OUT, "02-badge-reasons.png") });
  console.log("wrote 02-badge-reasons.png");

  // ---- 03: control chip with hidden count ----
  // Aggressive floor makes it likely the "Show N hidden" link appears.
  await setSettings(page, extId, { floor: "aggressive" });
  await search(page, QUERY);
  await scrollToResults(page);
  await page.waitForTimeout(400);
  const hidden = await page.$eval(".ts-chip-hidden", (b) => (b.hidden ? null : b.textContent));
  if (!hidden) console.warn("  note: nothing hidden on this search; try another --query for shot 3");
  await page.screenshot({ path: join(OUT, "03-control-chip.png") });
  console.log("wrote 03-control-chip.png");

  // ---- 04: value mode ----
  await setSettings(page, extId, { mode: "value", floor: "standard" });
  await search(page, VALUE_QUERY);
  // A tile with no price keeps its quality score in value mode, so it can
  // land at #1 with a "value: no price" reason -- that sells nothing. Open
  // the best-ranked badge whose reasons include an actual price division.
  const priced = await page.evaluate(() => {
    for (const r of [1, 2, 3]) {
      const b = document.querySelector(".ts-badge-" + r);
      if (b && /value: \/log10/.test(b.textContent)) {
        b.scrollIntoView({ block: "start" });
        window.scrollBy(0, -140);
        return r;
      }
    }
    return 0;
  });
  if (!priced) console.warn("  note: no priced tile in the top 3; try another --value-query for shot 4");
  await page.click(".ts-badge-" + (priced || 1)); // popover shows the "value: /log10($..)" line
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(OUT, "04-value-mode.png") });
  console.log("wrote 04-value-mode.png");

  // ---- 05: options page, centred on a brand backdrop ----
  await setSettings(page, extId, { mode: "quality", floor: "standard" });
  // Render it at popup width so it looks like the real toolbar popup.
  await page.setViewportSize({ width: 440, height: H });
  await page.goto("chrome-extension://" + extId + "/options/options.html");
  await page.waitForTimeout(500);
  // Crop to the content: the page's own background runs past the last card.
  const contentH = await page.evaluate(() => {
    let b = 0;
    for (const el of document.body.children) b = Math.max(b, el.getBoundingClientRect().bottom);
    return Math.ceil(b + 16);
  });
  const card = await page.screenshot({ clip: { x: 0, y: 0, width: 440, height: Math.min(contentH, H - 40) } });
  await page.setViewportSize({ width: W, height: H });
  await composeOptions(page, card);
  console.log("wrote 05-options.png");

  console.log("\nDone. Review the PNGs in store-assets/screenshots/ before uploading.");
} finally {
  await ctx.close();
  rmSync(profile, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------

async function findExtensionId(page) {
  // No background worker to read the id from, so ask chrome://extensions.
  // Playwright's CSS engine pierces the page's shadow roots.
  await page.goto("chrome://extensions");
  const item = page.locator("extensions-item").first();
  await item.waitFor({ timeout: 10000 });
  return item.getAttribute("id");
}

async function setSettings(page, extId, patch) {
  // chrome.storage only exists on extension pages, so hop to options.html.
  await page.goto("chrome-extension://" + extId + "/options/options.html");
  await page.evaluate((p) => new Promise((r) => chrome.storage.sync.set(p, r)), patch);
}

async function search(page, q) {
  await page.goto("https://" + DOMAIN + "/s?k=" + encodeURIComponent(q));
  try {
    await page.waitForSelector(".ts-badge-1", { timeout: 15000 });
  } catch (e) {
    console.log("  Waiting for results... if Amazon shows a robot check or a");
    console.log("  location/cookie prompt, deal with it in the browser window.");
    await page.waitForSelector(".ts-badge-1", { timeout: 180000 });
  }
  await page.waitForTimeout(800); // let late-loading tiles settle and re-rank
}

async function scrollToResults(page) {
  await page.evaluate(() => {
    const slot = document.querySelector(".s-main-slot");
    const top = slot.getBoundingClientRect().top + window.scrollY;
    window.scrollTo(0, Math.max(0, top - 16));
  });
  await page.waitForTimeout(200);
}

// Top of the first result tile, below Amazon's ad carousels, so the crop
// shows ranked tiles (and their badges) rather than sponsored banners.
async function scrollToFirstResult(page) {
  await page.evaluate(() => {
    const t = document.querySelector('.s-main-slot div[data-component-type="s-search-result"]');
    const el = t || document.querySelector(".s-main-slot");
    window.scrollTo(0, Math.max(0, el.getBoundingClientRect().top + window.scrollY - 2));
  });
  await page.waitForTimeout(200);
}

// The left part of the results grid at full resolution -- shrinking the whole
// 1280px page into half a slide would make the badges unreadable.
async function resultsCrop(page) {
  // The fixed chip would sit on top of the tiles in a crop (slide 03 shows
  // it), and Amazon's sticky header would cover the top of a scrolled crop.
  const hide = await page.addStyleTag({
    content: ".ts-chip,#navbar-main,#navbar,#nav-belt,#nav-main{visibility:hidden !important}",
  });
  const box = await page.evaluate(() => {
    const r = document.querySelector(".s-main-slot").getBoundingClientRect();
    return { x: Math.max(0, r.left), width: Math.min(r.width, 1000) };
  });
  // Match the hero pane's aspect so the scaled crop fills it top to bottom.
  const h = Math.min(CROP_H, Math.round((box.width * PANE_H) / PANE_W));
  const png = await page.screenshot({ clip: { x: box.x, y: 0, width: box.width, height: h } });
  await hide.evaluate((el) => el.remove());
  return png;
}

function dataUrl(buf) {
  return "data:image/png;base64," + buf.toString("base64");
}

function esc(s) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}

async function composeHero(page, before, after, q) {
  const pane = (label, sub, img, accent) =>
    '<div class="pane"><div class="lab" style="color:' + accent + '">' + label +
    '<span>' + sub + "</span></div>" +
    '<div class="shot"><img src="' + dataUrl(img) + '"></div></div>';
  // Compose on a blank page: Amazon's (or the extension's) CSP must not get
  // a say over our data: images.
  await page.goto("about:blank");
  await page.setContent(
    "<style>" + BASE_CSS +
    ".wrap{display:flex;gap:24px;padding:28px 32px}" +
    ".pane{flex:1;display:flex;flex-direction:column;gap:12px;min-width:0}" +
    ".lab{font-size:22px;font-weight:700}.lab span{display:block;font-size:14px;font-weight:400;color:#9ca3af;margin-top:4px}" +
    ".shot{height:666px;border-radius:12px;overflow:hidden;background:#fff}" +
    ".shot img{width:100%;display:block}</style>" +
    '<div class="wrap">' +
    pane("Amazon's order", 'Real search: "' + esc(q) + '"', before, "#e5e7eb") +
    pane("TopShelf, best first", "Same page, re-ranked on-device", after, "#febd69") +
    "</div>"
  );
  await page.waitForFunction(() => [...document.images].every((i) => i.complete));
  await page.screenshot({ path: join(OUT, "01-before-after.png") });
}

async function composeOptions(page, card) {
  // Compose on a blank page: Amazon's (or the extension's) CSP must not get
  // a say over our data: images.
  await page.goto("about:blank");
  await page.setContent(
    "<style>" + BASE_CSS +
    "body{display:flex;align-items:center;justify-content:center;gap:64px}" +
    ".copy{max-width:420px}.copy h1{font-size:40px;line-height:1.15;margin-bottom:16px}" +
    ".copy p{font-size:18px;line-height:1.5;color:#d1d5db}" +
    "img{max-height:740px;border-radius:14px;box-shadow:0 20px 60px rgba(0,0,0,.45)}</style>" +
    '<div class="copy"><h1>Your rules,<br><span style="color:#febd69">your ranking.</span></h1>' +
    "<p>Quality or value per dollar, how strict the hide floor is, and what to do " +
    "with sponsored listings. Settings stay in your browser.</p></div>" +
    '<img src="' + dataUrl(card) + '">'
  );
  await page.waitForFunction(() => [...document.images].every((i) => i.complete));
  await page.screenshot({ path: join(OUT, "05-options.png") });
}
