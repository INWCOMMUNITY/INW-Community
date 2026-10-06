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

function normalizeTitle(v) {
  return typeof v === "string" ? v.trim() : "";
}
function normalizeDesc(v) {
  return String(v ?? "").replace(/\r\n/g, "\n").trim();
}
function productFp(title, description) {
  return createHash("sha256")
    .update(JSON.stringify({ title: normalizeTitle(title), description: normalizeDesc(description) }), "utf8")
    .digest("hex");
}

const prisma = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });
const conn = await prisma.etsyConnection.findFirst({ where: { status: "ACTIVE" } });
if (!conn) throw new Error("no active connection");
const accessToken = decrypt(conn.accessTokenEncrypted);
const apiKey = env.ETSY_API_KEY || "";
const clientSecret = env.ETSY_CLIENT_SECRET || "";
const xApiKey = `${apiKey}:${clientSecret}`;

async function etsyGet(pathSuffix, query = {}) {
  const qs = new URLSearchParams(query).toString();
  const url = `https://openapi.etsy.com/v3/application${pathSuffix}${qs ? `?${qs}` : ""}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "x-api-key": xApiKey,
    },
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

const links = await prisma.etsyListingLink.findMany({
  where: { etsyConnectionId: conn.id },
  orderBy: { updatedAt: "desc" },
});

console.log(
  "CONN",
  JSON.stringify({
    id: conn.id,
    lastPolled: conn.listingContentLastPolledAt,
    lease: conn.listingContentPollLeaseExpiresAt,
    tokenExp: conn.accessTokenExpiresAt,
  })
);

for (const link of links) {
  const storeItem = await prisma.storeItem.findUnique({
    where: { id: link.storeItemId },
    select: { id: true, title: true, description: true, priceCents: true },
  });
  const maps = await prisma.etsyVariantMap.findMany({
    where: { etsyListingLinkId: link.id },
  });
  const variants = await prisma.storeVariant.findMany({
    where: { id: { in: maps.map((m) => m.storeVariantId) } },
    select: {
      id: true,
      priceCents: true,
      sku: true,
      options: true,
      inventoryState: { select: { onHand: true, reserved: true, mode: true } },
    },
  });
  const byId = new Map(variants.map((v) => [v.id, v]));

  const listingRes = await etsyGet(`/listings/${link.etsyListingId}`, { includes: "Images" });
  const invRes = await etsyGet(`/listings/${link.etsyListingId}/inventory`);
  const remoteTitle = listingRes.data?.title ?? null;
  const remoteDesc = listingRes.data?.description ?? null;
  const remoteFp = productFp(remoteTitle, remoteDesc);
  const localFp = productFp(storeItem?.title, storeItem?.description);
  const offerings = [];
  for (const p of invRes.data?.products ?? []) {
    for (const o of p.offerings ?? []) {
      const price = o.price;
      const cents =
        price && typeof price === "object"
          ? Math.round((Number(price.amount) / Number(price.divisor || 100)) * 100)
          : null;
      offerings.push({
        productId: String(p.product_id),
        offeringId: String(o.offering_id),
        qty: o.quantity,
        priceCents: cents,
        sku: p.sku ?? null,
        props: (p.property_values ?? []).map((pv) => `${pv.property_name}=${(pv.values || []).join("/")}`),
      });
    }
  }

  const desiredUsed = link.desiredProductFingerprint ?? localFp;
  let classWithDesired = "OTHER";
  if (desiredUsed === remoteFp) {
    classWithDesired =
      link.appliedProductFingerprint === desiredUsed ? "UNCHANGED" : "CONVERGED";
  } else if (link.appliedProductFingerprint == null) {
    classWithDesired =
      link.desiredProductContentVersion > link.appliedProductContentVersion
        ? "CONFLICT"
        : "REMOTE_ONLY";
  } else if (
    desiredUsed === link.appliedProductFingerprint &&
    remoteFp !== link.appliedProductFingerprint
  ) {
    classWithDesired = "REMOTE_ONLY";
  } else if (
    desiredUsed !== link.appliedProductFingerprint &&
    remoteFp === link.appliedProductFingerprint
  ) {
    classWithDesired = "LOCAL_ONLY";
  } else {
    classWithDesired = "CONFLICT";
  }

  console.log(
    "COMPARE",
    JSON.stringify(
      {
        inwTitle: storeItem?.title,
        etsyTitle: remoteTitle,
        listingHttp: listingRes.status,
        invHttp: invRes.status,
        titleMatch: storeItem?.title === remoteTitle,
        descMatch: normalizeDesc(storeItem?.description) === normalizeDesc(remoteDesc),
        storeItemFp: localFp.slice(0, 16),
        remoteFp: remoteFp.slice(0, 16),
        desiredFp: (link.desiredProductFingerprint || "").slice(0, 16),
        appliedFp: (link.appliedProductFingerprint || "").slice(0, 16),
        observedFp: (link.lastObservedProductFingerprint || "").slice(0, 16),
        storeEqualsDesired: localFp === (link.desiredProductFingerprint || ""),
        d: link.desiredProductContentVersion,
        a: link.appliedProductContentVersion,
        classActualInbound: classWithDesired,
        maps: maps.map((m) => {
          const sv = byId.get(m.storeVariantId);
          const remote = offerings.find((o) => o.offeringId === m.etsyOfferingId);
          const available =
            sv?.inventoryState?.onHand != null
              ? Math.max(0, (sv.inventoryState.onHand ?? 0) - (sv.inventoryState.reserved ?? 0))
              : null;
          return {
            offering: m.etsyOfferingId,
            remoteFound: Boolean(remote),
            remoteQty: remote?.qty ?? null,
            inwAvailable: available,
            invDesired: m.inventoryDesiredAvailable,
            invApplied: m.inventoryAppliedAvailable,
            invDv: m.inventoryDesiredVersion,
            invAv: m.inventoryAppliedVersion,
            inwPrice: sv?.priceCents ?? null,
            remotePrice: remote?.priceCents ?? null,
            inwOptions: sv?.options ?? null,
            remoteProps: remote?.props ?? null,
            qtyDiffers: remote ? remote.qty !== available : "UNMAPPED",
            priceDiffers: remote ? remote.priceCents !== sv?.priceCents : "UNMAPPED",
            vd: m.desiredVariantContentVersion,
            va: m.appliedVariantContentVersion,
            vDesiredFp: (m.desiredVariantFingerprint || "").slice(0, 12),
            vAppliedFp: (m.appliedVariantFingerprint || "").slice(0, 12),
          };
        }),
        unmatchedRemote: offerings.filter(
          (o) => !maps.some((m) => m.etsyOfferingId === o.offeringId)
        ),
      },
      null,
      2
    )
  );
}

await prisma.$disconnect();
