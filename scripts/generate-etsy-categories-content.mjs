#!/usr/bin/env node
import { readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const mdPath = join(root, "apps/main/src/lib/channels/data/etsy-seller-categories.md");
const outPath = join(root, "apps/main/src/lib/channels/data/etsy-seller-categories-content.ts");
const markdown = readFileSync(mdPath, "utf8");

writeFileSync(
  outPath,
  `/** Generated from etsy-seller-categories.md — run: node scripts/generate-etsy-categories-content.mjs */\nexport default ${JSON.stringify(markdown)};\n`
);

console.log("Wrote", outPath, `(${markdown.length} chars)`);
