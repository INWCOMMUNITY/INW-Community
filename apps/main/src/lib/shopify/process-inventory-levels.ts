import {
  applyShopifyInventoryLevelObservation,
  assertShopifyInventoryItemGid,
  markShopifyEvidenceIgnored,
  prisma,
  ShopifyGidValidationError,
  type ShopifyProviderEvidence,
  type ShopifyJobHandlerResult,
  type ShopifySyncJobClaim,
} from "database";
import type { ShopifyFetch } from "./admin-graphql";

function parseInventoryLevelBody(rawBody: string): {
  inventoryItemId: string;
  locationId: string;
  available: number;
  inventoryLevelId: string | null;
} | null {
  try {
    const parsed = JSON.parse(rawBody) as Record<string, unknown>;
    const available =
      typeof parsed.available === "number"
        ? Math.trunc(parsed.available)
        : typeof parsed.available === "string" && /^-?\d+$/.test(parsed.available)
          ? Number.parseInt(parsed.available, 10)
          : NaN;
    if (!Number.isFinite(available)) return null;

    let inventoryItemId: string | null = null;
    const itemGid =
      typeof parsed.inventory_item_id === "number"
        ? `gid://shopify/InventoryItem/${Math.trunc(parsed.inventory_item_id)}`
        : typeof parsed.admin_graphql_api_id === "string" &&
            parsed.admin_graphql_api_id.includes("InventoryItem")
          ? parsed.admin_graphql_api_id
          : typeof parsed.inventory_item_id === "string"
            ? `gid://shopify/InventoryItem/${parsed.inventory_item_id}`
            : null;
    if (itemGid) {
      try {
        inventoryItemId = assertShopifyInventoryItemGid(itemGid);
      } catch {
        inventoryItemId = null;
      }
    }

    let locationId: string | null = null;
    if (typeof parsed.location_id === "number") {
      locationId = `gid://shopify/Location/${Math.trunc(parsed.location_id)}`;
    } else if (typeof parsed.location_id === "string" && /^\d+$/.test(parsed.location_id)) {
      locationId = `gid://shopify/Location/${parsed.location_id}`;
    } else if (
      typeof parsed.location_id === "string" &&
      parsed.location_id.startsWith("gid://shopify/Location/")
    ) {
      locationId = parsed.location_id;
    }

    const inventoryLevelId =
      typeof parsed.admin_graphql_api_id === "string" &&
      parsed.admin_graphql_api_id.includes("InventoryLevel")
        ? parsed.admin_graphql_api_id
        : null;

    if (!inventoryItemId || !locationId) return null;
    return { inventoryItemId, locationId, available, inventoryLevelId };
  } catch (error) {
    if (error instanceof ShopifyGidValidationError) return null;
    return null;
  }
}

/**
 * PROCESS_PROVIDER_EVIDENCE handler for inventory_levels/update.
 * Reconciles pending order causality before classifying marketplace quantity edits.
 */
export async function handleShopifyInventoryLevelsEvidence(
  claim: ShopifySyncJobClaim,
  evidence: ShopifyProviderEvidence,
  _deps: { fetchImpl?: ShopifyFetch; now?: Date } = {}
): Promise<ShopifyJobHandlerResult> {
  const connection = await prisma.shopifyConnection.findUnique({
    where: { id: claim.shopifyConnectionId },
  });
  if (!connection || connection.status !== "ACTIVE") {
    await markShopifyEvidenceIgnored(
      prisma,
      evidence.id,
      "CONNECTION_INACTIVE",
      "Evidence generation is not an active Shopify connection"
    );
    return { outcome: "SUCCESS" };
  }
  if (!connection.primaryLocationId) {
    await markShopifyEvidenceIgnored(
      prisma,
      evidence.id,
      "LOCATION_REQUIRED",
      "Primary location required for inventory level processing"
    );
    return { outcome: "SUCCESS" };
  }

  const parsed = parseInventoryLevelBody(evidence.rawBody);
  if (!parsed) {
    await markShopifyEvidenceIgnored(
      prisma,
      evidence.id,
      "INVALID_INVENTORY_LEVEL",
      "inventory_levels/update evidence lacked inventory item/location/available"
    );
    return { outcome: "SUCCESS" };
  }

  // Pending ORDERS_PAID evidence may still explain the delta — do not invent a manual edit yet.
  const pendingOrders = await prisma.shopifyProviderEvidence.findFirst({
    where: {
      shopifyConnectionId: connection.id,
      topic: "orders/paid",
      processState: "RECEIVED",
    },
    select: { id: true },
  });

  const result = await applyShopifyInventoryLevelObservation(prisma, {
    connectionId: connection.id,
    memberId: connection.memberId,
    primaryLocationId: connection.primaryLocationId,
    observation: {
      inventoryItemId: parsed.inventoryItemId,
      locationId: parsed.locationId,
      available: parsed.available,
      evidenceId: evidence.id,
      inventoryLevelId: parsed.inventoryLevelId,
    },
    hasPendingOrderEvidence: Boolean(pendingOrders),
  });

  if (result.status === "IGNORED") {
    await markShopifyEvidenceIgnored(prisma, evidence.id, result.reason, result.reason);
    return { outcome: "SUCCESS" };
  }

  // Pending ORDERS_PAID may still explain the delta — retry without finalizing evidence.
  if (result.status === "WAITING_ORDER") {
    return {
      outcome: "RETRY",
      errorClass: "TRANSIENT_PROVIDER",
      errorCode: result.code,
      errorMessage: "Inventory observation waiting for ORDERS_PAID causality",
    };
  }

  await prisma.shopifyProviderEvidence.update({
    where: { id: evidence.id },
    data: {
      processState: "PROCESSED",
      processedAt: new Date(),
      lastErrorCode: result.status === "PAUSED_UNCERTAIN" ? result.code : null,
      lastErrorMessage:
        result.status === "PAUSED_UNCERTAIN"
          ? "Inventory observation paused pending causal certainty"
          : null,
    },
  });

  return { outcome: "SUCCESS" };
}
