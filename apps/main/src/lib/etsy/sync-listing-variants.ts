/**
 * Size×Color (multi-option) topology sync between INW StoreVariants and Etsy products[].
 * PUT full inventory products[] when local combo set diverges; rematch maps by options when ids drift.
 */
import {
  captureEtsyInventoryProjectionDesire,
  prisma,
  replaceEtsyListingVariantMaps,
  type EtsyJobHandlerResult,
} from "database";
import { skuSelectionKey } from "@/lib/listing-variant-matrix";
import { etsyConnectionRequest } from "./connection-request";
import type { EtsyFetch } from "./client";
import {
  buildEtsyInventoryProductsPayload,
  correlateEtsyProductsToStoreVariants,
  ETSY_INVENTORY_QUERY,
  toEtsyInventoryPutBody,
  inventoryHasDeprecatedEtsyProperties,
  optionsFromEtsyPropertyValues,
  parseStoreVariantOptions,
  resolveEtsyVariationPropertyIds,
  validateEtsyExportVariants,
  type EtsyRemoteInventoryProduct,
  type EtsyStoreVariantRow,
} from "./listing-variants";

export type SyncEtsyVariantTopologyResult =
  | { status: "NOOP"; reason: string }
  | { status: "REMATCHED"; pairCount: number }
  | { status: "PUSHED"; pairCount: number }
  | Extract<EtsyJobHandlerResult, { outcome: "RETRY" | "DEAD" }>;

function classifyFailure(
  apiClass: string,
  retryAfterMs: number | null,
  message?: string
): Extract<EtsyJobHandlerResult, { outcome: "RETRY" | "DEAD" }> {
  if (apiClass === "THROTTLED" || apiClass === "TRANSIENT" || apiClass === "NETWORK") {
    return {
      outcome: "RETRY",
      errorClass: apiClass,
      errorCode: apiClass,
      errorMessage: message?.slice(0, 400) || `Etsy provider ${apiClass}`,
      retryAt: retryAfterMs != null ? new Date(Date.now() + retryAfterMs) : undefined,
    };
  }
  if (apiClass === "AUTH" || apiClass === "CONNECTION_INACTIVE" || apiClass === "NOT_CONFIGURED") {
    return {
      outcome: "DEAD",
      errorClass: apiClass,
      errorCode: apiClass,
      errorMessage: message?.slice(0, 400) || `Etsy authorization unavailable (${apiClass})`,
    };
  }
  return {
    outcome: "DEAD",
    errorClass: apiClass || "PERMANENT",
    errorCode: apiClass || "PROVIDER_ERROR",
    errorMessage: message?.slice(0, 400) || "Etsy variant topology sync failed permanently",
  };
}

export function localVariantComboKeys(variants: EtsyStoreVariantRow[]): string[] {
  const keys: string[] = [];
  for (const v of variants) {
    const opts = parseStoreVariantOptions(v.options);
    if (!opts) return [];
    keys.push(skuSelectionKey(opts));
  }
  return keys.sort();
}

export function remoteProductComboKeys(products: EtsyRemoteInventoryProduct[]): string[] {
  return products
    .map((p) => skuSelectionKey(optionsFromEtsyPropertyValues(p.property_values)))
    .filter((k) => k.length > 0)
    .sort();
}

export function mapsMatchLocalCombos(input: {
  maps: Array<{ storeVariantId: string; propertyValuesJson: unknown }>;
  variants: EtsyStoreVariantRow[];
}): boolean {
  if (input.maps.length !== input.variants.length) return false;
  const byId = new Map(input.variants.map((v) => [v.id, v]));
  for (const map of input.maps) {
    const local = byId.get(map.storeVariantId);
    if (!local) return false;
    const localOpts = parseStoreVariantOptions(local.options);
    if (!localOpts) return false;
    const mapOpts = optionsFromEtsyPropertyValues(
      Array.isArray(map.propertyValuesJson)
        ? (map.propertyValuesJson as EtsyRemoteInventoryProduct["property_values"])
        : undefined
    );
    if (Object.keys(mapOpts).length === 0) return false;
    if (skuSelectionKey(localOpts) !== skuSelectionKey(mapOpts)) return false;
  }
  return true;
}

function sameKeySet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Rematch existing EtsyVariantMap rows to remote products by Size×Color option keys.
 * No Etsy writes — used when product/offering ids drifted but combinations match.
 */
export async function rematchEtsyVariantMapsByOptions(input: {
  connectionId: string;
  memberId: string;
  listingLinkId: string;
  storeItemId: string;
  variants: Array<{ storeVariantId: string; options: Record<string, string> }>;
  remote: EtsyRemoteInventoryProduct[];
  now?: Date;
}): Promise<{ rematched: boolean; pairCount: number }> {
  const correlation = correlateEtsyProductsToStoreVariants({
    requested: input.variants,
    remote: input.remote,
  });
  if (!correlation.ok) return { rematched: false, pairCount: 0 };

  const existing = await prisma.etsyVariantMap.findMany({
    where: {
      etsyListingLinkId: input.listingLinkId,
      etsyConnectionId: input.connectionId,
    },
    select: {
      storeVariantId: true,
      etsyProductId: true,
      etsyOfferingId: true,
    },
  });
  const bySv = new Map(existing.map((m) => [m.storeVariantId, m]));
  let needsReplace = existing.length !== correlation.pairs.length;
  for (const pair of correlation.pairs) {
    const map = bySv.get(pair.storeVariantId);
    if (
      !map ||
      map.etsyProductId !== pair.etsyProductId ||
      map.etsyOfferingId !== pair.etsyOfferingId
    ) {
      needsReplace = true;
      break;
    }
  }
  if (!needsReplace) return { rematched: false, pairCount: correlation.pairs.length };

  await prisma.$transaction(async (tx) => {
    await replaceEtsyListingVariantMaps(tx, {
      listingLinkId: input.listingLinkId,
      connectionId: input.connectionId,
      memberId: input.memberId,
      storeItemId: input.storeItemId,
      variants: correlation.pairs.map((p) => ({
        storeVariantId: p.storeVariantId,
        etsyProductId: p.etsyProductId,
        etsyOfferingId: p.etsyOfferingId,
        propertyValuesJson: (p.propertyValuesJson as never) ?? undefined,
        remoteSku: p.remoteSku,
        remoteAvailable: p.remoteAvailable,
      })),
    });
    for (const p of correlation.pairs) {
      await captureEtsyInventoryProjectionDesire(tx, {
        memberId: input.memberId,
        storeVariantId: p.storeVariantId,
      });
    }
  });
  return { rematched: true, pairCount: correlation.pairs.length };
}

/**
 * Sync INW ACTIVE StoreVariants (Size×Color matrix) onto a mapped Etsy listing.
 * - Rematch when remote already has the same option combos
 * - PUT full products[] when remote structure diverges or maps are incomplete
 */
export async function syncEtsyListingVariantTopology(input: {
  connectionId: string;
  memberId: string;
  listingLinkId: string;
  storeItemId: string;
  etsyListingId: string;
  taxonomyId: number;
  readinessStateId: number | string;
  inventoryTracking: string;
  /** Force PUT even when maps already look complete. */
  forcePush?: boolean;
  fetchImpl?: EtsyFetch;
  now?: Date;
}): Promise<SyncEtsyVariantTopologyResult> {
  const maps = await prisma.etsyVariantMap.findMany({
    where: {
      etsyListingLinkId: input.listingLinkId,
      etsyConnectionId: input.connectionId,
    },
    select: {
      id: true,
      storeVariantId: true,
      etsyProductId: true,
      etsyOfferingId: true,
      propertyValuesJson: true,
    },
  });

  const storeVariants = await prisma.storeVariant.findMany({
    where: {
      storeItemId: input.storeItemId,
      memberId: input.memberId,
      status: "ACTIVE",
    },
    include: {
      inventoryState: { select: { mode: true, onHand: true, reserved: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  const variantRows: EtsyStoreVariantRow[] = storeVariants.map((v) => ({
    id: v.id,
    options: v.options,
    priceCents: v.priceCents,
    sku: v.sku,
    inventory: v.inventoryState
      ? {
          mode: v.inventoryState.mode,
          onHand: v.inventoryState.onHand,
          reserved: v.inventoryState.reserved,
        }
      : null,
  }));

  const gate = validateEtsyExportVariants({ variants: variantRows });
  if (!gate.ok) {
    return {
      outcome: "DEAD",
      errorClass: "PERMANENT",
      errorCode: "UNSUPPORTED_VARIANTS",
      errorMessage: gate.message,
    };
  }
  if (!gate.multi) {
    return { status: "NOOP", reason: "SINGLE_VARIANT" };
  }

  const localKeys = localVariantComboKeys(variantRows);
  if (localKeys.length !== variantRows.length) {
    return {
      outcome: "DEAD",
      errorClass: "PERMANENT",
      errorCode: "UNSUPPORTED_VARIANTS",
      errorMessage: "Multi-variant listing is missing option combinations",
    };
  }

  const inventoryRes = await etsyConnectionRequest<{ products?: EtsyRemoteInventoryProduct[] }>({
    connectionId: input.connectionId,
    memberId: input.memberId,
    method: "GET",
    path: `/listings/${encodeURIComponent(input.etsyListingId)}/inventory`,
    query: { max_variations_supported: 3 },
    maxAttempts: 3,
    fetchImpl: input.fetchImpl,
    now: input.now,
  });
  if (!inventoryRes.ok || !inventoryRes.data?.products) {
    return classifyFailure(inventoryRes.class, inventoryRes.retryAfterMs, inventoryRes.message);
  }

  const remoteProducts = inventoryRes.data.products;
  const remoteKeys = remoteProductComboKeys(remoteProducts);
  const mapsOk = mapsMatchLocalCombos({ maps, variants: variantRows });
  const combosMatch = sameKeySet(localKeys, remoteKeys);
  const hasDeprecatedProperties = inventoryHasDeprecatedEtsyProperties(remoteProducts);

  const requested = variantRows.map((v) => ({
    storeVariantId: v.id,
    options: parseStoreVariantOptions(v.options)!,
  }));

  // Deprecated Size=100 (etc.) must be rebuilt — rematch-only would keep failing on PUT.
  if (combosMatch && !input.forcePush && !hasDeprecatedProperties) {
    const rematched = await rematchEtsyVariantMapsByOptions({
      connectionId: input.connectionId,
      memberId: input.memberId,
      listingLinkId: input.listingLinkId,
      storeItemId: input.storeItemId,
      variants: requested,
      remote: remoteProducts,
      now: input.now,
    });
    if (rematched.rematched || mapsOk) {
      return rematched.rematched
        ? { status: "REMATCHED", pairCount: rematched.pairCount }
        : { status: "NOOP", reason: "ALREADY_ALIGNED" };
    }
  }

  // INW matrix diverges from Etsy (or maps incomplete) — push full Size×Color products[].
  const propertyMap = await resolveEtsyVariationPropertyIds({
    connectionId: input.connectionId,
    memberId: input.memberId,
    taxonomyId: input.taxonomyId,
    axisNames: gate.axisNames,
    fetchImpl: input.fetchImpl,
    now: input.now,
  });
  const payloadInventory = buildEtsyInventoryProductsPayload({
    variants: variantRows,
    inventoryTracking: input.inventoryTracking,
    axisNames: gate.axisNames,
    propertyMap,
    readinessStateId: input.readinessStateId,
  });

  const put = await etsyConnectionRequest<{ products?: EtsyRemoteInventoryProduct[] }>({
    connectionId: input.connectionId,
    memberId: input.memberId,
    method: "PUT",
    path: `/listings/${encodeURIComponent(input.etsyListingId)}/inventory`,
    query: ETSY_INVENTORY_QUERY,
    body: toEtsyInventoryPutBody(payloadInventory),
    maxAttempts: 1,
    fetchImpl: input.fetchImpl,
    now: input.now,
  });
  if (!put.ok) {
    return classifyFailure(put.class, put.retryAfterMs, put.message);
  }

  const afterRes = await etsyConnectionRequest<{ products?: EtsyRemoteInventoryProduct[] }>({
    connectionId: input.connectionId,
    memberId: input.memberId,
    method: "GET",
    path: `/listings/${encodeURIComponent(input.etsyListingId)}/inventory`,
    query: { max_variations_supported: 3 },
    maxAttempts: 3,
    fetchImpl: input.fetchImpl,
    now: input.now,
  });
  if (!afterRes.ok || !afterRes.data?.products?.length) {
    return classifyFailure(
      afterRes.class || "PERMANENT",
      afterRes.retryAfterMs,
      afterRes.message || "Could not read inventory after multi-variant topology PUT"
    );
  }

  const correlation = correlateEtsyProductsToStoreVariants({
    requested,
    remote: afterRes.data.products,
  });
  if (!correlation.ok) {
    return {
      outcome: "DEAD",
      errorClass: "PERMANENT",
      errorCode: correlation.code,
      errorMessage: correlation.message,
    };
  }

  try {
    await prisma.$transaction(async (tx) => {
      await replaceEtsyListingVariantMaps(tx, {
        listingLinkId: input.listingLinkId,
        connectionId: input.connectionId,
        memberId: input.memberId,
        storeItemId: input.storeItemId,
        variants: correlation.pairs.map((p) => ({
          storeVariantId: p.storeVariantId,
          etsyProductId: p.etsyProductId,
          etsyOfferingId: p.etsyOfferingId,
          propertyValuesJson: (p.propertyValuesJson as never) ?? undefined,
          remoteSku: p.remoteSku,
          remoteAvailable: p.remoteAvailable,
        })),
      });
      for (const p of correlation.pairs) {
        await captureEtsyInventoryProjectionDesire(tx, {
          memberId: input.memberId,
          storeVariantId: p.storeVariantId,
        });
      }
    });
  } catch (error) {
    return {
      outcome: "DEAD",
      errorClass: "PERMANENT",
      errorCode: "MAPPING_FAILED",
      errorMessage: error instanceof Error ? error.message.slice(0, 500) : "Variant remap failed",
    };
  }

  return { status: "PUSHED", pairCount: correlation.pairs.length };
}

/** True when handler result is a job failure (RETRY/DEAD). */
export function isSyncEtsyVariantTopologyFailure(
  result: SyncEtsyVariantTopologyResult
): result is Extract<EtsyJobHandlerResult, { outcome: "RETRY" | "DEAD" }> {
  return "outcome" in result && (result.outcome === "RETRY" || result.outcome === "DEAD");
}
