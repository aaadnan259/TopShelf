/*
 * Render icons/icon.svg to 16/32/48/128 PNGs.
 *
 * PNGs are NOT committed and are NOT rendered automatically -- this machine
 * had no SVG rasterizer at build time. Run this once when a renderer is
 * available, then reload the unpacked extension.
 *
 * Tries, in order:
 *   1. `sharp` if installed  (npm i -D sharp && node scripts/render-icons.mjs)
 *   2. ImageMagick `magick` / `convert` on PATH
 *   3. Inkscape on PATH
 *   4. rsvg-convert on PATH
 * If none is available it prints instructions and exits non-zero.
 */
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const svg = join(root, "icons", "icon.svg");
const sizes = [16, 32, 48, 128];
const out = (s) => join(root, "icons", `icon-${s}.png`);

if (!existsSync(svg)) {
  console.error(`Missing ${svg}`);
  process.exit(1);
}

function have(cmd) {
  const r = spawnSync(cmd, ["--version"], { stdio: "ignore" });
  return r.status === 0 || r.status === null ? r.error == null : false;
}

async function trySharp() {
  let sharp;
  try {
    sharp = (await import("sharp")).default;
  } catch {
    return false; // sharp genuinely not installed -> fall through to CLI tools
  }
  // sharp IS present: a failure here is a real render error (e.g. a malformed
  // SVG), not "no rasterizer". Surface it and stop rather than silently
  // pretending no tool was found.
  try {
    for (const s of sizes) {
      await sharp(svg, { density: 384 }).resize(s, s).png().toFile(out(s));
      console.log(`sharp -> icon-${s}.png`);
    }
    return true;
  } catch (e) {
    console.error(`sharp failed to render ${svg}:`);
    console.error("  " + (e && e.message ? e.message : e));
    process.exit(1);
  }
}

function tryCmd(cmd, argsFor) {
  if (!have(cmd)) return false;
  for (const s of sizes) {
    const r = spawnSync(cmd, argsFor(s), { stdio: "inherit" });
    if (r.status !== 0) return false;
    console.log(`${cmd} -> icon-${s}.png`);
  }
  return true;
}

const done =
  (await trySharp()) ||
  tryCmd("magick", (s) => [svg, "-background", "none", "-resize", `${s}x${s}`, out(s)]) ||
  tryCmd("convert", (s) => [svg, "-background", "none", "-resize", `${s}x${s}`, out(s)]) ||
  tryCmd("inkscape", (s) => [svg, "--export-type=png", `--export-width=${s}`, `--export-height=${s}`, `--export-filename=${out(s)}`]) ||
  tryCmd("rsvg-convert", (s) => ["-w", String(s), "-h", String(s), "-o", out(s), svg]);

if (!done) {
  console.error(
    "\nNo SVG rasterizer found. Install one, then re-run:\n" +
      "  npm i -D sharp   (recommended, zero system deps)\n" +
      "  or ImageMagick / Inkscape / librsvg on PATH\n"
  );
  process.exit(1);
}
console.log("\nAll icons rendered.");
