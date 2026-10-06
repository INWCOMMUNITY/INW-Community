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
const storeItemId = "cmup1yoqd0008r2zhq0tjnlao";

const link = await db.etsyListingLink.findFirst({
  where: { storeItemId },
  orderBy: { updatedAt: "desc" },
});
if (!link) throw new Error("listing link missing");

const nextProductVersion = link.desiredProductContentVersion + 1;
await db.etsyListingLink.update({
  where: { id: link.id },
  data: {
    desiredProductContentVersion: nextProductVersion,
    productDesiredAt: new Date(),
  },
});

const dedupeKey = `RECONCILE_LISTING:${link.etsyConnectionId}:${link.id}:topo:p${nextProductVersion}`;
// Give the production deploy a couple minutes so the new on_property heal runs.
const nextAttemptAt = new Date(Date.now() + 3 * 60_000);
const existing = await db.etsySyncJob.findUnique({ where: { dedupeKey } });
const job = existing
  ? await db.etsySyncJob.update({
      where: { id: existing.id },
      data: {
        state: "PENDING",
        nextAttemptAt,
        payload: {
          listingLinkId: link.id,
          storeItemId,
          pushTopology: true,
        },
        lastErrorClass: null,
        lastErrorCode: null,
        lastErrorMessage: null,
        completedAt: null,
        leaseOwner: null,
        leaseToken: null,
        leaseExpiresAt: null,
      },
    })
  : await db.etsySyncJob.create({
      data: {
        etsyConnectionId: link.etsyConnectionId,
        kind: "RECONCILE_LISTING",
        dedupeKey,
        state: "PENDING",
        payload: {
          listingLinkId: link.id,
          storeItemId,
          pushTopology: true,
        },
        nextAttemptAt,
      },
    });

console.log(
  JSON.stringify(
    {
      etsyListingId: link.etsyListingId,
      listingLinkId: link.id,
      productVersion: nextProductVersion,
      jobId: job.id,
      state: job.state,
      dedupeKey,
    },
    null,
    2
  )
);

await db.$disconnect();
