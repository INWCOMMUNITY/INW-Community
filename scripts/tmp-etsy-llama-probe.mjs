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

const recent = await db.storeItem.findMany({
  orderBy: { updatedAt: "desc" },
  take: 12,
  select: { id: true, title: true, quantity: true, updatedAt: true },
});
console.log("RECENT", JSON.stringify(recent, null, 2));

const jobs = await db.etsySyncJob.findMany({
  where: { state: { in: ["DEAD", "RETRY_WAIT"] } },
  orderBy: { updatedAt: "desc" },
  take: 15,
  select: { kind: true, state: true, lastErrorCode: true, lastErrorMessage: true, updatedAt: true },
});
console.log("OPEN_FAIL", JSON.stringify(jobs, null, 2));

const items = await db.storeItem.findMany({
  where: {
    OR: [
      { title: { contains: "Llama", mode: "insensitive" } },
      { title: { contains: "Billion", mode: "insensitive" } },
      { title: { contains: "Etsy to INW", mode: "insensitive" } },
    ],
  },
  select: {
    id: true,
    title: true,
    quantity: true,
    priceCents: true,
    inventoryTracking: true,
    variants: true,
    updatedAt: true,
  },
  orderBy: { updatedAt: "desc" },
  take: 8,
});

for (const it of items) {
  const vars = await db.storeVariant.findMany({
    where: { storeItemId: it.id },
    select: {
      id: true,
      status: true,
      isDefault: true,
      options: true,
      priceCents: true,
    },
    orderBy: { createdAt: "asc" },
  });
  const inv = await db.inventoryState.findMany({
    where: { variantId: { in: vars.map((v) => v.id) } },
    select: { variantId: true, mode: true, onHand: true, reserved: true },
  });
  const maps = await db.etsyVariantMap.findMany({
    where: { storeItemId: it.id },
    select: { storeVariantId: true, etsyProductId: true, etsyOfferingId: true },
  });
  const link = await db.etsyListingLink.findFirst({
    where: { storeItemId: it.id },
    select: {
      id: true,
      etsyListingId: true,
      issueCode: true,
      issueMessage: true,
      contentHealth: true,
      readiness: true,
    },
  });
  const jobs = link
    ? await db.etsySyncJob.findMany({
        where: {
          OR: [{ dedupeKey: { contains: it.id } }, { dedupeKey: { contains: link.id } }],
        },
        orderBy: { updatedAt: "desc" },
        take: 12,
        select: {
          kind: true,
          state: true,
          lastErrorMessage: true,
          updatedAt: true,
          dedupeKey: true,
        },
      })
    : [];
  const axes = it.variants && typeof it.variants === "object" ? it.variants.axes : null;
  const skuCount = it.variants?.skus?.length ?? null;
  console.log(
    JSON.stringify(
      {
        title: it.title,
        id: it.id,
        qty: it.quantity,
        price: it.priceCents,
        tracking: it.inventoryTracking,
        axes,
        skuCount,
        active: vars.filter((v) => v.status === "ACTIVE").map((v) => ({
          id: v.id.slice(-6),
          options: v.options,
          price: v.priceCents,
          onHand: inv.find((i) => i.variantId === v.id)?.onHand,
          mode: inv.find((i) => i.variantId === v.id)?.mode,
        })),
        retired: vars.filter((v) => v.status !== "ACTIVE").length,
        mapCount: maps.length,
        link,
        jobs: jobs.map((j) => ({
          kind: j.kind,
          state: j.state,
          err: (j.lastErrorMessage || "").slice(0, 160),
        })),
      },
      null,
      2
    )
  );
}

const item = await db.storeItem.findUnique({
  where: { id: "cmup1yoqd0008r2zhq0tjnlao" },
  select: { variants: true },
});
const vj = item?.variants;
const skus = vj && typeof vj === "object" && !Array.isArray(vj) ? vj.skus : [];
const summary = Array.isArray(skus)
  ? skus.map((s) => ({
      keys: s?.options && typeof s.options === "object" ? Object.keys(s.options) : [],
      opts: s?.options,
      qty: s?.quantity,
      id: s?.storeVariantId ?? null,
    }))
  : [];
console.log("SKU_SHAPE", JSON.stringify(summary, null, 2));

const retired = await db.storeVariant.findMany({
  where: { storeItemId: "cmup1yoqd0008r2zhq0tjnlao", status: "RETIRED" },
  select: { id: true, options: true, priceCents: true, isDefault: true },
});
console.log("RETIRED_OPTS", JSON.stringify(retired, null, 2));

const dead = await db.etsySyncJob.findMany({
  where: { lastErrorMessage: { contains: "no variant map", mode: "insensitive" } },
  orderBy: { updatedAt: "desc" },
  take: 8,
  select: { kind: true, state: true, lastErrorMessage: true, dedupeKey: true, updatedAt: true, payload: true },
});
console.log("DEAD_MAP", JSON.stringify(dead, null, 2));

await db.$disconnect();
