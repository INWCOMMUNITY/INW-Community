import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { createHash } from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const require = createRequire(path.join(root, "packages/database/package.json"));
const { PrismaClient } = require("@prisma/client");

function loadEnv(filePath) {
  return Object.fromEntries(
    fs
      .readFileSync(filePath, "utf8")
      .split(/\r?\n/)
      .filter((l) => l && !l.startsWith("#") && l.includes("="))
      .map((l) => {
        const i = l.indexOf("=");
        return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, "")];
      })
  );
}

function variantFp(priceCents, sku) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        priceCents: Number.isFinite(priceCents) ? Math.trunc(priceCents) : 0,
        sku: typeof sku === "string" ? sku.trim() : "",
      }),
      "utf8"
    )
    .digest("hex");
}

function classify(base, local, remote, hasLocal) {
  if (local === remote) return base != null && local === base ? "UNCHANGED" : "CONVERGED";
  if (base == null) return hasLocal ? "CONFLICT" : "REMOTE_ONLY";
  if (local !== base && remote === base) return "LOCAL_ONLY";
  if (local === base && remote !== base) return "REMOTE_ONLY";
  return "CONFLICT";
}

const env = loadEnv(path.join(root, ".env"));
const db = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });

const rows = await db.$queryRawUnsafe(`
  SELECT
    si.title,
    si.price_cents AS item_price,
    sv.price_cents AS variant_price,
    sv.sku,
    sv.options,
    m.desired_variant_content_version AS vd,
    m.applied_variant_content_version AS va,
    m.desired_variant_fingerprint AS desired_fp,
    m.applied_variant_fingerprint AS applied_fp,
    m.last_observed_variant_fingerprint AS observed_fp,
    m.variant_content_conflict AS conflict,
    m.inventory_desired_available AS inv_d,
    m.inventory_applied_available AS inv_a,
    m.inventory_desired_version AS inv_dv,
    m.inventory_applied_version AS inv_av,
    m.last_observed_variant_updated_at AS observed_at,
    m.variant_content_applied_at AS content_applied_at,
    ell.issue_code,
    ell.updated_at AS link_updated
  FROM etsy_variant_map m
  JOIN etsy_listing_link ell ON ell.id = m.etsy_listing_link_id
  JOIN "StoreItem" si ON si.id = m.store_item_id
  JOIN store_variant sv ON sv.id = m.store_variant_id
  ORDER BY si.title, m.created_at
`);

for (const r of rows) {
  const localFp = variantFp(r.variant_price, r.sku);
  const desireAhead = r.vd > r.va;
  const localForClass = desireAhead ? r.desired_fp || localFp : localFp;
  const observed = r.observed_fp;
  const cls =
    observed == null
      ? "NO_OBSERVATION"
      : classify(r.applied_fp, localForClass, observed, desireAhead);

  const priceWouldApply = cls === "REMOTE_ONLY";
  const observedDiffersFromLocal = observed != null && observed !== localFp;
  const observedDiffersFromApplied = observed != null && observed !== r.applied_fp;

  console.log(
    JSON.stringify({
      title: r.title,
      options: r.options,
      itemPrice: r.item_price,
      variantPrice: r.variant_price,
      vd: r.vd,
      va: r.va,
      conflict: r.conflict,
      issue: r.issue_code,
      localFp: localFp.slice(0, 14),
      desiredFp: (r.desired_fp || "").slice(0, 14),
      appliedFp: (r.applied_fp || "").slice(0, 14),
      observedFp: (r.observed_fp || "").slice(0, 14),
      localEqDesired: localFp === r.desired_fp,
      localEqApplied: localFp === r.applied_fp,
      observedEqLocal: observed === localFp,
      observedEqApplied: observed === r.applied_fp,
      observedDiffersFromLocal,
      observedDiffersFromApplied,
      classIfObservedIsRemote: cls,
      priceWouldApply,
      inv: { d: r.inv_d, a: r.inv_a, dv: r.inv_dv, av: r.inv_av },
      observedAt: r.observed_at,
      contentAppliedAt: r.content_applied_at,
    })
  );
}

await db.$disconnect();
