import { prisma } from "database";
import { getConnectionContext } from "./connection";
import { persistRemoteDeletedPending } from "./listing-link-flags";
import {
  applyRemoteCategoryToStoreItem,
  applyRemoteShippingToStoreItem,
  applyRemoteVariantsToStoreItem,
  applyRemoteAspectsToStoreItem,
} from "./apply-remote-meta";
import { applyRemoteStockFromChannel } from "./apply-remote-listing";
import { etsyRemoteQuantityIsKnown } from "./etsy/listing-exists";
import { getAdapter } from "./registry";
import { indexEbayRemoteListings } from "./ebay/mapping";
import { updateStoreItemOnChannels } from "./outbound";
import { channelSyncSucceeded } from "./sync-inventory";
import {
  inwChangedSinceBaseline,
  resolveSyncDirection,
  syncContentHash,
  syncMetaHash,
  SYNC_ECHO_SKEW_MS,
  type SyncDirection,
} from "./sync-baseline";
import type { ChannelProvider, RemoteListingSummary } from "./types";
import { sumVariantQuantities, remoteVariantsIndicateChange, remoteVariantPricesLookLikeListingFlatten, remoteVariantPricesLookUntrusted, stalePushedVariantPricesShouldRepush, variantsFingerprint, variantPricesFingerprint } from "./variant-sync";
import { hasOptionQuantities, sumOptionQuantities } from "@/lib/store-item-variants";
import { isMadeToOrderTracking, matrixHasKnownSkuPrices, normalizeVariantMatrix, optionValuesKey } from "@/lib/listing-variant-matrix";
import { matchInwSkuRow } from "./variant-match";
import { recordVariantPriceTrace, type VariantPriceTraceRow } from "./sync-trace";
import { isComboInventoryFailedError } from "./combo-sync";
import { readLastPushedVariantPricesHash } from "./listing-conflict-json";

function inwMissingVariants(variants: unknown): boolean {
  if (variants == null) return true;
  const matrix = normalizeVariantMatrix(variants);
  if (matrix && matrix.axes.length > 0) return false;
  if (!Array.isArray(variants)) return true;
  return variants.length === 0;
}

function remoteVariantQtySum(remote: RemoteListingSummary): number {
  if (!remote.variants) return 0;
  return sumVariantQuantities(remote.variants) || sumOptionQuantities(remote.variants);
}

function inwAllOptionQtyZero(variants: unknown): boolean {
  if (inwMissingVariants(variants)) return false;
  if (!hasOptionQuantities(variants)) return false;
  return sumOptionQuantities(variants) === 0;
}

type ConnectionRow = {
  id: string;
  memberId: string;
  provider: string;
  externalShopId: string | null;
  accessTokenEncrypted: string | null;
  refreshTokenEncrypted: string | null;
  tokenExpiresAt: Date | null;
  status: string;
  etsyShippingProfileId: string | null;
  config?: unknown;
};

type LinkRow = {
  id: string;
  storeItemId: string;
  externalListingId: string;
  conflictDetails: unknown;
  syncError: string | null;
  syncBaselineHash: string | null;
  syncBaselineMetaHash: string | null;
  syncBaselineVariantsHash: string | null;
  syncBaselineQty: number | null;
  syncBaselineAt: Date | null;
  storeItem: {
    title: string;
    description: string | null;
    photos: string[];
    priceCents: number;
    quantity: number;
    category: string | null;
    subcategory: string | null;
    secondaryCategory: string | null;
    shippingCostCents: number | null;
    variants: unknown;
    status: string;
    updatedAt: Date;
    inventoryTracking?: string | null;
  };
};

async function writeBaseline(
  linkId: string,
  storeItemId: string,
  remote: RemoteListingSummary | null,
  pushed: boolean
): Promise<void> {
  const item = await prisma.storeItem.findUnique({
    where: { id: storeItemId },
    select: {
      title: true,
      description: true,
      photos: true,
      priceCents: true,
      quantity: true,
      category: true,
      subcategory: true,
      secondaryCategory: true,
      shippingCostCents: true,
      variants: true,
    },
  });
  if (!item) return;
  const baselineAt = pushed
    ? new Date(Date.now() + SYNC_ECHO_SKEW_MS)
    : remote?.remoteUpdatedAt ?? new Date();
  await prisma.channelListingLink
    .update({
      where: { id: linkId },
      data: {
        syncBaselineHash: syncContentHash(item),
        syncBaselineMetaHash: syncMetaHash(item),
        syncBaselineVariantsHash: variantsFingerprint(item.variants),
        syncBaselineQty: item.quantity,
        syncBaselineAt: baselineAt,
      },
    })
    .catch((e) => console.error("[channels] write baseline failed", { linkId, error: String(e) }));
}

/** Two-way meta reconcile (category, shipping, variants) for all linked providers. */
export async function reconcileConnectionInboundMeta(
  connection: ConnectionRow
): Promise<{ updated: number; removed: number }> {
  const provider = connection.provider as ChannelProvider;

  // Respect the store's sync direction, mirroring the catalog reconcile. Without this the
  // variant/meta reconcile kept pulling remote variant prices onto INW (and fanning them out)
  // even for a store the seller set to Paused — so pausing a store did NOT isolate it.
  // Skip inbound when the store may not write back to INW: "paused" (inert) or "push_only"
  // (INW->channel only). "pull_only" still wants inbound, and its push side is separately
  // blocked in outbound.ts, so it is allowed to run here.
  const connConfig = (connection.config ?? {}) as Record<string, unknown>;
  const syncDirection = (connConfig.syncDirection as string) ?? "two_way";
  if (syncDirection === "paused" || syncDirection === "push_only") {
    console.log("[channels] meta reconcile skipped; sync direction blocks inbound", {
      connectionId: connection.id,
      provider,
      syncDirection,
    });
    return { updated: 0, removed: 0 };
  }

  const ctx = await getConnectionContext(connection);
  if (!ctx) return { updated: 0, removed: 0 };

  const linkCount = await prisma.channelListingLink.count({
    where: { connectionId: connection.id, provider, syncEnabled: true },
  });
  if (linkCount === 0) return { updated: 0, removed: 0 };

  let remoteList: RemoteListingSummary[];
  try {
    remoteList = await getAdapter(provider).listRemoteListings(ctx, {
      skipPhotoEnrichment: provider === "ebay",
    });
  } catch (e) {
    console.error("[channels] inbound meta list failed", { provider, error: String(e) });
    return { updated: 0, removed: 0 };
  }

  if (remoteList.length === 0) {
    if (provider !== "wix") return { updated: 0, removed: 0 };
    const emptyLinks = await prisma.channelListingLink.findMany({
      where: { connectionId: connection.id, provider, syncEnabled: true },
      select: {
        id: true,
        conflictDetails: true,
        storeItem: { select: { status: true } },
      },
    });
    let removed = 0;
    for (const link of emptyLinks) {
      if (link.storeItem.status === "sold_out" || link.storeItem.status === "inactive") continue;
      const flagged = await persistRemoteDeletedPending({
        linkId: link.id,
        conflictDetails: link.conflictDetails,
        provider,
      });
      if (flagged) removed += 1;
    }
    return { updated: 0, removed };
  }

  const remoteById =
    provider === "ebay"
      ? indexEbayRemoteListings(remoteList)
      : new Map(remoteList.map((r) => [r.externalListingId, r]));

  if (provider === "wix" && ctx) {
    const { attachWixVariantsToSummary, fetchWixV1Product } = await import("./wix/collections");
    const { wixSiteIdFromConn } = await import("./wix/site");
    const siteId = wixSiteIdFromConn(ctx);
    const wixOpts = siteId ? { siteId } : {};
    for (const r of remoteList) {
      if (!r.externalListingId) continue;
      const needsFull =
        !r.variantsKnown ||
        (r.variantsKnown && remoteVariantQtySum(r) === 0) ||
        (r.variantsKnown && !matrixHasKnownSkuPrices(r.variants));
      if (!needsFull) continue;
      const full = await fetchWixV1Product(ctx.accessToken, r.externalListingId, wixOpts);
      if (full) attachWixVariantsToSummary(r, full);
    }
  }

  // eBay list/inventory payloads omit per-variation prices. Overlay live GetItem variations
  // (each carries StartPrice) so the variant-price reconcile below sees eBay's real per-SKU
  // prices with last-write-wins — otherwise eBay variant price edits never reach INW/siblings.
  if (provider === "ebay" && ctx) {
    const { resolveEbayLegacyListingId } = await import("./ebay/mapping");
    const { fetchEbayItemDetails } = await import("./ebay/trading");
    for (const link of await prisma.channelListingLink.findMany({
      where: { connectionId: connection.id, provider: "ebay", syncEnabled: true },
      select: { externalListingId: true },
    })) {
      const r = remoteById.get(link.externalListingId);
      if (!r) continue;
      if (r.variantsKnown && matrixHasKnownSkuPrices(r.variants)) continue;
      const legacyId =
        resolveEbayLegacyListingId(link.externalListingId) ??
        resolveEbayLegacyListingId(r.externalListingId ?? "");
      if (!legacyId) continue;
      try {
        const details = await fetchEbayItemDetails(ctx.accessToken, legacyId);
        if (details.listingEnded || details.variants == null) continue;
        r.variants = details.variants;
        r.variantsKnown = true;
      } catch (e) {
        console.warn("[channels] eBay meta variant hydrate failed", {
          externalListingId: link.externalListingId,
          legacyId,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
  }

  const etsyInventoryEnriched = new Set<string>();
  if (provider === "etsy" && ctx) {
    const { enrichEtsyListingSummaryWithInventory } = await import("./etsy/variants");
    for (const link of await prisma.channelListingLink.findMany({
      where: { connectionId: connection.id, provider: "etsy", syncEnabled: true },
      select: { externalListingId: true },
    })) {
      const r = remoteById.get(link.externalListingId);
      if (!r) continue;
      const loaded = await enrichEtsyListingSummaryWithInventory(
        ctx.accessToken,
        r,
        connection.externalShopId
      );
      if (loaded) {
        etsyInventoryEnriched.add(link.externalListingId);
        etsyInventoryEnriched.add(r.externalListingId);
      }
    }
  }

  const links = (await prisma.channelListingLink.findMany({
    where: { connectionId: connection.id, provider, syncEnabled: true },
    select: {
      id: true,
      storeItemId: true,
      externalListingId: true,
      conflictDetails: true,
      syncError: true,
      syncBaselineHash: true,
      syncBaselineMetaHash: true,
      syncBaselineVariantsHash: true,
      syncBaselineQty: true,
      syncBaselineAt: true,
      storeItem: {
        select: {
          title: true,
          description: true,
          photos: true,
          priceCents: true,
          quantity: true,
          category: true,
          subcategory: true,
          secondaryCategory: true,
          shippingCostCents: true,
          variants: true,
          status: true,
          updatedAt: true,
          inventoryTracking: true,
        },
      },
    },
  })) as LinkRow[];

  let updated = 0;
  let removed = 0;

  for (const link of links) {
    const remote = remoteById.get(link.externalListingId);
    if (!remote) {
      if (provider === "wix") {
        if (link.storeItem.status !== "sold_out" && link.storeItem.status !== "inactive") {
          const flagged = await persistRemoteDeletedPending({
            linkId: link.id,
            conflictDetails: link.conflictDetails,
            provider,
          });
          if (flagged) removed += 1;
        }
      }
      continue;
    }

    const item = link.storeItem;

    // Backfill listings imported before variant qty parsing was fixed (Wix / Etsy inventory API).
    if (
      remote.variantsKnown &&
      remote.variants &&
      !isComboInventoryFailedError(link.syncError) &&
      (inwMissingVariants(item.variants) ||
        (provider === "wix" &&
          inwAllOptionQtyZero(item.variants) &&
          remoteVariantQtySum(remote) > 0) ||
        (provider === "etsy" && inwAllOptionQtyZero(item.variants) && remoteVariantQtySum(remote) > 0))
    ) {
      const vars = await applyRemoteVariantsToStoreItem(link.storeItemId, remote, provider);
      if (vars) {
        await prisma.channelListingLink.update({
          where: { id: link.id },
          data: { lastInboundAt: new Date() },
        });
        await writeBaseline(link.id, link.storeItemId, remote, false);
        updated += 1;
        continue;
      }
    }

    // Category/shipping use the listing-level timestamp to detect a remote edit.
    const inwMetaHash = syncMetaHash(item);
    const baseMetaHash = link.syncBaselineMetaHash ?? inwMetaHash;
    const baseAt = link.syncBaselineAt ?? remote.remoteUpdatedAt ?? new Date();
    const inwMetaChanged = inwChangedSinceBaseline({
      hashDiffers: inwMetaHash !== baseMetaHash,
      inwUpdatedAt: item.updatedAt,
      baselineAt: baseAt,
    });
    const remoteMetaChanged =
      remote.remoteUpdatedAt != null && remote.remoteUpdatedAt.getTime() > baseAt.getTime();
    const metaDecision: SyncDirection = resolveSyncDirection({
      inwChanged: inwMetaChanged,
      remoteChanged: remoteMetaChanged,
      inwUpdatedAt: item.updatedAt,
      remoteUpdatedAt: remote.remoteUpdatedAt ?? null,
    });

    // Per-option quantities use a content fingerprint (not the listing timestamp): some providers
    // (e.g. Wix Stores v2 inventory) change stock without bumping the product's lastUpdated, so a
    // timestamp-only check would miss remote per-size edits. Provider-agnostic; eBay (variantsKnown
    // false) yields no remote change, so it stays push-only with no regression.
    const inwVarFp = variantsFingerprint(item.variants);
    const baseVarFp = link.syncBaselineVariantsHash ?? inwVarFp;
    let inwVarChanged = inwChangedSinceBaseline({
      hashDiffers: inwVarFp !== baseVarFp,
      inwUpdatedAt: item.updatedAt,
      baselineAt: baseAt,
    });
    let remoteVarChanged = remoteVariantsIndicateChange({
      remoteVariantsKnown: remote.variantsKnown === true,
      remoteVariants: remote.variants,
      inwVariants: item.variants,
      baselineVarHash: link.syncBaselineVariantsHash,
    });
    // We stamped the hub fingerprint after outbound even when Wix/eBay never persisted
    // per-SKU prices. Cron then sees the old $1 channel snapshot as a "remote edit" and
    // pulls it over INW. If hub still matches last-pushed prices, re-push instead.
    // Same when every remote SKU equals the listing price — that is the Wix product PATCH
    // flatten, including the webhook that fires before lastPushedAt is written.
    if (
      stalePushedVariantPricesShouldRepush({
        inwPriceFingerprint: variantPricesFingerprint(item.variants),
        lastPushedPriceFingerprint: readLastPushedVariantPricesHash(link.conflictDetails),
        remotePriceFingerprint: variantPricesFingerprint(remote.variants),
        remotePricesKnown: matrixHasKnownSkuPrices(remote.variants),
      }) ||
      remoteVariantPricesLookLikeListingFlatten({
        remoteVariants: remote.variants,
        inwVariants: item.variants,
        listingPriceCents: item.priceCents,
      }) ||
      remoteVariantPricesLookUntrusted({
        remoteVariants: remote.variants,
        inwVariants: item.variants,
      })
    ) {
      inwVarChanged = true;
      remoteVarChanged = false;
    }
    const varDecision: SyncDirection = resolveSyncDirection({
      inwChanged: inwVarChanged,
      remoteChanged: remoteVarChanged,
      inwUpdatedAt: item.updatedAt,
      remoteUpdatedAt: remote.remoteUpdatedAt ?? null,
    });

    // Variant-price observability for the reconcile side: record INW's intended per-SKU price
    // vs what the channel snapshot reported (verified), the match quality, and the decision.
    // This is how we can tell whether a snap-back was a real remote edit or a flatten pull.
    if (
      varDecision !== "noop" &&
      (matrixHasKnownSkuPrices(item.variants) || matrixHasKnownSkuPrices(remote.variants))
    ) {
      const inwMatrix = normalizeVariantMatrix(item.variants);
      const remoteMatrix = normalizeVariantMatrix(remote.variants);
      const rows: VariantPriceTraceRow[] = (inwMatrix?.skus ?? []).map((s) => {
        const m = remoteMatrix ? matchInwSkuRow(remoteMatrix, { sku: s.sku ?? null, options: s.options }) : null;
        return {
          key: optionValuesKey(s.options) || (s.sku ?? ""),
          options: s.options,
          sku: s.sku ?? null,
          intendedCents: s.priceCents ?? null,
          verifiedCents: m?.row?.priceCents ?? null,
          matchQuality: m?.quality ?? "none",
        };
      });
      recordVariantPriceTrace({
        memberId: connection.memberId,
        provider,
        storeItemId: link.storeItemId,
        direction: "reconcile",
        decision: `var:${varDecision}${remoteVarChanged ? "" : inwVarChanged ? " (repush/guard)" : ""}`,
        rows,
      });
    }

    const etsySimpleQtyPull =
      provider === "etsy" &&
      varDecision === "noop" &&
      etsyRemoteQuantityIsKnown({
        quantity: remote.quantity,
        quantityKnown: remote.quantityKnown,
        inventoryEnriched:
          etsyInventoryEnriched.has(link.externalListingId) ||
          etsyInventoryEnriched.has(remote.externalListingId),
      }) &&
      remote.quantity !== item.quantity &&
      !hasOptionQuantities(item.variants);

    if (metaDecision === "noop" && varDecision === "noop" && !etsySimpleQtyPull) {
      if (link.syncBaselineMetaHash == null || link.syncBaselineVariantsHash == null) {
        await writeBaseline(link.id, link.storeItemId, remote, false);
      }
      continue;
    }

    // Pull remote-winning aspects first so a subsequent push carries the merged state.
    let pulled = false;
    if (metaDecision === "pull") {
      const cat = await applyRemoteCategoryToStoreItem(link.storeItemId, remote, provider);
      const ship = await applyRemoteShippingToStoreItem(link.storeItemId, remote);
      const asp = await applyRemoteAspectsToStoreItem(link.storeItemId, remote);
      pulled = cat || ship || asp || pulled;
    }
    if (varDecision === "pull" && !isComboInventoryFailedError(link.syncError)) {
      const skipMtoZero =
        isMadeToOrderTracking(item.inventoryTracking) && remoteVariantQtySum(remote) === 0;
      if (!skipMtoZero) {
        const vars = await applyRemoteVariantsToStoreItem(link.storeItemId, remote, provider);
        pulled = vars || pulled;
      }
    }
    if (etsySimpleQtyPull) {
      const qty = await applyRemoteStockFromChannel(link.storeItemId, remote, {
        provider,
        memberId: connection.memberId,
      });
      pulled = qty || pulled;
    }

    let attemptedPush = false;
    let pushOk = false;
    if (metaDecision === "push" || varDecision === "push") {
      attemptedPush = true;
      pushOk = channelSyncSucceeded(await updateStoreItemOnChannels(link.storeItemId), provider);
    }

    if (pulled && !attemptedPush) {
      // Fan a just-pulled remote edit out to siblings with the SOURCE timestamp, not the
      // post-apply now(), so a sibling that already has a newer copy is not reverted.
      await updateStoreItemOnChannels(link.storeItemId, {
        skipProviders: [provider],
        sourceUpdatedAt: remote.remoteUpdatedAt ?? undefined,
      });
    }

    if (pulled) {
      await prisma.channelListingLink.update({
        where: { id: link.id },
        data: { lastInboundAt: new Date() },
      });
    }
    if (attemptedPush && pushOk) {
      await prisma.channelListingLink.update({
        where: { id: link.id },
        data: { lastPushedAt: new Date() },
      });
    }

    if (pulled || (attemptedPush && pushOk)) {
      await writeBaseline(link.id, link.storeItemId, remote, attemptedPush && pushOk);
    } else if (link.syncBaselineMetaHash == null || link.syncBaselineVariantsHash == null) {
      await writeBaseline(link.id, link.storeItemId, remote, false);
    }
    updated += 1;
  }

  if (updated > 0 || removed > 0) {
    console.info("[channels] inbound meta sync", {
      provider,
      connectionId: connection.id,
      updated,
      removed,
    });
  }
  return { updated, removed };
}
