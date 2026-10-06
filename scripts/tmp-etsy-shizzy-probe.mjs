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

const items = await db.storeItem.findMany({
  where: { title: { contains: "Shizzy", mode: "insensitive" } },
  select: {
    id: true,
    title: true,
    quantity: true,
    priceCents: true,
    variants: true,
    updatedAt: true,
  },
});
console.log("ITEMS", JSON.stringify(items, null, 2));

for (const it of items) {
  const vars = await db.storeVariant.findMany({
    where: { storeItemId: it.id },
    select: {
      id: true,
      status: true,
      isDefault: true,
      options: true,
      priceCents: true,
      sku: true,
      retiredAt: true,
    },
    orderBy: { createdAt: "asc" },
  });
  console.log(
    "VARIANTS",
    JSON.stringify(
      vars.map((v) => ({
        id: v.id,
        status: v.status,
        isDefault: v.isDefault,
        priceCents: v.priceCents,
        options: v.options,
        retiredAt: v.retiredAt,
      })),
      null,
      2
    )
  );
  const defaults = vars.filter((v) => v.isDefault);
  console.log("DEFAULT_COUNT", defaults.length, defaults.map((d) => ({ id: d.id, status: d.status })));

  const maps = await db.etsyVariantMap.findMany({
    where: { storeItemId: it.id },
    select: {
      id: true,
      storeVariantId: true,
      desiredVariantContentVersion: true,
      appliedVariantContentVersion: true,
      desiredVariantFingerprint: true,
      appliedVariantFingerprint: true,
    },
  });
  console.log("MAPS", JSON.stringify(maps, null, 2));

  const link = await db.etsyListingLink.findFirst({ where: { storeItemId: it.id } });
  if (link) {
    console.log(
      "LINK",
      JSON.stringify({
        id: link.id,
        etsyListingId: link.etsyListingId,
        contentHealth: link.contentHealth,
        issueCode: link.issueCode,
        desired: link.desiredProductContentVersion,
        applied: link.appliedProductContentVersion,
      })
    );
  }

  const jobs = await db.etsySyncJob.findMany({
    where: {
      OR: [
        { dedupeKey: { contains: it.id } },
        ...(link ? [{ dedupeKey: { contains: link.id } }] : []),
      ],
    },
    orderBy: { updatedAt: "desc" },
    take: 15,
  });
  console.log(
    "JOBS",
    JSON.stringify(
      jobs.map((j) => ({
        kind: j.kind,
        state: j.state,
        updatedAt: j.updatedAt,
        err: (j.lastErrorMessage || "").slice(0, 180),
        dedupe: j.dedupeKey,
      })),
      null,
      2
    )
  );
}

await db.$disconnect();
