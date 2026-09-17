/**
 * Isolated delete-safety FK test: temp-copy migrations, one known historical
 * replay patch, prisma migrate deploy against disposable localhost Docker Postgres.
 * Never mutates tracked migrations. Never uses production URLs.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import {
  copyFileSync,
  cpSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = path.resolve(ROOT, "../..");
const PRISMA_DIR = path.join(ROOT, "prisma");
const SRC_SCHEMA = path.join(PRISMA_DIR, "schema.prisma");
const SRC_MIGRATIONS = path.join(PRISMA_DIR, "migrations");
const TRACKED_SHARE_REL =
  "packages/database/prisma/migrations/20260604120000_content_share_event/migration.sql";
const TRACKED_SHARE_SQL = path.join(REPO_ROOT, TRACKED_SHARE_REL);
const SHARE_MIGRATION = "20260604120000_content_share_event";
const DELETE_SAFETY = "20260916210000_commerce_foundation_delete_safety";
const M1 = "20260916221500_commerce_foundation_m1";
const MARKETPLACE_V2 = "20260916010000_marketplace_sync_v2";
const EXPECTED_SHARE_SHA256 =
  "d1f89b47101f513809c3e23541019bfe52e23dcea9616eadad68dc095fda1e6f";
const BAD_FRAGMENT = `REFERENCES "member"("id")`;
const GOOD_FRAGMENT = `REFERENCES "Member"("id")`;

const CONTAINER = "inw-delete-safety-pg-test";
const PORT = process.env.DELETE_SAFETY_TEST_PG_PORT?.trim() || "55433";
const USER = "inw_delete_safety";
const PASSWORD = "inw_delete_safety_pw";
const DB = "inw_delete_safety_test";
const TEST_DATABASE_URL = `postgresql://${USER}:${PASSWORD}@127.0.0.1:${PORT}/${DB}`;
const REMOTE_HINT = /neon|amazonaws|railway|vercel|render\.com|supabase|psdb\.cloud|db\.prisma/i;

function sha256File(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function countFragment(haystack, needle) {
  return haystack.split(needle).length - 1;
}

function run(cmd, args, env = {}) {
  const result = spawnSync(cmd, args, {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, ...env },
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")}\n${result.stdout || ""}\n${result.stderr || ""}`);
  }
  return result.stdout || "";
}

function docker(args) {
  return run("docker", args);
}

function assertLocal(url) {
  if (REMOTE_HINT.test(url)) throw new Error("Refusing remote-looking DATABASE_URL.");
  const parsed = new URL(url);
  if (!["127.0.0.1", "localhost", "::1"].includes(parsed.hostname)) {
    throw new Error(`Refusing non-local host: ${parsed.hostname}`);
  }
}

function sleep(ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    /* busy wait: no Atomics.wait (SAB may be blocked) */
  }
}

function waitReady() {
  for (let i = 0; i < 40; i += 1) {
    const probe = spawnSync(
      "docker",
      ["exec", CONTAINER, "pg_isready", "-U", USER, "-d", DB],
      { encoding: "utf8", shell: process.platform === "win32" }
    );
    if (probe.status === 0) return;
    sleep(500);
  }
  throw new Error("Postgres did not become ready");
}

function startPostgres() {
  spawnSync("docker", ["rm", "-f", CONTAINER], { encoding: "utf8", shell: process.platform === "win32" });
  docker([
    "run",
    "-d",
    "--name",
    CONTAINER,
    "-e",
    `POSTGRES_USER=${USER}`,
    "-e",
    `POSTGRES_PASSWORD=${PASSWORD}`,
    "-e",
    `POSTGRES_DB=${DB}`,
    "-p",
    `${PORT}:5432`,
    "postgres:16-alpine",
  ]);
  waitReady();
}

function stopPostgres() {
  spawnSync("docker", ["rm", "-f", CONTAINER], { encoding: "utf8", shell: process.platform === "win32" });
}

async function main() {
  assertLocal(TEST_DATABASE_URL);
  const trackedHash = sha256File(TRACKED_SHARE_SQL);
  if (trackedHash !== EXPECTED_SHARE_SHA256) {
    throw new Error(`Tracked share-event checksum ${trackedHash} !== ${EXPECTED_SHARE_SHA256}`);
  }

  const names = readdirSync(SRC_MIGRATIONS);
  if (names.includes(M1) || names.some((n) => n.includes("marketplace_sync_v2"))) {
    throw new Error("Hotfix branch unexpectedly contains M1 or marketplace-v2");
  }
  if (!names.includes(DELETE_SAFETY)) {
    throw new Error(`Missing ${DELETE_SAFETY}`);
  }

  const replayDir = mkdtempSync(path.join(tmpdir(), "inw-delete-safety-replay-"));
  copyFileSync(SRC_SCHEMA, path.join(replayDir, "schema.prisma"));
  cpSync(SRC_MIGRATIONS, path.join(replayDir, "migrations"), { recursive: true });

  const tempSql = path.join(replayDir, "migrations", SHARE_MIGRATION, "migration.sql");
  const original = readFileSync(tempSql, "utf8");
  if (countFragment(original, BAD_FRAGMENT) !== 1) {
    throw new Error(`Known replay exception must occur exactly once, found ${countFragment(original, BAD_FRAGMENT)}`);
  }
  const patched = original.replace(BAD_FRAGMENT, GOOD_FRAGMENT);
  writeFileSync(tempSql, patched, "utf8");

  startPostgres();
  try {
    console.log("[delete-safety-int] prisma migrate deploy");
    run("pnpm", ["exec", "prisma", "migrate", "deploy", "--schema", path.join(replayDir, "schema.prisma")], {
      DATABASE_URL: TEST_DATABASE_URL,
    });

    const requireFromDb = createRequire(path.join(ROOT, "package.json"));
    const { PrismaClient } = requireFromDb("@prisma/client");
    const prisma = new PrismaClient({
      datasources: { db: { url: TEST_DATABASE_URL } },
      log: ["error"],
    });
    try {
      const seller = await prisma.member.create({
        data: {
          email: "delete-safety-seller@test.local",
          passwordHash: "x",
          firstName: "Seller",
          lastName: "Test",
        },
      });
      const buyer = await prisma.member.create({
        data: {
          email: "delete-safety-buyer@test.local",
          passwordHash: "x",
          firstName: "Buyer",
          lastName: "Test",
        },
      });
      const item = await prisma.storeItem.create({
        data: {
          memberId: seller.id,
          title: "History listing",
          slug: `delete-safety-${Date.now()}`,
          priceCents: 1000,
          photos: [],
          quantity: 1,
        },
      });
      const order = await prisma.storeOrder.create({
        data: {
          buyerId: buyer.id,
          sellerId: seller.id,
          totalCents: 1000,
          subtotalCents: 1000,
        },
      });
      const line = await prisma.orderItem.create({
        data: {
          orderId: order.id,
          storeItemId: item.id,
          quantity: 1,
          priceCentsAtPurchase: 1000,
        },
      });

      let rejected = false;
      try {
        await prisma.storeItem.delete({ where: { id: item.id } });
      } catch (err) {
        const msg = String(err?.message || err);
        if (/P2003|23503|restrict|foreign key/i.test(msg)) rejected = true;
        else throw err;
      }
      if (!rejected) throw new Error("Expected StoreItem delete to be rejected");

      const stillItem = await prisma.storeItem.findUnique({ where: { id: item.id } });
      const stillLine = await prisma.orderItem.findUnique({ where: { id: line.id } });
      if (!stillItem) throw new Error("StoreItem was deleted");
      if (!stillLine) throw new Error("OrderItem was deleted");
      console.log("[delete-safety-int] PASS: StoreItem delete RESTRICT; OrderItem retained");
    } finally {
      await prisma.$disconnect();
    }
  } finally {
    stopPostgres();
    rmSync(replayDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error("[delete-safety-int] FAIL", err);
  process.exit(1);
});
