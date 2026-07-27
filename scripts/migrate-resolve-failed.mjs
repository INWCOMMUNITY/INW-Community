#!/usr/bin/env node
/**
 * Resolve failed migrations by marking them as rolled back.
 * This script is run before `prisma migrate deploy` to clear any failed migration state.
 * 
 * Uses the same DATABASE_URL resolution logic as migrate-deploy.mjs.
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

let url = process.env.DATABASE_URL?.trim();
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
      break;
    }
  }
}

if (!url) {
  console.log("migrate-resolve-failed: No DATABASE_URL, skipping.");
  process.exit(0);
}

const migrateUrl = withLibpqMigrateOptions(resolveMigrateDatabaseUrl(url));
const dbDir = path.join(rootDir, "packages", "database");

// Check for failed migrations
const checkChild = spawn(
  "pnpm exec prisma migrate status --schema=prisma/schema.prisma",
  [],
  {
    cwd: dbDir,
    env: { ...process.env, DATABASE_URL: migrateUrl },
    shell: true,
    stdio: ["pipe", "pipe", "pipe"],
  }
);

let statusOutput = "";
checkChild.stdout?.on("data", (data) => {
  statusOutput += data.toString();
});
checkChild.stderr?.on("data", (data) => {
  statusOutput += data.toString();
});

checkChild.on("close", (code) => {
  // Look for failed migrations in the output
  const failedMatch = statusOutput.match(/The `([^`]+)` migration.*failed/);
  
  if (!failedMatch) {
    console.log("migrate-resolve-failed: No failed migrations found.");
    process.exit(0);
  }

  const failedMigration = failedMatch[1];
  console.log(`migrate-resolve-failed: Found failed migration: ${failedMigration}`);
  console.log(`migrate-resolve-failed: Marking as rolled back...`);

  // Mark the failed migration as rolled back
  const resolveChild = spawn(
    `pnpm exec prisma migrate resolve --rolled-back ${failedMigration}`,
    [],
    {
      cwd: dbDir,
      env: { ...process.env, DATABASE_URL: migrateUrl },
      stdio: "inherit",
      shell: true,
    }
  );

  resolveChild.on("close", (resolveCode) => {
    if (resolveCode === 0) {
      console.log(`migrate-resolve-failed: Successfully marked ${failedMigration} as rolled back.`);
    } else {
      console.error(`migrate-resolve-failed: Failed to resolve migration (exit code ${resolveCode}).`);
    }
    process.exit(resolveCode ?? 0);
  });
});
