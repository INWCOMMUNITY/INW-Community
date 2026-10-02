/**
 * Size×Color (multi-option) topology sync between INW StoreVariants and Etsy products[].
 * PUT full inventory products[] when local combo set diverges; rematch maps by options when ids drift.
 */
import {
  applyFoundationSellerCollapseToSimple,
  applyFoundationSellerMatrixStructure,
  captureEtsyInventoryProjectionDesire,
  etsyCentsFromMoney,
  prisma,
  replaceEtsyListingVariantMaps,
  type EtsyJobHandlerResult,
} from "database";
import { optionValuesKey, skuSelectionKey } from "@/lib/listing-variant-matrix";
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
  sellableQtyForEtsyVariant,
  validateEtsyExportVariants,
  type EtsyRemoteInventoryProduct,
  type EtsyStoreVariantRow,
} from "./listing-variants";

export type SyncEtsyVariantTopologyResult =
  | { status: "NOOP"; reason: string }
  | { status: "REMATCHED"; pairCount: number }
  | { status: "PUSHED"; pairCount: number }
  | { status: "PULLED"; pairCount: number }
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
    // Axis rename (Color → Primary color) must not look like a topology mismatch.
    if (skuSelectionKey(localOpts) === skuSelectionKey(mapOpts)) continue;
    if (optionValuesKey(localOpts) === optionValuesKey(mapOpts)) continue;
    return false;
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
        // Seed applied/desired from Etsy observation — do not capture INW desire here
        // (that enqueued PROJECT_INVENTORY and overwrote seller qty edits on Etsy).
        remoteAvailable: p.remoteAvailable,
      })),
    });
  });
  return { rematched: true, pairCount: correlation.pairs.length };
}

function offeringPriceCents(price: unknown): number {
  if (price && typeof price === "object") {
    const row = price as { amount?: number; divisor?: number };
    const cents = etsyCentsFromMoney({ amount: row.amount, divisor: row.divisor });
    if (Number.isFinite(cents) && cents > 0) return Math.round(cents);
  }
  if (typeof price === "number" && Number.isFinite(price) && price > 0) {
    return Math.max(1, Math.round(price * 100));
  }
  return 1;
}

/**
 * Etsy changed Size×Color (or collapsed to simple). Adopt remote products into Foundation
 * and remap. Does not PUT inventory back to Etsy.
 */
/** Seller structure edit is still waiting to PUT. A cron pull must not adopt Etsy over it. */
export async function etsySellerTopologyPushPending(listingLinkId: string): Promise<boolean> {
  const pending = await prisma.etsySyncJob.findFirst({
    where: {
      kind: "RECONCILE_LISTING",
      state: { in: ["PENDING", "RETRY_WAIT", "RUNNING"] },
      AND: [
        { payload: { path: ["listingLinkId"], equals: listingLinkId } },
        { payload: { path: ["pushTopology"], equals: true } },
      ],
    },
    select: { id: true },
  });
  return Boolean(pending);
}

async function pullRemoteTopologyIntoFoundation(input: {
  connectionId: string;
  memberId: string;
  listingLinkId: string;
  storeItemId: string;
  remoteProducts: EtsyRemoteInventoryProduct[];
}): Promise<SyncEtsyVariantTopologyResult> {
  if (await etsySellerTopologyPushPending(input.listingLinkId)) {
    return { status: "NOOP", reason: "SELLER_TOPOLOGY_PUSH_PENDING" };
  }
  const commandId = `etsy-pull:${input.listingLinkId}:${Date.now()}`;
  const optioned = input.remoteProducts
    .map((product) => {
      const options = optionsFromEtsyPropertyValues(product.property_values);
      const offering =
        (product.offerings ?? []).find((o) => o?.is_enabled !== false) ?? product.offerings?.[0];
      const quantity =
        typeof offering?.quantity === "number" && Number.isFinite(offering.quantity)
          ? Math.max(0, Math.trunc(offering.quantity))
          : 0;
      return {
        product,
        options,
        quantity,
        priceCents: offeringPriceCents(offering?.price),
        sku: typeof product.sku === "string" ? product.sku : null,
      };
    })
    .filter((row) => Object.keys(row.options).length > 0);

  try {
    if (optioned.length === 0) {
      const product = input.remoteProducts[0];
      const offering =
        (product?.offerings ?? []).find((o) => o?.is_enabled !== false) ?? product?.offerings?.[0];
      const quantity =
        typeof offering?.quantity === "number" && Number.isFinite(offering.quantity)
          ? Math.max(1, Math.trunc(offering.quantity))
          : 1;
      await prisma.$transaction((tx) =>
        applyFoundationSellerCollapseToSimple(tx, {
          storeItemId: input.storeItemId,
          memberId: input.memberId,
          commandId,
          simpleTarget: quantity,
          priceCents: offeringPriceCents(offering?.price),
          sku: typeof product?.sku === "string" ? product.sku : null,
        })
      );
    } else {
      await prisma.$transaction((tx) =>
        applyFoundationSellerMatrixStructure(tx, {
          storeItemId: input.storeItemId,
          memberId: input.memberId,
          commandId,
          matrixTargets: optioned.map((row) => ({
            fingerprint: `matrix:${skuSelectionKey(row.options)}`,
            options: row.options,
            targetOnHand: row.quantity,
            priceCents: row.priceCents,
            sku: row.sku,
          })),
        })
      );
    }
  } catch (error) {
    return {
      outcome: "DEAD",
      errorClass: "PERMANENT",
      errorCode: "TOPOLOGY_PULL_FAILED",
      errorMessage: error instanceof Error ? error.message.slice(0, 500) : "Could not adopt Etsy variant structure",
    };
  }

  const storeVariants = await prisma.storeVariant.findMany({
    where: { storeItemId: input.storeItemId, memberId: input.memberId, status: "ACTIVE" },
    select: { id: true, options: true },
    orderBy: { createdAt: "asc" },
  });
  const requested = storeVariants
    .map((v) => {
      const options = parseStoreVariantOptions(v.options);
      if (!options || Object.keys(options).length === 0) return null;
      return { storeVariantId: v.id, options };
    })
    .filter((row): row is { storeVariantId: string; options: Record<string, string> } => row != null);

  if (optioned.length === 0) {
    const survivor = storeVariants[0];
    const product = input.remoteProducts[0];
    const offering =
      (product?.offerings ?? []).find((o) => o?.is_enabled !== false) ?? product?.offerings?.[0];
    const productId = String(product?.product_id ?? "").trim();
    const offeringId = String(offering?.offering_id ?? "").trim();
    if (!survivor || !/^\d+$/.test(productId) || !/^\d+$/.test(offeringId)) {
      return {
        outcome: "DEAD",
        errorClass: "PERMANENT",
        errorCode: "TOPOLOGY_PULL_UNMAPPED",
        errorMessage: "Etsy simple inventory is missing product/offering ids after pull",
      };
    }
    await prisma.$transaction((tx) =>
      replaceEtsyListingVariantMaps(tx, {
        listingLinkId: input.listingLinkId,
        connectionId: input.connectionId,
        memberId: input.memberId,
        storeItemId: input.storeItemId,
        variants: [
          {
            storeVariantId: survivor.id,
            etsyProductId: productId,
            etsyOfferingId: offeringId,
            remoteSku: typeof product?.sku === "string" ? product.sku : null,
            remoteAvailable:
              typeof offering?.quantity === "number" ? Math.max(0, Math.trunc(offering.quantity)) : null,
          },
        ],
      })
    );
    return { status: "PULLED", pairCount: 1 };
  }

  const correlation = correlateEtsyProductsToStoreVariants({
    requested,
    remote: input.remoteProducts,
  });
  if (!correlation.ok) {
    return {
      outcome: "DEAD",
      errorClass: "PERMANENT",
      errorCode: "TOPOLOGY_PULL_UNMAPPED",
      errorMessage: "Pulled Etsy variations could not be remapped to StoreVariants",
    };
  }
  await prisma.$transaction((tx) =>
    replaceEtsyListingVariantMaps(tx, {
      listingLinkId: input.listingLinkId,
      connectionId: input.connectionId,
      memberId: input.memberId,
      storeItemId: input.storeItemId,
      variants: correlation.pairs.map((p) => ({
        storeVariantId: p.storeVariantId,
        etsyProductId: p.etsyProductId,
        etsyOfferingId: p.etsyOfferingId,
        propertyValuesJson: p.propertyValuesJson,
        remoteSku: p.remoteSku,
        remoteAvailable: p.remoteAvailable,
      })),
    })
  );
  return { status: "PULLED", pairCount: correlation.pairs.length };
}

/**
 * Sync Size×Color between INW StoreVariants and Etsy products[].
 * direction "pull" (cron default): adopt Etsy structure into Foundation when combos diverge.
 * direction "push": seller topology desire — PUT INW products[] onto Etsy.
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
  /** Seller edit asked to overwrite Etsy. Cron observe/pull must not set this. */
  direction?: "push" | "pull";
  /** Force PUT even when maps already look complete. Only honored for direction "push". */
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
    // Local is simple/single. If Etsy still has variations, push collapse — never NOOP
    // while remote stays multi (that left INW "synced" while channels diverged).
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
    const remoteIsMulti =
      remoteProducts.length > 1 ||
      remoteProducts.some((p) => {
        const opts = optionsFromEtsyPropertyValues(p.property_values);
        return Object.keys(opts).length > 0;
      });
    if (remoteIsMulti && input.direction !== "push") {
      return pullRemoteTopologyIntoFoundation({
        connectionId: input.connectionId,
        memberId: input.memberId,
        listingLinkId: input.listingLinkId,
        storeItemId: input.storeItemId,
        remoteProducts,
      });
    }
    if (!remoteIsMulti && !(input.direction === "push" && input.forcePush)) {
      // Already a single offering on Etsy — rematch the one map if needed.
      const survivor = variantRows[0]!;
      const product = remoteProducts[0];
      const offering =
        (product?.offerings ?? []).find((o) => o?.is_enabled !== false) ?? product?.offerings?.[0];
      const productId = String(product?.product_id ?? "").trim();
      const offeringId = String(offering?.offering_id ?? "").trim();
      if (/^\d+$/.test(productId) && /^\d+$/.test(offeringId)) {
        const mapOk =
          maps.length === 1 &&
          maps[0]!.storeVariantId === survivor.id &&
          maps[0]!.etsyProductId === productId &&
          maps[0]!.etsyOfferingId === offeringId;
        if (!mapOk) {
          try {
            await prisma.$transaction(async (tx) => {
              await replaceEtsyListingVariantMaps(tx, {
                listingLinkId: input.listingLinkId,
                connectionId: input.connectionId,
                memberId: input.memberId,
                storeItemId: input.storeItemId,
                variants: [
                  {
                    storeVariantId: survivor.id,
                    etsyProductId: productId,
                    etsyOfferingId: offeringId,
                    remoteSku: typeof product?.sku === "string" ? product.sku : null,
                    remoteAvailable:
                      typeof offering?.quantity === "number"
                        ? Math.max(0, Math.trunc(offering.quantity))
                        : null,
                  },
                ],
              });
            });
            return { status: "REMATCHED", pairCount: 1 };
          } catch (error) {
            return {
              outcome: "DEAD",
              errorClass: "PERMANENT",
              errorCode: "MAPPING_FAILED",
              errorMessage:
                error instanceof Error ? error.message.slice(0, 500) : "Simple variant remap failed",
            };
          }
        }
      }
      return { status: "NOOP", reason: "SINGLE_VARIANT" };
    }

    const survivor = variantRows[0]!;
    const qty = sellableQtyForEtsyVariant(survivor, input.inventoryTracking);
    const put = await etsyConnectionRequest<{ products?: EtsyRemoteInventoryProduct[] }>({
      connectionId: input.connectionId,
      memberId: input.memberId,
      method: "PUT",
      path: `/listings/${encodeURIComponent(input.etsyListingId)}/inventory`,
      query: ETSY_INVENTORY_QUERY,
      body: toEtsyInventoryPutBody({
        products: [
          {
            sku: (survivor.sku ?? "").trim(),
            property_values: [],
            offerings: [
              {
                price: Math.max(0.2, survivor.priceCents / 100),
                quantity: Math.max(0, qty),
                is_enabled: true,
                readiness_state_id: input.readinessStateId,
              },
            ],
          },
        ],
        price_on_property: [],
        quantity_on_property: [],
        sku_on_property: [],
      }),
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
        afterRes.message || "Could not read inventory after simple topology PUT"
      );
    }
    const product = afterRes.data.products[0]!;
    const offering =
      (product.offerings ?? []).find((o) => o?.is_enabled !== false) ?? product.offerings?.[0];
    const productId = String(product.product_id ?? "").trim();
    const offeringId = String(offering?.offering_id ?? "").trim();
    if (!/^\d+$/.test(productId) || !/^\d+$/.test(offeringId)) {
      return {
        outcome: "DEAD",
        errorClass: "PERMANENT",
        errorCode: "INVENTORY_SHAPE",
        errorMessage: "Etsy product/offering ids missing after simple inventory PUT",
      };
    }
    try {
      await prisma.$transaction(async (tx) => {
        await replaceEtsyListingVariantMaps(tx, {
          listingLinkId: input.listingLinkId,
          connectionId: input.connectionId,
          memberId: input.memberId,
          storeItemId: input.storeItemId,
          variants: [
            {
              storeVariantId: survivor.id,
              etsyProductId: productId,
              etsyOfferingId: offeringId,
              remoteSku: typeof product.sku === "string" ? product.sku : null,
              remoteAvailable:
                typeof offering?.quantity === "number"
                  ? Math.max(0, Math.trunc(offering.quantity))
                  : null,
            },
          ],
        });
      });
    } catch (error) {
      return {
        outcome: "DEAD",
        errorClass: "PERMANENT",
        errorCode: "MAPPING_FAILED",
        errorMessage:
          error instanceof Error ? error.message.slice(0, 500) : "Simple variant remap failed",
      };
    }
    return { status: "PUSHED", pairCount: 1 };
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

  // Same option combos: rematch ids only. Never PUT just because map labels are stale.
  if (combosMatch && !hasDeprecatedProperties && !(input.direction === "push" && input.forcePush)) {
    const rematched = await rematchEtsyVariantMapsByOptions({
      connectionId: input.connectionId,
      memberId: input.memberId,
      listingLinkId: input.listingLinkId,
      storeItemId: input.storeItemId,
      variants: requested,
      remote: remoteProducts,
      now: input.now,
    });
    if (rematched.rematched) {
      return { status: "REMATCHED", pairCount: rematched.pairCount };
    }
    // Combos already match Etsy. Never fall through to a full inventory PUT just because
    // stored property_values labels (Color vs Primary color) are stale — that PUT was
    // overwriting seller qty/price edits on Etsy before inbound poll could apply them.
    return {
      status: "NOOP",
      reason: mapsOk ? "ALREADY_ALIGNED" : "COMBOS_MATCH_STALE_MAP_LABELS",
    };
  }

  // Structure diverges. Cron adopts Etsy into Foundation. Seller topology desire pushes INW.
  if (input.direction !== "push") {
    return pullRemoteTopologyIntoFoundation({
      connectionId: input.connectionId,
      memberId: input.memberId,
      listingLinkId: input.listingLinkId,
      storeItemId: input.storeItemId,
      remoteProducts,
    });
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
