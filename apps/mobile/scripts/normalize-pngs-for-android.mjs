/**
 * Re-encodes PNGs under assets/images as standard 8-bit RGBA PNGs so AAPT2 can compile them.
 * Fixes "AAPT: error: file failed to compile" on :app:mergeReleaseResources (bad/corrupt/non‑sRGB PNGs).
 *
 * Run from apps/mobile: node scripts/normalize-pngs-for-android.mjs
 */
import fs from "fs/promises";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "../assets/images");

/** Paths that failed EAS AAPT2 — processed first */
const priority = [
  "calendars/fun_events.png",
  "nwc-logo.png",
  "nwc-community-logo.png",
  "calendars/non_profit.png",
  "nwc-logo-home.png",
  "calendars/local_art_music.png",
];

async function* walkPngs(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walkPngs(p);
    else if (e.name.toLowerCase().endsWith(".png")) yield p;
  }
}

async function normalizeOne(filePath) {
  const tmp = path.join(os.tmpdir(), `png-fix-${path.basename(filePath)}-${Date.now()}.png`);
  const buf = await sharp(filePath).ensureAlpha().png({ compressionLevel: 9, effort: 6 }).toBuffer();
  await fs.writeFile(tmp, buf);
  await fs.rename(tmp, filePath);
  console.log("OK", path.relative(path.join(__dirname, ".."), filePath));
}

const seen = new Set();
let ok = 0;
let failed = 0;

for (const rel of priority) {
  const filePath = path.join(root, rel);
  try {
    await normalizeOne(filePath);
    seen.add(path.normalize(filePath));
    ok++;
  } catch (e) {
    console.error("FAIL", rel, e.message || e);
    failed++;
  }
}

for await (const filePath of walkPngs(root)) {
  if (seen.has(path.normalize(filePath))) continue;
  try {
    await normalizeOne(filePath);
    ok++;
  } catch (e) {
    console.error("FAIL", path.relative(path.join(__dirname, ".."), filePath), e.message || e);
    failed++;
  }
}

console.log(`Done: ${ok} normalized, ${failed} failed.`);
if (failed) process.exitCode = 1;
