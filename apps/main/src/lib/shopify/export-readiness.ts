import {
  lookupShopifyListingByStoreItem,
  prisma,
  SHOPIFY_MAX_OPTION_DIMENSIONS,
  SHOPIFY_MAX_VARIANTS,
} from "database";

export type ShopifyExportBlockerCode =
  | "CONNECTION_REQUIRED"
  | "LOCATION_REQUIRED"
  | "NOT_FOUND"
  | "INACTIVE"
  | "UNSUPPORTED_VARIANTS"
  | "MISSING_TITLE"
  | "MISSING_PRICE"
  | "ALREADY_MAPPED";

export type ShopifyExportBlocker = {
  code: ShopifyExportBlockerCode;
  message: string;
};

export type ShopifyExportReadiness = {
  canList: boolean;
  alreadyMapped: boolean;
  connectionId: string | null;
  shopDomain: string | null;
  inventoryReady: boolean;
  locationSelectionRequired: boolean;
  shopifyProductId: string | null;
  variantCount: number;
  blockers: ShopifyExportBlocker[];
};

function parseOptions(raw: unknown): Record<string, unknown> | null {
  let value: unknown = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/**
 * Shared preflight for List on Shopify — same rules as enqueueShopifyCreateListing.
 */
export async function getShopifyExportReadiness(input: {
  memberId: string;
  storeItemId: string;
}): Promise<ShopifyExportReadiness> {
  const blockers: ShopifyExportBlocker[] = [];

  const connection = await prisma.shopifyConnection.findFirst({
    where: { memberId: input.memberId, status: "ACTIVE" },
    orderBy: { connectedAt: "desc" },
    select: {
      id: true,
      shopDomain: true,
      primaryLocationId: true,
      status: true,
    },
  });

  if (!connection) {
    return {
      canList: false,
      alreadyMapped: false,
      connectionId: null,
      shopDomain: null,
      inventoryReady: false,
      locationSelectionRequired: false,
      shopifyProductId: null,
      variantCount: 0,
      blockers: [
        {
          code: "CONNECTION_REQUIRED",
          message: "Connect Shopify before listing",
        },
      ],
    };
  }

  const inventoryReady = Boolean(connection.primaryLocationId);
  if (!inventoryReady) {
    blockers.push({
      code: "LOCATION_REQUIRED",
      message: "Select a primary Shopify location before listing",
    });
  }

  const storeItem = await prisma.storeItem.findFirst({
    where: { id: input.storeItemId, memberId: input.memberId },
    select: {
      id: true,
      status: true,
      title: true,
      storeVariants: {
        where: { status: "ACTIVE" },
        select: { id: true, options: true, priceCents: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!storeItem) {
    return {
      canList: false,
      alreadyMapped: false,
      connectionId: connection.id,
      shopDomain: connection.shopDomain,
      inventoryReady,
      locationSelectionRequired: !inventoryReady,
      shopifyProductId: null,
      variantCount: 0,
      blockers: [{ code: "NOT_FOUND", message: "Store item was not found" }],
    };
  }

  if (storeItem.status === "inactive") {
    blockers.push({
      code: "INACTIVE",
      message: "Only active listings can be listed on Shopify",
    });
  }

  if (!storeItem.title?.trim()) {
    blockers.push({
      code: "MISSING_TITLE",
      message: "Add a title before listing on Shopify",
    });
  }

  const variants = storeItem.storeVariants;
  if (variants.length < 1 || variants.length > SHOPIFY_MAX_VARIANTS) {
    blockers.push({
      code: "UNSUPPORTED_VARIANTS",
      message: `Shopify export supports 1–${SHOPIFY_MAX_VARIANTS} variants; found ${variants.length}`,
    });
  } else if (variants.length > 1) {
    const axisNames = new Set<string>();
    for (const v of variants) {
      const opts = parseOptions(v.options);
      if (opts) {
        for (const key of Object.keys(opts)) axisNames.add(key);
      }
    }
    if (axisNames.size < 1 || axisNames.size > SHOPIFY_MAX_OPTION_DIMENSIONS) {
      blockers.push({
        code: "UNSUPPORTED_VARIANTS",
        message: `Shopify export supports 1–${SHOPIFY_MAX_OPTION_DIMENSIONS} option dimensions; found ${axisNames.size}`,
      });
    }
  }

  if (variants.some((v) => !(typeof v.priceCents === "number" && v.priceCents > 0))) {
    blockers.push({
      code: "MISSING_PRICE",
      message: "Every variant needs a price greater than zero",
    });
  }

  const mapped = await lookupShopifyListingByStoreItem(prisma, {
    connectionId: connection.id,
    storeItemId: storeItem.id,
  });

  let alreadyMapped = false;
  let shopifyProductId: string | null = null;
  if (mapped.status === "MAPPED") {
    alreadyMapped = true;
    shopifyProductId = mapped.listingLink.shopifyProductId;
    blockers.push({
      code: "ALREADY_MAPPED",
      message: "This listing is already linked to Shopify",
    });
  } else if (mapped.status === "CONNECTION_INACTIVE") {
    blockers.push({
      code: "CONNECTION_REQUIRED",
      message: "Shopify connection is not active",
    });
  }

  const blocking = blockers.filter((b) => b.code !== "ALREADY_MAPPED");
  return {
    canList: blocking.length === 0 && !alreadyMapped,
    alreadyMapped,
    connectionId: connection.id,
    shopDomain: connection.shopDomain,
    inventoryReady,
    locationSelectionRequired: !inventoryReady,
    shopifyProductId,
    variantCount: variants.length,
    blockers,
  };
}
