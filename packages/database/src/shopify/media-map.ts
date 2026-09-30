import { createHash, randomUUID } from "crypto";
import type { Prisma, PrismaClient, ShopifyMediaMap, ShopifyMediaMapStatus } from "@prisma/client";
import { normalizeShopifyPhotoUrls } from "./content-fingerprint";
import { shopifyFieldFingerprint } from "./field-fingerprint";

export type ShopifyMediaMapDb = PrismaClient | Prisma.TransactionClient;

export type ShopifyMediaDesireRow = {
  inwMediaId: string;
  sourceUrl: string;
  position: number;
  contentSha256: string;
};

/** Stable content hash of a photo URL bytes (not used as durable identity). */
export function shopifyMediaContentSha256(sourceUrl: string): string {
  return createHash("sha256").update(sourceUrl.trim(), "utf8").digest("hex");
}

/** MEDIA field fingerprint from ordered durable media ids (not URLs). */
export function shopifyMediaIdentityFingerprint(inwMediaIds: string[]): string {
  return shopifyFieldFingerprint("MEDIA", inwMediaIds);
}

/**
 * Ensure durable INW media ids for each photo URL on a listing.
 * Identity is inwMediaId, never the URL alone.
 * Matching existing ACTIVE maps by sourceUrl reuses identity across URL-stable edits.
 */
export function planShopifyMediaDesireFromPhotos(
  photos: string[] | null | undefined,
  existing: Array<Pick<ShopifyMediaMap, "inwMediaId" | "sourceUrl" | "status" | "position">>
): {
  desired: ShopifyMediaDesireRow[];
  mediaFingerprint: string;
  toAdd: ShopifyMediaDesireRow[];
  toRemove: string[];
  toReorder: Array<{ inwMediaId: string; position: number; sourceUrl: string }>;
} {
  const urls = normalizeShopifyPhotoUrls(photos);
  const active = existing.filter((row) => row.status === "ACTIVE");
  const byUrl = new Map(
    active
      .filter((row) => typeof row.sourceUrl === "string" && row.sourceUrl.trim())
      .map((row) => [row.sourceUrl!.trim(), row])
  );

  const desired: ShopifyMediaDesireRow[] = urls.map((url, position) => {
    const prior = byUrl.get(url);
    const inwMediaId = prior?.inwMediaId ?? randomUUID().replace(/-/g, "").slice(0, 24);
    return {
      inwMediaId,
      sourceUrl: url,
      position,
      contentSha256: shopifyMediaContentSha256(url),
    };
  });

  const desiredIds = new Set(desired.map((row) => row.inwMediaId));
  const toRemove = active
    .filter((row) => !desiredIds.has(row.inwMediaId))
    .map((row) => row.inwMediaId);

  const existingById = new Map(active.map((row) => [row.inwMediaId, row]));
  const toAdd = desired.filter((row) => !existingById.has(row.inwMediaId));
  const toReorder = desired.filter((row) => {
    const prior = existingById.get(row.inwMediaId);
    return prior != null && prior.position !== row.position;
  });

  const mediaFingerprint = shopifyMediaIdentityFingerprint(desired.map((row) => row.inwMediaId));

  return { desired, mediaFingerprint, toAdd, toRemove, toReorder };
}

/** Persist desired media map rows (ACTIVE / REMOVED). No Shopify network I/O. */
export async function upsertShopifyMediaDesireMaps(
  db: ShopifyMediaMapDb,
  input: {
    connectionId: string;
    listingLinkId: string;
    memberId: string;
    storeItemId: string;
    desired: ShopifyMediaDesireRow[];
    removeInwMediaIds: string[];
  }
): Promise<void> {
  for (const row of input.desired) {
    await db.shopifyMediaMap.upsert({
      where: {
        shopifyListingLinkId_inwMediaId: {
          shopifyListingLinkId: input.listingLinkId,
          inwMediaId: row.inwMediaId,
        },
      },
      create: {
        shopifyConnectionId: input.connectionId,
        shopifyListingLinkId: input.listingLinkId,
        memberId: input.memberId,
        storeItemId: input.storeItemId,
        inwMediaId: row.inwMediaId,
        sourceUrl: row.sourceUrl,
        contentSha256: row.contentSha256,
        position: row.position,
        status: "ACTIVE" satisfies ShopifyMediaMapStatus,
      },
      update: {
        sourceUrl: row.sourceUrl,
        contentSha256: row.contentSha256,
        position: row.position,
        status: "ACTIVE",
      },
    });
  }
  if (input.removeInwMediaIds.length > 0) {
    await db.shopifyMediaMap.updateMany({
      where: {
        shopifyListingLinkId: input.listingLinkId,
        inwMediaId: { in: input.removeInwMediaIds },
      },
      data: { status: "REMOVED" },
    });
  }
}

/**
 * Match remote Shopify media GIDs onto durable maps.
 * Prefer shopifyMediaId; else contentSha256; never invent identity from URL alone for new remotes
 * without creating a PENDING_LOCAL map row.
 */
export function matchRemoteShopifyMediaToMaps(input: {
  maps: Array<
    Pick<
      ShopifyMediaMap,
      "inwMediaId" | "shopifyMediaId" | "contentSha256" | "sourceUrl" | "status"
    >
  >;
  remote: Array<{ shopifyMediaId: string; sourceUrl?: string | null; contentSha256?: string | null }>;
}): {
  matched: Array<{ inwMediaId: string; shopifyMediaId: string }>;
  unmatchedRemote: Array<{ shopifyMediaId: string; sourceUrl?: string | null }>;
} {
  const active = input.maps.filter((m) => m.status === "ACTIVE" || m.status === "PENDING_REMOTE");
  const byGid = new Map(
    active.filter((m) => m.shopifyMediaId).map((m) => [m.shopifyMediaId!, m.inwMediaId])
  );
  const bySha = new Map(
    active.filter((m) => m.contentSha256).map((m) => [m.contentSha256!, m.inwMediaId])
  );
  const matched: Array<{ inwMediaId: string; shopifyMediaId: string }> = [];
  const unmatchedRemote: Array<{ shopifyMediaId: string; sourceUrl?: string | null }> = [];
  const used = new Set<string>();

  for (const remote of input.remote) {
    const byId = byGid.get(remote.shopifyMediaId);
    if (byId && !used.has(byId)) {
      matched.push({ inwMediaId: byId, shopifyMediaId: remote.shopifyMediaId });
      used.add(byId);
      continue;
    }
    const sha =
      remote.contentSha256 ??
      (remote.sourceUrl ? shopifyMediaContentSha256(remote.sourceUrl) : null);
    const byHash = sha ? bySha.get(sha) : undefined;
    if (byHash && !used.has(byHash)) {
      matched.push({ inwMediaId: byHash, shopifyMediaId: remote.shopifyMediaId });
      used.add(byHash);
      continue;
    }
    unmatchedRemote.push({
      shopifyMediaId: remote.shopifyMediaId,
      sourceUrl: remote.sourceUrl,
    });
  }

  return { matched, unmatchedRemote };
}
