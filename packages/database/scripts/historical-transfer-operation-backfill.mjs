/**
 * Historical TransferOperation hybrid backfill CLI.
 *
 * DEFAULT: PREVIEW ONLY.
 * Production APPLY is intentionally hard-refused in this runner.
 * Disposable APPLY is performed only via unit/integration tests calling
 * `applyHistoricalTransferOperationBackfill` directly.
 *
 * Required for any future authorized production APPLY (not enabled here):
 *   --apply --production --confirm=HISTORICAL_TO_BACKFILL_APPLY
 *   --cutover-mode=LEGACY|FROZEN
 *   --order-ids=id1,id2
 *   --manifest-hash=<preview candidateHash>
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CONFIRM_TOKEN = "HISTORICAL_TO_BACKFILL_APPLY";
const ALLOWED_CUTOVER = new Set(["LEGACY", "FROZEN"]);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = path.resolve(ROOT, "../..");

function parseArgs(argv) {
  const flags = new Set();
  const opts = {};
  for (const a of argv) {
    if (!a.startsWith("--")) continue;
    const eq = a.indexOf("=");
    if (eq === -1) flags.add(a.slice(2));
    else opts[a.slice(2, eq)] = a.slice(eq + 1);
  }
  return { flags, opts };
}

function main() {
  const { flags, opts } = parseArgs(process.argv.slice(2));
  const wantApply = flags.has("apply");
  const wantProduction = flags.has("production");
  const confirm = opts.confirm || "";
  const cutoverMode = opts["cutover-mode"] || "";
  const orderIds = opts["order-ids"] || "";
  const manifestHash = opts["manifest-hash"] || "";

  if (!wantApply) {
    console.log(
      JSON.stringify(
        {
          mode: "PREVIEW_REQUIRED",
          message:
            "Default is preview-only. Invoke analyzeHistoricalTransferOperationBackfill via tests or a controlled TS entrypoint with DATABASE_URL pointing at disposable Postgres. This CLI does not mutate.",
          hint: "Pass --apply only with full production guards (still refused here).",
        },
        null,
        2
      )
    );
    process.exit(0);
  }

  // APPLY path — refuse unless every guard is present, then still refuse production mutation.
  if (!wantProduction) {
    console.error("APPLY refused: --apply without --production");
    process.exit(2);
  }
  if (confirm !== CONFIRM_TOKEN) {
    console.error("APPLY refused: missing --confirm=" + CONFIRM_TOKEN);
    process.exit(2);
  }
  if (!ALLOWED_CUTOVER.has(cutoverMode)) {
    console.error("APPLY refused: --cutover-mode must be LEGACY or FROZEN");
    process.exit(2);
  }
  if (!orderIds.trim()) {
    console.error("APPLY refused: --order-ids required");
    process.exit(2);
  }
  if (!manifestHash.trim()) {
    console.error("APPLY refused: --manifest-hash required");
    process.exit(2);
  }

  console.error(
    "APPLY refused: production historical TO backfill APPLY is disabled in this runner. Use authorized future prompt only."
  );
  process.exit(3);
}

main();
