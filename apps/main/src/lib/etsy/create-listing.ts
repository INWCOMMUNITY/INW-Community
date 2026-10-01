import {
  captureEtsyInventoryProjectionDesire,
  createEtsyImportedListingMapping,
  enqueueEtsySyncJob,
  EtsyMappingConflictError,
  EtsySyncJobConflictError,
  lookupEtsyListingByRemoteId,
  prisma,
  provisionNativeFoundationListing,
  resolveEtsyHowItsMadeForCreate,
  type EtsyJobHandlerResult,
  type EtsySyncJobClaim,
} from "database";
import { etsyConnectionRequest } from "./connection-request";
import type { EtsyFetch } from "./client";
import { resolveEtsyTaxonomyFallback, sanitizeEtsyTaxonomyId } from "./taxonomy-default";
import { ETSY_PLATFORM_DEFAULT_TAXONOMY_ID } from "./apps-airport";
import { resolveEtsyReadinessStateId } from "./readiness-state";
import { notifyEtsyListingIssueOnce } from "./listing-issue-notify";
import { resolveEtsyListingPackageFields } from "./listing-package";

export type EnqueueEtsyCreateListingResult =
  | {
      status: "ALREADY_MAPPED";
      connectionId: string;
      storeItemId: string;
      etsyListingId: string;
    }
  | {
      status: "QUEUED";
      connectionId: string;
      storeItemId: string;
      jobId: string;
    }
  | {
      status: "ERROR";
      code:
        | "UNAUTHORIZED"
        | "NOT_FOUND"
        | "CONNECTION_INACTIVE"
        | "HOW_ITS_MADE_REQUIRED"
        | "SHIPPING_PROFILE_REQUIRED"
        | "UNSUPPORTED_VARIANTS"
        | "INVALID_ITEM"
        | "CONFLICT";
      message: string;
      missing?: string[];
    };

export function etsyCreateListingDedupeKey(connectionId: string, storeItemId: string): string {
  return `CREATE_LISTING:${connectionId}:${storeItemId}`;
}

/**
 * Seller-initiated enqueue for CREATE_LISTING. No Etsy network calls.
 * Fails closed when How it's made / taxonomy are incomplete.
 */
export async function enqueueEtsyCreateListing(input: {
  memberId: string;
  storeItemId: string;
}): Promise<EnqueueEtsyCreateListingResult> {
  const connection = await prisma.etsyConnection.findFirst({
    where: { memberId: input.memberId, status: "ACTIVE" },
    orderBy: { connectedAt: "desc" },
  });
  if (!connection) {
    return {
      status: "ERROR",
      code: "CONNECTION_INACTIVE",
      message: "No active Etsy connection",
    };
  }

  const existing = await prisma.etsyListingLink.findUnique({
    where: {
      etsyConnectionId_storeItemId: {
        etsyConnectionId: connection.id,
        storeItemId: input.storeItemId,
      },
    },
  });
  if (existing) {
    return {
      status: "ALREADY_MAPPED",
      connectionId: connection.id,
      storeItemId: input.storeItemId,
      etsyListingId: existing.etsyListingId,
    };
  }

  const storeItem = await prisma.storeItem.findFirst({
    where: { id: input.storeItemId, memberId: input.memberId },
    select: {
      id: true,
      status: true,
      title: true,
      description: true,
      priceCents: true,
      quantity: true,
      inventoryTracking: true,
      etsyWhoMade: true,
      etsyWhenMade: true,
      etsyIsSupply: true,
      etsyTaxonomyId: true,
    },
  });
  if (!storeItem) {
    return { status: "ERROR", code: "NOT_FOUND", message: "Store item was not found" };
  }
  if (storeItem.status === "inactive") {
    return {
      status: "ERROR",
      code: "INVALID_ITEM",
      message: "Ended listings cannot be published to Etsy",
    };
  }
  if (!storeItem.title?.trim() || storeItem.priceCents < 1) {
    return {
      status: "ERROR",
      code: "INVALID_ITEM",
      message: "Etsy listings require a title and price greater than zero",
    };
  }

  if (!connection.defaultShippingProfileId?.trim()) {
    return {
      status: "ERROR",
      code: "SHIPPING_PROFILE_REQUIRED",
      message:
        "Set a default Etsy shipping profile in Apps Airport → Etsy → Settings before listing items.",
    };
  }

  const how = resolveEtsyHowItsMadeForCreate({
    etsyWhoMade: storeItem.etsyWhoMade,
    etsyWhenMade: storeItem.etsyWhenMade,
    etsyIsSupply: storeItem.etsyIsSupply,
    etsyTaxonomyId: sanitizeEtsyTaxonomyId(storeItem.etsyTaxonomyId),
    defaultTaxonomyId: resolveEtsyTaxonomyFallback(connection.defaultTaxonomyId),
    inventoryTracking: storeItem.inventoryTracking,
  });
  if (!how.ok) {
    return {
      status: "ERROR",
      code: "HOW_ITS_MADE_REQUIRED",
      message: how.message,
      missing: how.missing,
    };
  }

  const variants = await prisma.storeVariant.findMany({
    where: { storeItemId: storeItem.id, memberId: input.memberId, status: "ACTIVE" },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  if (variants.length < 1 || variants.length > 400) {
    return {
      status: "ERROR",
      code: "UNSUPPORTED_VARIANTS",
      message: `Etsy export supports 1–400 variants; found ${variants.length}`,
    };
  }

  try {
    const job = await enqueueEtsySyncJob(prisma, {
      etsyConnectionId: connection.id,
      kind: "CREATE_LISTING",
      dedupeKey: etsyCreateListingDedupeKey(connection.id, storeItem.id),
      payload: {
        storeItemId: storeItem.id,
        storeVariantId: variants[0]!.id,
        storeVariantIds: variants.map((v) => v.id),
      },
    });
    return {
      status: "QUEUED",
      connectionId: connection.id,
      storeItemId: storeItem.id,
      jobId: job.id,
    };
  } catch (error) {
    if (error instanceof EtsySyncJobConflictError) {
      return {
        status: "ERROR",
        code: "CONFLICT",
        message: "A create-listing job already exists with different payload",
      };
    }
    throw error;
  }
}

function parsePayload(payload: unknown): {
  storeItemId: string;
  storeVariantId: string;
  storeVariantIds: string[];
} | null {
  if (!payload || typeof payload !== "object") return null;
  const row = payload as Record<string, unknown>;
  const storeItemId = typeof row.storeItemId === "string" ? row.storeItemId : "";
  const storeVariantId = typeof row.storeVariantId === "string" ? row.storeVariantId : "";
  if (!storeItemId || !storeVariantId) return null;
  const storeVariantIds = Array.isArray(row.storeVariantIds)
    ? row.storeVariantIds.filter((v): v is string => typeof v === "string" && v.length > 0)
    : [storeVariantId];
  return { storeItemId, storeVariantId, storeVariantIds };
}

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
      errorMessage: message ?? `Etsy provider ${apiClass}`,
      retryAt: retryAfterMs != null ? new Date(Date.now() + retryAfterMs) : undefined,
    };
  }
  return {
    outcome: "DEAD",
    errorClass: apiClass || "PERMANENT",
    errorCode: apiClass || "PROVIDER_ERROR",
    errorMessage: message ?? "Etsy CREATE_LISTING failed permanently",
  };
}

/**
 * CREATE_LISTING handler: draft listing with How it's made → map → optional activate.
 */
export async function handleEtsyCreateListingJob(
  claim: EtsySyncJobClaim,
  deps: { fetchImpl?: EtsyFetch; now?: Date } = {}
): Promise<EtsyJobHandlerResult> {
  const payload = parsePayload(claim.payload);
  if (!payload) {
    return {
      outcome: "DEAD",
      errorClass: "PERMANENT",
      errorCode: "INVALID_PAYLOAD",
      errorMessage: "CREATE_LISTING payload is invalid",
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

  const already = await prisma.etsyListingLink.findUnique({
    where: {
      etsyConnectionId_storeItemId: {
        etsyConnectionId: connection.id,
        storeItemId: payload.storeItemId,
      },
    },
  });
  if (already) {
    return { outcome: "SUCCESS" };
  }

  const storeItem = await prisma.storeItem.findFirst({
    where: { id: payload.storeItemId, memberId: connection.memberId },
    include: {
      shippingOption: {
        select: {
          weightOz: true,
          lengthIn: true,
          widthIn: true,
          heightIn: true,
        },
      },
    },
  });
  if (!storeItem) {
    return {
      outcome: "DEAD",
      errorClass: "PERMANENT",
      errorCode: "STORE_ITEM_UNAVAILABLE",
      errorMessage: "Store item unavailable for Etsy create listing",
    };
  }

  const how = resolveEtsyHowItsMadeForCreate({
    etsyWhoMade: storeItem.etsyWhoMade,
    etsyWhenMade: storeItem.etsyWhenMade,
    etsyIsSupply: storeItem.etsyIsSupply,
    etsyTaxonomyId: sanitizeEtsyTaxonomyId(storeItem.etsyTaxonomyId),
    defaultTaxonomyId: resolveEtsyTaxonomyFallback(connection.defaultTaxonomyId),
    inventoryTracking: storeItem.inventoryTracking,
  });
  if (!how.ok) {
    return {
      outcome: "DEAD",
      errorClass: "PERMANENT",
      errorCode: how.code,
      errorMessage: how.message,
    };
  }

  const readiness = await resolveEtsyReadinessStateId({
    connectionId: connection.id,
    memberId: connection.memberId,
    shopId: connection.shopId,
    whenMade: how.whenMade,
    inventoryTracking: storeItem.inventoryTracking,
    fetchImpl: deps.fetchImpl,
    now: deps.now,
  });
  if (!readiness.ok) {
    return {
      outcome: "DEAD",
      errorClass: readiness.code === "AUTH" ? "AUTH" : "PERMANENT",
      errorCode:
        readiness.code === "AUTH"
          ? "AUTH"
          : readiness.code === "PROVIDER_ERROR"
            ? "PROVIDER_ERROR"
            : "READINESS_STATE_REQUIRED",
      errorMessage: readiness.message,
    };
  }

  const qty =
    storeItem.inventoryTracking === "made_to_order"
      ? Math.max(1, storeItem.quantity || 1)
      : Math.max(1, storeItem.quantity || 1);
  const price = storeItem.priceCents / 100;
  const packageFields = resolveEtsyListingPackageFields(storeItem.shippingOption);

  const createBody: Record<string, unknown> = {
    quantity: qty,
    title: storeItem.title.trim().slice(0, 140),
    description: (storeItem.description ?? storeItem.title).trim() || storeItem.title,
    price,
    who_made: how.whoMade,
    when_made: how.whenMade,
    taxonomy_id: how.taxonomyId,
    is_supply: how.isSupply,
    type: "physical",
    readiness_state_id: readiness.readinessStateId,
    item_weight: packageFields.item_weight,
    item_weight_unit: packageFields.item_weight_unit,
    item_length: packageFields.item_length,
    item_width: packageFields.item_width,
    item_height: packageFields.item_height,
    item_dimensions_unit: packageFields.item_dimensions_unit,
  };
  if (connection.defaultShippingProfileId) {
    createBody.shipping_profile_id = connection.defaultShippingProfileId;
  }

  const createRes = await etsyConnectionRequest<{
    listing_id?: number | string;
    listing_id_str?: string;
    state?: string;
  }>({
    connectionId: connection.id,
    memberId: connection.memberId,
    method: "POST",
    path: `/shops/${encodeURIComponent(connection.shopId)}/listings`,
    query: { legacy: false },
    body: createBody,
    bodyEncoding: "form",
    maxAttempts: 1,
    fetchImpl: deps.fetchImpl,
    now: deps.now,
  });
  let createData = createRes.ok ? createRes.data : null;
  if (!createRes.ok || !createData) {
    const taxonomyInvalid =
      /invalid taxonomy/i.test(createRes.message || "") ||
      /taxonomy_id/i.test(createRes.message || "");
    if (
      taxonomyInvalid &&
      how.taxonomyId !== ETSY_PLATFORM_DEFAULT_TAXONOMY_ID &&
      createRes.class === "PERMANENT"
    ) {
      const retryBody = {
        ...createBody,
        taxonomy_id: ETSY_PLATFORM_DEFAULT_TAXONOMY_ID,
      };
      const retry = await etsyConnectionRequest<{
        listing_id?: number | string;
        listing_id_str?: string;
        state?: string;
      }>({
        connectionId: connection.id,
        memberId: connection.memberId,
        method: "POST",
        path: `/shops/${encodeURIComponent(connection.shopId)}/listings`,
        query: { legacy: false },
        body: retryBody,
        bodyEncoding: "form",
        maxAttempts: 1,
        fetchImpl: deps.fetchImpl,
        now: deps.now,
      });
      if (retry.ok && retry.data) {
        createData = retry.data;
        createBody.taxonomy_id = ETSY_PLATFORM_DEFAULT_TAXONOMY_ID;
      } else {
        return classifyFailure(
          createRes.class,
          createRes.retryAfterMs,
          createRes.message || retry.message
        );
      }
    } else {
      return classifyFailure(createRes.class, createRes.retryAfterMs, createRes.message);
    }
  }

  const etsyListingId = String(
    createData.listing_id ?? createData.listing_id_str ?? ""
  ).trim();
  if (!/^\d+$/.test(etsyListingId)) {
    return {
      outcome: "DEAD",
      errorClass: "PERMANENT",
      errorCode: "MISSING_LISTING_ID",
      errorMessage: "Etsy create listing response lacked listing_id",
    };
  }

  // Ensure we do not double-map if a concurrent import raced.
  const racedRemote = await lookupEtsyListingByRemoteId(prisma, {
    connectionId: connection.id,
    etsyListingId,
  });
  if (racedRemote) {
    return { outcome: "SUCCESS" };
  }

  // Read inventory to capture product/offering ids for mapping.
  const inventoryRes = await etsyConnectionRequest<{
    products?: Array<{
      product_id?: number | string;
      sku?: string | null;
      offerings?: Array<{ offering_id?: number | string; quantity?: number }>;
    }>;
  }>({
    connectionId: connection.id,
    memberId: connection.memberId,
    method: "GET",
    path: `/listings/${encodeURIComponent(etsyListingId)}/inventory`,
    query: { max_variations_supported: 3 },
    maxAttempts: 3,
    fetchImpl: deps.fetchImpl,
    now: deps.now,
  });
  if (!inventoryRes.ok || !inventoryRes.data?.products?.length) {
    return classifyFailure(
      inventoryRes.class || "PERMANENT",
      inventoryRes.retryAfterMs,
      inventoryRes.message || "Could not read inventory after create"
    );
  }

  const storeVariants = await prisma.storeVariant.findMany({
    where: {
      id: { in: payload.storeVariantIds },
      storeItemId: storeItem.id,
      memberId: connection.memberId,
      status: "ACTIVE",
    },
    orderBy: { createdAt: "asc" },
  });
  if (storeVariants.length < 1) {
    return {
      outcome: "DEAD",
      errorClass: "PERMANENT",
      errorCode: "UNSUPPORTED_VARIANTS",
      errorMessage: "No ACTIVE StoreVariants available for mapping",
    };
  }

  // Simple listings: Etsy returns one product/offering. Multi-variant structural sync is E8+.
  const firstProduct = inventoryRes.data.products[0]!;
  const firstOffering = firstProduct.offerings?.[0];
  if (!firstOffering?.offering_id || firstProduct.product_id == null) {
    return {
      outcome: "DEAD",
      errorClass: "PERMANENT",
      errorCode: "INVENTORY_SHAPE",
      errorMessage: "Etsy listing inventory missing product/offering identities",
    };
  }

  try {
    await prisma.$transaction(async (tx) => {
      let variantIds = storeVariants.map((v) => v.id);
      const existingFoundation = await tx.inventoryState.findFirst({
        where: { storeItemId: storeItem.id },
        select: { variantId: true },
      });
      if (!existingFoundation) {
        const provisioned = await provisionNativeFoundationListing(tx, storeItem.id);
        variantIds = provisioned.variantIds.length ? provisioned.variantIds : variantIds;
      }

      const primaryVariantId = variantIds[0]!;
      await createEtsyImportedListingMapping(tx, {
        memberId: connection.memberId,
        connectionId: connection.id,
        storeItemId: storeItem.id,
        etsyListingId,
        remoteListingState: createData.state ?? "draft",
        importBootstrapStartedAt: deps.now ?? new Date(),
        importSource: "NATIVE",
        variants: [
          {
            storeVariantId: primaryVariantId,
            etsyProductId: String(firstProduct.product_id),
            etsyOfferingId: String(firstOffering.offering_id),
            remoteSku: typeof firstProduct.sku === "string" ? firstProduct.sku : storeItem.sku,
            remoteAvailable:
              typeof firstOffering.quantity === "number" ? firstOffering.quantity : storeItem.quantity,
          },
        ],
      });

      await captureEtsyInventoryProjectionDesire(tx, {
        memberId: connection.memberId,
        storeVariantId: primaryVariantId,
      });
    });
  } catch (error) {
    if (error instanceof EtsyMappingConflictError) {
      return { outcome: "SUCCESS" };
    }
    return {
      outcome: "DEAD",
      errorClass: "PERMANENT",
      errorCode: "MAPPING_FAILED",
      errorMessage: error instanceof Error ? error.message.slice(0, 500) : "Mapping failed",
    };
  }

  // Attempt activate when shipping profile is configured.
  if (connection.defaultShippingProfileId) {
    const activate = await etsyConnectionRequest({
      connectionId: connection.id,
      memberId: connection.memberId,
      method: "PATCH",
      path: `/shops/${encodeURIComponent(connection.shopId)}/listings/${encodeURIComponent(etsyListingId)}`,
      query: { legacy: false },
      body: {
        state: "active",
        shipping_profile_id: connection.defaultShippingProfileId,
        readiness_state_id: readiness.readinessStateId,
        who_made: how.whoMade,
        when_made: how.whenMade,
        is_supply: how.isSupply,
        taxonomy_id: createBody.taxonomy_id ?? how.taxonomyId,
        item_weight: packageFields.item_weight,
        item_weight_unit: packageFields.item_weight_unit,
        item_length: packageFields.item_length,
        item_width: packageFields.item_width,
        item_height: packageFields.item_height,
        item_dimensions_unit: packageFields.item_dimensions_unit,
      },
      bodyEncoding: "form",
      maxAttempts: 1,
      fetchImpl: deps.fetchImpl,
      now: deps.now,
    });
    if (activate.ok) {
      await prisma.etsyListingLink.updateMany({
        where: { etsyConnectionId: connection.id, etsyListingId },
        data: { remoteListingState: "active", readiness: "READY_TO_PUBLISH" },
      });
    } else if (
      activate.class === "THROTTLED" ||
      activate.class === "TRANSIENT" ||
      activate.class === "NETWORK"
    ) {
      return classifyFailure(activate.class, activate.retryAfterMs, activate.message);
    } else {
      const issueMessage =
        activate.message.slice(0, 500) || "Created as draft; could not activate on Etsy";
      await prisma.etsyListingLink.updateMany({
        where: { etsyConnectionId: connection.id, etsyListingId },
        data: {
          remoteListingState: "draft",
          readiness: "ACTION_REQUIRED",
          issueCode: "ACTIVATE_FAILED",
          issueMessage,
        },
      });
      const link = await prisma.etsyListingLink.findFirst({
        where: { etsyConnectionId: connection.id, etsyListingId },
        select: { id: true },
      });
      if (link) {
        await notifyEtsyListingIssueOnce({
          memberId: connection.memberId,
          storeItemId: storeItem.id,
          connectionId: connection.id,
          subjectId: link.id,
          issueCode: "ACTIVATE_FAILED",
          issueFingerprint: issueMessage,
          severity: "ACTION_REQUIRED",
          message: issueMessage,
        }).catch(() => undefined);
      }
    }
  } else {
    const issueMessage =
      "Listing created as an Etsy draft. Set a default shipping profile on the Etsy connection to activate.";
    await prisma.etsyListingLink.updateMany({
      where: { etsyConnectionId: connection.id, etsyListingId },
      data: {
        remoteListingState: "draft",
        readiness: "ACTION_REQUIRED",
        issueCode: "SHIPPING_PROFILE_REQUIRED",
        issueMessage,
      },
    });
    const link = await prisma.etsyListingLink.findFirst({
      where: { etsyConnectionId: connection.id, etsyListingId },
      select: { id: true },
    });
    if (link) {
      await notifyEtsyListingIssueOnce({
        memberId: connection.memberId,
        storeItemId: storeItem.id,
        connectionId: connection.id,
        subjectId: link.id,
        issueCode: "SHIPPING_PROFILE_REQUIRED",
        issueFingerprint: issueMessage,
        severity: "ACTION_REQUIRED",
        message: issueMessage,
      }).catch(() => undefined);
    }
  }

  return { outcome: "SUCCESS" };
}
