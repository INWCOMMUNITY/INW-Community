import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";

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

const env = loadEnv(path.join(root, ".env"));
const db = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });

const rows = await db.$queryRawUnsafe(`
  SELECT
    si.title,
    ell.product_content_conflict AS conflict,
    ell.desired_product_content_version AS d,
    ell.applied_product_content_version AS a,
    (ell.desired_product_fingerprint IS NOT DISTINCT FROM ell.applied_product_fingerprint) AS prod_fp_eq,
    (ell.last_observed_product_fingerprint IS NOT DISTINCT FROM ell.applied_product_fingerprint) AS obs_eq_applied,
    (SELECT COUNT(*)::int FROM etsy_variant_map m
      WHERE m.etsy_listing_link_id = ell.id AND m.variant_content_conflict) AS v_conflicts,
    (SELECT COUNT(*)::int FROM etsy_variant_map m
      WHERE m.etsy_listing_link_id = ell.id
        AND m.desired_variant_fingerprint IS DISTINCT FROM m.applied_variant_fingerprint) AS v_fp_diff,
    (SELECT COUNT(*)::int FROM etsy_variant_map m
      WHERE m.etsy_listing_link_id = ell.id
        AND m.inventory_desired_available IS DISTINCT FROM m.inventory_applied_available) AS inv_diff,
    (SELECT COUNT(*)::int FROM etsy_order_line_sale_fact f
      WHERE f.etsy_connection_id = ell.etsy_connection_id
        AND f.etsy_listing_id = ell.etsy_listing_id
        AND f.apply_state = 'PENDING') AS pending_sales
  FROM etsy_listing_link ell
  JOIN "StoreItem" si ON si.id = ell.store_item_id
  ORDER BY ell.updated_at DESC
`);
console.log(JSON.stringify(rows, null, 2));

const pendingJobs = await db.$queryRawUnsafe(`
  SELECT kind::text, state::text, COUNT(*)::int AS n
  FROM etsy_sync_job
  WHERE state IN ('PENDING','RUNNING','RETRY_WAIT')
  GROUP BY 1, 2
`);
console.log("OPEN_JOBS", JSON.stringify(pendingJobs, null, 2));

const recentPollPayload = await db.$queryRawUnsafe(`
  SELECT id, state::text, attempt_count, updated_at,
         LEFT(COALESCE(last_error_message,''), 200) AS err
  FROM etsy_sync_job
  WHERE kind = 'POLL_LISTING_CONTENT'
  ORDER BY updated_at DESC
  LIMIT 5
`);
console.log("RECENT_POLLS", JSON.stringify(recentPollPayload, null, 2));

await db.$disconnect();
