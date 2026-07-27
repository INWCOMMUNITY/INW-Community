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
 *
 * **Neon + Vercel:** Even with a direct host, Prisma’s 10s advisory-lock wait often times out (cold
 * compute, serverless). On `VERCEL=1` with a `.neon.tech` migrate host, this script sets
 * `PRISMA_SCHEMA_DISABLE_ADVISORY_LOCK=true` for the migrate subprocess only. Use
 * `PRISMA_SCHEMA_DISABLE_ADVISORY_LOCK=0` in Vercel env to keep locking (and run one deploy at a time).
 *
 * **Failed migrations (P3009):** If a prior deploy left a migration in failed state, this script marks
 * it rolled back via `prisma migrate resolve --rolled-back` and retries deploy (up to 3 attempts).
 */
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const dbDir = path.join(rootDir, "packages", "database");
const MAX_DEPLOY_ATTEMPTS = 3;

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

/**
 * Longer libpq connect timeout helps Neon wake compute during CI.
 * @param {string} databaseUrl
 */
function withLibpqMigrateOptions(databaseUrl) {
  try {
    const u = new URL(databaseUrl);
    if (!u.searchParams.has("connect_timeout")) {
      u.searchParams.set("connect_timeout", "60");
    }
    return u.toString();
  } catch {
    return databaseUrl;
  }
}

/**
 * Prisma’s migrate advisory lock often fails on Neon (P1002) within the fixed 10s window.
 * @param {string} migrateHost hostname only (no port)
 */
function shouldDisableAdvisoryLock(migrateHost) {
  const raw = process.env.PRISMA_SCHEMA_DISABLE_ADVISORY_LOCK?.trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "no") return false;
  if (raw === "1" || raw === "true" || raw === "yes") return true;
  if (process.env.VERCEL !== "1") return false;
  return /\.neon\.tech$/i.test(migrateHost) || migrateHost.includes(".neon.tech");
}

/**
 * @param {string} output
 * @returns {string[]}
 */
function extractFailedMigrationNames(output) {
  const names = new Set();
  const re = /The `([^`]+)` migration[\s\S]*?failed/gi;
  let match;
  while ((match = re.exec(output)) !== null) {
    names.add(match[1]);
  }
  return [...names];
}

/**
 * @param {NodeJS.ProcessEnv} childEnv
 * @returns {{ ok: boolean; output: string; status: number }}
 */
function runPrismaMigrateDeploy(childEnv) {
  try {
    const out = execSync("pnpm exec prisma migrate deploy", {
      cwd: dbDir,
      env: childEnv,
      encoding: "utf-8",
      shell: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    if (out) process.stdout.write(out);
    return { ok: true, output: String(out || ""), status: 0 };
  } catch (e) {
    const ex = /** @type {Error & { stdout?: string; stderr?: string; status?: number }} */ (e);
    const output = [ex.stdout, ex.stderr, ex.message].filter(Boolean).join("\n");
    if (output) process.stderr.write(output + (output.endsWith("\n") ? "" : "\n"));
    return { ok: false, output, status: typeof ex.status === "number" ? ex.status : 1 };
  }
}

/**
 * @param {string} migrationName
 * @param {NodeJS.ProcessEnv} childEnv
 */
function resolveFailedMigration(migrationName, childEnv) {
  console.log(`migrate-deploy: marking failed migration as rolled back: ${migrationName}`);
  try {
    const out = execSync(`pnpm exec prisma migrate resolve --rolled-back ${migrationName}`, {
      cwd: dbDir,
      env: childEnv,
      encoding: "utf-8",
      shell: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    if (out) process.stdout.write(out);
    return true;
  } catch (e) {
    const ex = /** @type {Error & { stdout?: string; stderr?: string }} */ (e);
    const output = [ex.stdout, ex.stderr, ex.message].filter(Boolean).join("\n");
    console.warn(`migrate-deploy: resolve --rolled-back ${migrationName} warning:\n${output}`);
    return false;
  }
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

const migrateUrl = withLibpqMigrateOptions(resolveMigrateDatabaseUrl(url));
const migrateHostMatch = migrateUrl.match(/@([^/?]+)/);
const migrateHostOnly = migrateHostMatch ? migrateHostMatch[1].split(":")[0] : "";
console.log("migrate-deploy: Migrate host:", migrateHostOnly || "(verify URL)");

const childEnv = { ...process.env, DATABASE_URL: migrateUrl };
if (shouldDisableAdvisoryLock(migrateHostOnly)) {
  childEnv.PRISMA_SCHEMA_DISABLE_ADVISORY_LOCK = "true";
  console.log(
    "migrate-deploy: PRISMA_SCHEMA_DISABLE_ADVISORY_LOCK=true for migrate (Neon on Vercel). Set PRISMA_SCHEMA_DISABLE_ADVISORY_LOCK=0 to require advisory locking."
  );
}

for (let attempt = 1; attempt <= MAX_DEPLOY_ATTEMPTS; attempt++) {
  if (attempt > 1) {
    console.log(`migrate-deploy: retry attempt ${attempt}/${MAX_DEPLOY_ATTEMPTS}`);
  }

  const result = runPrismaMigrateDeploy(childEnv);
  if (result.ok) {
    process.exit(0);
  }

  const isFailedMigrationBlock =
    result.output.includes("P3009") || /migration[\s\S]*failed/i.test(result.output);
  const failedNames = extractFailedMigrationNames(result.output);

  if (!isFailedMigrationBlock || failedNames.length === 0) {
    process.exit(result.status ?? 1);
  }

  console.log(
    `migrate-deploy: detected failed migration(s): ${failedNames.join(", ")}`
  );
  for (const name of failedNames) {
    resolveFailedMigration(name, childEnv);
  }
}

console.error("migrate-deploy: migrate deploy failed after clearing failed migration state.");
process.exit(1);
