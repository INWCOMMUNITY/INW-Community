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

const jobs = await db.$queryRawUnsafe(`
  SELECT kind::text AS kind, state::text AS state, attempts, error_code, error_message,
         created_at, started_at, finished_at, dedupe_key,
         left(payload::text, 220) AS payload_head
  FROM etsy_sync_job
  WHERE created_at > NOW() - INTERVAL '8 hours'
  ORDER BY created_at DESC
  LIMIT 100
`);
console.log("=== recent jobs ===");
for (const j of jobs) console.log(JSON.stringify(j));

const links = await db.$queryRawUnsafe(`
  SELECT si.title, si.price_cents AS item_price,
         ell.desired_product_content_version AS pd,
         ell.applied_product_content_version AS pa,
         ell.issue_code, ell.issue_message, ell.content_health::text AS content_health,
         ell.readiness::text AS readiness,
         ell.updated_at,
         (SELECT COUNT(*)::int FROM store_variant sv WHERE sv."storeItemId" = si.id AND sv.status = 'ACTIVE') AS active_variants,
         (SELECT MIN(sv.price_cents) FROM store_variant sv WHERE sv."storeItemId" = si.id AND sv.status = 'ACTIVE') AS min_vp,
         (SELECT MAX(sv.price_cents) FROM store_variant sv WHERE sv."storeItemId" = si.id AND sv.status = 'ACTIVE') AS max_vp
  FROM etsy_listing_link ell
  JOIN "StoreItem" si ON si.id = ell.store_item_id
  ORDER BY si.title
`);
console.log("\n=== listing summary ===");
for (const r of links) console.log(JSON.stringify(r));

const variantTouch = await db.$queryRawUnsafe(`
  SELECT si.title, sv.options, sv.price_cents, sv."updatedAt" AS sv_updated,
         inv.updated_at AS inv_updated, inv.on_hand, inv.reserved,
         m.last_observed_variant_updated_at, m.variant_content_applied_at,
         m.inventory_applied_at
  FROM etsy_variant_map m
  JOIN "StoreItem" si ON si.id = m.store_item_id
  JOIN store_variant sv ON sv.id = m.store_variant_id
  LEFT JOIN inventory_state inv ON inv.store_variant_id = sv.id
  ORDER BY si.title, sv."updatedAt" DESC
`);
console.log("\n=== variant touch times ===");
for (const r of variantTouch) console.log(JSON.stringify(r));

await db.$disconnect();
