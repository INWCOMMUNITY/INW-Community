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
console.log("migrate-deploy: Database host:", hostMatch ? hostMatch[1] : "(verify URL)");

const dbDir = path.join(rootDir, "packages", "database");
const child = spawn("pnpm exec prisma migrate deploy", [], {
  cwd: dbDir,
  env: { ...process.env, DATABASE_URL: url },
  stdio: "inherit",
  shell: true,
});

child.on("close", (code) => process.exit(code ?? 0));
