import {
  createWixNativeListingMapping,
  enqueueWixSyncJob,
  prisma,
  refreshWixListingHealthFromDb,
  wixReconcileListingDedupeKey,
  type WixJobHandlerResult,
  type WixSyncJobClaim,
  type WixVariantMappingInput,
} from "database";
import { readWixAppConfig } from "./config";
import { accessTokenForWixConnection } from "./connect";
import { wixApplicationRequest } from "./client";
import {
  WIX_V1_PRODUCTS,
  WIX_V1_PRODUCT_GET,
  WIX_V3_PRODUCTS,
  WIX_CATALOG_V1,
} from "./constants";

type CreateListingPayload = {
  storeItemId: string;
  memberId: string;
};

/**
 * CREATE_LISTING job handler: create a new product on Wix from INW listing.
 */
export async function handleWixCreateListingJob(
  claim: WixSyncJobClaim
): Promise<WixJobHandlerResult> {
  const payload = claim.payload as CreateListingPayload | null;
  if (!payload?.storeItemId || !payload?.memberId) {
    return {
      outcome: "DEAD",
      errorClass: "PERMANENT",
      errorCode: "MISSING_PAYLOAD",
      errorMessage: "Missing storeItemId or memberId in job payload",
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

  // Load connection
  const connection = await prisma.wixConnection.findFirst({
    where: { id: claim.wixConnectionId, status: "ACTIVE" },
  });

  if (!connection) {
    return {
      outcome: "DEAD",
      errorClass: "PERMANENT",
      errorCode: "CONNECTION_NOT_FOUND",
      errorMessage: "Active Wix connection not found",
    };
  }

  // Check if already linked
  const existingLink = await prisma.wixListingLink.findFirst({
    where: {
      wixConnectionId: connection.id,
      storeItemId: payload.storeItemId,
    },
  });

  if (existingLink) {
    return { outcome: "SUCCESS" }; // Already created
  }

  // Load store item with variants
  const storeItem = await prisma.storeItem.findUnique({
    where: { id: payload.storeItemId },
    include: {
      storeVariants: {
        where: { status: "ACTIVE" },
        include: {
          inventoryState: true,
        },
      },
    },
  });

  if (!storeItem) {
    return {
      outcome: "DEAD",
      errorClass: "PERMANENT",
      errorCode: "ITEM_NOT_FOUND",
      errorMessage: "Store item not found",
    };
  }

  // Mint access token
  let accessToken: string;
  try {
    accessToken = await accessTokenForWixConnection({ instanceId: connection.instanceId });
  } catch (error) {
    return {
      outcome: "RETRY",
      errorClass: "AUTH",
      errorCode: "TOKEN_MINT_FAILED",
      errorMessage: error instanceof Error ? error.message : "Token mint failed",
    };
  }

  const isV1 = connection.catalogVersion === WIX_CATALOG_V1;
  const priceValue = (storeItem.priceCents / 100).toFixed(2);

  // Calculate total quantity
  let totalQuantity = 0;
  for (const variant of storeItem.storeVariants) {
    if (variant.inventoryState?.mode === "TRACKED_FINITE") {
      const onHand = variant.inventoryState.onHand ?? 0;
      const reserved = variant.inventoryState.reserved ?? 0;
      totalQuantity += Math.max(0, onHand - reserved);
    }
  }

  try {
    let wixProductId: string;
    const variantMappings: WixVariantMappingInput[] = [];
    const productOptions = buildWixProductOptions(storeItem.storeVariants);

    if (isV1) {
      // V1: Create product
      const result = await wixApplicationRequest<{
        product?: { id?: string; variants?: Array<{ id?: string; choices?: Record<string, string> }> };
      }>({
        method: "POST",
        path: WIX_V1_PRODUCTS,
        body: JSON.stringify({
          product: {
            name: storeItem.title,
            description: storeItem.description || "",
            productType: "physical",
            priceData: {
              price: parseFloat(priceValue),
            },
            visible: true,
            stock: {
              trackQuantity: storeItem.inventoryTracking === "tracked",
              quantity: totalQuantity,
            },
            ...(productOptions.length > 0 ? { productOptions, manageVariants: true } : {}),
          },
        }),
        deps: { config, accessToken, maxAttempts: 1 },
      });

      if (!result.ok || !result.data?.product?.id) {
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
          errorCode: "CREATE_FAILED",
          errorMessage: result.message || "Failed to create product on Wix",
        };
      }

      wixProductId = result.data.product.id;
      const remoteVariants = await remoteVariantsForCreatedProduct({
        isV1: true,
        wixProductId,
        responseVariants: result.data.product.variants,
        localCount: storeItem.storeVariants.length,
        config,
        accessToken,
      });
      const mapped = mapStoreVariantsToWix(storeItem.storeVariants, remoteVariants, wixProductId);
      if (!mapped) {
        return {
          outcome: "RETRY",
          errorClass: "TRANSIENT",
          errorCode: "VARIANT_MAP_INCOMPLETE",
          errorMessage: "Wix did not return every variant yet",
        };
      }
      variantMappings.push(...mapped);
    } else {
      // V3: Create product
      const result = await wixApplicationRequest<{
        product?: { id?: string; variants?: Array<{ id?: string; choices?: Record<string, string> }> };
      }>({
        method: "POST",
        path: WIX_V3_PRODUCTS,
        body: JSON.stringify({
          product: {
            name: storeItem.title,
            description: storeItem.description || "",
            productType: "physical",
            priceData: {
              price: priceValue,
            },
            visible: true,
            stock: {
              trackInventory: storeItem.inventoryTracking === "tracked",
              quantity: totalQuantity,
            },
            ...(productOptions.length > 0 ? { productOptions, manageVariants: true } : {}),
          },
        }),
        deps: { config, accessToken, maxAttempts: 1 },
      });

      if (!result.ok || !result.data?.product?.id) {
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
          errorCode: "CREATE_FAILED",
          errorMessage: result.message || "Failed to create product on Wix",
        };
      }

      wixProductId = result.data.product.id;
      const remoteVariants = await remoteVariantsForCreatedProduct({
        isV1: false,
        wixProductId,
        responseVariants: result.data.product.variants,
        localCount: storeItem.storeVariants.length,
        config,
        accessToken,
      });
      const mapped = mapStoreVariantsToWix(storeItem.storeVariants, remoteVariants, wixProductId);
      if (!mapped) {
        return {
          outcome: "RETRY",
          errorClass: "TRANSIENT",
          errorCode: "VARIANT_MAP_INCOMPLETE",
          errorMessage: "Wix did not return every variant yet",
        };
      }
      variantMappings.push(...mapped);
    }

    // Create mapping
    const mapping = await createWixNativeListingMapping(prisma, {
      wixConnectionId: connection.id,
      memberId: payload.memberId,
      storeItemId: payload.storeItemId,
      wixProductId,
      variants: variantMappings,
    });

    await prisma.wixListingLink.update({
      where: { id: mapping.listingLink.id },
      data: { remoteProductVisible: true },
    });
    await refreshWixListingHealthFromDb(prisma, mapping.listingLink.id);
    await enqueueWixSyncJob(prisma, {
      wixConnectionId: connection.id,
      kind: "RECONCILE_LISTING",
      dedupeKey: wixReconcileListingDedupeKey(mapping.listingLink.id),
      payload: { listingLinkId: mapping.listingLink.id },
      nextAttemptAt: new Date(),
    });

    console.info("WIX_LISTING_CREATED", {
      connectionId: connection.id,
      storeItemId: payload.storeItemId,
      wixProductId,
    });

    return { outcome: "SUCCESS" };
  } catch (error) {
    return {
      outcome: "RETRY",
      errorClass: "TRANSIENT",
      errorCode: "CREATE_FAILED",
      errorMessage: error instanceof Error ? error.message : "Create failed",
    };
  }
}

type LocalVariant = {
  id: string;
  sku: string | null;
  options: unknown;
};

type RemoteVariant = { id?: string; choices?: Record<string, string> };

function asChoiceRecord(options: unknown): Record<string, string> {
  if (!options || typeof options !== "object" || Array.isArray(options)) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(options as Record<string, unknown>)) {
    if (typeof value === "string" && value.trim()) out[key] = value;
  }
  return out;
}

function choiceKey(choices: Record<string, string>): string {
  return Object.entries(choices)
    .map(([key, value]) => `${key.trim().toLowerCase()}=${value.trim().toLowerCase()}`)
    .sort()
    .join("|");
}

function buildWixProductOptions(variants: LocalVariant[]) {
  const axes = new Map<string, Set<string>>();
  for (const variant of variants) {
    for (const [name, value] of Object.entries(asChoiceRecord(variant.options))) {
      const values = axes.get(name) ?? new Set<string>();
      values.add(value);
      axes.set(name, values);
    }
  }
  return [...axes.entries()].map(([name, values]) => ({
    name,
    choices: [...values].map((value) => ({ value, description: value })),
  }));
}

function mapStoreVariantsToWix(
  local: LocalVariant[],
  remote: RemoteVariant[],
  wixProductId: string
): WixVariantMappingInput[] | null {
  if (local.length === 0) return null;
  const optioned = local.some((variant) => Object.keys(asChoiceRecord(variant.options)).length > 0);
  if (!optioned) {
    const only = local[0];
    if (!only || local.length !== 1) return null;
    return [
      {
        storeVariantId: only.id,
        wixVariantId: remote[0]?.id ?? wixProductId,
        remoteSku: only.sku,
      },
    ];
  }

  const used = new Set<string>();
  const mappings: WixVariantMappingInput[] = [];
  for (const variant of local) {
    const key = choiceKey(asChoiceRecord(variant.options));
    const match = remote.find((row) => {
      const id = row.id;
      return !!id && !used.has(id) && choiceKey(row.choices ?? {}) === key;
    });
    if (!match?.id) return null;
    used.add(match.id);
    mappings.push({
      storeVariantId: variant.id,
      wixVariantId: match.id,
      choicesJson: asChoiceRecord(variant.options),
      remoteSku: variant.sku,
    });
  }
  return mappings;
}

async function remoteVariantsForCreatedProduct(input: {
  isV1: boolean;
  wixProductId: string;
  responseVariants: RemoteVariant[] | undefined;
  localCount: number;
  config: NonNullable<ReturnType<typeof readWixAppConfig>>;
  accessToken: string;
}): Promise<RemoteVariant[]> {
  const initial = input.responseVariants ?? [];
  if (initial.length >= input.localCount) return initial;
  const result = await wixApplicationRequest<{
    product?: { variants?: RemoteVariant[] };
  }>({
    method: "GET",
    path: `${input.isV1 ? WIX_V1_PRODUCT_GET : WIX_V3_PRODUCTS}/${input.wixProductId}`,
    deps: { config: input.config, accessToken: input.accessToken, maxAttempts: 1 },
  });
  return result.data?.product?.variants ?? initial;
}
