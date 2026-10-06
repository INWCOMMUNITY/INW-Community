import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { createHash, createDecipheriv } from "crypto";

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
for (const [k, v] of Object.entries(env)) {
  if (process.env[k] == null) process.env[k] = v;
}

function getKey() {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw || raw.length < 16) throw new Error("ENCRYPTION_KEY missing");
  if (Buffer.byteLength(raw, "utf8") === 32 && raw.length === 32) return Buffer.from(raw, "utf8");
  try {
    const decoded = Buffer.from(raw, "base64");
    if (decoded.length === 32) return decoded;
  } catch {}
  return createHash("sha256").update(raw, "utf8").digest();
}

function decrypt(payload) {
  const [ivB64, tagB64, dataB64] = String(payload).split(":");
  const key = getKey();
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

const db = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });
const item = await db.storeItem.findFirst({
  where: { title: { contains: "Testing Once Again", mode: "insensitive" } },
  select: {
    id: true,
    title: true,
    quantity: true,
    priceCents: true,
    variants: true,
    inventoryTracking: true,
    etsyTaxonomyId: true,
  },
});
if (!item) {
  console.log("ITEM_MISSING");
  await db.$disconnect();
  process.exit(0);
}

const active = await db.storeVariant.findMany({
  where: { storeItemId: item.id, status: "ACTIVE" },
  select: {
    id: true,
    options: true,
    priceCents: true,
    inventoryState: { select: { onHand: true, reserved: true, mode: true } },
  },
  orderBy: { createdAt: "asc" },
});
const link = await db.etsyListingLink.findFirst({
  where: { storeItemId: item.id },
  orderBy: { updatedAt: "desc" },
});
const maps = link
  ? await db.etsyVariantMap.findMany({
      where: { etsyListingLinkId: link.id },
      select: {
        storeVariantId: true,
        etsyProductId: true,
        etsyOfferingId: true,
        propertyValuesJson: true,
        inventoryDesiredAvailable: true,
        inventoryAppliedAvailable: true,
      },
    })
  : [];
const jobs = link
  ? await db.etsySyncJob.findMany({
      where: {
        OR: [
          { payload: { path: ["storeItemId"], equals: item.id } },
          { payload: { path: ["listingLinkId"], equals: link.id } },
        ],
      },
      orderBy: { updatedAt: "desc" },
      take: 12,
      select: {
        kind: true,
        state: true,
        lastErrorCode: true,
        lastErrorMessage: true,
        updatedAt: true,
        payload: true,
      },
    })
  : [];

console.log(
  JSON.stringify(
    {
      item: {
        id: item.id,
        title: item.title,
        qty: item.quantity,
        price: item.priceCents,
        tracking: item.inventoryTracking,
        axes: item.variants?.axes ?? null,
        skuCount: Array.isArray(item.variants?.skus) ? item.variants.skus.length : 0,
      },
      active: active.map((v) => ({
        id: v.id,
        options: v.options,
        price: v.priceCents,
        onHand: v.inventoryState?.onHand,
        mode: v.inventoryState?.mode,
      })),
      link: link
        ? {
            id: link.id,
            etsyListingId: link.etsyListingId,
            contentHealth: link.contentHealth,
            inventoryHealth: link.inventoryHealth,
            issueCode: link.issueCode,
            issueMessage: link.issueMessage,
          }
        : null,
      mapCount: maps.length,
      maps: maps.slice(0, 5),
      jobs,
    },
    null,
    2
  )
);

if (link?.etsyListingId) {
  const conn = await db.etsyConnection.findFirst({
    where: { id: link.etsyConnectionId },
    select: { id: true, memberId: true, shopId: true, accessTokenEnc: true, apiKey: true },
  });
  if (conn?.accessTokenEnc) {
    const token = decrypt(conn.accessTokenEnc);
    const key = process.env.ETSY_API_KEY || conn.apiKey || env.ETSY_API_KEY;
    const url = `https://openapi.etsy.com/v3/application/listings/${link.etsyListingId}/inventory?max_variations_supported=3`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "x-api-key": key,
      },
    });
    const body = await res.json();
    const products = Array.isArray(body.products) ? body.products : [];
    console.log(
      "REMOTE",
      JSON.stringify(
        {
          status: res.status,
          productCount: products.length,
          price_on_property: body.price_on_property ?? null,
          quantity_on_property: body.quantity_on_property ?? null,
          sku_on_property: body.sku_on_property ?? null,
          products: products.map((p) => ({
            product_id: p.product_id,
            sku: p.sku,
            props: (p.property_values ?? []).map((pv) => ({
              id: pv.property_id,
              name: pv.property_name,
              values: pv.values,
            })),
            offering: (p.offerings ?? [])[0]
              ? {
                  id: p.offerings[0].offering_id,
                  qty: p.offerings[0].quantity,
                  enabled: p.offerings[0].is_enabled,
                  price: p.offerings[0].price,
                }
              : null,
          })),
        },
        null,
        2
      )
    );
  }
}

await db.$disconnect();
