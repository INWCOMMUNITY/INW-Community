#!/usr/bin/env node
/**
 * One-time fix after squashing migrations into `20250101000000_init`.
 *
 * Production already has the schema (from older migration names). `migrate deploy` tries to
 * apply `20250101000000_init` and fails with P3018 (e.g. `type "Plan" already exists`).
 *
 * This script:
 * 1. Clears a failed `20250101000000_init` record if present (`migrate resolve --rolled-back`).
 * 2. Marks `20250101000000_init` as applied **without running SQL** (`migrate resolve --applied`).
 * 3. Runs `migrate deploy` so only real deltas (e.g. `20250329190000_group_allow_business_posts`) apply.
 *
 * Usage (local, against production Neon — use direct/unpooled URL):
 *   Set `DATABASE_URL_PRODUCTION` in root `.env` (same as `db:seed:prod`).
 *   pnpm db:resolve-squashed-init
 *
 * **Env files:** Loads `apps/main/.env`, `packages/database/.env`, then **root `.env`** (root always
 * wins for `DATABASE_URL`, `DATABASE_URL_PRODUCTION`, `DATABASE_URL_UNPOOLED`, `DIRECT_URL`).
 * That way Neon in root `.env` beats `localhost` in `apps/main/.env` or `packages/database/.env`.
 * Shell / CI vars are applied first; root file overrides only those four keys when set.
 *
 * If `DATABASE_URL` still points at **localhost** after that, the script exits unless you set
 * `RESOLVE_SQUASHED_INIT_ALLOW_LOCAL=1`.
 *
 * If Prisma reports migrations **in the database but missing from the repo**, you must reconcile
 * `_prisma_migrations` with Prisma support docs; this script only fixes the common squashed-init case.
 */
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const dbDir = path.join(rootDir, "packages", "database");

const ROOT_DB_KEYS = new Set([
  "DATABASE_URL_PRODUCTION",
  "DATABASE_URL",
  "DATABASE_URL_UNPOOLED",
  "DIRECT_URL",
]);

/**
 * @param {string} filePath
 * @returns {Map<string, string>}
 */
function parseEnvFile(filePath) {
  const map = new Map();
  if (!fs.existsSync(filePath)) return map;
  const content = fs.readFileSync(filePath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (!m) continue;
    const key = m[1].trim();
    let val = m[2].trim().replace(/^["']|["']$/g, "");
    if (val !== "") map.set(key, val);
  }
  return map;
}

const mainEnvMap = parseEnvFile(path.join(rootDir, "apps", "main", ".env"));
const dbPkgEnvMap = parseEnvFile(path.join(rootDir, "packages", "database", ".env"));
const rootEnvMap = parseEnvFile(path.join(rootDir, ".env"));

/**
 * Fill process.env from repo .env files. Root wins for DB URL keys so Neon in root/.env is used
 * even when apps/main/.env or packages/database/.env point at localhost.
 */
function mergeRepoEnv() {
  for (const map of [mainEnvMap, dbPkgEnvMap]) {
    for (const [key, val] of map) {
      if (!process.env[key]) process.env[key] = val;
    }
  }
  for (const key of ROOT_DB_KEYS) {
    const val = rootEnvMap.get(key);
    if (val) process.env[key] = val;
  }
}
mergeRepoEnv();

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

function resolveMigrateDatabaseUrl(appDatabaseUrl) {
  const unpooled = process.env.DATABASE_URL_UNPOOLED?.trim();
  if (unpooled) return unpooled;
  const direct = process.env.DIRECT_URL?.trim();
  if (direct) return direct;
  const derived = neonDirectFromPooled(appDatabaseUrl);
  if (derived) return derived;
  return appDatabaseUrl;
}

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

function shouldDisableAdvisoryLock(migrateHost) {
  const raw = process.env.PRISMA_SCHEMA_DISABLE_ADVISORY_LOCK?.trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "no") return false;
  if (raw === "1" || raw === "true" || raw === "yes") return true;
  return /\.neon\.tech$/i.test(migrateHost) || migrateHost.includes(".neon.tech");
}

const prodUrl = process.env.DATABASE_URL_PRODUCTION?.trim();
const fallbackUrl = process.env.DATABASE_URL?.trim();
let appUrl = prodUrl || fallbackUrl;
if (!appUrl) {
  console.error(
    "resolve-squashed-init: Set DATABASE_URL_PRODUCTION (recommended) or DATABASE_URL in .env."
  );
  process.exit(1);
}

if (!prodUrl && fallbackUrl) {
  try {
    const h = new URL(fallbackUrl.replace(/^postgresql\+/, "postgresql://")).hostname;
    const local =
      h === "localhost" ||
      h === "127.0.0.1" ||
      h === "::1" ||
      h.endsWith(".local");
    if (
      local &&
      !["1", "true", "yes"].includes(
        process.env.RESOLVE_SQUASHED_INIT_ALLOW_LOCAL?.trim().toLowerCase() || ""
      )
    ) {
      console.error(
        "resolve-squashed-init: DATABASE_URL points at localhost. This script is meant for production Neon.\n" +
          "  Add DATABASE_URL_PRODUCTION to .env, or re-run with:\n" +
          "  RESOLVE_SQUASHED_INIT_ALLOW_LOCAL=1 pnpm db:resolve-squashed-init"
      );
      process.exit(1);
    }
  } catch {
    /* ignore URL parse; proceed */
  }
}

const migrateUrl = withLibpqMigrateOptions(resolveMigrateDatabaseUrl(appUrl));
const migrateHostMatch = migrateUrl.match(/@([^/?]+)/);
const migrateHostOnly = migrateHostMatch ? migrateHostMatch[1].split(":")[0] : "";
const urlSource = prodUrl
  ? "DATABASE_URL_PRODUCTION"
  : rootEnvMap.get("DATABASE_URL")
    ? "root .env DATABASE_URL"
    : mainEnvMap.get("DATABASE_URL")
      ? "apps/main/.env DATABASE_URL (root had no DATABASE_URL)"
      : dbPkgEnvMap.get("DATABASE_URL")
        ? "packages/database/.env DATABASE_URL"
        : "DATABASE_URL";
console.log(
  "resolve-squashed-init: Using host:",
  migrateHostOnly || migrateUrl.slice(0, 40) + "…",
  `(${urlSource})`
);

const childEnv = { ...process.env, DATABASE_URL: migrateUrl };
if (shouldDisableAdvisoryLock(migrateHostOnly)) {
  childEnv.PRISMA_SCHEMA_DISABLE_ADVISORY_LOCK = "true";
  console.log("resolve-squashed-init: PRISMA_SCHEMA_DISABLE_ADVISORY_LOCK=true (Neon)");
}

function run(label, cmd) {
  console.log(`\nresolve-squashed-init: ${label}\n> ${cmd}`);
  execSync(cmd, { cwd: dbDir, env: childEnv, stdio: "inherit", shell: true });
}

/**
 * Run `pnpm exec prisma migrate resolve …` and capture output. Uses `execSync` + `shell: true` so
 * Windows reliably finds `pnpm` and Prisma errors (stdout/stderr) are captured; `spawnSync` without
 * shell often produced empty output and `status: null` on Windows.
 *
 * @param {string[]} prismaArgs e.g. ["--rolled-back", "20250101000000_init"]
 * @returns {{ ok: boolean; out: string; status: number }}
 */
function prismaResolve(prismaArgs) {
  const quoted = prismaArgs.map((a) =>
    /[\s"]/.test(a) ? `"${a.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"` : a
  );
  const cmd = `pnpm exec prisma migrate resolve ${quoted.join(" ")}`;
  try {
    const out = execSync(cmd, {
      cwd: dbDir,
      env: childEnv,
      encoding: "utf-8",
      shell: true,
    });
    return { ok: true, out: String(out || ""), status: 0 };
  } catch (e) {
    const ex = /** @type {Error & { stdout?: string; stderr?: string; status?: number; code?: string }} */ (
      e
    );
    const out = [ex.stdout, ex.stderr, ex.message].filter(Boolean).join("\n");
    return {
      ok: false,
      out: out || "unknown error (no stdout/stderr from prisma)",
      status: typeof ex.status === "number" ? ex.status : 1,
    };
  }
}

const rolled = prismaResolve(["--rolled-back", "20250101000000_init"]);
console.log(`\nresolve-squashed-init: clear failed state for 20250101000000_init\n> pnpm exec prisma migrate resolve --rolled-back 20250101000000_init`);
if (rolled.ok) {
  console.log(rolled.out.trim());
} else {
  console.log(
    "resolve-squashed-init: --rolled-back skipped or failed (ok if migration was not in failed state):\n",
    rolled.out.trim() || `(exit ${rolled.status ?? "unknown"})`
  );
}

const applied = prismaResolve(["--applied", "20250101000000_init"]);
console.log(`\nresolve-squashed-init: mark 20250101000000_init as applied (skip if already applied)\n> pnpm exec prisma migrate resolve --applied 20250101000000_init`);
if (applied.ok) {
  console.log(applied.out.trim());
} else if (
  /P3008|already recorded as applied|Migration .* already finished/i.test(applied.out)
) {
  console.log(
    "resolve-squashed-init: Init migration already applied (P3008 / finished). Continuing to migrate deploy."
  );
} else {
  console.error("resolve-squashed-init: prisma migrate resolve --applied failed:\n", applied.out);
  process.exit(applied.status);
}

run("apply any remaining migrations", "pnpm exec prisma migrate deploy");

console.log("\nresolve-squashed-init: done. Redeploy Vercel (or run pnpm db:migrate:deploy locally) to confirm.");
