import {
  markWixVariantContentApplied,
  prisma,
  refreshWixListingHealthFromDb,
  wixTopologyDesirePending,
  wixVariantContentFingerprint,
  type WixJobHandlerResult,
  type WixSyncJobClaim,
} from "database";
import { pushWixV1VariantChoices, pushWixV3VariantPrices } from "./catalog-variants";
import { readWixAppConfig } from "./config";
import { accessTokenForWixConnection } from "./connect";
import { wixApplicationRequest } from "./client";
import {
  WIX_V1_PRODUCT_GET,
  WIX_V3_PRODUCTS,
  WIX_CATALOG_V1,
} from "./constants";
import { wixPublicPhotoUrls, wixV1ProductMedia, wixV3ProductMedia } from "./listing-media";

type UpdateContentPayload = {
  listingLinkId: string;
};

/**
 * UPDATE_LISTING_CONTENT job handler: push product and per-variant content to Wix.
 */
export async function handleWixUpdateListingContentJob(
  claim: WixSyncJobClaim
): Promise<WixJobHandlerResult> {
  const payload = claim.payload as UpdateContentPayload | null;
  if (!payload?.listingLinkId) {
    return {
      outcome: "DEAD",
      errorClass: "PERMANENT",
      errorCode: "MISSING_PAYLOAD",
      errorMessage: "Missing listingLinkId in job payload",
    };
  }

  const config = readWixAppConfig();
  if (!config) {
    return {
      outcome: "DEAD",
      errorClass: "PERMANENT",
      errorCode: "NOT_CONFIGURED",
      errorMessage: "Wix is not configured",
    };
  }

  const link = await prisma.wixListingLink.findUnique({
    where: { id: payload.listingLinkId },
    include: {
      connection: true,
      storeItem: {
        select: {
          id: true,
          title: true,
          description: true,
          priceCents: true,
          photos: true,
        },
      },
      variantMaps: {
        select: {
          id: true,
          storeVariantId: true,
          wixVariantId: true,
          desiredVariantContentVersion: true,
          appliedVariantContentVersion: true,
          desiredVariantFingerprint: true,
        },
      },
    },
  });

  if (!link) {
    return {
      outcome: "DEAD",
      errorClass: "PERMANENT",
      errorCode: "LINK_NOT_FOUND",
      errorMessage: "Listing link not found",
    };
  }

  if (link.connection.status !== "ACTIVE") {
    return {
      outcome: "DEAD",
      errorClass: "PERMANENT",
      errorCode: "CONNECTION_INACTIVE",
      errorMessage: "Wix connection is not active",
    };
  }

  const productPending =
    link.desiredProductContentVersion > link.appliedProductContentVersion;
  const dirtyVariantMaps = link.variantMaps.filter(
    (map) => map.desiredVariantContentVersion > map.appliedVariantContentVersion
  );
  if (!productPending && dirtyVariantMaps.length === 0) {
    return { outcome: "SUCCESS" };
  }

  let accessToken: string;
  try {
    accessToken = await accessTokenForWixConnection({ instanceId: link.connection.instanceId });
  } catch (error) {
    return {
      outcome: "RETRY",
      errorClass: "AUTH",
      errorCode: "TOKEN_MINT_FAILED",
      errorMessage: error instanceof Error ? error.message : "Token mint failed",
    };
  }

  const isV1 = link.connection.catalogVersion === WIX_CATALOG_V1;
  const item = link.storeItem;

  try {
    if (productPending) {
      const priceValue = (item.priceCents / 100).toFixed(2);
      // A product-level price rewrite flattens every variant price. Leave that to the
      // option push while a saved option edit is still waiting on Wix.
      const writeProductPrice = !wixTopologyDesirePending(link);
      const photos = wixPublicPhotoUrls(item.photos);
      const media = isV1 ? wixV1ProductMedia(photos) : wixV3ProductMedia(photos);
      const result = await wixApplicationRequest({
        method: "PATCH",
        path: `${isV1 ? WIX_V1_PRODUCT_GET : WIX_V3_PRODUCTS}/${link.wixProductId}`,
        body: JSON.stringify({
          product: {
            name: item.title,
            description: item.description || "",
            ...(writeProductPrice
              ? {
                  priceData: isV1
                    ? { price: parseFloat(priceValue) }
                    : { price: priceValue },
                }
              : {}),
            ...(media ? { media } : {}),
          },
        }),
        deps: { config, accessToken, maxAttempts: 1 },
      });
      if (!result.ok) return contentWriteFailure(result);

      const readBack = await wixApplicationRequest<{
        product?: {
          name?: string;
          priceData?: { price?: number | string };
          media?: {
            mainMedia?: { image?: { url?: string } };
            items?: Array<{ image?: { url?: string } }>;
            itemsInfo?: { items?: Array<{ url?: string }> };
          };
        };
      }>({
        method: "GET",
        path: `${isV1 ? WIX_V1_PRODUCT_GET : WIX_V3_PRODUCTS}/${link.wixProductId}`,
        deps: { config, accessToken, maxAttempts: 1 },
      });
      if (!readBack.ok || !readBack.data?.product) {
        return {
          outcome: "RETRY",
          errorClass: readBack.class === "SUCCESS" ? "TRANSIENT" : readBack.class,
          errorCode: "READBACK_FAILED",
          errorMessage: readBack.message || "Could not read the Wix product back",
        };
      }
      const remoteProduct = readBack.data.product;
      const remoteName = normalizeComparableText(remoteProduct.name);
      const localName = normalizeComparableText(item.title);
      const remoteCents = priceToCents(remoteProduct.priceData?.price);
      const nameMatches = remoteName === localName;
      const priceMatches =
        !writeProductPrice || (remoteCents != null && Math.abs(remoteCents - item.priceCents) <= 1);
      const localPhotoCount = wixPublicPhotoUrls(item.photos).length;
      const photosMatch = localPhotoCount === 0 || remotePhotoCount(remoteProduct.media) >= localPhotoCount;
      if (!nameMatches || !priceMatches || !photosMatch) {
        return {
          outcome: "RETRY",
          errorClass: "TRANSIENT",
          errorCode: "CONTENT_READBACK_MISMATCH",
          errorMessage: "Wix did not show the INW title, price, or photos after the update",
        };
      }

      await prisma.wixListingLink.update({
        where: { id: link.id },
        data: {
          appliedProductContentVersion: link.desiredProductContentVersion,
          appliedProductFingerprint: link.desiredProductFingerprint,
          productContentAppliedAt: new Date(),
          contentHealth: "HEALTHY",
          issueCode: null,
          issueMessage: null,
        },
      });
    }

    if (dirtyVariantMaps.length > 0 && wixTopologyDesirePending(link)) {
      return {
        outcome: "RETRY",
        errorClass: "TRANSIENT",
        errorCode: "TOPOLOGY_PENDING",
        errorMessage: "Waiting until Wix options match INW before pushing variant prices",
      };
    }

    if (dirtyVariantMaps.length > 0) {
      const storeVariants = await prisma.storeVariant.findMany({
        where: {
          id: { in: dirtyVariantMaps.map((map) => map.storeVariantId) },
        },
        select: { id: true, options: true, priceCents: true, sku: true, status: true },
      });
      const byId = new Map(storeVariants.map((variant) => [variant.id, variant]));
      const rows = dirtyVariantMaps
        .map((map) => {
          const variant = byId.get(map.storeVariantId);
          if (!variant) return null;
          const options =
            variant.options && typeof variant.options === "object" && !Array.isArray(variant.options)
              ? (variant.options as Record<string, string>)
              : {};
          if (isV1 && Object.keys(options).length < 1) return null;
          if (!isV1 && !map.wixVariantId) return null;
          return {
            mapId: map.id,
            desiredVersion: map.desiredVariantContentVersion,
            fingerprint:
              map.desiredVariantFingerprint ??
              wixVariantContentFingerprint({
                priceCents: variant.priceCents,
                sku: variant.sku,
              }),
            wixVariantId: map.wixVariantId,
            options,
            priceCents: variant.priceCents,
            sku: variant.sku,
            visible: variant.status === "ACTIVE",
          };
        })
        .filter((row): row is NonNullable<typeof row> => row != null);

      if (rows.length > 0) {
        const wrote = isV1
          ? await pushWixV1VariantChoices({
              productId: link.wixProductId,
              variants: rows.map((row) => ({
                options: row.options,
                priceCents: row.priceCents,
                sku: row.sku,
                visible: row.visible,
              })),
              config,
              accessToken,
            })
          : await pushWixV3VariantPrices({
              productId: link.wixProductId,
              variants: rows.map((row) => ({
                wixVariantId: row.wixVariantId,
                priceCents: row.priceCents,
                sku: row.sku,
                visible: row.visible,
              })),
              config,
              accessToken,
            });
        if (wrote) return wrote;
        for (const row of rows) {
          await markWixVariantContentApplied(prisma, {
            variantMapId: row.mapId,
            appliedVersion: row.desiredVersion,
            appliedFingerprint: row.fingerprint,
          });
        }
      }
    }

    await refreshWixListingHealthFromDb(prisma, link.id);
    return { outcome: "SUCCESS" };
  } catch (error) {
    return {
      outcome: "RETRY",
      errorClass: "TRANSIENT",
      errorCode: "UPDATE_FAILED",
      errorMessage: error instanceof Error ? error.message : "Update failed",
    };
  }
}

function contentWriteFailure(result: {
  class: string;
  message: string;
  retryAfterMs: number | null;
}): WixJobHandlerResult {
  if (result.class === "THROTTLED" || result.class === "TRANSIENT" || result.class === "NETWORK") {
    return {
      outcome: "RETRY",
      errorClass: result.class,
      errorCode: result.class,
      errorMessage: result.message,
      retryAt: result.retryAfterMs ? new Date(Date.now() + result.retryAfterMs) : undefined,
    };
  }
  return {
    outcome: "DEAD",
    errorClass: result.class,
    errorCode: result.class,
    errorMessage: result.message,
  };
}

function remotePhotoCount(media: {
  mainMedia?: { image?: { url?: string } };
  items?: Array<{ image?: { url?: string } }>;
  itemsInfo?: { items?: Array<{ url?: string }> };
} | undefined): number {
  const urls = new Set<string>();
  const main = media?.mainMedia?.image?.url;
  if (main) urls.add(main);
  for (const item of media?.items ?? []) {
    if (item.image?.url) urls.add(item.image.url);
  }
  for (const item of media?.itemsInfo?.items ?? []) {
    if (item.url) urls.add(item.url);
  }
  return urls.size;
}

function normalizeComparableText(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

function priceToCents(price: number | string | undefined): number | null {
  if (price === undefined) return null;
  const num = typeof price === "string" ? Number(price) : price;
  if (!Number.isFinite(num) || num < 0) return null;
  return Math.round(num * 100);
}
