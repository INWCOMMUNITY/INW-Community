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

/** Run queued Etsy jobs now so a Shopify qty edit does not wait on cron. */
export async function drainEtsySyncJobs(workerPrefix: string): Promise<void> {
  try {
    const { runNextEtsySyncJob } = await import("../etsy/worker");
    for (let i = 0; i < 8; i += 1) {
      const ran = await runNextEtsySyncJob({ workerId: `${workerPrefix}-${i}` });
      if (!ran.claimed) break;
    }
  } catch {
    // Cron still picks up PROJECT_INVENTORY if this drain cannot run.
  }
}

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

  // Only an unfinished order for THIS inventory item should pause the qty edit.
  // A stuck shop-wide orders/paid used to block every Shopify qty change, so Etsy never got it.
  const inventoryItemNumeric = parsed.inventoryItemId.split("/").pop()?.split("?")[0] ?? "";
  const variantMap = await prisma.shopifyVariantMap.findFirst({
    where: {
      shopifyConnectionId: connection.id,
      shopifyInventoryItemId: parsed.inventoryItemId,
    },
    select: { storeVariantId: true, shopifyVariantId: true },
  });
  const variantNumeric = variantMap?.shopifyVariantId.split("/").pop()?.split("?")[0] ?? "";
  const needles = [inventoryItemNumeric, variantNumeric].filter((id) => id.length >= 3);
  const pendingForThisItem =
    needles.length === 0
      ? null
      : await prisma.shopifyProviderEvidence.findFirst({
          where: {
            shopifyConnectionId: connection.id,
            topic: "orders/paid",
            processState: "RECEIVED",
            OR: needles.map((id) => ({ rawBody: { contains: id } })),
          },
          select: { id: true },
        });
  const pendingVariantSales = variantMap
    ? await prisma.shopifyOrderLineSaleFact.count({
        where: {
          shopifyConnectionId: connection.id,
          applyState: "PENDING",
          OR: [
            { storeVariantId: variantMap.storeVariantId },
            { shopifyVariantId: variantMap.shopifyVariantId },
          ],
        },
      })
    : 0;

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
    hasPendingOrderEvidence: Boolean(pendingForThisItem) || pendingVariantSales > 0,
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

  if (result.status === "APPLIED_EDIT") {
    await drainEtsySyncJobs("shopify-qty");
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
