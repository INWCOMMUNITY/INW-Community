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
for (const [k, v] of Object.entries(env)) process.env[k] = v;

function getKey() {
  const raw = process.env.ENCRYPTION_KEY;
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
  const decipher = createDecipheriv("aes-256-gcm", key, buf.subarray(0, 16));
  decipher.setAuthTag(buf.subarray(16, 32));
  return decipher.update(buf.subarray(32)).toString("utf8") + decipher.final("utf8");
}

function variantFp(priceCents, sku) {
  const payload = {
    priceCents: Number.isFinite(priceCents) ? Math.trunc(priceCents) : 0,
    sku: typeof sku === "string" ? sku.trim() : "",
  };
  return createHash("sha256").update(JSON.stringify(payload), "utf8").digest("hex");
}

function classify({ base, local, remote, hasLocalSemanticEdit }) {
  if (local === remote) {
    if (base != null && local === base) return "UNCHANGED";
    return "CONVERGED";
  }
  if (base == null) return hasLocalSemanticEdit ? "CONFLICT" : "REMOTE_ONLY";
  if (local !== base && remote === base) return "LOCAL_ONLY";
  if (local === base && remote !== base) return "REMOTE_ONLY";
  return "CONFLICT";
}

const db = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });
const conn = await db.etsyConnection.findFirst({ where: { status: "ACTIVE" } });
if (!conn) throw new Error("no active connection");
const token = decrypt(conn.accessTokenEncrypted);
const xApiKey = `${(env.ETSY_API_KEY || "").trim()}:${(env.ETSY_CLIENT_SECRET || "").trim()}`;

async function etsyGet(pathSuffix) {
  const res = await fetch(`https://openapi.etsy.com/v3/application${pathSuffix}`, {
    headers: { Authorization: `Bearer ${token}`, "x-api-key": xApiKey },
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

const links = await db.etsyListingLink.findMany({
  where: { etsyConnectionId: conn.id },
  orderBy: { updatedAt: "desc" },
});

for (const link of links) {
  const storeItem = await db.storeItem.findUnique({
    where: { id: link.storeItemId },
    select: { title: true },
  });
  const maps = await db.etsyVariantMap.findMany({
    where: { etsyListingLinkId: link.id },
    orderBy: { createdAt: "asc" },
  });
  const variants = await db.storeVariant.findMany({
    where: { id: { in: maps.map((m) => m.storeVariantId) } },
    select: { id: true, priceCents: true, sku: true, options: true },
  });
  const byId = new Map(variants.map((v) => [v.id, v]));

  const inv = await etsyGet(`/listings/${link.etsyListingId}/inventory`);
  const offerings = [];
  for (const p of inv.data?.products ?? []) {
    for (const o of p.offerings ?? []) {
      const price = o.price;
      const cents =
        price && typeof price === "object"
          ? Math.round((Number(price.amount) / Number(price.divisor || 100)) * 100)
          : typeof price === "number"
            ? Math.round(price * 100)
            : null;
      offerings.push({
        productId: String(p.product_id),
        offeringId: String(o.offering_id),
        qty: o.quantity,
        priceCents: cents,
        sku: typeof p.sku === "string" ? p.sku : null,
        props: (p.property_values ?? []).map((pv) => `${pv.property_name}=${(pv.values || []).join("/")}`),
      });
    }
  }

  const rows = maps.map((m) => {
    const sv = byId.get(m.storeVariantId);
    const remote = offerings.find((o) => o.offeringId === m.etsyOfferingId);
    const localFp = variantFp(sv?.priceCents ?? 0, sv?.sku ?? null);
    const remoteFp = remote ? variantFp(remote.priceCents ?? 0, remote.sku) : null;
    const desireAhead = m.desiredVariantContentVersion > m.appliedVariantContentVersion;
    const localForClass = desireAhead ? m.desiredVariantFingerprint ?? localFp : localFp;
    const cls =
      remoteFp == null
        ? "UNMAPPED_OFFERING"
        : classify({
            base: m.appliedVariantFingerprint,
            local: localForClass,
            remote: remoteFp,
            hasLocalSemanticEdit: desireAhead,
          });
    return {
      options: sv?.options ?? null,
      offering: m.etsyOfferingId,
      remoteFound: Boolean(remote),
      inwPrice: sv?.priceCents ?? null,
      remotePrice: remote?.priceCents ?? null,
      priceDiffers: remote ? remote.priceCents !== sv?.priceCents : null,
      inwQtyAvailable: null,
      remoteQty: remote?.qty ?? null,
      vd: m.desiredVariantContentVersion,
      va: m.appliedVariantContentVersion,
      desireAhead,
      localFp: localFp.slice(0, 12),
      desiredFp: (m.desiredVariantFingerprint || "").slice(0, 12),
      appliedFp: (m.appliedVariantFingerprint || "").slice(0, 12),
      remoteFp: remoteFp ? remoteFp.slice(0, 12) : null,
      class: cls,
      remoteProps: remote?.props ?? null,
    };
  });

  console.log(
    "LISTING",
    JSON.stringify(
      {
        title: storeItem?.title,
        etsyListingId: link.etsyListingId,
        invHttp: inv.status,
        unmatchedRemote: offerings.filter((o) => !maps.some((m) => m.etsyOfferingId === o.offeringId)),
        rows,
      },
      null,
      2
    )
  );
}

await db.$disconnect();
