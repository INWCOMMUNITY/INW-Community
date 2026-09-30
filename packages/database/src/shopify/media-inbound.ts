import type { Prisma, PrismaClient } from "@prisma/client";
import { randomUUID } from "crypto";
import {
  matchRemoteShopifyMediaToMaps,
  shopifyMediaContentSha256,
  shopifyMediaIdentityFingerprint,
} from "./media-map";
import { planShopifyFieldLevelSync } from "./field-semantic";
import { persistShopifyFieldPlans, markShopifyFieldsApplied } from "./field-state";

export type ShopifyMediaInboundDb = PrismaClient | Prisma.TransactionClient;

export type ShopifyRemoteMediaNode = {
  shopifyMediaId: string;
  sourceUrl?: string | null;
  position: number;
  altText?: string | null;
};

/**
 * Adaptive MEDIA field inbound from a full product re-fetch.
 * Identity: Shopify Media GID + durable ShopifyMediaMap (never URL-alone).
 */
export async function applyShopifyMediaInbound(
  db: ShopifyMediaInboundDb,
  input: {
    evidenceId: string;
    connectionId: string;
    listingLinkId: string;
    memberId: string;
    storeItemId: string;
    remoteMedia: ShopifyRemoteMediaNode[];
  }
): Promise<{ action: string; photos: string[] }> {
  const maps = await db.shopifyMediaMap.findMany({
    where: { shopifyListingLinkId: input.listingLinkId },
  });
  const orderedRemote = [...input.remoteMedia].sort((a, b) => a.position - b.position);

  const match = matchRemoteShopifyMediaToMaps({
    maps,
    remote: orderedRemote.map((row) => ({
      shopifyMediaId: row.shopifyMediaId,
      sourceUrl: row.sourceUrl,
      contentSha256: row.sourceUrl ? shopifyMediaContentSha256(row.sourceUrl) : null,
    })),
  });

  // Ingest unmatched remote media as new durable INW identities (Shopify-added photos).
  const newMaps: Array<{
    inwMediaId: string;
    shopifyMediaId: string;
    sourceUrl: string | null;
    position: number;
    contentSha256: string | null;
  }> = [];
  for (const unmatched of match.unmatchedRemote) {
    const remote = orderedRemote.find((r) => r.shopifyMediaId === unmatched.shopifyMediaId);
    if (!remote) continue;
    const inwMediaId = randomUUID().replace(/-/g, "").slice(0, 24);
    const sourceUrl = remote.sourceUrl?.trim() || null;
    newMaps.push({
      inwMediaId,
      shopifyMediaId: remote.shopifyMediaId,
      sourceUrl,
      position: remote.position,
      contentSha256: sourceUrl ? shopifyMediaContentSha256(sourceUrl) : null,
    });
    await db.shopifyMediaMap.create({
      data: {
        shopifyConnectionId: input.connectionId,
        shopifyListingLinkId: input.listingLinkId,
        memberId: input.memberId,
        storeItemId: input.storeItemId,
        inwMediaId,
        shopifyMediaId: remote.shopifyMediaId,
        sourceUrl,
        contentSha256: sourceUrl ? shopifyMediaContentSha256(sourceUrl) : null,
        position: remote.position,
        altText: remote.altText ?? null,
        status: "ACTIVE",
      },
    });
  }

  // Bind GIDs onto existing maps matched by hash.
  for (const row of match.matched) {
    await db.shopifyMediaMap.updateMany({
      where: {
        shopifyListingLinkId: input.listingLinkId,
        inwMediaId: row.inwMediaId,
      },
      data: {
        shopifyMediaId: row.shopifyMediaId,
        status: "ACTIVE",
      },
    });
  }

  const mapsAfter = await db.shopifyMediaMap.findMany({
    where: { shopifyListingLinkId: input.listingLinkId, status: "ACTIVE" },
  });
  const byGid = new Map(
    mapsAfter.filter((m) => m.shopifyMediaId).map((m) => [m.shopifyMediaId!, m])
  );

  const remoteOrderedIds: string[] = [];
  const remotePhotos: string[] = [];
  for (const remote of orderedRemote) {
    const mapped = byGid.get(remote.shopifyMediaId);
    if (!mapped) continue;
    remoteOrderedIds.push(mapped.inwMediaId);
    // Prefer durable INW source URL. Shopify CDN rewrites must not replace
    // the seller's blob URL or desire planning invents new media identities.
    const keptSourceUrl = mapped.sourceUrl?.trim() || remote.sourceUrl?.trim() || null;
    if (keptSourceUrl) remotePhotos.push(keptSourceUrl);
    await db.shopifyMediaMap.update({
      where: { id: mapped.id },
      data: {
        position: remote.position,
        // Keep existing INW URL when present; only fill when map had none.
        sourceUrl: mapped.sourceUrl?.trim() || remote.sourceUrl?.trim() || mapped.sourceUrl,
        altText: remote.altText ?? mapped.altText,
      },
    });
  }

  // Shopify-removed: ACTIVE maps whose GID is absent from remote → REMOVED when remote-only.
  const remoteGids = new Set(orderedRemote.map((r) => r.shopifyMediaId));
  const removedLocally: string[] = [];
  for (const map of mapsAfter) {
    if (map.shopifyMediaId && !remoteGids.has(map.shopifyMediaId)) {
      removedLocally.push(map.inwMediaId);
    }
  }

  const storeItem = await db.storeItem.findUniqueOrThrow({
    where: { id: input.storeItemId },
    select: { photos: true },
  });
  const localPlan = await import("./media-map").then((m) =>
    m.planShopifyMediaDesireFromPhotos(storeItem.photos, mapsAfter)
  );
  const localIds = localPlan.desired.map((d) => d.inwMediaId);
  const fieldState = await db.shopifyListingFieldState.findUnique({
    where: {
      shopifyListingLinkId_storeVariantId_fieldKey: {
        shopifyListingLinkId: input.listingLinkId,
        storeVariantId: "",
        fieldKey: "MEDIA",
      },
    },
  });

  const plan = planShopifyFieldLevelSync([
    {
      field: "MEDIA",
      base: fieldState?.baseFingerprint ?? null,
      local: shopifyMediaIdentityFingerprint(localIds),
      remote: shopifyMediaIdentityFingerprint(remoteOrderedIds),
      hasLocalSemanticEdit: Boolean(fieldState?.localFingerprint),
    },
  ]);

  await persistShopifyFieldPlans(db, {
    connectionId: input.connectionId,
    listingLinkId: input.listingLinkId,
    memberId: input.memberId,
    storeItemId: input.storeItemId,
    plans: plan.plans,
    evidenceId: input.evidenceId,
  });

  const mediaPlan = plan.plans[0];
  if (mediaPlan.action === "CONFLICT") {
    return { action: "MEDIA_CONFLICT", photos: storeItem.photos };
  }

  if (mediaPlan.action === "CONVERGED") {
    // Identities already match — do not rewrite StoreItem.photos (Shopify CDN URLs
    // would snap the listing UI and break URL-based desire reuse).
    await markShopifyFieldsApplied(db, {
      listingLinkId: input.listingLinkId,
      fields: [{ field: "MEDIA", fingerprint: shopifyMediaIdentityFingerprint(remoteOrderedIds) }],
    });
    return { action: "MEDIA_CONVERGED", photos: storeItem.photos };
  }

  if (mediaPlan.action === "PULL_REMOTE") {
    // Mark removed maps and update canonical photo URLs from remote order.
    if (removedLocally.length > 0) {
      await db.shopifyMediaMap.updateMany({
        where: {
          shopifyListingLinkId: input.listingLinkId,
          inwMediaId: { in: removedLocally },
        },
        data: { status: "REMOVED" },
      });
    }
    const photos = remotePhotos;
    await db.storeItem.update({
      where: { id: input.storeItemId },
      data: { photos },
    });
    await markShopifyFieldsApplied(db, {
      listingLinkId: input.listingLinkId,
      fields: [{ field: "MEDIA", fingerprint: shopifyMediaIdentityFingerprint(remoteOrderedIds) }],
    });
    return { action: "MEDIA_PULL", photos };
  }

  // LOCAL_ONLY / PUSH — leave photos; outbound sync will push.
  if (newMaps.length > 0 && mediaPlan.action === "UNCHANGED") {
    // Remote added while local fingerprint matched stale empty — treat as pull.
    const photos = remotePhotos;
    await db.storeItem.update({ where: { id: input.storeItemId }, data: { photos } });
    await markShopifyFieldsApplied(db, {
      listingLinkId: input.listingLinkId,
      fields: [{ field: "MEDIA", fingerprint: shopifyMediaIdentityFingerprint(remoteOrderedIds) }],
    });
    return { action: "MEDIA_PULL", photos };
  }

  return { action: mediaPlan.action, photos: storeItem.photos };
}
