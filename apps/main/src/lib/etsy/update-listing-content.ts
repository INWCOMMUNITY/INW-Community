import {
  etsyCentsFromMoney,
  etsyMoneyFromCents,
  etsyProductContentFingerprint,
  etsyVariantContentFingerprint,
  ensureEtsyUpdateListingContentJob,
  markEtsyProductContentApplied,
  markEtsyVariantContentApplied,
  normalizeEtsyDescription,
  normalizeEtsyPhotoUrls,
  normalizeEtsySku,
  normalizeEtsyTitle,
  prisma,
  reconcileEtsyListingHealthFromDb,
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

  if (listing.contentHealth === "PAUSED" && connection.status !== "ACTIVE") {
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

  const productPending =
    listing.desiredProductContentVersion > listing.appliedProductContentVersion;
  const variantPending =
    variantMap.desiredVariantContentVersion > variantMap.appliedVariantContentVersion;

  if (
    (payload.productDesiredVersion < listing.desiredProductContentVersion ||
      payload.productDesiredVersion <= listing.appliedProductContentVersion) &&
    (payload.variantDesiredVersion < variantMap.desiredVariantContentVersion ||
      payload.variantDesiredVersion <= variantMap.appliedVariantContentVersion)
  ) {
    // Stale job succeeded without applying — keep the latest desire queued.
    if (productPending || variantPending) {
      await ensureEtsyUpdateListingContentJob(prisma, {
        connectionId: connection.id,
        storeItemId: payload.storeItemId,
        storeVariantId: variantMap.storeVariantId,
        productDesiredVersion: listing.desiredProductContentVersion,
        variantDesiredVersion: variantMap.desiredVariantContentVersion,
      });
    }
    await reconcileEtsyListingHealthFromDb(prisma, {
      connectionId: connection.id,
      listingLinkId: listing.id,
    }).catch(() => undefined);
    return { outcome: "SUCCESS" };
  }
  if (!applyProduct && !applyVariant) {
    if (productPending || variantPending) {
      await ensureEtsyUpdateListingContentJob(prisma, {
        connectionId: connection.id,
        storeItemId: payload.storeItemId,
        storeVariantId: variantMap.storeVariantId,
        productDesiredVersion: listing.desiredProductContentVersion,
        variantDesiredVersion: variantMap.desiredVariantContentVersion,
      });
    }
    await reconcileEtsyListingHealthFromDb(prisma, {
      connectionId: connection.id,
      listingLinkId: listing.id,
    }).catch(() => undefined);
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
    // Desire fingerprint can drift after algorithm changes (e.g. photos omitted) or
    // another local write. Version gates already ensure this is the current desire —
    // refresh the stored fingerprint and continue instead of DEAD-locking sync.
    await prisma.etsyListingLink.update({
      where: { id: listing.id },
      data: { desiredProductFingerprint: desiredProductFp },
    });
  }
  if (
    applyVariant &&
    variantMap.desiredVariantFingerprint &&
    variantMap.desiredVariantFingerprint !== desiredVariantFp
  ) {
    await prisma.etsyVariantMap.update({
      where: { id: variantMap.id },
      data: { desiredVariantFingerprint: desiredVariantFp },
    });
  }

  const listingPath = `/shops/${encodeURIComponent(connection.shopId)}/listings/${encodeURIComponent(listing.etsyListingId)}`;

  if (applyProduct) {
    const remoteRes = await etsyConnectionRequest<RemoteListing>({
      connectionId: connection.id,
      memberId: connection.memberId,
      method: "GET",
      path: listingPath,
      query: { includes: "Images", legacy: false },
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
      await reconcileEtsyListingHealthFromDb(prisma, {
        connectionId: connection.id,
        listingLinkId: listing.id,
      }).catch(() => undefined);
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
        query: { legacy: false },
        body: {
          ...(titleNeedsPatch ? { title: localTitle } : {}),
          ...(descriptionNeedsPatch ? { description: localDescription } : {}),
        },
        bodyEncoding: "form",
        maxAttempts: 1,
        fetchImpl: deps.fetchImpl,
        now: deps.now,
      });
      if (!patch.ok) {
        return classifyFailure(patch.class, patch.retryAfterMs);
      }
    }

    // Best-effort photo push. Never block title/description apply — INW URLs rarely
    // match Etsy CDN URLs, and image_url upload is not reliably supported for all hosts.
    const remoteSet = new Set(remotePhotos);
    for (const url of desiredPhotos) {
      if (remoteSet.has(url)) continue;
      if (!/^https?:\/\//i.test(url)) continue;
      if (/etsystatic\.com|etsyimg\.com/i.test(url)) continue;
      const upload = await etsyConnectionRequest({
        connectionId: connection.id,
        memberId: connection.memberId,
        method: "POST",
        path: `${listingPath}/images`,
        body: { image_url: url },
        bodyEncoding: "form",
        maxAttempts: 1,
        fetchImpl: deps.fetchImpl,
        now: deps.now,
      });
      if (!upload.ok) {
        if (
          upload.class === "THROTTLED" ||
          upload.class === "TRANSIENT" ||
          upload.class === "NETWORK"
        ) {
          return classifyFailure(upload.class, upload.retryAfterMs);
        }
        // Permanent photo failure: title/desc already applied; finish product desire.
        break;
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

  await reconcileEtsyListingHealthFromDb(prisma, {
    connectionId: connection.id,
    listingLinkId: listing.id,
  }).catch(() => undefined);

  return { outcome: "SUCCESS" };
}
