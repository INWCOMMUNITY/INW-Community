#!/usr/bin/env node
/**
 * Apply pending Prisma migrations to the production database.
 *
 * Usage:
 *   1. Add DATABASE_URL_PRODUCTION to your .env (same as for db:seed:prod)
 *   2. Run: pnpm db:migrate:prod
 *
 * Run this before db:seed:prod if production schema is behind (e.g. missing columns).
 */
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

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
      process.env[key] = val;
    }
  }
}
envPaths.forEach(loadEnv);

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
  console.error("Need production DB URL. Set DATABASE_URL_PRODUCTION in .env (root).");
  process.exit(1);
}

const env = { ...process.env, DATABASE_URL: prodUrl };
const hostMatch = prodUrl.match(/@([^/]+)/);
console.log("Applying migrations to production DB:", hostMatch ? hostMatch[1] : "(check .env)");

const dbDir = path.join(rootDir, "packages", "database");
const child = spawn("pnpm exec prisma migrate deploy", [], {
  cwd: dbDir,
  env,
  stdio: "inherit",
  shell: true,
});

child.on("close", (code) => {
  process.exit(code ?? 0);
});
