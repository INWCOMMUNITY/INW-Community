#!/usr/bin/env node
/**
 * Sets Vercel project Root Directory to apps/main via API.
 * Avoids UI copy-paste spacing issues.
 * Requires VERCEL_TOKEN in .env
 */

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");

function loadEnv() {
  try {
    const content = readFileSync(join(rootDir, ".env"), "utf8");
    for (const line of content.split("\n")) {
      const m = line.match(/^VERCEL_TOKEN\s*=\s*["']?([^"'\s]+)["']?/);
      if (m) return m[1].trim();
    }
  } catch (e) {}
  return process.env.VERCEL_TOKEN;
}

const token = loadEnv();
if (!token) {
  console.error("VERCEL_TOKEN not found in .env");
  process.exit(1);
}

const PROJECT = "INW-Community";
const ROOT_DIR = "apps/main";

async function main() {
  // Use PATCH to update only rootDirectory
  const res = await fetch(`https://api.vercel.com/v9/projects/${encodeURIComponent(PROJECT)}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ rootDirectory: ROOT_DIR }),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`API ${res.status}:`, text);
    process.exit(1);
  }

  const data = await res.json();
  console.log("✓ Root Directory set to:", data.rootDirectory ?? ROOT_DIR);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
