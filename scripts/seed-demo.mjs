#!/usr/bin/env node
/**
 * Run prisma seed with SEED_DEMO_DATA=1 (sponsors, sample businesses, test accounts, fixtures).
 * Usage: pnpm db:seed:demo
 */
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import path from "path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.env.SEED_DEMO_DATA = "1";
const r = spawnSync("pnpm", ["--filter", "database", "seed"], {
  cwd: root,
  stdio: "inherit",
  shell: true,
  env: { ...process.env, SEED_DEMO_DATA: "1" },
});
process.exit(r.status ?? 1);
