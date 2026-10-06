/**
 * One-shot heal: rebuild StoreItem.variants/quantity from ACTIVE foundation inventory
 * and clear RETIRED leftover isDefault (partial unique index).
 */
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const require = createRequire(path.join(root, "packages/database/package.json"));
const { PrismaClient } = require("@prisma/client");

// Prefer compiled package export
let projectStoreItemQuantity;
try {
  ({ projectStoreItemQuantity } = require("database"));
} catch {
  // Fall back to building via raw SQL projection if package not linked
}

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
const itemId = process.argv[2] || "cmup0o4oc000q14jchyecegzy";

const before = await db.storeItem.findUnique({
  where: { id: itemId },
  select: { id: true, title: true, quantity: true, priceCents: true, variants: true },
});
console.log("BEFORE", JSON.stringify(before, null, 2));

// Clear RETIRED defaults so collapse can promote a survivor later.
const cleared = await db.storeVariant.updateMany({
  where: { storeItemId: itemId, status: "RETIRED", isDefault: true },
  data: { isDefault: false },
});
console.log("CLEARED_RETIRED_DEFAULTS", cleared.count);

if (typeof projectStoreItemQuantity === "function") {
  await db.$transaction((tx) => projectStoreItemQuantity(tx, itemId));
} else {
  // Inline projection: sum ACTIVE onHand-reserved → StoreItem.quantity + rebuild variants JSON
  const variants = await db.storeVariant.findMany({
    where: { storeItemId: itemId, status: "ACTIVE" },
    include: { inventoryState: true },
    orderBy: { createdAt: "asc" },
  });
  let qty = 0;
  const live = [];
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
    }
  }
  const axisNames = new Set();
  for (const row of live) for (const name of Object.keys(row.options)) axisNames.add(name);
  const axes = [...axisNames].sort().map((name) => ({
    name,
    values: [...new Set(live.map((row) => row.options[name]).filter(Boolean))],
  }));
  const prices = new Set(live.map((s) => s.priceCents || 0));
  const qtys = new Set(live.map((s) => s.quantity || 0));
  const skuCodes = new Set(live.map((s) => String(s.sku ?? "")));
  await db.storeItem.update({
    where: { id: itemId },
    data: {
      quantity: qty,
      variants:
        live.length === 0
          ? null
          : {
              axes,
              skus: live,
              pricesVary: prices.size > 1,
              quantitiesVary: qtys.size > 1,
              skusVary: skuCodes.size > 1,
            },
    },
  });
}

const after = await db.storeItem.findUnique({
  where: { id: itemId },
  select: { id: true, title: true, quantity: true, priceCents: true, variants: true },
});
console.log("AFTER", JSON.stringify({
  id: after.id,
  title: after.title,
  quantity: after.quantity,
  priceCents: after.priceCents,
  variantSkuCount: after.variants?.skus?.length ?? null,
  axes: after.variants?.axes ?? null,
}, null, 2));

await db.$disconnect();
