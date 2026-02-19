#!/usr/bin/env node
/**
 * Run the database seed against the production database.
 *
 * Usage:
 *   1. Add DATABASE_URL_PRODUCTION to your .env (copy from Vercel → Settings → Environment Variables)
 *   2. Run: pnpm db:seed:prod
 *
 * Or inline:
 *   DATABASE_URL_PRODUCTION="postgresql://..." pnpm db:seed:prod
 */
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

// Load apps/main first, then root (root wins - usually has production URLs)
const envPaths = [
  path.join(rootDir, "apps", "main", ".env"),
  path.join(rootDir, ".env"),
];
function loadEnv(p) {
  if (!fs.existsSync(p)) return;
  const content = fs.readFileSync(p, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) {
      const key = m[1].trim();
      const val = m[2].trim().replace(/^["']|["']$/g, "");
      process.env[key] = val; // Last file wins (apps/main overrides root if both have it)
    }
  }
}
envPaths.forEach(loadEnv);

// Read production URL from root .env (cwd or script-relative)
const tryPaths = [path.join(process.cwd(), ".env"), path.resolve(rootDir, ".env")];
for (const envPath of tryPaths) {
  if (!fs.existsSync(envPath)) continue;
  const raw = fs.readFileSync(envPath, "utf8");
  const m = raw.match(/DATABASE_URL_PRODUCTION\s*=\s*"(postgresql:[^"]+)"/)
    || raw.match(/DATABASE_URL\s*=\s*"(postgresql:[^"]+)"/);
  if (m) {
    process.env.DATABASE_URL_PRODUCTION = m[1];
    break;
  }
}

let prodUrl =
  process.env.DATABASE_URL_PRODUCTION?.trim() ||
  (process.env.DATABASE_URL?.includes("ep-") ? process.env.DATABASE_URL.trim() : null);
if (!prodUrl || prodUrl.includes("host.neon.tech") || prodUrl.includes("user:password")) {
  console.error("Need production DB URL. Set DATABASE_URL_PRODUCTION or DATABASE_URL in .env (root) to your Neon URL from Vercel.");
  console.error("Format: postgresql://user:pass@ep-XXXXX.region.aws.neon.tech/neondb?sslmode=require");
  process.exit(1);
}

// Always pass our prod URL
const env = { ...process.env, DATABASE_URL: prodUrl, SEED_DATABASE_URL: prodUrl };
// Log host only for verification (e.g. ep-xxx.aws.neon.tech)
const hostMatch = prodUrl.match(/@([^/]+)/);
console.log("Seeding production DB:", hostMatch ? hostMatch[1] : "(check .env)");
const dbDir = path.join(rootDir, "packages", "database");
const seedPath = path.join(dbDir, "prisma", "seed.js");
// Run seed via Node directly (avoids spawn pnpm ENOENT on Windows)
const child = spawn(process.execPath, [seedPath], {
  cwd: dbDir,
  env,
  stdio: "inherit",
});

child.on("close", (code) => {
  process.exit(code ?? 0);
});
