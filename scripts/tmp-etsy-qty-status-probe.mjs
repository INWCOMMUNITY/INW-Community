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

const maps = await db.$queryRawUnsafe(`
  SELECT si.title,
         m.id AS map_id,
         m.inventory_desired_version AS inv_dv,
         m.inventory_applied_version AS inv_av,
         m.inventory_desired_available AS inv_d,
         m.inventory_applied_available AS inv_a,
         m.etsy_offering_id,
         m.store_variant_id,
         ist.on_hand,
         ist.reserved,
         ell.inventory_health::text AS inv_health,
         ell.content_health::text AS content_health,
         ell.issue_code,
         LEFT(COALESCE(ell.issue_message, ''), 160) AS issue,
         ell.desired_product_content_version AS d,
         ell.applied_product_content_version AS a
  FROM etsy_variant_map m
  JOIN etsy_listing_link ell ON ell.id = m.etsy_listing_link_id
  JOIN "StoreItem" si ON si.id = m.store_item_id
  LEFT JOIN inventory_state ist ON ist.variant_id = m.store_variant_id
  ORDER BY si.title, m.created_at
`);
console.log("MAPS", JSON.stringify(maps, null, 2));

const jobs = await db.$queryRawUnsafe(`
  SELECT kind::text, state::text, attempt_count, updated_at,
         LEFT(COALESCE(last_error_code, ''), 40) AS code,
         LEFT(COALESCE(last_error_message, ''), 180) AS err,
         dedupe_key
  FROM etsy_sync_job
  WHERE kind IN ('PROJECT_INVENTORY', 'UPDATE_LISTING_CONTENT', 'POLL_LISTING_CONTENT', 'RECONCILE_LISTING')
  ORDER BY updated_at DESC
  LIMIT 25
`);
console.log("RECENT", JSON.stringify(jobs, null, 2));

const open = await db.$queryRawUnsafe(`
  SELECT kind::text, state::text, COUNT(*)::int AS n,
         MAX(updated_at) AS newest
  FROM etsy_sync_job
  WHERE state IN ('PENDING', 'RUNNING', 'RETRY_WAIT')
  GROUP BY 1, 2
`);
console.log("OPEN", JSON.stringify(open, null, 2));

const deadInv = await db.$queryRawUnsafe(`
  SELECT kind::text, state::text, updated_at,
         LEFT(COALESCE(last_error_message, ''), 200) AS err,
         dedupe_key
  FROM etsy_sync_job
  WHERE kind = 'PROJECT_INVENTORY'
  ORDER BY updated_at DESC
  LIMIT 10
`);
console.log("PROJECT_INV", JSON.stringify(deadInv, null, 2));

const conn = await db.etsyConnection.findFirst({
  where: { status: "ACTIVE" },
  select: {
    id: true,
    listingContentLastPolledAt: true,
    listingContentPollLeaseExpiresAt: true,
    accessTokenExpiresAt: true,
  },
});
console.log("CONN", JSON.stringify(conn, null, 2));

await db.$disconnect();
