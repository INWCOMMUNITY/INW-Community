#!/usr/bin/env node
/**
 * One-time: baseline production DB so Prisma knows existing migrations are applied,
 * then run any new migrations (e.g. member_coupons_redeemed).
 *
 * Use when you see: "The database schema is not empty" (P3005) on first db:migrate:prod.
 *
 * Usage: same .env as db:seed:prod with DATABASE_URL_PRODUCTION, then:
 *   pnpm db:baseline:prod
 */
import { spawnSync } from "child_process";
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
console.log("Baseline + deploy for production DB:", hostMatch ? hostMatch[1] : "(check .env)");

const migrationsDir = path.join(rootDir, "packages", "database", "prisma", "migrations");
const migrationNames = fs.readdirSync(migrationsDir)
  .filter((name) => {
    const p = path.join(migrationsDir, name);
    return fs.statSync(p).isDirectory() && fs.existsSync(path.join(p, "migration.sql"));
  })
  .sort();

// Only migration we want to actually run on prod (adds coupons_redeemed). Rest we mark as applied.
const runThisMigration = "20250225000000_member_coupons_redeemed";
const toMarkApplied = migrationNames.filter((n) => n !== runThisMigration);

const dbDir = path.join(rootDir, "packages", "database");

function run(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: dbDir, env, stdio: "inherit", shell: true });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

for (const name of toMarkApplied) {
  console.log("Marking as applied:", name);
  run("pnpm", ["exec", "prisma", "migrate", "resolve", "--applied", name]);
}

console.log("Applying new migration(s)...");
run("pnpm", ["exec", "prisma", "migrate", "deploy"]);

console.log("Done. Production is baselined and up to date.");
