/**
 * Read-only: Bear Clock photos on INW + channel lastPushedPhotos.
 * Run from apps/main: npx tsx scripts/debug-bear-photos-snapshot.ts
 */
import fs from "fs";
import path from "path";

function loadEnvFile(filePath: string): void {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, "utf8");
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] == null || process.env[key] === "") process.env[key] = value;
  }
}

loadEnvFile(path.resolve(process.cwd(), "../../.env"));
loadEnvFile(path.resolve(process.cwd(), "../../.env.local"));
loadEnvFile(path.resolve(process.cwd(), ".env"));
loadEnvFile(path.resolve(process.cwd(), ".env.local"));

const LOG_PATHS = [
  path.resolve(process.cwd(), "../../debug-8e1c2a.log"),
  path.resolve(process.cwd(), "../../.cursor/debug-8e1c2a.log"),
];
const INGEST = "http://127.0.0.1:7258/ingest/d5ed32a3-508e-4e39-8711-9dcd44c7de36";
const ITEM_ID = "cmt7vumcl000dxjujvgwe8dob";

function hostFamily(url: string): string {
  try {
    const host = new URL(url.startsWith("//") ? `https:${url}` : url).hostname.toLowerCase();
    if (host.includes("blob.vercel-storage.com")) return "inw-blob";
    if (host.includes("ebayimg") || host.includes("ebaystatic")) return "ebay-eps";
    if (host.includes("etsystatic")) return "etsy";
    if (host.includes("wixstatic")) return "wix";
    if (host.includes("shopify")) return "shopify";
    return host;
  } catch {
    return "invalid";
  }
}

function dbg(hypothesisId: string, message: string, data: Record<string, unknown>) {
  const payload = {
    sessionId: "8e1c2a",
    runId: "photo-wipe",
    hypothesisId,
    location: "debug-bear-photos-snapshot.ts",
    message,
    data,
    timestamp: Date.now(),
  };
  // #region agent log
  fetch(INGEST, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "8e1c2a" },
    body: JSON.stringify(payload),
  }).catch(() => {});
  const line = JSON.stringify(payload) + "\n";
  for (const p of LOG_PATHS) {
    try {
      fs.appendFileSync(p, line);
    } catch {
      /* ignore */
    }
  }
  // #endregion
  console.log(JSON.stringify({ hypothesisId, message, data }, null, 2));
}

function photoSummary(photos: unknown): { count: number; families: Record<string, number>; samples: string[] } {
  const urls = Array.isArray(photos)
    ? photos.filter((u): u is string => typeof u === "string" && u.trim().length > 0)
    : [];
  const families: Record<string, number> = {};
  for (const url of urls) {
    const fam = hostFamily(url);
    families[fam] = (families[fam] ?? 0) + 1;
  }
  return {
    count: urls.length,
    families,
    samples: urls.slice(0, 3).map((u) => u.slice(0, 80)),
  };
}

async function main() {
  const { prisma } = await import("database");
  const item = await prisma.storeItem.findUnique({
    where: { id: ITEM_ID },
    select: {
      title: true,
      photos: true,
      variants: true,
      updatedAt: true,
      quantity: true,
      status: true,
    },
  });
  if (!item) {
    dbg("P", "item missing", { ITEM_ID });
    await prisma.$disconnect();
    return;
  }

  const variants = item.variants;
  let variantPhotoCount = 0;
  if (variants && typeof variants === "object" && !Array.isArray(variants)) {
    const rec = variants as { axes?: { photosByValue?: Record<string, string[]> }[]; skus?: { photos?: string[] }[] };
    for (const axis of rec.axes ?? []) {
      for (const urls of Object.values(axis.photosByValue ?? {})) {
        variantPhotoCount += Array.isArray(urls) ? urls.length : 0;
      }
    }
    for (const sku of rec.skus ?? []) {
      variantPhotoCount += Array.isArray(sku.photos) ? sku.photos.length : 0;
    }
  } else if (Array.isArray(variants)) {
    for (const axis of variants as { options?: { photos?: string[] }[] }[]) {
      for (const opt of axis.options ?? []) {
        variantPhotoCount += Array.isArray(opt.photos) ? opt.photos.length : 0;
      }
    }
  }

  dbg("P", "inw listing photos", {
    title: item.title,
    qty: item.quantity,
    status: item.status,
    updatedAt: item.updatedAt.toISOString(),
    listingPhotos: photoSummary(item.photos),
    variantPhotoCount,
    variantIsArray: Array.isArray(variants),
    variantKeys:
      variants && typeof variants === "object" && !Array.isArray(variants)
        ? Object.keys(variants as object)
        : null,
    imageAxis:
      variants && typeof variants === "object" && !Array.isArray(variants)
        ? (variants as { imageAxis?: unknown }).imageAxis ?? null
        : null,
  });

  const urlChecks: { url: string; status: number | null; ok: boolean }[] = [];
  for (const raw of Array.isArray(item.photos) ? item.photos.slice(0, 3) : []) {
    if (typeof raw !== "string" || !raw.startsWith("http")) continue;
    try {
      const res = await fetch(raw, { method: "HEAD", redirect: "follow" });
      urlChecks.push({ url: raw.slice(0, 90), status: res.status, ok: res.ok });
    } catch {
      urlChecks.push({ url: raw.slice(0, 90), status: null, ok: false });
    }
  }
  dbg("P", "listing photo URL HEAD", { urlChecks });

  const links = await prisma.channelListingLink.findMany({
    where: { storeItemId: ITEM_ID },
    select: {
      provider: true,
      syncStatus: true,
      syncError: true,
      lastPushedAt: true,
      lastPushedPhotos: true,
      lastInboundAt: true,
      updatedAt: true,
    },
  });
  dbg("P", "channel lastPushedPhotos", {
    rows: links.map((l) => ({
      provider: l.provider,
      syncStatus: l.syncStatus,
      syncError: l.syncError?.slice(0, 100) ?? null,
      lastPushedAt: l.lastPushedAt?.toISOString() ?? null,
      lastInboundAt: l.lastInboundAt?.toISOString() ?? null,
      linkUpdatedAt: l.updatedAt.toISOString(),
      lastPushed: photoSummary(l.lastPushedPhotos),
    })),
  });

  const activity = await prisma.sellerActivityLog.findMany({
    where: { entityType: "store_item", entityId: ITEM_ID, createdAt: { gte: new Date("2026-09-08T20:00:00.000Z") } },
    orderBy: { createdAt: "desc" },
    take: 12,
    select: { action: true, createdAt: true, detail: true },
  });
  dbg("P", "recent activity", {
    rows: activity.map((a) => {
      const detail = a.detail && typeof a.detail === "object" ? (a.detail as Record<string, unknown>) : {};
      const changed = Array.isArray(detail.changedFields) ? detail.changedFields : [];
      return {
        action: a.action,
        createdAt: a.createdAt.toISOString(),
        changedFields: changed,
        hasPhotosField: changed.includes("photos") || changed.includes("variants"),
      };
    }),
  });

  const logs = await prisma.channelSyncLog.findMany({
    where: { storeItemId: ITEM_ID, createdAt: { gte: new Date("2026-09-09T03:00:00.000Z") } },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { provider: true, action: true, createdAt: true, detail: true },
  });
  dbg("P", "sync logs since 03:00", {
    rows: logs.map((r) => ({
      provider: r.provider,
      action: r.action,
      createdAt: r.createdAt.toISOString(),
      detail: r.detail?.slice(0, 140) ?? null,
    })),
  });

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
