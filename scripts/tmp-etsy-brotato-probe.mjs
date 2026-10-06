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

function decrypt(ciphertext) {
  const key = getKey();
  const buf = Buffer.from(ciphertext, "base64");
  const iv = buf.subarray(0, 16);
  const authTag = buf.subarray(16, 32);
  const data = buf.subarray(32);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  return decipher.update(data).toString("utf8") + decipher.final("utf8");
}

const db = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });

const items = await db.storeItem.findMany({
  where: { title: { contains: "Brotato", mode: "insensitive" } },
  select: {
    id: true,
    title: true,
    quantity: true,
    priceCents: true,
    variants: true,
    memberId: true,
    updatedAt: true,
    inventoryTracking: true,
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
      createdAt: true,
      retiredAt: true,
    },
    orderBy: { createdAt: "asc" },
  });
  const inv = await db.inventoryState.findMany({
    where: { variantId: { in: vars.map((v) => v.id) } },
  });
  const maps = await db.etsyVariantMap.findMany({ where: { storeItemId: it.id } });
  const links = await db.etsyListingLink.findMany({ where: { storeItemId: it.id } });
  console.log(
    "VARIANTS",
    JSON.stringify(
      vars.map((v) => ({
        ...v,
        options: v.options,
      })),
      null,
      2
    )
  );
  console.log("INV", JSON.stringify(inv, null, 2));
  console.log(
    "MAPS",
    JSON.stringify(
      maps.map((m) => ({
        id: m.id,
        storeVariantId: m.storeVariantId,
        etsyProductId: m.etsyProductId,
        etsyOfferingId: m.etsyOfferingId,
        inv_d: m.inventoryDesiredAvailable,
        inv_a: m.inventoryAppliedAvailable,
        inv_dv: m.inventoryDesiredVersion,
        inv_av: m.inventoryAppliedVersion,
      })),
      null,
      2
    )
  );
  console.log(
    "LINKS",
    JSON.stringify(
      links.map((l) => ({
        id: l.id,
        etsyListingId: l.etsyListingId,
        contentHealth: l.contentHealth,
        inventoryHealth: l.inventoryHealth,
        issueCode: l.issueCode,
        issueMessage: l.issueMessage,
        desired: l.desiredProductContentVersion,
        applied: l.appliedProductContentVersion,
        updatedAt: l.updatedAt,
      })),
      null,
      2
    )
  );

  const jobs = await db.etsySyncJob.findMany({
    where: {
      OR: [
        { dedupeKey: { contains: it.id } },
        ...(links[0] ? [{ dedupeKey: { contains: String(links[0].etsyListingId) } }] : []),
        ...(links[0] ? [{ dedupeKey: { contains: links[0].id } }] : []),
      ],
    },
    orderBy: { updatedAt: "desc" },
    take: 30,
  });
  console.log(
    "JOBS",
    JSON.stringify(
      jobs.map((j) => ({
        kind: j.kind,
        state: j.state,
        attempt: j.attemptCount,
        updatedAt: j.updatedAt,
        code: j.lastErrorCode,
        err: (j.lastErrorMessage || "").slice(0, 200),
        dedupe: j.dedupeKey,
      })),
      null,
      2
    )
  );

  // Live Etsy inventory for qty compare
  if (links[0]) {
    const conn = await db.etsyConnection.findFirst({
      where: { id: links[0].etsyConnectionId },
    });
    if (conn?.accessTokenEncrypted) {
      const accessToken = decrypt(conn.accessTokenEncrypted);
      const apiKey = env.ETSY_API_KEY || "";
      const clientSecret = env.ETSY_CLIENT_SECRET || "";
      const xApiKey = `${apiKey}:${clientSecret}`;
      const res = await fetch(
        `https://openapi.etsy.com/v3/application/listings/${links[0].etsyListingId}/inventory`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "x-api-key": xApiKey,
          },
        }
      );
      const data = await res.json().catch(() => null);
      const products = (data?.products || []).map((p) => ({
        product_id: p.product_id,
        sku: p.sku,
        props: (p.property_values || []).map((pv) => `${pv.property_name}=${(pv.values || []).join(",")}`),
        qty: p.offerings?.[0]?.quantity,
        price: p.offerings?.[0]?.price
          ? p.offerings[0].price.amount / p.offerings[0].price.divisor
          : null,
        offering_id: p.offerings?.[0]?.offering_id,
        enabled: p.offerings?.[0]?.is_enabled,
      }));
      console.log("ETSY_LIVE", JSON.stringify({ status: res.status, productCount: products.length, products }, null, 2));
    }
  }
}

await db.$disconnect();
