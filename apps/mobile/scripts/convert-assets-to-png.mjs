/**
 * Converts icon/splash/adaptive-icon from JPEG to PNG so Expo's schema passes.
 * Run from repo root: node apps/mobile/scripts/convert-assets-to-png.mjs
 */
import sharp from "sharp";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const imagesDir = path.join(__dirname, "../assets/images");
const files = ["icon.jpg", "splash-icon.jpg", "adaptive-icon.jpg"];

for (const f of files) {
  const base = f.replace(".jpg", "");
  const outPath = path.join(imagesDir, `${base}.png`);
  await sharp(path.join(imagesDir, f)).png().toFile(outPath);
  console.log("Wrote", outPath);
}
