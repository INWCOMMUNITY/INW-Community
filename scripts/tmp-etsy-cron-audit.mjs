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

const now = new Date();
console.log("NOW", now.toISOString());

const conn = await db.etsyConnection.findMany({
  select: {
    id: true,
    status: true,
    shopId: true,
    shopName: true,
    listingContentLastPolledAt: true,
    listingContentPollLeaseExpiresAt: true,
    accessTokenExpiresAt: true,
    updatedAt: true,
  },
});
console.log(
  "CONNECTIONS",
  JSON.stringify(
    conn.map((c) => ({
      ...c,
      minutesSincePoll: c.listingContentLastPolledAt
        ? (now - c.listingContentLastPolledAt) / 60000
        : null,
      leaseActive:
        c.listingContentPollLeaseExpiresAt != null && c.listingContentPollLeaseExpiresAt > now,
      tokenExpired: c.accessTokenExpiresAt <= now,
    })),
    null,
    2
  )
);

const byKindState = await db.$queryRawUnsafe(`
  SELECT kind::text, state::text, COUNT(*)::int AS n,
         MIN(updated_at) AS oldest, MAX(updated_at) AS newest
  FROM etsy_sync_job
  WHERE updated_at > NOW() - INTERVAL '3 hours'
  GROUP BY 1, 2
  ORDER BY newest DESC NULLS LAST
`);
console.log("JOBS_3H", JSON.stringify(byKindState, null, 2));

const open = await db.$queryRawUnsafe(`
  SELECT id, kind::text, state::text, attempt_count, next_attempt_at, updated_at,
         LEFT(COALESCE(last_error_message,''), 160) AS err,
         dedupe_key
  FROM etsy_sync_job
  WHERE state IN ('PENDING','RUNNING','RETRY_WAIT')
  ORDER BY next_attempt_at ASC
  LIMIT 30
`);
console.log("OPEN", JSON.stringify(open, null, 2));

const recentPolls = await db.$queryRawUnsafe(`
  SELECT id, state::text, attempt_count, updated_at, next_attempt_at,
         LEFT(COALESCE(last_error_code,''), 40) AS code,
         LEFT(COALESCE(last_error_message,''), 160) AS err,
         dedupe_key
  FROM etsy_sync_job
  WHERE kind = 'POLL_LISTING_CONTENT'
  ORDER BY updated_at DESC
  LIMIT 12
`);
console.log("RECENT_POLLS", JSON.stringify(recentPolls, null, 2));

const pollGaps = await db.$queryRawUnsafe(`
  WITH polls AS (
    SELECT updated_at,
           LAG(updated_at) OVER (ORDER BY updated_at) AS prev
    FROM etsy_sync_job
    WHERE kind = 'POLL_LISTING_CONTENT'
      AND state = 'SUCCEEDED'
      AND updated_at > NOW() - INTERVAL '3 hours'
  )
  SELECT
    COUNT(*)::int AS success_n,
    ROUND(AVG(EXTRACT(EPOCH FROM (updated_at - prev)))::numeric, 1) AS avg_gap_sec,
    ROUND(MIN(EXTRACT(EPOCH FROM (updated_at - prev)))::numeric, 1) AS min_gap_sec,
    ROUND(MAX(EXTRACT(EPOCH FROM (updated_at - prev)))::numeric, 1) AS max_gap_sec
  FROM polls
  WHERE prev IS NOT NULL
`);
console.log("POLL_GAPS", JSON.stringify(pollGaps, null, 2));

const recentReconcile = await db.$queryRawUnsafe(`
  SELECT state::text, COUNT(*)::int AS n, MAX(updated_at) AS newest
  FROM etsy_sync_job
  WHERE kind = 'RECONCILE_LISTING'
    AND updated_at > NOW() - INTERVAL '3 hours'
  GROUP BY 1
`);
console.log("RECONCILE_3H", JSON.stringify(recentReconcile, null, 2));

const outbound = await db.$queryRawUnsafe(`
  SELECT kind::text, state::text, COUNT(*)::int AS n, MAX(updated_at) AS newest,
         LEFT(MAX(COALESCE(last_error_message,'')), 120) AS sample_err
  FROM etsy_sync_job
  WHERE kind IN ('UPDATE_LISTING_CONTENT','PROJECT_INVENTORY','CREATE_LISTING')
    AND updated_at > NOW() - INTERVAL '6 hours'
  GROUP BY 1, 2
  ORDER BY 1, 2
`);
console.log("OUTBOUND_6H", JSON.stringify(outbound, null, 2));

const links = await db.$queryRawUnsafe(`
  SELECT si.title,
         ell.content_health::text, ell.inventory_health::text, ell.readiness::text,
         ell.issue_code, LEFT(COALESCE(ell.issue_message,''), 100) AS issue,
         ell.desired_product_content_version AS d,
         ell.applied_product_content_version AS a,
         ell.product_content_conflict AS conflict,
         ell.remote_listing_state,
         ell.updated_at
  FROM etsy_listing_link ell
  JOIN "StoreItem" si ON si.id = ell.store_item_id
  ORDER BY ell.updated_at DESC
`);
console.log("LINKS", JSON.stringify(links, null, 2));

const deadRecent = await db.$queryRawUnsafe(`
  SELECT kind::text, COUNT(*)::int AS n, MAX(updated_at) AS newest,
         LEFT(MAX(COALESCE(last_error_message,'')), 160) AS sample_err
  FROM etsy_sync_job
  WHERE state = 'DEAD'
    AND updated_at > NOW() - INTERVAL '6 hours'
  GROUP BY 1
`);
console.log("DEAD_6H", JSON.stringify(deadRecent, null, 2));

await db.$disconnect();
