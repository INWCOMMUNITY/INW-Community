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

const ITEM_ID = "cmup1yoqd0008r2zhq0tjnlao";
const env = loadEnv(path.join(root, ".env"));
const db = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });

const item = await db.storeItem.findUnique({
  where: { id: ITEM_ID },
  select: { title: true, variants: true },
});
const existing = item?.variants && typeof item.variants === "object" ? item.variants : {};
const existingSkus = Array.isArray(existing.skus) ? existing.skus : [];
const existingAxes = Array.isArray(existing.axes) ? existing.axes : [];

const variants = await db.storeVariant.findMany({
  where: { storeItemId: ITEM_ID, status: "ACTIVE" },
  select: {
    id: true,
    options: true,
    priceCents: true,
    sku: true,
    inventoryState: { select: { onHand: true, reserved: true, mode: true } },
  },
  orderBy: { createdAt: "asc" },
});

const live = variants
  .map((v) => {
    const options =
      v.options && typeof v.options === "object" && !Array.isArray(v.options) ? v.options : {};
    const state = v.inventoryState;
    const quantity =
      state?.mode === "TRACKED_FINITE" && state.onHand != null && state.reserved != null
        ? Math.max(0, state.onHand - state.reserved)
        : 0;
    return { storeVariantId: v.id, options, quantity, priceCents: v.priceCents, sku: v.sku };
  })
  .filter((row) => Object.keys(row.options).length > 0);

const photosById = new Map();
for (const raw of existingSkus) {
  if (typeof raw.storeVariantId === "string" && Array.isArray(raw.photos) && raw.photos.length > 0) {
    photosById.set(raw.storeVariantId, raw.photos);
  }
}

const axisNames = [...new Set(live.flatMap((row) => Object.keys(row.options)))].sort((a, b) =>
  a.localeCompare(b)
);
const axes = axisNames.map((name) => {
  const prev = existingAxes.find((axis) => axis?.name === name);
  const photosByValue =
    prev?.photosByValue && typeof prev.photosByValue === "object" ? prev.photosByValue : undefined;
  return {
    name,
    values: [...new Set(live.map((row) => row.options[name]).filter(Boolean))],
    ...(photosByValue ? { photosByValue } : {}),
  };
});
const skus = live.map((row) => {
  const photos = photosById.get(row.storeVariantId);
  return {
    options: row.options,
    quantity: row.quantity,
    priceCents: row.priceCents,
    storeVariantId: row.storeVariantId,
    ...(row.sku ? { sku: row.sku } : { sku: null }),
    ...(photos ? { photos } : {}),
  };
});
const imageAxis =
  typeof existing.imageAxis === "string" && axes.some((axis) => axis.name === existing.imageAxis)
    ? existing.imageAxis
    : undefined;
const prices = new Set(skus.map((s) => s.priceCents));
const qtys = new Set(skus.map((s) => s.quantity));
const skuCodes = new Set(skus.map((s) => String(s.sku ?? "")));

await db.storeItem.update({
  where: { id: ITEM_ID },
  data: {
    variants: {
      axes,
      skus,
      pricesVary: prices.size > 1,
      quantitiesVary: qtys.size > 1,
      skusVary: skuCodes.size > 1,
      ...(imageAxis ? { imageAxis } : {}),
    },
    priceCents: Math.min(...skus.map((s) => s.priceCents).filter((n) => n > 0)),
  },
});

const after = await db.storeItem.findUnique({
  where: { id: ITEM_ID },
  select: { title: true, quantity: true, priceCents: true, variants: true },
});
const afterAxes = after?.variants?.axes?.map((a) => ({ name: a.name, values: a.values }));
console.log(
  JSON.stringify(
    {
      title: after?.title,
      quantity: after?.quantity,
      priceCents: after?.priceCents,
      axes: afterAxes,
      skuCount: after?.variants?.skus?.length ?? 0,
    },
    null,
    2
  )
);

await db.$disconnect();
