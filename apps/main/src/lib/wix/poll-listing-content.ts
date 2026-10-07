import {
  applyWixListingContentInbound,
  persistWixListingHealth,
  prisma,
  refreshWixListingHealthFromDb,
  type WixJobHandlerResult,
  type WixRemoteListingObservation,
  type WixSyncJobClaim,
} from "database";
import { loadWixCatalogVariants } from "./catalog-variants";
import { readWixAppConfig } from "./config";
import { accessTokenForWixConnection } from "./connect";
import { wixApplicationRequest } from "./client";
import { WIX_CATALOG_V1, WIX_V1_PRODUCT_GET, WIX_V3_PRODUCTS } from "./constants";
import { pullWixInventoryIntoInw } from "./project-inventory";
import {
  isSyncWixVariantTopologyFailure,
  syncWixListingVariantTopology,
} from "./sync-listing-variants";

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
    sku?: string | null;
    variant?: { priceData?: { price?: number | string }; sku?: string | null };
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

  // Wix-first structure: pull new options/variants into Foundation before content LWW.
  const topology = await syncWixListingVariantTopology({
    connectionId: link.wixConnectionId,
    memberId: link.memberId,
    listingLinkId: link.id,
    storeItemId: link.storeItemId,
    wixProductId: link.wixProductId,
    catalogVersion: link.connection.catalogVersion,
    direction: "pull",
  });
  if (isSyncWixVariantTopologyFailure(topology)) {
    return topology;
  }
  const skippedReason = topology.status === "SKIPPED" ? topology.reason : null;
  if (!skippedReason) {
    const current = await prisma.wixListingLink.findUnique({
      where: { id: link.id },
      select: { issueCode: true },
    });
    if (current?.issueCode === "TOPOLOGY_UNREADABLE" || current?.issueCode === "OPTION_AXIS_LIMIT") {
      await prisma.wixListingLink.update({
        where: { id: link.id },
        data: { issueCode: null, issueMessage: null, issueSeverity: null },
      });
    }
  }

  // V1 keeps per-variant prices on the variants query, not on product GET.
  const catalog = await loadWixCatalogVariants({
    isV1,
    productId: link.wixProductId,
    fallback: result.data.product.variants ?? [],
    config,
    accessToken,
  });
  const remote = toObservation(
    link.wixProductId,
    result.data.product,
    catalog.ok ? catalog.variants : result.data.product.variants
  );
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
  await pullWixInventoryIntoInw({
    listingLinkId: link.id,
    wixConnectionId: link.wixConnectionId,
    memberId: link.memberId,
    wixProductId: link.wixProductId,
    catalogVersion: link.connection.catalogVersion,
    instanceId: link.connection.instanceId,
  });
  await refreshWixListingHealthFromDb(prisma, link.id);

  if (skippedReason) {
    const after = await prisma.wixListingLink.findUnique({
      where: { id: link.id },
      select: { productContentConflict: true },
    });
    if (!after?.productContentConflict) {
      const tooMany = skippedReason === "TOO_MANY_AXES";
      await persistWixListingHealth(prisma, link.id, {
        readiness: "ACTION_REQUIRED",
        contentHealth: "DEGRADED",
        inventoryHealth: "DEGRADED",
        issueCode: tooMany ? "OPTION_AXIS_LIMIT" : "TOPOLOGY_UNREADABLE",
        issueMessage: tooMany
          ? "Wix has more than 3 option types, so variants were left unchanged"
          : "Wix options could not be read, so quantities were left unchanged",
        issueSeverity: "warning",
      });
    }
  }

  return { outcome: "SUCCESS" };
}

function toObservation(
  wixProductId: string,
  product: WixRemoteProduct,
  catalogVariants?: WixRemoteProduct["variants"]
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
  const sourceVariants = catalogVariants ?? product.variants ?? [];
  const variants = sourceVariants
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

  const facadeCents =
    variants.length > 0
      ? Math.min(...variants.map((variant) => variant.priceCents).filter((cents) => cents > 0))
      : priceCents;

  return {
    wixProductId,
    title,
    description: typeof product.description === "string" ? product.description : null,
    photos,
    priceCents: Number.isFinite(facadeCents) && facadeCents > 0 ? facadeCents : priceCents,
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
