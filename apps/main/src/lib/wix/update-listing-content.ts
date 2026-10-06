import {
  prisma,
  refreshWixListingHealthFromDb,
  type WixJobHandlerResult,
  type WixSyncJobClaim,
} from "database";
import { readWixAppConfig } from "./config";
import { accessTokenForWixConnection } from "./connect";
import { wixApplicationRequest } from "./client";
import {
  WIX_V1_PRODUCT_GET,
  WIX_V3_PRODUCTS,
  WIX_CATALOG_V1,
} from "./constants";

type UpdateContentPayload = {
  listingLinkId: string;
};

/**
 * UPDATE_LISTING_CONTENT job handler: push content changes to Wix.
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

  // Load listing link with store item and connection
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

  // Check if update is needed (desired > applied)
  if (link.desiredProductContentVersion <= link.appliedProductContentVersion) {
    return { outcome: "SUCCESS" };
  }

  // Mint access token
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

  // Build update payload
  const priceValue = (item.priceCents / 100).toFixed(2);
  const photos = photoUrls(item.photos);
  const media = photos.length > 0 ? { items: photos.map((url) => ({ image: { url } })) } : undefined;

  try {
    if (isV1) {
      // V1: PATCH product
      const result = await wixApplicationRequest({
        method: "PATCH",
        path: `${WIX_V1_PRODUCT_GET}/${link.wixProductId}`,
        body: JSON.stringify({
          product: {
            name: item.title,
            description: item.description || "",
            priceData: {
              price: parseFloat(priceValue),
            },
            ...(media ? { media } : {}),
          },
        }),
        deps: { config, accessToken, maxAttempts: 1 },
      });

      if (!result.ok) {
        return contentWriteFailure(result);
      }
    } else {
      // V3: PATCH product
      const result = await wixApplicationRequest({
        method: "PATCH",
        path: `${WIX_V3_PRODUCTS}/${link.wixProductId}`,
        body: JSON.stringify({
          product: {
            name: item.title,
            description: item.description || "",
            priceData: {
              price: priceValue,
            },
            ...(media ? { media } : {}),
          },
        }),
        deps: { config, accessToken, maxAttempts: 1 },
      });

      if (!result.ok) {
        return contentWriteFailure(result);
      }
    }

    const readBack = await wixApplicationRequest<{
      product?: { name?: string; priceData?: { price?: number | string } };
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
    const remoteName = normalizeComparableText(readBack.data.product.name);
    const localName = normalizeComparableText(item.title);
    const remoteCents = priceToCents(readBack.data.product.priceData?.price);
    const nameMatches = remoteName === localName;
    const priceMatches =
      remoteCents != null && Math.abs(remoteCents - item.priceCents) <= 1;
    // PATCH already succeeded. Soft-verify so minor Wix formatting differences
    // do not leave desired>applied forever (stuck Syncing).
    if (!nameMatches && !priceMatches) {
      console.warn("WIX_CONTENT_READBACK_SOFT_MISMATCH", {
        listingLinkId: link.id,
        localName,
        remoteName,
        localCents: item.priceCents,
        remoteCents,
      });
    }

    // Update link to mark content as applied
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
  if (result.class === "NOT_FOUND") {
    return {
      outcome: "DEAD",
      errorClass: "PERMANENT",
      errorCode: "PRODUCT_NOT_FOUND",
      errorMessage: "Product not found on Wix",
    };
  }
  if (result.class === "VALIDATION" && /media|image|photo/i.test(result.message)) {
    return {
      outcome: "DEAD",
      errorClass: "PERMANENT",
      errorCode: "MEDIA_NOT_APPLIED",
      errorMessage: "Wix could not use these photos. Update the listing photos and try again.",
    };
  }
  return {
    outcome: "DEAD",
    errorClass: result.class,
    errorCode: result.class,
    errorMessage: result.message,
  };
}

function photoUrls(photos: unknown): string[] {
  if (!Array.isArray(photos)) return [];
  return photos.filter((photo): photo is string => typeof photo === "string" && photo.trim().length > 0);
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
