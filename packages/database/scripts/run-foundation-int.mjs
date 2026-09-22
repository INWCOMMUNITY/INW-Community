/**
 * Foundation integration tests: copy Prisma history to an ephemeral directory,
 * apply one fail-closed test-only replay patch, then `prisma migrate deploy`
 * against disposable localhost Docker Postgres.
 * Never mutates tracked migrations. Never uses production URLs.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
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
const REMOVE_CHANNEL_SYNC = "20260916000000_remove_channel_sync";
const MARKETPLACE_V2 = "20260916010000_marketplace_sync_v2";
const M1_MIGRATION = "20260916221500_commerce_foundation_m1";
const M2_MIGRATION = "20260916233000_commerce_foundation_m2";
const M3_MIGRATION = "20260916234500_commerce_foundation_m3";
const MEMBER_DELETE_SAFETY = "20260917140000_member_delete_safety";
const CUTOVER_STATE = "20260918183000_commerce_foundation_cutover_state";
const SELLER_RETURN_ENTITLEMENT = "20260921220000_seller_return_entitlement_operation";
const EXPECTED_SHARE_SHA256 =
  "d1f89b47101f513809c3e23541019bfe52e23dcea9616eadad68dc095fda1e6f";
const BAD_FRAGMENT = `REFERENCES "member"("id")`;
const GOOD_FRAGMENT = `REFERENCES "Member"("id")`;

const CONTAINER = "inw-foundation-pg-test";
const PORT = process.env.FOUNDATION_TEST_PG_PORT?.trim() || "55432";
const USER = "inw_foundation";
const PASSWORD = "inw_foundation_pw";
const DB = "inw_foundation_test";
const TEST_DATABASE_URL = `postgresql://${USER}:${PASSWORD}@127.0.0.1:${PORT}/${DB}`;

const REMOTE_HINT = /neon|amazonaws|railway|vercel|render\.com|supabase|psdb\.cloud|db\.prisma/i;

function assertLocal(url) {
  if (REMOTE_HINT.test(url)) {
    throw new Error("Refusing remote-looking DATABASE_URL.");
  }
  const parsed = new URL(url);
  if (!["127.0.0.1", "localhost", "::1"].includes(parsed.hostname)) {
    throw new Error(`Refusing non-local host: ${parsed.hostname}`);
  }
}

function refuseInheritedRemoteUrls() {
  for (const key of ["DATABASE_URL", "FOUNDATION_TEST_DATABASE_URL", "DATABASE_URL_PRODUCTION"]) {
    const value = process.env[key];
    if (!value) continue;
    if (REMOTE_HINT.test(value) || key === "DATABASE_URL_PRODUCTION") {
      console.log(`[foundation-int] ignoring inherited ${key} (not used for disposable Postgres)`);
    }
  }
}

function sha256File(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function countFragment(haystack, needle) {
  if (!needle) return 0;
  return haystack.split(needle).length - 1;
}

function assertTrackedShareChecksum(when) {
  const actual = sha256File(TRACKED_SHARE_SQL);
  if (actual !== EXPECTED_SHARE_SHA256) {
    throw new Error(
      `Known replay exception must be re-audited (${when}). ` +
        `Tracked ${SHARE_MIGRATION} checksum ${actual} !== ${EXPECTED_SHARE_SHA256}.`
    );
  }
  return actual;
}

function assertTrackedShareUnchangedInGit() {
  const result = spawnSync(
    "git",
    ["diff", "--", TRACKED_SHARE_REL],
    { cwd: REPO_ROOT, encoding: "utf8" }
  );
  if (result.status !== 0) {
    throw new Error(`git diff failed for ${TRACKED_SHARE_REL}: ${result.stderr || result.stdout}`);
  }
  if (result.stdout.trim()) {
    throw new Error(`Tracked historical migration was modified:\n${result.stdout}`);
  }
}

function childEnv(extra = {}) {
  const env = {
    ...process.env,
    ...extra,
    DATABASE_URL: TEST_DATABASE_URL,
    FOUNDATION_TEST_DATABASE_URL: TEST_DATABASE_URL,
  };
  delete env.DATABASE_URL_PRODUCTION;
  return env;
}

function run(cmd, args, extraEnv = {}) {
  const result = spawnSync(cmd, args, {
    cwd: ROOT,
    env: childEnv(extraEnv),
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} exited ${result.status}`);
  }
}

function docker(args, opts = {}) {
  const result = spawnSync("docker", args, {
    encoding: "utf8",
    stdio: opts.input ? ["pipe", "pipe", "pipe"] : "pipe",
    input: opts.input,
  });
  if (result.status !== 0) {
    throw new Error(`docker ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

function psql(sql) {
  return docker(["exec", CONTAINER, "psql", "-U", USER, "-d", DB, "-v", "ON_ERROR_STOP=1", "-tAc", sql]).trim();
}

function waitReady() {
  for (let i = 0; i < 40; i++) {
    const ping = spawnSync(
      "docker",
      ["exec", CONTAINER, "pg_isready", "-U", USER, "-d", DB],
      { encoding: "utf8" }
    );
    if (ping.status === 0) return;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
  }
  throw new Error("Postgres container did not become ready");
}

function startContainer() {
  spawnSync("docker", ["rm", "-f", CONTAINER], { stdio: "ignore" });
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

function createReplayCopy() {
  const replayDir = mkdtempSync(path.join(tmpdir(), "inw-foundation-replay-"));
  copyFileSync(SRC_SCHEMA, path.join(replayDir, "schema.prisma"));
  cpSync(SRC_MIGRATIONS, path.join(replayDir, "migrations"), { recursive: true });
  return replayDir;
}

function assertNoMarketplaceV2OnDisk(migrationsDir) {
  const names = readdirSync(migrationsDir);
  const hit = names.find((name) => name.includes("marketplace_sync_v2") || name.includes("marketplace-v2"));
  if (hit) {
    throw new Error(`marketplace-v2 migration appeared in replay copy: ${hit}`);
  }
}

function patchShareMigrationCopy(replayDir) {
  const tempSql = path.join(replayDir, "migrations", SHARE_MIGRATION, "migration.sql");
  const copyHash = sha256File(tempSql);
  if (copyHash !== EXPECTED_SHARE_SHA256) {
    throw new Error(
      `Replay copy checksum ${copyHash} !== tracked ${EXPECTED_SHARE_SHA256}; refusing to patch.`
    );
  }

  const original = readFileSync(tempSql, "utf8");
  const badCount = countFragment(original, BAD_FRAGMENT);
  if (badCount !== 1) {
    throw new Error(
      `Known replay exception must be re-audited: ${BAD_FRAGMENT} occurs ${badCount} time(s), expected 1.`
    );
  }

  console.log(`Applying known test-only migration replay patch: ${SHARE_MIGRATION}`);
  const patched = original.replace(BAD_FRAGMENT, GOOD_FRAGMENT);
  if (countFragment(patched, BAD_FRAGMENT) !== 0 || countFragment(patched, GOOD_FRAGMENT) !== 1) {
    throw new Error("Test-only replay patch did not yield exactly one corrected FK fragment.");
  }
  writeFileSync(tempSql, patched, "utf8");
}

function assertAppliedMigrations() {
  const names = psql("SELECT migration_name FROM _prisma_migrations ORDER BY started_at, migration_name");
  console.log("[foundation-int] applied migrations:\n" + names);

  const finished = psql(
    "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL"
  );
  for (const name of [
    SHARE_MIGRATION,
    REMOVE_CHANNEL_SYNC,
    M1_MIGRATION,
    M2_MIGRATION,
    M3_MIGRATION,
    MEMBER_DELETE_SAFETY,
    CUTOVER_STATE,
    SELLER_RETURN_ENTITLEMENT,
  ]) {
    if (!finished.split(/\s+/).includes(name)) {
      throw new Error(`Expected finished migration ${name} in disposable _prisma_migrations`);
    }
  }
  if (names.includes(MARKETPLACE_V2)) {
    throw new Error("marketplace-v2 migration unexpectedly applied");
  }
}

function assertM1Catalog() {
  const tables = psql(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename IN ('store_variant','inventory_state','inventory_event','variant_backfill_map') ORDER BY 1"
  ).split(/\s+/).filter(Boolean);
  const expectedTables = ["inventory_event", "inventory_state", "store_variant", "variant_backfill_map"];
  if (tables.join(",") !== expectedTables.join(",")) {
    throw new Error(`M1 tables missing after migrate deploy: ${tables.join(",") || "(none)"}`);
  }

  const versions = psql(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'StoreItem'
       AND column_name IN ('content_version','lifecycle_version')
     ORDER BY 1`
  );
  if (!versions.includes("content_version") || !versions.includes("lifecycle_version")) {
    throw new Error("StoreItem semantic version columns missing after migrate deploy");
  }

  const nullability = psql(
    `SELECT table_name || '=' || is_nullable
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND ((table_name = 'CartItem' AND column_name = 'variant_id')
         OR (table_name = 'OrderItem' AND column_name = 'variant_id'))
     ORDER BY 1`
  );
  if (!nullability.includes("CartItem=YES") || !nullability.includes("OrderItem=YES")) {
    throw new Error(`CartItem/OrderItem.variant_id not nullable after migrate deploy: ${nullability}`);
  }

  const indexes = psql(
    `SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname IN (
       'store_variant_one_default_per_item',
       'inventory_event_causal_key',
       'store_variant_id_store_item_id_member_id_key'
     ) ORDER BY 1`
  );
  for (const name of [
    "inventory_event_causal_key",
    "store_variant_id_store_item_id_member_id_key",
    "store_variant_one_default_per_item",
  ]) {
    if (!indexes.includes(name)) {
      throw new Error(`Missing M1 index after migrate deploy: ${name}`);
    }
  }

  const checks = psql(
    `SELECT conname FROM pg_constraint WHERE contype = 'c' AND conname IN (
       'inventory_state_mode_qty_check',
       'StoreItem_content_version_check',
       'StoreItem_lifecycle_version_check'
     ) ORDER BY 1`
  );
  for (const name of [
    "StoreItem_content_version_check",
    "StoreItem_lifecycle_version_check",
    "inventory_state_mode_qty_check",
  ]) {
    if (!checks.includes(name)) {
      throw new Error(`Missing M1 CHECK after migrate deploy: ${name}`);
    }
  }

  const fks = psql(
    `SELECT conname FROM pg_constraint WHERE contype = 'f' AND conname IN (
       'CartItem_variant_id_store_item_id_fkey',
       'OrderItem_variant_id_store_item_id_fkey',
       'inventory_state_variant_id_store_item_id_member_id_fkey',
       'inventory_event_variant_id_store_item_id_member_id_fkey',
       'store_variant_store_item_id_member_id_fkey'
     ) ORDER BY 1`
  );
  for (const name of [
    "CartItem_variant_id_store_item_id_fkey",
    "OrderItem_variant_id_store_item_id_fkey",
    "inventory_event_variant_id_store_item_id_member_id_fkey",
    "inventory_state_variant_id_store_item_id_member_id_fkey",
    "store_variant_store_item_id_member_id_fkey",
  ]) {
    if (!fks.includes(name)) {
      throw new Error(`Missing M1 FK after migrate deploy: ${name}`);
    }
  }
}

function assertM2Catalog() {
  const tables = psql(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename IN ('checkout_attempt','inventory_reservation') ORDER BY 1"
  )
    .split(/\s+/)
    .filter(Boolean);
  if (tables.join(",") !== "checkout_attempt,inventory_reservation") {
    throw new Error(`M2 tables missing after migrate deploy: ${tables.join(",") || "(none)"}`);
  }

  const commerce = psql(
    `SELECT is_nullable || ':' || column_default
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'StoreOrder' AND column_name = 'commerce_status'`
  );
  if (!commerce.includes("NO:") || !commerce.includes("PENDING")) {
    throw new Error(`StoreOrder.commerce_status missing default PENDING: ${commerce}`);
  }

  const checks = psql(
    "SELECT conname FROM pg_constraint WHERE contype = 'c' AND conname = 'inventory_reservation_qty_check'"
  );
  if (!checks.includes("inventory_reservation_qty_check")) {
    throw new Error("Missing inventory_reservation_qty_check after migrate deploy");
  }

  for (const name of [
    "inventory_reservation_variant_id_store_item_id_member_id_fkey",
    "inventory_reservation_store_order_id_checkout_attempt_id_fkey",
    "inventory_reservation_store_order_id_member_id_fkey",
    "inventory_reservation_order_item_id_store_order_id_fkey",
    "inventory_reservation_line_variant_listing_fkey",
    "inventory_event_reservation_id_fkey",
  ]) {
    const found = psql(`SELECT conname FROM pg_constraint WHERE contype = 'f' AND conname = '${name}'`);
    if (!found.includes(name)) {
      throw new Error(`Missing M2 FK after migrate deploy: ${name}`);
    }
  }

  const partial = psql(
    "SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'inventory_reservation_active_expires_at_idx'"
  );
  if (!partial.includes("inventory_reservation_active_expires_at_idx")) {
    throw new Error("Missing active-reservation expiresAt partial index after migrate deploy");
  }
}

function assertMemberDeleteSafetyCatalog() {
  const closed = psql(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'Member'
       AND column_name IN ('closed_at','auth_epoch')
     ORDER BY 1`
  );
  if (!closed.includes("auth_epoch") || !closed.includes("closed_at")) {
    throw new Error("Member closed_at/auth_epoch missing after migrate deploy");
  }
  for (const name of [
    "StoreOrder_buyer_id_fkey",
    "StoreOrder_seller_id_fkey",
    "StoreItem_member_id_fkey",
    "SellerBalance_member_id_fkey",
    "SellerBalanceTransaction_member_id_fkey",
  ]) {
    const row = psql(
      `SELECT conname || '=' || CASE confdeltype WHEN 'r' THEN 'RESTRICT' ELSE confdeltype::text END
       FROM pg_constraint WHERE conname = '${name}'`
    );
    if (!row.includes(`${name}=RESTRICT`)) {
      throw new Error(`Expected ${name} ON DELETE RESTRICT after member-delete-safety, got: ${row || "(missing)"}`);
    }
  }
}

function assertCutoverCatalog() {
  const tables = psql(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename = 'commerce_foundation_cutover'"
  );
  if (!tables.includes("commerce_foundation_cutover")) {
    throw new Error("commerce_foundation_cutover table missing after migrate deploy");
  }
  const check = psql(
    "SELECT conname FROM pg_constraint WHERE contype = 'c' AND conname = 'commerce_foundation_cutover_singleton_id_check'"
  );
  if (!check.includes("commerce_foundation_cutover_singleton_id_check")) {
    throw new Error("cutover singleton CHECK missing after migrate deploy");
  }
  const row = psql(`SELECT id || '=' || mode FROM commerce_foundation_cutover`);
  if (!row.includes("singleton=LEGACY")) {
    throw new Error(`Expected singleton LEGACY cutover row, got: ${row || "(none)"}`);
  }
  const extra = psql("SELECT COUNT(*)::text FROM commerce_foundation_cutover");
  if (!extra.trim().split(/\s+/).includes("1")) {
    throw new Error(`Expected exactly one cutover row, got: ${extra}`);
  }
}

function assertSellerReturnEntitlementCatalog() {
  const tables = psql(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename = 'seller_return_entitlement_operation'"
  );
  if (!tables.includes("seller_return_entitlement_operation")) {
    throw new Error("seller_return_entitlement_operation table missing after migrate deploy");
  }

  for (const name of ["sreo_amount_positive_check", "sreo_retry_nonnegative_check"]) {
    const found = psql(`SELECT conname FROM pg_constraint WHERE contype = 'c' AND conname = '${name}'`);
    if (!found.includes(name)) {
      throw new Error(`Missing seller-return-entitlement CHECK after migrate deploy: ${name}`);
    }
  }

  for (const name of [
    "sreo_store_order_id_key",
    "sreo_store_return_id_key",
    "sreo_provider_idempotency_key_key",
    "sreo_stripe_transfer_id_key",
    "sreo_status_created_at_idx",
    "StoreReturn_id_order_id_key",
  ]) {
    const found = psql(`SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname = '${name}'`);
    if (!found.includes(name)) {
      throw new Error(`Missing seller-return-entitlement index after migrate deploy: ${name}`);
    }
  }

  for (const name of [
    "sreo_member_id_fkey",
    "sreo_store_order_id_fkey",
    "sreo_store_return_id_fkey",
    "sreo_store_order_id_member_id_fkey",
    "sreo_store_return_id_store_order_id_fkey",
  ]) {
    const row = psql(
      `SELECT conname || '=' || CASE confdeltype WHEN 'r' THEN 'RESTRICT' ELSE confdeltype::text END
       FROM pg_constraint WHERE contype = 'f' AND conname = '${name}'`
    );
    if (!row.includes(`${name}=RESTRICT`)) {
      throw new Error(`Expected ${name} ON DELETE RESTRICT after seller-return-entitlement, got: ${row || "(missing)"}`);
    }
  }
}

function assertM3Catalog() {
  const tables = psql(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename IN ('stripe_event_evidence','refund_operation','transfer_operation') ORDER BY 1"
  )
    .split(/\s+/)
    .filter(Boolean);
  if (tables.join(",") !== "refund_operation,stripe_event_evidence,transfer_operation") {
    throw new Error(`M3 tables missing after migrate deploy: ${tables.join(",") || "(none)"}`);
  }

  for (const name of [
    "refund_operation_amount_positive_check",
    "transfer_operation_amount_positive_check",
  ]) {
    const found = psql(`SELECT conname FROM pg_constraint WHERE contype = 'c' AND conname = '${name}'`);
    if (!found.includes(name)) {
      throw new Error(`Missing M3 CHECK after migrate deploy: ${name}`);
    }
  }

  for (const name of [
    "refund_operation_store_order_id_member_id_fkey",
    "refund_operation_order_item_id_store_order_id_fkey",
    "refund_operation_store_order_id_checkout_attempt_id_fkey",
    "transfer_operation_store_order_id_member_id_fkey",
    "stripe_event_evidence_checkout_attempt_id_fkey",
  ]) {
    const found = psql(`SELECT conname FROM pg_constraint WHERE contype = 'f' AND conname = '${name}'`);
    if (!found.includes(name)) {
      throw new Error(`Missing M3 FK after migrate deploy: ${name}`);
    }
  }
}

refuseInheritedRemoteUrls();
assertLocal(TEST_DATABASE_URL);
console.log("[foundation-int] using", TEST_DATABASE_URL.replace(PASSWORD, "***"));

const trackedHash = assertTrackedShareChecksum("before replay");
console.log("[foundation-int] tracked", SHARE_MIGRATION, "sha256", trackedHash);

let started = false;
let replayDir = null;
try {
  replayDir = createReplayCopy();
  console.log("[foundation-int] replay copy", replayDir);
  assertNoMarketplaceV2OnDisk(path.join(replayDir, "migrations"));
  patchShareMigrationCopy(replayDir);
  assertTrackedShareChecksum("after copy patch");

  console.log("[foundation-int] starting disposable Postgres");
  startContainer();
  started = true;

  const schemaPath = path.join(replayDir, "schema.prisma");
  console.log("[foundation-int] prisma migrate deploy --schema <temp replay copy>");
  run("pnpm", ["exec", "prisma", "migrate", "deploy", "--schema", schemaPath]);

  assertAppliedMigrations();
  assertM1Catalog();
  assertM2Catalog();
  assertM3Catalog();
  assertMemberDeleteSafetyCatalog();
  assertCutoverCatalog();
  assertSellerReturnEntitlementCatalog();
  assertTrackedShareChecksum("after migrate deploy");

  run("pnpm", ["exec", "prisma", "generate"]);
  console.log("[foundation-int] vitest against migrate-deploy database");
  run("pnpm", ["exec", "vitest", "run", "--config", "vitest.config.ts"]);

  assertTrackedShareChecksum("after tests");
  assertTrackedShareUnchangedInGit();
  console.log("[foundation-int] tracked historical migration unchanged");
} finally {
  if (started) {
    console.log("[foundation-int] removing container", CONTAINER);
    spawnSync("docker", ["rm", "-f", CONTAINER], { stdio: "ignore" });
  }
  if (replayDir) {
    console.log("[foundation-int] removing replay copy");
    rmSync(replayDir, { recursive: true, force: true });
  }
}
