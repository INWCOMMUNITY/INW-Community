/**
 * One-time script to download the gallery top photo for the Local Business Directory header.
 * Run from apps/main: node scripts/download-directory-background.mjs
 *
 * Source: https://www.pnwcommunity.com/gallery (top/background image)
 * Wix media ID: 2bdd49_26cd29bec17e4bb5b2990254f09f85d2
 */
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WIX_ORIGINAL_URL =
  "https://static.wixstatic.com/media/2bdd49_26cd29bec17e4bb5b2990254f09f85d2~mv2.jpg";
const OUT_PATH = path.join(__dirname, "..", "public", "directory-background.jpg");

async function main() {
  console.log("Downloading directory background from Wix...");
  const res = await fetch(WIX_ORIGINAL_URL, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; NWC-Site/1.0)" },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch: ${res.status} ${res.statusText}`);
  }
  const buf = await res.arrayBuffer();
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, Buffer.from(buf));
  console.log(`Saved: ${OUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
