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
const prisma = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });

const open = await prisma.$queryRawUnsafe(`
  SELECT state::text, kind::text, COUNT(*)::int AS n,
         MAX(updated_at) AS latest
  FROM etsy_sync_job
  GROUP BY 1, 2
  ORDER BY latest DESC NULLS LAST
`);
console.log("BY_STATE", JSON.stringify(open, null, 2));

const recent = await prisma.$queryRawUnsafe(`
  SELECT kind::text, state::text, last_error_code,
         LEFT(COALESCE(last_error_message,''), 160) AS msg,
         attempt_count, updated_at, dedupe_key
  FROM etsy_sync_job
  WHERE kind IN ('POLL_LISTING_CONTENT','PROCESS_PROVIDER_EVIDENCE','RECONCILE_LISTING','UPDATE_LISTING_CONTENT','PROJECT_INVENTORY')
  ORDER BY updated_at DESC
  LIMIT 25
`);
console.log("RECENT", JSON.stringify(recent, null, 2));

const polls = await prisma.$queryRawUnsafe(`
  SELECT state::text, COUNT(*)::int AS n,
         MIN(updated_at) AS oldest, MAX(updated_at) AS newest
  FROM etsy_sync_job
  WHERE kind = 'POLL_LISTING_CONTENT'
    AND updated_at > NOW() - INTERVAL '6 hours'
  GROUP BY 1
`);
console.log("POLLS_6H", JSON.stringify(polls, null, 2));

const links = await prisma.$queryRawUnsafe(`
  SELECT ell.id, si.title, ell.desired_product_content_version AS d,
         ell.applied_product_content_version AS a,
         ell.content_health::text, ell.inventory_health::text,
         ell.readiness::text, LEFT(COALESCE(ell.issue_message,''), 120) AS issue,
         ell.updated_at
  FROM etsy_listing_link ell
  JOIN "StoreItem" si ON si.id = ell.store_item_id
  ORDER BY ell.updated_at DESC
  LIMIT 5
`);
console.log("LINKS", JSON.stringify(links, null, 2));

await prisma.$disconnect();
