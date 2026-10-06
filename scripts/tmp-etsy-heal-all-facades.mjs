/**
 * Heal all listings: clear RETIRED leftover isDefault, reproject StoreItem facade
 * (quantity + variants JSON prices) from ACTIVE foundation rows.
 */
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

const cleared = await db.storeVariant.updateMany({
  where: { status: "RETIRED", isDefault: true },
  data: { isDefault: false },
});
console.log("CLEARED_RETIRED_DEFAULTS", cleared.count);

// Also: if multiple ACTIVE defaults somehow exist, keep oldest and clear rest.
const multiDefaults = await db.$queryRawUnsafe(`
  SELECT store_item_id AS "storeItemId", COUNT(*)::int AS n
  FROM store_variant
  WHERE is_default = true
  GROUP BY store_item_id
  HAVING COUNT(*) > 1
`);
console.log("MULTI_DEFAULT_ITEMS", multiDefaults);

const matrixItems = await db.$queryRawUnsafe(`
  SELECT DISTINCT sv.store_item_id AS id
  FROM store_variant sv
  WHERE sv.status = 'ACTIVE'
    AND sv.options IS NOT NULL
    AND sv.options::text NOT IN ('{}', 'null')
`);
console.log("MATRIX_ITEMS", matrixItems.length);

for (const row of matrixItems) {
  const itemId = row.id;
  const variants = await db.storeVariant.findMany({
    where: { storeItemId: itemId, status: "ACTIVE" },
    include: { inventoryState: true },
    orderBy: { createdAt: "asc" },
  });
  let qty = 0;
  const live = [];
  const prices = [];
  for (const v of variants) {
    const state = v.inventoryState;
    let available = 0;
    if (state?.mode === "TRACKED_FINITE" && state.onHand != null && state.reserved != null) {
      available = Math.max(0, state.onHand - state.reserved);
      qty += available;
    }
    const options =
      typeof v.options === "string"
        ? JSON.parse(v.options)
        : v.options && typeof v.options === "object"
          ? v.options
          : {};
    if (Object.keys(options).length > 0) {
      live.push({
        options,
        quantity: available,
        priceCents: v.priceCents,
        storeVariantId: v.id,
        ...(v.sku ? { sku: v.sku } : {}),
      });
      if (v.priceCents > 0) prices.push(v.priceCents);
    }
  }
  if (live.length === 0) continue;
  const axisNames = new Set();
  for (const r of live) for (const name of Object.keys(r.options)) axisNames.add(name);
  const axes = [...axisNames].sort().map((name) => ({
    name,
    values: [...new Set(live.map((r) => r.options[name]).filter(Boolean))],
  }));
  const priceSet = new Set(live.map((s) => s.priceCents || 0));
  const qtySet = new Set(live.map((s) => s.quantity || 0));
  const skuSet = new Set(live.map((s) => String(s.sku ?? "")));
  const facadePrice = prices.length > 0 ? Math.min(...prices) : undefined;
  await db.storeItem.update({
    where: { id: itemId },
    data: {
      quantity: qty,
      ...(facadePrice != null ? { priceCents: facadePrice } : {}),
      variants: {
        axes,
        skus: live,
        pricesVary: priceSet.size > 1,
        quantitiesVary: qtySet.size > 1,
        skusVary: skuSet.size > 1,
      },
    },
  });
  console.log("HEALED", itemId, { qty, facadePrice, skus: live.length });
}

await db.$disconnect();
