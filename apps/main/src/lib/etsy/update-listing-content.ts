import {
  etsyCentsFromMoney,
  etsyMoneyFromCents,
  etsyProductContentFingerprint,
  etsyVariantContentFingerprint,
  markEtsyProductContentApplied,
  markEtsyVariantContentApplied,
  normalizeEtsyDescription,
  normalizeEtsyPhotoUrls,
  normalizeEtsySku,
  normalizeEtsyTitle,
  prisma,
  setEtsyProductContentConflict,
  setEtsyVariantContentConflict,
  type EtsyJobHandlerResult,
  type EtsySyncJobClaim,
} from "database";
import { etsyConnectionRequest } from "./connection-request";
import type { EtsyFetch } from "./client";

function parseUpdatePayload(payload: unknown): {
  storeItemId: string;
  storeVariantId: string;
  productDesiredVersion: number;
  variantDesiredVersion: number;
} | null {
  if (!payload || typeof payload !== "object") return null;
  const row = payload as Record<string, unknown>;
  const storeItemId = typeof row.storeItemId === "string" ? row.storeItemId : "";
  const storeVariantId = typeof row.storeVariantId === "string" ? row.storeVariantId : "";
  const productDesiredVersion =
    typeof row.productDesiredVersion === "number" ? Math.trunc(row.productDesiredVersion) : NaN;
  const variantDesiredVersion =
    typeof row.variantDesiredVersion === "number" ? Math.trunc(row.variantDesiredVersion) : NaN;
  if (
    !storeItemId ||
    !storeVariantId ||
    !Number.isFinite(productDesiredVersion) ||
    !Number.isFinite(variantDesiredVersion) ||
    productDesiredVersion < 0 ||
    variantDesiredVersion < 0
  ) {
    return null;
  }
  return { storeItemId, storeVariantId, productDesiredVersion, variantDesiredVersion };
}

function classifyFailure(
  apiClass: string,
  retryAfterMs: number | null
): Extract<EtsyJobHandlerResult, { outcome: "RETRY" | "DEAD" }> {
  if (apiClass === "THROTTLED" || apiClass === "TRANSIENT" || apiClass === "NETWORK") {
    return {
      outcome: "RETRY",
      errorClass: apiClass,
      errorCode: apiClass,
      errorMessage: `Etsy provider ${apiClass}`,
      retryAt: retryAfterMs != null ? new Date(Date.now() + retryAfterMs) : undefined,
    };
  }
  if (apiClass === "AUTH" || apiClass === "CONNECTION_INACTIVE" || apiClass === "NOT_CONFIGURED") {
    return {
      outcome: "DEAD",
      errorClass: apiClass,
      errorCode: apiClass,
      errorMessage: `Etsy authorization unavailable (${apiClass})`,
    };
  }
  return {
    outcome: "DEAD",
    errorClass: apiClass || "PERMANENT",
    errorCode: apiClass || "PROVIDER_ERROR",
    errorMessage: "Etsy content update failed permanently",
  };
}

type RemoteListing = {
  listing_id?: number | string;
  title?: string;
  description?: string;
  images?: Array<{ url_fullxfull?: string; url_570xN?: string }>;
};

type RemoteInventory = {
  products?: Array<{
    product_id?: number | string;
    sku?: string | null;
    offerings?: Array<{
      offering_id?: number | string;
      quantity?: number;
      is_enabled?: boolean;
      price?: number | string | { amount?: number; divisor?: number };
    }>;
    property_values?: unknown;
  }>;
  price_on_property?: number[];
  quantity_on_property?: number[];
  sku_on_property?: number[];
};

/**
 * UPDATE_LISTING_CONTENT handler.
 * Read-before-write. Inventory PUT always sends the full products[] snapshot.
 * Stale desires (newer version already desired/applied) succeed without network writes.
 */
export async function handleEtsyUpdateListingContentJob(
  claim: EtsySyncJobClaim,
  deps: { fetchImpl?: EtsyFetch; now?: Date } = {}
): Promise<EtsyJobHandlerResult> {
  const payload = parseUpdatePayload(claim.payload);
  if (!payload) {
    return {
      outcome: "DEAD",
      errorClass: "PERMANENT",
      errorCode: "INVALID_PAYLOAD",
      errorMessage: "UPDATE_LISTING_CONTENT payload is invalid",
    };
  }

  const connection = await prisma.etsyConnection.findUnique({
    where: { id: claim.etsyConnectionId },
  });
  if (!connection || connection.status !== "ACTIVE") {
    return {
      outcome: "DEAD",
      errorClass: "CONNECTION_INACTIVE",
      errorCode: "CONNECTION_INACTIVE",
      errorMessage: "Etsy connection is not active for this generation",
    };
  }

  const listing = await prisma.etsyListingLink.findUnique({
    where: {
      etsyConnectionId_storeItemId: {
        etsyConnectionId: connection.id,
        storeItemId: payload.storeItemId,
      },
    },
  });
  if (!listing) {
    return {
      outcome: "DEAD",
      errorClass: "UNMAPPED",
      errorCode: "UNMAPPED",
      errorMessage: "Store item is not mapped on this Etsy connection generation",
    };
  }

  if (listing.contentHealth === "PAUSED") {
    return { outcome: "SUCCESS" };
  }

  const variantMaps = await prisma.etsyVariantMap.findMany({
    where: { etsyListingLinkId: listing.id, etsyConnectionId: connection.id },
    orderBy: { createdAt: "asc" },
  });
  const variantMap =
    variantMaps.find((row) => row.storeVariantId === payload.storeVariantId) ?? null;
  if (!variantMap) {
    return {
      outcome: "DEAD",
      errorClass: "PERMANENT",
      errorCode: "UNSUPPORTED_VARIANTS",
      errorMessage: "Mapped listing has no variant map matching the job payload",
    };
  }

  const applyProduct =
    payload.productDesiredVersion === listing.desiredProductContentVersion &&
    payload.productDesiredVersion > listing.appliedProductContentVersion;
  const applyVariant =
    payload.variantDesiredVersion === variantMap.desiredVariantContentVersion &&
    payload.variantDesiredVersion > variantMap.appliedVariantContentVersion;

  if (
    (payload.productDesiredVersion < listing.desiredProductContentVersion ||
      payload.productDesiredVersion <= listing.appliedProductContentVersion) &&
    (payload.variantDesiredVersion < variantMap.desiredVariantContentVersion ||
      payload.variantDesiredVersion <= variantMap.appliedVariantContentVersion)
  ) {
    return { outcome: "SUCCESS" };
  }
  if (!applyProduct && !applyVariant) {
    return { outcome: "SUCCESS" };
  }

  const storeItem = await prisma.storeItem.findFirst({
    where: { id: payload.storeItemId, memberId: connection.memberId },
  });
  const storeVariant = await prisma.storeVariant.findFirst({
    where: {
      id: payload.storeVariantId,
      storeItemId: payload.storeItemId,
      memberId: connection.memberId,
    },
  });
  if (!storeItem || !storeVariant) {
    return {
      outcome: "DEAD",
      errorClass: "PERMANENT",
      errorCode: "STORE_ITEM_UNAVAILABLE",
      errorMessage: "Store item/variant unavailable for Etsy content update",
    };
  }

  const desiredPhotos = normalizeEtsyPhotoUrls(storeItem.photos);
  const desiredProductFp = etsyProductContentFingerprint({
    title: storeItem.title,
    description: storeItem.description,
    photos: desiredPhotos,
  });
  const desiredVariantFp = etsyVariantContentFingerprint({
    priceCents: storeVariant.priceCents,
    sku: storeVariant.sku,
  });

  if (
    applyProduct &&
    listing.desiredProductFingerprint &&
    listing.desiredProductFingerprint !== desiredProductFp
  ) {
    return {
      outcome: "DEAD",
      errorClass: "PERMANENT",
      errorCode: "PRODUCT_DESIRE_MISMATCH",
      errorMessage: "Canonical product content does not match recorded desired fingerprint",
    };
  }
  if (
    applyVariant &&
    variantMap.desiredVariantFingerprint &&
    variantMap.desiredVariantFingerprint !== desiredVariantFp
  ) {
    return {
      outcome: "DEAD",
      errorClass: "PERMANENT",
      errorCode: "VARIANT_DESIRE_MISMATCH",
      errorMessage: "Canonical variant content does not match recorded desired fingerprint",
    };
  }

  const listingPath = `/shops/${encodeURIComponent(connection.shopId)}/listings/${encodeURIComponent(listing.etsyListingId)}`;

  if (applyProduct) {
    const remoteRes = await etsyConnectionRequest<RemoteListing>({
      connectionId: connection.id,
      memberId: connection.memberId,
      method: "GET",
      path: listingPath,
      query: { includes: "Images" },
      maxAttempts: 3,
      fetchImpl: deps.fetchImpl,
      now: deps.now,
    });
    if (!remoteRes.ok || !remoteRes.data) {
      return classifyFailure(remoteRes.class, remoteRes.retryAfterMs);
    }

    const remoteTitle = normalizeEtsyTitle(remoteRes.data.title);
    const remoteDescription = normalizeEtsyDescription(remoteRes.data.description);
    const remotePhotos = normalizeEtsyPhotoUrls(
      (remoteRes.data.images ?? []).map((img) => img.url_fullxfull || img.url_570xN || "")
    );
    const remoteProductFp = etsyProductContentFingerprint({
      title: remoteTitle,
      description: remoteDescription,
      photos: remotePhotos,
    });

    const localTitle = normalizeEtsyTitle(storeItem.title);
    const localDescription = normalizeEtsyDescription(storeItem.description);

    // Dual divergence: remotes differ from both applied and desired.
    if (
      listing.appliedProductFingerprint &&
      remoteProductFp !== listing.appliedProductFingerprint &&
      remoteProductFp !== desiredProductFp
    ) {
      await setEtsyProductContentConflict(prisma, {
        listingLinkId: listing.id,
        remoteFingerprint: remoteProductFp,
        now: deps.now,
      });
      return {
        outcome: "DEAD",
        errorClass: "CONTENT_CONFLICT",
        errorCode: "PRODUCT_CONTENT_CONFLICT",
        errorMessage: "Etsy listing content diverged from both applied and desired",
      };
    }

    const titleNeedsPatch = remoteTitle !== localTitle;
    const descriptionNeedsPatch = remoteDescription !== localDescription;
    if (titleNeedsPatch || descriptionNeedsPatch) {
      const patch = await etsyConnectionRequest({
        connectionId: connection.id,
        memberId: connection.memberId,
        method: "PATCH",
        path: listingPath,
        body: {
          ...(titleNeedsPatch ? { title: localTitle } : {}),
          ...(descriptionNeedsPatch ? { description: localDescription } : {}),
        },
        maxAttempts: 1,
        fetchImpl: deps.fetchImpl,
        now: deps.now,
      });
      if (!patch.ok) {
        return classifyFailure(patch.class, patch.retryAfterMs);
      }
    }

    // E5 photo push: upload missing desired URLs. Does not delete remote extras.
    const remoteSet = new Set(remotePhotos);
    for (const url of desiredPhotos) {
      if (remoteSet.has(url)) continue;
      const upload = await etsyConnectionRequest({
        connectionId: connection.id,
        memberId: connection.memberId,
        method: "POST",
        path: `${listingPath}/images`,
        body: { image_url: url },
        maxAttempts: 1,
        fetchImpl: deps.fetchImpl,
        now: deps.now,
      });
      if (!upload.ok) {
        // Photo endpoint may reject URL uploads; retryable provider errors bubble.
        return classifyFailure(upload.class, upload.retryAfterMs);
      }
    }

    await markEtsyProductContentApplied(prisma, {
      listingLinkId: listing.id,
      desiredVersion: payload.productDesiredVersion,
      fingerprint: desiredProductFp,
      now: deps.now,
    });
  }

  if (applyVariant) {
    const inventoryRes = await etsyConnectionRequest<RemoteInventory>({
      connectionId: connection.id,
      memberId: connection.memberId,
      method: "GET",
      path: `/listings/${encodeURIComponent(listing.etsyListingId)}/inventory`,
      query: { max_variations_supported: 3 },
      maxAttempts: 3,
      fetchImpl: deps.fetchImpl,
      now: deps.now,
    });
    if (!inventoryRes.ok || !inventoryRes.data?.products) {
      return classifyFailure(inventoryRes.class, inventoryRes.retryAfterMs);
    }

    const products = inventoryRes.data.products;
    const targetProductId = variantMap.etsyProductId;
    const targetOfferingId = variantMap.etsyOfferingId;
    let matched = false;
    let remotePriceCents = Number.NaN;
    let remoteSku = "";

    const nextProducts = products.map((product) => {
      const productId = String(product.product_id ?? "");
      const offerings = (product.offerings ?? []).map((offering) => {
        const offeringId = String(offering.offering_id ?? "");
        const priceObj =
          offering.price && typeof offering.price === "object"
            ? (offering.price as { amount?: number; divisor?: number })
            : null;
        const cents = etsyCentsFromMoney({
          amount: priceObj?.amount,
          divisor: priceObj?.divisor,
          price: typeof offering.price === "number" || typeof offering.price === "string" ? offering.price : null,
        });
        if (productId === targetProductId && offeringId === targetOfferingId) {
          matched = true;
          remotePriceCents = cents;
          remoteSku = normalizeEtsySku(product.sku);
          return {
            ...offering,
            price: etsyMoneyFromCents(storeVariant.priceCents),
          };
        }
        return offering;
      });
      if (productId === targetProductId) {
        return {
          ...product,
          sku: normalizeEtsySku(storeVariant.sku) || product.sku || "",
          offerings,
        };
      }
      return { ...product, offerings };
    });

    if (!matched) {
      return {
        outcome: "DEAD",
        errorClass: "PERMANENT",
        errorCode: "OFFERING_NOT_FOUND",
        errorMessage: "Mapped Etsy offering was not found in listing inventory",
      };
    }

    const remoteVariantFp = etsyVariantContentFingerprint({
      priceCents: Number.isFinite(remotePriceCents) ? remotePriceCents : 0,
      sku: remoteSku,
    });
    if (
      variantMap.appliedVariantFingerprint &&
      remoteVariantFp !== variantMap.appliedVariantFingerprint &&
      remoteVariantFp !== desiredVariantFp
    ) {
      await setEtsyVariantContentConflict(prisma, {
        variantMapId: variantMap.id,
        remoteFingerprint: remoteVariantFp,
        now: deps.now,
      });
      return {
        outcome: "DEAD",
        errorClass: "CONTENT_CONFLICT",
        errorCode: "VARIANT_CONTENT_CONFLICT",
        errorMessage: "Etsy offering content diverged from both applied and desired",
      };
    }

    if (remoteVariantFp !== desiredVariantFp) {
      // Full replace — incomplete products[] would delete variants.
      const put = await etsyConnectionRequest({
        connectionId: connection.id,
        memberId: connection.memberId,
        method: "PUT",
        path: `/listings/${encodeURIComponent(listing.etsyListingId)}/inventory`,
        body: {
          products: nextProducts,
          price_on_property: inventoryRes.data.price_on_property ?? [],
          quantity_on_property: inventoryRes.data.quantity_on_property ?? [],
          sku_on_property: inventoryRes.data.sku_on_property ?? [],
        },
        maxAttempts: 1,
        fetchImpl: deps.fetchImpl,
        now: deps.now,
      });
      if (!put.ok) {
        return classifyFailure(put.class, put.retryAfterMs);
      }
    }

    await markEtsyVariantContentApplied(prisma, {
      variantMapId: variantMap.id,
      desiredVersion: payload.variantDesiredVersion,
      fingerprint: desiredVariantFp,
      now: deps.now,
    });
  }

  return { outcome: "SUCCESS" };
}
