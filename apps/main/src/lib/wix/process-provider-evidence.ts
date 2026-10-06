import {
  applyTrackedMarketplaceQuantityEdit,
  applyWixPaidOrderObservation,
  enqueueWixSyncJob,
  getWixEvidenceWithConnection,
  markWixEvidenceError,
  markWixEvidenceIgnored,
  markWixEvidenceProcessed,
  prisma,
  restockWixCanceledOrder,
  wixPollListingContentDedupeKey,
  wixReconcileListingDedupeKey,
  WIX_SOURCE_SYSTEM,
  type WixJobHandlerResult,
  type WixPaidOrderLineObservation,
  type WixSyncJobClaim,
} from "database";

type ProcessEvidencePayload = {
  webhookId: string;
  topic: string;
};

type WixOrderPayload = {
  id?: string;
  lineItems?: Array<{
    id?: string;
    productId?: string;
    catalogReference?: {
      catalogItemId?: string;
      options?: { variantId?: string };
    };
    quantity?: number;
  }>;
  paymentStatus?: string;
};

type WixProductPayload = {
  id?: string;
  slug?: string;
};

type WixInventoryPayload = {
  inventoryItemId?: string;
  productId?: string;
  variantId?: string;
  quantity?: number;
};

/**
 * PROCESS_PROVIDER_EVIDENCE job handler: process Wix webhook events.
 */
export async function handleWixProcessProviderEvidenceJob(
  claim: WixSyncJobClaim
): Promise<WixJobHandlerResult> {
  const payload = claim.payload as ProcessEvidencePayload | null;
  if (!payload?.webhookId) {
    return {
      outcome: "DEAD",
      errorClass: "PERMANENT",
      errorCode: "MISSING_PAYLOAD",
      errorMessage: "Missing webhookId in job payload",
    };
  }

  // Load evidence with connection
  const evidenceResult = await getWixEvidenceWithConnection(prisma, claim.evidenceId ?? "");
  if (!evidenceResult) {
    return {
      outcome: "DEAD",
      errorClass: "PERMANENT",
      errorCode: "EVIDENCE_NOT_FOUND",
      errorMessage: "Evidence not found",
    };
  }

  const { evidence, connection } = evidenceResult;
  if (!connection) {
    await markWixEvidenceIgnored(prisma, evidence.id, "NO_CONNECTION");
    return { outcome: "SUCCESS" };
  }

  const topic = evidence.topic.toLowerCase();
  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(evidence.rawBody);
  } catch {
    await markWixEvidenceError(prisma, evidence.id, {
      code: "PARSE_ERROR",
      message: "Failed to parse webhook body",
    });
    return {
      outcome: "DEAD",
      errorClass: "PERMANENT",
      errorCode: "PARSE_ERROR",
      errorMessage: "Failed to parse webhook body",
    };
  }

  try {
    // Route by topic
    if (topic.includes("order_approved") || topic.includes("order.paid")) {
      return await handleOrderPaidEvidence(evidence.id, connection, parsedBody, evidence.triggeredAt);
    }

    if (topic.includes("order_canceled") || topic.includes("order_cancelled")) {
      return await handleOrderCanceledEvidence(evidence.id, connection, parsedBody);
    }

    if (topic.includes("product_created") || topic.includes("product.created")) {
      // Auto-import could be handled here
      await markWixEvidenceProcessed(prisma, evidence.id);
      return { outcome: "SUCCESS" };
    }

    if (topic.includes("product_changed") || topic.includes("product.updated") || topic.includes("product_deleted") || topic.includes("product.deleted")) {
      return await handleProductChangeEvidence(evidence.id, connection, parsedBody, topic);
    }

    if (topic.includes("inventory")) {
      return await handleInventoryEvidence(evidence.id, connection, parsedBody);
    }

    // Unknown topic - ignore
    await markWixEvidenceIgnored(prisma, evidence.id, "UNKNOWN_TOPIC");
    return { outcome: "SUCCESS" };
  } catch (error) {
    await markWixEvidenceError(prisma, evidence.id, {
      code: "PROCESS_ERROR",
      message: error instanceof Error ? error.message : "Processing failed",
    });
    return {
      outcome: "RETRY",
      errorClass: "TRANSIENT",
      errorCode: "PROCESS_ERROR",
      errorMessage: error instanceof Error ? error.message : "Processing failed",
    };
  }
}

async function handleOrderPaidEvidence(
  evidenceId: string,
  connection: { id: string; memberId: string },
  body: unknown,
  triggeredAt: Date
): Promise<WixJobHandlerResult> {
  const order = extractWixOrder(body);
  if (!order?.id) {
    await markWixEvidenceIgnored(prisma, evidenceId, "NO_ORDER_ID");
    return { outcome: "SUCCESS" };
  }

  // Extract line items
  const lines: WixPaidOrderLineObservation[] = [];
  for (const lineItem of order.lineItems ?? []) {
    if (!lineItem.id || !lineItem.quantity) continue;

    const productId = lineItem.productId ?? lineItem.catalogReference?.catalogItemId;
    const variantId = lineItem.catalogReference?.options?.variantId;

    lines.push({
      wixOrderId: order.id,
      wixLineItemId: lineItem.id,
      wixProductId: productId ?? null,
      wixVariantId: variantId ?? null,
      paidQuantity: lineItem.quantity,
      triggeredAt,
    });
  }

  if (lines.length === 0) {
    await markWixEvidenceIgnored(prisma, evidenceId, "NO_LINE_ITEMS");
    return { outcome: "SUCCESS" };
  }

  // Apply sales
  await applyWixPaidOrderObservation(prisma, {
    connectionId: connection.id,
    memberId: connection.memberId,
    evidenceId,
    lines,
  });

  await markWixEvidenceProcessed(prisma, evidenceId);
  return { outcome: "SUCCESS" };
}

async function handleOrderCanceledEvidence(
  evidenceId: string,
  connection: { id: string; memberId: string },
  body: unknown
): Promise<WixJobHandlerResult> {
  const order = extractWixOrder(body);
  if (!order?.id) {
    await markWixEvidenceIgnored(prisma, evidenceId, "NO_ORDER_ID");
    return { outcome: "SUCCESS" };
  }

  // Restock canceled order
  await restockWixCanceledOrder(prisma, {
    connectionId: connection.id,
    wixOrderId: order.id,
  });

  await markWixEvidenceProcessed(prisma, evidenceId);
  return { outcome: "SUCCESS" };
}

async function handleProductChangeEvidence(
  evidenceId: string,
  connection: { id: string; memberId: string },
  body: unknown,
  topic: string
): Promise<WixJobHandlerResult> {
  const product = extractWixProduct(body);
  if (!product?.id) {
    await markWixEvidenceIgnored(prisma, evidenceId, "NO_PRODUCT_ID");
    return { outcome: "SUCCESS" };
  }

  // Find linked listing
  const link = await prisma.wixListingLink.findFirst({
    where: {
      wixConnectionId: connection.id,
      wixProductId: product.id,
    },
  });

  if (!link) {
    await markWixEvidenceIgnored(prisma, evidenceId, "NOT_LINKED");
    return { outcome: "SUCCESS" };
  }

  if (topic.includes("deleted")) {
    await prisma.wixListingLink.update({
      where: { id: link.id },
      data: {
        remoteProductVisible: false,
        readiness: "ACTION_REQUIRED",
        issueCode: "PRODUCT_DELETED",
        issueMessage: "Product was deleted on Wix",
        issueSeverity: "error",
        issueFirstSeenAt: link.issueFirstSeenAt ?? new Date(),
        issueLastSeenAt: new Date(),
      },
    });
  } else {
    await prisma.wixListingLink.update({
      where: { id: link.id },
      data: {
        lastObservedProductUpdatedAt: new Date(),
      },
    });
    // Re-read Wix product and apply title/description/photos/price into INW.
    await enqueueWixSyncJob(prisma, {
      wixConnectionId: connection.id,
      kind: "POLL_LISTING_CONTENT",
      dedupeKey: wixPollListingContentDedupeKey(link.id),
      payload: { listingLinkId: link.id },
      nextAttemptAt: new Date(),
    });
    await enqueueWixSyncJob(prisma, {
      wixConnectionId: connection.id,
      kind: "RECONCILE_LISTING",
      dedupeKey: wixReconcileListingDedupeKey(link.id),
      payload: { listingLinkId: link.id },
      nextAttemptAt: new Date(),
    });
  }

  await markWixEvidenceProcessed(prisma, evidenceId);
  return { outcome: "SUCCESS" };
}

async function handleInventoryEvidence(
  evidenceId: string,
  connection: { id: string; memberId: string },
  body: unknown
): Promise<WixJobHandlerResult> {
  const inventory = extractWixInventory(body);
  const productId = inventory?.productId ?? inventory?.inventoryItemId;
  
  if (!productId) {
    await markWixEvidenceIgnored(prisma, evidenceId, "NO_PRODUCT_ID");
    return { outcome: "SUCCESS" };
  }

  if (inventory?.quantity == null || !Number.isInteger(inventory.quantity) || inventory.quantity < 0) {
    await markWixEvidenceIgnored(prisma, evidenceId, "NO_QUANTITY");
    return { outcome: "SUCCESS" };
  }

  // Find variant map — prefer explicit variant/inventory ids, else product id.
  let variantMap = await prisma.wixVariantMap.findFirst({
    where: {
      wixConnectionId: connection.id,
      OR: [
        ...(inventory?.variantId ? [{ wixVariantId: inventory.variantId }] : []),
        ...(inventory?.inventoryItemId
          ? [{ wixInventoryItemId: inventory.inventoryItemId }]
          : []),
      ],
    },
  });

  if (!variantMap && productId) {
    const link = await prisma.wixListingLink.findFirst({
      where: { wixConnectionId: connection.id, wixProductId: productId },
      select: { id: true },
    });
    if (link) {
      variantMap = await prisma.wixVariantMap.findFirst({
        where: { wixListingLinkId: link.id },
        orderBy: { createdAt: "asc" },
      });
    }
  }

  if (!variantMap) {
    await markWixEvidenceIgnored(prisma, evidenceId, "NOT_MAPPED");
    return { outcome: "SUCCESS" };
  }

  const newQuantity = inventory.quantity;
  if (variantMap.inventoryAppliedAvailable === newQuantity) {
    await markWixEvidenceIgnored(prisma, evidenceId, "ECHO_SUPPRESSED");
    return { outcome: "SUCCESS" };
  }

  await prisma.$transaction(async (tx) => {
    const state = await tx.inventoryState.findUnique({
      where: { variantId: variantMap.storeVariantId },
    });
    if (state?.mode === "TRACKED_FINITE" && state.reserved != null) {
      await applyTrackedMarketplaceQuantityEdit(tx, {
        variantId: variantMap.storeVariantId,
        memberId: connection.memberId,
        targetOnHand: newQuantity + state.reserved,
        sourceScope: connection.id,
        sourceFactId: evidenceId,
        sourceSystem: WIX_SOURCE_SYSTEM,
        metadata: { wixProductId: productId, wixVariantId: inventory.variantId ?? null },
      });
    }

    await tx.wixVariantMap.update({
      where: { id: variantMap.id },
      data: {
        inventoryAppliedAvailable: newQuantity,
        inventoryDesiredAvailable: newQuantity,
        inventoryAppliedVersion: variantMap.inventoryDesiredVersion,
        inventoryAppliedAt: new Date(),
        lastObservedVariantUpdatedAt: new Date(),
      },
    });
  });

  await markWixEvidenceProcessed(prisma, evidenceId);
  return { outcome: "SUCCESS" };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function unwrapData(value: unknown): Record<string, unknown> | null {
  if (typeof value === "string") {
    try {
      return unwrapData(JSON.parse(value) as unknown);
    } catch {
      return null;
    }
  }
  return asRecord(value);
}

function extractWixOrder(body: unknown): WixOrderPayload | null {
  const root = asRecord(body) ?? {};
  const inner = unwrapData(root.data) ?? root;
  const candidates = [inner.order, inner.entity, unwrapData(inner.data), root.order, root, inner];
  for (const candidate of candidates) {
    const record = asRecord(candidate);
    if (!record) continue;
    const nested = asRecord(record.order);
    const order = nested ?? record;
    if (typeof order.id === "string" || Array.isArray(order.lineItems)) {
      return order as WixOrderPayload;
    }
  }
  return null;
}

function extractWixProduct(body: unknown): WixProductPayload | null {
  const root = asRecord(body) ?? {};
  const inner = unwrapData(root.data) ?? root;
  const candidates = [inner.product, inner.entity, unwrapData(inner.data), root, inner];
  for (const candidate of candidates) {
    const record = asRecord(candidate);
    if (!record) continue;
    const id =
      (typeof record.id === "string" && record.id) ||
      (typeof record.productId === "string" && record.productId) ||
      null;
    if (id) return { id, slug: typeof record.slug === "string" ? record.slug : undefined };
  }
  return null;
}

function extractWixInventory(body: unknown): WixInventoryPayload | null {
  const root = asRecord(body) ?? {};
  const inner = unwrapData(root.data) ?? root;
  const record = asRecord(inner.inventoryItem) ?? asRecord(inner.entity) ?? unwrapData(inner.data) ?? inner;
  const quantity = readQuantity(record.quantity ?? record.availableQuantity ?? inner.quantity);
  return {
    inventoryItemId: readId(record.inventoryItemId ?? record.id),
    productId: readId(record.productId ?? record.catalogItemId),
    variantId: readId(record.variantId),
    quantity: quantity ?? undefined,
  };
}

function readId(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function readQuantity(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}
