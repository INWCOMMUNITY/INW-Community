#!/usr/bin/env node
/**
 * Run `prisma migrate deploy` against the DATABASE_URL your Next app is most likely using.
 *
 * If `DATABASE_URL` is not already set in the environment, the first match wins from:
 *   1. `apps/main/.env.local`
 *   2. `apps/main/.env`
 *   3. Repo root `.env`
 *   4. `packages/database/.env`
 *
 * This avoids migrating localhost while the app uses Neon (a common cause of "column does not exist").
 *
 * **Neon pooled URLs** (`…-pooler.…`) break Prisma’s advisory lock during `migrate deploy` (P1002).
 * This script runs migrate against a **direct** connection, in order:
 *   1. `DATABASE_URL_UNPOOLED` (Vercel + Neon integration)
 *   2. `DIRECT_URL`
 *   3. Derived from pooled `DATABASE_URL` by stripping `-pooler.` from the hostname
 *   4. Same as `DATABASE_URL` (local Postgres or already-direct Neon URL)
 */
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

function readDatabaseUrlFromFile(p) {
  if (!fs.existsSync(p)) return null;
  const content = fs.readFileSync(p, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const m = line.match(/^DATABASE_URL\s*=\s*(.*)$/);
    if (!m) continue;
    let val = m[1].trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (val && !val.startsWith("#")) return val;
  }
  return null;
}

/**
 * @param {string} databaseUrl
 * @returns {string | null}
 */
function neonDirectFromPooled(databaseUrl) {
  try {
    const u = new URL(databaseUrl);
    if (!u.hostname.includes("-pooler.")) return null;
    const next = new URL(databaseUrl);
    next.hostname = u.hostname.replace("-pooler.", ".");
    return next.toString();
  } catch {
    return null;
  }
}

/**
 * Connection string for `prisma migrate deploy` only (session + advisory locks).
 * @param {string} appDatabaseUrl
 */
function resolveMigrateDatabaseUrl(appDatabaseUrl) {
  const unpooled = process.env.DATABASE_URL_UNPOOLED?.trim();
  if (unpooled) {
    console.log("migrate-deploy: Using DATABASE_URL_UNPOOLED for migrate (direct Neon connection)");
    return unpooled;
  }
  const direct = process.env.DIRECT_URL?.trim();
  if (direct) {
    console.log("migrate-deploy: Using DIRECT_URL for migrate");
    return direct;
  }
  const derived = neonDirectFromPooled(appDatabaseUrl);
  if (derived) {
    console.log(
      "migrate-deploy: Using derived direct Neon URL for migrate (stripped -pooler from host)"
    );
    return derived;
  }
  console.log("migrate-deploy: Using DATABASE_URL for migrate (no pooler strip / unpooled env)");
  return appDatabaseUrl;
}

let url = process.env.DATABASE_URL?.trim();
if (url) {
  console.log("migrate-deploy: DATABASE_URL from environment");
}
if (!url) {
  const paths = [
    path.join(rootDir, "apps", "main", ".env.local"),
    path.join(rootDir, "apps", "main", ".env"),
    path.join(rootDir, ".env"),
    path.join(rootDir, "packages", "database", ".env"),
  ];
  for (const p of paths) {
    const found = readDatabaseUrlFromFile(p);
    if (found) {
      url = found;
      process.env.DATABASE_URL = found;
      console.log("migrate-deploy: DATABASE_URL from", path.relative(rootDir, p));
      break;
    }
  }
}

if (!url) {
  console.error(
    "migrate-deploy: No DATABASE_URL. Set it in the environment or in apps/main/.env, root .env, or packages/database/.env."
  );
  process.exit(1);
}

const hostMatch = url.match(/@([^/?]+)/);
console.log("migrate-deploy: App DATABASE_URL host:", hostMatch ? hostMatch[1] : "(verify URL)");

const migrateUrl = resolveMigrateDatabaseUrl(url);
const migrateHost = migrateUrl.match(/@([^/?]+)/);
console.log(
  "migrate-deploy: Migrate host:",
  migrateHost ? migrateHost[1] : "(verify URL)"
);

const dbDir = path.join(rootDir, "packages", "database");
const child = spawn("pnpm exec prisma migrate deploy", [], {
  cwd: dbDir,
  env: { ...process.env, DATABASE_URL: migrateUrl },
  stdio: "inherit",
  shell: true,
});

child.on("close", (code) => process.exit(code ?? 0));
