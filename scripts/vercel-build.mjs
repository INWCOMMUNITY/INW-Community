#!/usr/bin/env node
/**
 * Vercel / CI build entry from the monorepo root:
 * 1) `pnpm db:migrate:deploy` (Prisma against production DB — needs DATABASE_URL at build time)
 * 2) `pnpm --filter main build`
 *
 * If migrations are applied elsewhere (or DB is unavailable during build), set
 * SKIP_DB_MIGRATE_ON_VERCEL_BUILD=1 on Vercel — only the Next.js build runs.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function run(label, command) {
  console.log(`[vercel-build] ${label}: ${command}`);
  const r = spawnSync(command, {
    cwd: rootDir,
    shell: true,
    stdio: "inherit",
    env: process.env,
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

const skipRaw = String(process.env.SKIP_DB_MIGRATE_ON_VERCEL_BUILD ?? "").trim();
const skipMigrate = /^1|true|yes$/i.test(skipRaw);

if (skipMigrate) {
  console.warn(
    "[vercel-build] SKIP_DB_MIGRATE_ON_VERCEL_BUILD is set — skipping pnpm db:migrate:deploy. Apply migrations with pnpm db:migrate:deploy (or CI) before relying on new schema."
  );
} else {
  const dbUrl = process.env.DATABASE_URL?.trim();
  if (!dbUrl) {
    console.error(
      "[vercel-build] DATABASE_URL is not set in the build environment. Vercel cannot run prisma migrate deploy.\n" +
        "Fix: add DATABASE_URL for Production (and Preview if you build there), redeploy, or set SKIP_DB_MIGRATE_ON_VERCEL_BUILD=1 if you run migrations separately."
    );
    process.exit(1);
  }
  run("migrate", "pnpm db:migrate:deploy");
}

run("next", "pnpm --filter main build");
