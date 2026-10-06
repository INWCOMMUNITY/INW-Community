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

function getKey(env) {
  const raw = env.ENCRYPTION_KEY;
  if (!raw || raw.length < 16) throw new Error("ENCRYPTION_KEY missing");
  if (Buffer.byteLength(raw, "utf8") === 32 && raw.length === 32) return Buffer.from(raw, "utf8");
  try {
    const decoded = Buffer.from(raw, "base64");
    if (decoded.length === 32) return decoded;
  } catch {}
  return createHash("sha256").update(raw, "utf8").digest();
}

function decrypt(ciphertext, env) {
  const key = getKey(env);
  const buf = Buffer.from(ciphertext, "base64");
  const iv = buf.subarray(0, 16);
  const authTag = buf.subarray(16, 32);
  const data = buf.subarray(32);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  return decipher.update(data).toString("utf8") + decipher.final("utf8");
}

function optionKey(options) {
  return Object.keys(options)
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
    .map((k) => `${k.trim().toLowerCase()}=${String(options[k] ?? "").trim().toLowerCase()}`)
    .join("|");
}

function optionsFromProps(propertyValues) {
  const options = {};
  for (const pv of propertyValues ?? []) {
    const name = String(pv.property_name ?? "").trim();
    const value = (pv.values ?? []).map(String).filter(Boolean).join(" / ");
    if (name && value) options[name] = value;
  }
  return options;
}

const env = loadEnv(path.join(root, ".env"));
const db = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });
const storeItemId = "cmup1yoqd0008r2zhq0tjnlao";

const link = await db.etsyListingLink.findFirst({
  where: { storeItemId },
  orderBy: { updatedAt: "desc" },
});
if (!link) throw new Error("listing link missing");

const conn = await db.etsyConnection.findFirst({ where: { id: link.etsyConnectionId } });
if (!conn?.accessTokenEncrypted) throw new Error("connection token missing");

const active = await db.storeVariant.findMany({
  where: { storeItemId, status: "ACTIVE" },
  select: {
    id: true,
    options: true,
    priceCents: true,
    sku: true,
    inventoryState: { select: { onHand: true, reserved: true, mode: true } },
  },
  orderBy: { createdAt: "asc" },
});

const accessToken = decrypt(conn.accessTokenEncrypted, env);
const apiKey = env.ETSY_API_KEY || "";
const clientSecret = env.ETSY_CLIENT_SECRET || "";
const headers = {
  Authorization: `Bearer ${accessToken}`,
  "x-api-key": `${apiKey}:${clientSecret}`,
  "Content-Type": "application/json",
};

const getRes = await fetch(
  `https://openapi.etsy.com/v3/application/listings/${link.etsyListingId}/inventory?max_variations_supported=3`,
  { headers }
);
const remote = await getRes.json();
if (!getRes.ok) {
  console.log("GET_FAIL", getRes.status, remote);
  await db.$disconnect();
  process.exit(1);
}

const remoteProducts = Array.isArray(remote.products) ? remote.products : [];
console.log(
  "BEFORE",
  JSON.stringify(
    {
      productCount: remoteProducts.length,
      price_on_property: remote.price_on_property ?? [],
      quantity_on_property: remote.quantity_on_property ?? [],
      sampleQty: remoteProducts[0]?.offerings?.[0]?.quantity,
    },
    null,
    2
  )
);

const axisMeta = new Map();
for (const product of remoteProducts) {
  for (const pv of product.property_values ?? []) {
    const name = String(pv.property_name ?? "").trim();
    if (!name || axisMeta.has(name)) continue;
    axisMeta.set(name, {
      propertyId: Number(pv.property_id),
      scaleId: pv.scale_id != null ? Number(pv.scale_id) : null,
    });
  }
}
const axisNames = [...axisMeta.keys()];
const axisIds = [...new Set([...axisMeta.values()].map((m) => m.propertyId))];

const readiness =
  remoteProducts[0]?.offerings?.find((o) => o?.is_enabled !== false)?.readiness_state_id ??
  remoteProducts[0]?.offerings?.[0]?.readiness_state_id;

const byRemote = new Map(
  remoteProducts.map((p) => [optionKey(optionsFromProps(p.property_values)), p])
);

const products = [];
for (const row of active) {
  const options =
    row.options && typeof row.options === "object" && !Array.isArray(row.options) ? row.options : {};
  if (Object.keys(options).length === 0) continue;
  const qty =
    row.inventoryState?.mode === "TRACKED_FINITE" &&
    row.inventoryState.onHand != null &&
    row.inventoryState.reserved != null
      ? Math.max(0, row.inventoryState.onHand - row.inventoryState.reserved)
      : 0;
  const remoteMatch = byRemote.get(optionKey(options));
  products.push({
    sku: String(row.sku ?? remoteMatch?.sku ?? "").trim(),
    property_values: axisNames.map((axis) => {
      const meta = axisMeta.get(axis);
      const value =
        options[axis] ??
        Object.entries(options).find(([k]) => k.toLowerCase() === axis.toLowerCase())?.[1] ??
        "";
      return {
        property_id: meta.propertyId,
        property_name: axis,
        values: [String(value)],
        value_ids: [],
        ...(meta.scaleId != null && Number.isFinite(meta.scaleId) ? { scale_id: meta.scaleId } : {}),
      };
    }),
    offerings: [
      {
        price: Math.max(0.2, (row.priceCents || 500) / 100),
        quantity: qty,
        is_enabled: true,
        ...(readiness != null ? { readiness_state_id: readiness } : {}),
      },
    ],
  });
}

const body = {
  products,
  price_on_property: axisIds,
  quantity_on_property: axisIds,
  sku_on_property: [],
};

const putRes = await fetch(
  `https://openapi.etsy.com/v3/application/listings/${link.etsyListingId}/inventory?max_variations_supported=3`,
  {
    method: "PUT",
    headers,
    body: JSON.stringify(body),
  }
);
const putJson = await putRes.json().catch(() => null);
if (!putRes.ok) {
  console.log("PUT_FAIL", putRes.status, putJson);
  await db.$disconnect();
  process.exit(1);
}

const afterRes = await fetch(
  `https://openapi.etsy.com/v3/application/listings/${link.etsyListingId}/inventory?max_variations_supported=3`,
  { headers }
);
const after = await afterRes.json();
const afterProducts = Array.isArray(after.products) ? after.products : [];
const qtySum = afterProducts.reduce((n, p) => n + (p.offerings?.[0]?.quantity ?? 0), 0);
console.log(
  "AFTER",
  JSON.stringify(
    {
      status: afterRes.status,
      productCount: afterProducts.length,
      price_on_property: after.price_on_property ?? [],
      quantity_on_property: after.quantity_on_property ?? [],
      qtySum,
      sample: afterProducts.slice(0, 3).map((p) => ({
        props: (p.property_values ?? []).map((pv) => `${pv.property_name}=${(pv.values || []).join(",")}`),
        qty: p.offerings?.[0]?.quantity,
        price: p.offerings?.[0]?.price,
      })),
    },
    null,
    2
  )
);

await db.$disconnect();
