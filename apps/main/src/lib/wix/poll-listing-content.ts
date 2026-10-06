import {
  applyWixListingContentInbound,
  prisma,
  refreshWixListingHealthFromDb,
  type WixJobHandlerResult,
  type WixRemoteListingObservation,
  type WixSyncJobClaim,
} from "database";
import { readWixAppConfig } from "./config";
import { accessTokenForWixConnection } from "./connect";
import { wixApplicationRequest } from "./client";
import { WIX_CATALOG_V1, WIX_V1_PRODUCT_GET, WIX_V3_PRODUCTS } from "./constants";

type PollPayload = {
  listingLinkId: string;
};

type WixRemoteProduct = {
  id?: string;
  name?: string;
  description?: string;
  visible?: boolean;
  priceData?: { price?: number | string };
  media?: {
    mainMedia?: { image?: { url?: string } };
    items?: Array<{ image?: { url?: string } }>;
  };
  variants?: Array<{
    id?: string;
    sku?: string;
    variant?: { priceData?: { price?: number | string } };
    priceData?: { price?: number | string };
  }>;
};

/**
 * POLL_LISTING_CONTENT: re-read a Wix product and apply inbound content to INW.
 */
export async function handleWixPollListingContentJob(
  claim: WixSyncJobClaim
): Promise<WixJobHandlerResult> {
  const payload = claim.payload as PollPayload | null;
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
    include: { connection: true },
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
  const result = await wixApplicationRequest<{ product?: WixRemoteProduct }>({
    method: "GET",
    path: `${isV1 ? WIX_V1_PRODUCT_GET : WIX_V3_PRODUCTS}/${link.wixProductId}`,
    deps: { config, accessToken, maxAttempts: 2 },
  });

  if (!result.ok || !result.data?.product) {
    if (result.class === "NOT_FOUND") {
      return {
        outcome: "DEAD",
        errorClass: "PERMANENT",
        errorCode: "PRODUCT_NOT_FOUND",
        errorMessage: "Product not found on Wix",
      };
    }
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
      errorMessage: result.message || "Could not fetch Wix product",
    };
  }

  const remote = toObservation(link.wixProductId, result.data.product);
  if (!remote) {
    return {
      outcome: "DEAD",
      errorClass: "PERMANENT",
      errorCode: "INVALID_PRODUCT",
      errorMessage: "Wix product payload was missing required fields",
    };
  }

  await prisma.$transaction(async (tx) => {
    await applyWixListingContentInbound(tx, {
      connectionId: link.wixConnectionId,
      memberId: link.memberId,
      listingLinkId: link.id,
      remote,
    });
  });
  await refreshWixListingHealthFromDb(prisma, link.id);

  return { outcome: "SUCCESS" };
}

function toObservation(
  wixProductId: string,
  product: WixRemoteProduct
): WixRemoteListingObservation | null {
  const title = typeof product.name === "string" ? product.name.trim() : "";
  if (!title) return null;

  const photos: string[] = [];
  if (product.media?.mainMedia?.image?.url) photos.push(product.media.mainMedia.image.url);
  for (const item of product.media?.items ?? []) {
    const url = item.image?.url;
    if (url && !photos.includes(url)) photos.push(url);
  }

  const priceCents = priceToCents(product.priceData?.price) ?? 0;
  const variants = (product.variants ?? [])
    .map((variant) => {
      const id = typeof variant.id === "string" ? variant.id : null;
      if (!id) return null;
      const variantPrice =
        priceToCents(variant.priceData?.price) ??
        priceToCents(variant.variant?.priceData?.price) ??
        priceCents;
      return {
        wixVariantId: id,
        priceCents: variantPrice,
        sku: typeof variant.sku === "string" ? variant.sku : null,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  if (variants.length === 0) {
    variants.push({
      wixVariantId: wixProductId,
      priceCents,
      sku: null,
    });
  }

  return {
    wixProductId,
    title,
    description: typeof product.description === "string" ? product.description : null,
    photos,
    priceCents,
    visible: typeof product.visible === "boolean" ? product.visible : null,
    variants,
  };
}

function priceToCents(price: number | string | undefined): number | null {
  if (price === undefined) return null;
  const num = typeof price === "string" ? Number(price) : price;
  if (!Number.isFinite(num) || num < 0) return null;
  return Math.round(num * 100);
}
