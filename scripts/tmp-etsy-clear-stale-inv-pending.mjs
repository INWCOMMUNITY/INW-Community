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

const link = await db.etsyListingLink.findFirst({
  where: { id: "cmupw47p60020nt3wd5es9v77" },
});
const maps = await db.etsyVariantMap.findMany({
  where: { etsyListingLinkId: "cmupw47p60020nt3wd5es9v77" },
});
console.log(
  "BEFORE",
  JSON.stringify(
    {
      issueCode: link?.issueCode,
      issueMessage: link?.issueMessage,
      invHealth: link?.inventoryHealth,
      readiness: link?.readiness,
      maps: maps.map((m) => ({
        dv: m.inventoryDesiredVersion,
        av: m.inventoryAppliedVersion,
        d: m.inventoryDesiredAvailable,
        a: m.inventoryAppliedAvailable,
      })),
    },
    null,
    2
  )
);

// Dynamically import health reconcile from compiled path - use inline classify logic
const contentPending =
  (link?.desiredProductContentVersion ?? 0) > (link?.appliedProductContentVersion ?? 0) ||
  maps.some((m) => m.desiredVariantContentVersion > m.appliedVariantContentVersion);
const inventoryPending = maps.some(
  (m) =>
    m.inventoryDesiredVersion > m.inventoryAppliedVersion ||
    (m.inventoryDesiredAvailable != null &&
      m.inventoryDesiredAvailable !== m.inventoryAppliedAvailable)
);
console.log("WOULD_PENDING", { contentPending, inventoryPending });

if (link && !contentPending && !inventoryPending) {
  await db.etsyListingLink.update({
    where: { id: link.id },
    data: {
      readiness: "READY_TO_PUBLISH",
      contentHealth: "HEALTHY",
      inventoryHealth: "HEALTHY",
      issueCode: null,
      issueMessage: null,
    },
  });
  const after = await db.etsyListingLink.findUnique({ where: { id: link.id } });
  console.log(
    "CLEARED",
    JSON.stringify(
      {
        issueCode: after?.issueCode,
        issueMessage: after?.issueMessage,
        invHealth: after?.inventoryHealth,
        readiness: after?.readiness,
      },
      null,
      2
    )
  );
}

await db.$disconnect();
