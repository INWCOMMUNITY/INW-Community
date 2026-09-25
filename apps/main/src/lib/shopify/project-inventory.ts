import {
  clearShopifyInventoryProjectionPendingMutation,
  classifyShopifyInventoryProjectionAction,
  markShopifyInventoryProjectionApplied,
  markShopifyInventoryProjectionRemoteDrift,
  prisma,
  setShopifyInventoryProjectionPendingMutation,
  shopifyInventoryActivateIdempotencyKey,
  shopifyInventoryProjectionReferenceUri,
  shopifyInventorySetIdempotencyKey,
  shopifyInventoryTrackedIdempotencyKey,
} from "database";
import type { ShopifyJobHandlerResult, ShopifySyncJobClaim } from "database";
import type { ShopifyFetch } from "./admin-graphql";
import { executeShopifyAdminGraphql } from "./admin-graphql";

function parseProjectInventoryPayload(payload: unknown): {
  storeItemId: string;
  storeVariantId: string;
  inventoryDesiredVersion: number;
} | null {
  if (!payload || typeof payload !== "object") return null;
  const row = payload as Record<string, unknown>;
  const storeItemId = typeof row.storeItemId === "string" ? row.storeItemId : "";
  const storeVariantId = typeof row.storeVariantId === "string" ? row.storeVariantId : "";
  const inventoryDesiredVersion =
    typeof row.inventoryDesiredVersion === "number"
      ? Math.trunc(row.inventoryDesiredVersion)
      : typeof row.inventoryDesiredVersion === "string" && /^\d+$/.test(row.inventoryDesiredVersion)
        ? Number.parseInt(row.inventoryDesiredVersion, 10)
        : NaN;
  if (
    !storeItemId ||
    !storeVariantId ||
    !Number.isFinite(inventoryDesiredVersion) ||
    inventoryDesiredVersion < 1
  ) {
    return null;
  }
  return { storeItemId, storeVariantId, inventoryDesiredVersion };
}

type HandlerFailure = {
  outcome: "RETRY" | "DEAD";
  errorClass: string;
  errorCode: string;
  errorMessage: string;
};

type RemoteInventorySnapshot = {
  inventoryItemId: string;
  tracked: boolean;
  levelExists: boolean;
  available: number | null;
};

async function readRemoteInventory(input: {
  connectionId: string;
  inventoryItemId: string;
  locationId: string;
  fetchImpl?: ShopifyFetch;
  now?: Date;
}): Promise<{ ok: true; remote: RemoteInventorySnapshot } | ({ ok: false } & HandlerFailure)> {
  const result = await executeShopifyAdminGraphql<{
    inventoryItem: {
      id: string;
      tracked: boolean;
      inventoryLevel: {
        id: string;
        quantities: Array<{ name: string; quantity: number }>;
      } | null;
    } | null;
  }>({
    connectionId: input.connectionId,
    operationType: "query",
    operationName: "ShopifyInventoryProjectionRead",
    document: `query ShopifyInventoryProjectionRead($id: ID!, $locationId: ID!) {
      inventoryItem(id: $id) {
        id
        tracked
        inventoryLevel(locationId: $locationId) {
          id
          quantities(names: ["available"]) { name quantity }
        }
      }
    }`,
    variables: { id: input.inventoryItemId, locationId: input.locationId },
    fetchImpl: input.fetchImpl,
    now: input.now,
  });

  if (!result.ok) {
    if (
      result.class === "THROTTLED" ||
      result.class === "TRANSIENT_PROVIDER" ||
      result.class === "NETWORK_UNKNOWN" ||
      result.class === "CONNECTION_INACTIVE"
    ) {
      return {
        ok: false,
        outcome: result.class === "CONNECTION_INACTIVE" ? "DEAD" : "RETRY",
        errorClass: result.class,
        errorCode: "INVENTORY_READ",
        errorMessage: result.message,
      };
    }
    return {
      ok: false,
      outcome: "DEAD",
      errorClass: result.class,
      errorCode: "INVENTORY_READ",
      errorMessage: result.message,
    };
  }

  const item = result.data?.inventoryItem ?? null;
  if (!item) {
    return {
      ok: false,
      outcome: "DEAD",
      errorClass: "REMOTE_MISSING",
      errorCode: "REMOTE_INVENTORY_ITEM_MISSING",
      errorMessage: "Mapped Shopify InventoryItem was not found",
    };
  }

  const level = item.inventoryLevel;
  const availableQty =
    level?.quantities?.find((row) => row.name === "available")?.quantity ?? null;

  return {
    ok: true,
    remote: {
      inventoryItemId: item.id,
      tracked: Boolean(item.tracked),
      levelExists: Boolean(level),
      available: typeof availableQty === "number" && Number.isFinite(availableQty) ? availableQty : null,
    },
  };
}

function userErrorCodes(userErrors: Array<{ code?: string | null; message: string }> | null | undefined): string[] {
  if (!Array.isArray(userErrors)) return [];
  return userErrors
    .map((row) => (typeof row.code === "string" ? row.code.toUpperCase() : ""))
    .filter(Boolean);
}

async function enableTracked(input: {
  connectionId: string;
  inventoryItemId: string;
  idempotencyKey: string;
  fetchImpl?: ShopifyFetch;
  now?: Date;
}): Promise<{ ok: true } | ({ ok: false } & HandlerFailure & { outcomeUnknown?: boolean })> {
  // inventoryItemUpdate does not require @idempotent in 2026-07; key is retained for durable pending identity.
  void input.idempotencyKey;
  const result = await executeShopifyAdminGraphql<{
    inventoryItemUpdate: {
      inventoryItem: { id: string; tracked: boolean } | null;
      userErrors: Array<{ field?: string[] | null; message: string; code?: string | null }>;
    };
  }>({
    connectionId: input.connectionId,
    operationType: "mutation",
    operationName: "ShopifyInventoryItemEnableTracked",
    document: `mutation ShopifyInventoryItemEnableTracked($id: ID!, $input: InventoryItemInput!) {
      inventoryItemUpdate(id: $id, input: $input) {
        inventoryItem { id tracked }
        userErrors { field message code }
      }
    }`,
    variables: {
      id: input.inventoryItemId,
      input: { tracked: true },
    },
    fetchImpl: input.fetchImpl,
    now: input.now,
  });

  if (!result.ok) {
    if (result.outcomeUnknown || result.class === "NETWORK_UNKNOWN") {
      return {
        ok: false,
        outcome: "RETRY",
        errorClass: "NETWORK_UNKNOWN",
        errorCode: "TRACKED_UNKNOWN",
        errorMessage: result.message,
        outcomeUnknown: true,
      };
    }
    if (result.class === "THROTTLED" || result.class === "TRANSIENT_PROVIDER") {
      return {
        ok: false,
        outcome: "RETRY",
        errorClass: result.class,
        errorCode: "TRACKED_UPDATE",
        errorMessage: result.message,
      };
    }
    return {
      ok: false,
      outcome: "DEAD",
      errorClass: result.class,
      errorCode: "TRACKED_UPDATE",
      errorMessage: result.message,
    };
  }

  const payload = result.data?.inventoryItemUpdate;
  const errors = payload?.userErrors ?? [];
  if (errors.length > 0) {
    return {
      ok: false,
      outcome: "DEAD",
      errorClass: "GRAPHQL_PERMANENT",
      errorCode: userErrorCodes(errors)[0] ?? "TRACKED_USER_ERROR",
      errorMessage: errors.map((e) => e.message).join("; "),
    };
  }
  if (!payload?.inventoryItem?.tracked) {
    return {
      ok: false,
      outcome: "DEAD",
      errorClass: "GRAPHQL_PERMANENT",
      errorCode: "TRACKED_NOT_ENABLED",
      errorMessage: "inventoryItemUpdate did not enable tracked",
    };
  }
  return { ok: true };
}

async function activateInventory(input: {
  connectionId: string;
  inventoryItemId: string;
  locationId: string;
  available: number;
  idempotencyKey: string;
  fetchImpl?: ShopifyFetch;
  now?: Date;
}): Promise<{ ok: true; available: number } | ({ ok: false } & HandlerFailure & { outcomeUnknown?: boolean; casStale?: boolean })> {
  const result = await executeShopifyAdminGraphql<{
    inventoryActivate: {
      inventoryLevel: {
        id: string;
        quantities: Array<{ name: string; quantity: number }>;
      } | null;
      userErrors: Array<{ field?: string[] | null; message: string; code?: string | null }>;
    };
  }>({
    connectionId: input.connectionId,
    operationType: "mutation",
    operationName: "ShopifyInventoryActivate",
    document: `mutation ShopifyInventoryActivate($inventoryItemId: ID!, $locationId: ID!, $available: Int, $idempotencyKey: String!) {
      inventoryActivate(inventoryItemId: $inventoryItemId, locationId: $locationId, available: $available) @idempotent(key: $idempotencyKey) {
        inventoryLevel {
          id
          quantities(names: ["available"]) { name quantity }
        }
        userErrors { field message code }
      }
    }`,
    variables: {
      inventoryItemId: input.inventoryItemId,
      locationId: input.locationId,
      available: input.available,
      idempotencyKey: input.idempotencyKey,
    },
    fetchImpl: input.fetchImpl,
    now: input.now,
  });

  if (!result.ok) {
    if (result.outcomeUnknown || result.class === "NETWORK_UNKNOWN") {
      return {
        ok: false,
        outcome: "RETRY",
        errorClass: "NETWORK_UNKNOWN",
        errorCode: "ACTIVATE_UNKNOWN",
        errorMessage: result.message,
        outcomeUnknown: true,
      };
    }
    if (result.class === "THROTTLED" || result.class === "TRANSIENT_PROVIDER") {
      return {
        ok: false,
        outcome: "RETRY",
        errorClass: result.class,
        errorCode: "ACTIVATE",
        errorMessage: result.message,
      };
    }
    return {
      ok: false,
      outcome: "DEAD",
      errorClass: result.class,
      errorCode: "ACTIVATE",
      errorMessage: result.message,
    };
  }

  const payload = result.data?.inventoryActivate;
  const errors = payload?.userErrors ?? [];
  if (errors.length > 0) {
    const codes = userErrorCodes(errors);
    return {
      ok: false,
      outcome: "DEAD",
      errorClass: "GRAPHQL_PERMANENT",
      errorCode: codes[0] ?? "ACTIVATE_USER_ERROR",
      errorMessage: errors.map((e) => e.message).join("; "),
    };
  }
  const qty =
    payload?.inventoryLevel?.quantities?.find((row) => row.name === "available")?.quantity ?? null;
  if (typeof qty !== "number") {
    return {
      ok: false,
      outcome: "DEAD",
      errorClass: "GRAPHQL_PERMANENT",
      errorCode: "ACTIVATE_NO_LEVEL",
      errorMessage: "inventoryActivate returned no available quantity",
    };
  }
  return { ok: true, available: qty };
}

async function setAvailableQuantities(input: {
  connectionId: string;
  inventoryItemId: string;
  locationId: string;
  quantity: number;
  changeFromQuantity: number;
  referenceDocumentUri: string;
  idempotencyKey: string;
  fetchImpl?: ShopifyFetch;
  now?: Date;
}): Promise<{ ok: true } | ({ ok: false } & HandlerFailure & { outcomeUnknown?: boolean; casStale?: boolean })> {
  const result = await executeShopifyAdminGraphql<{
    inventorySetQuantities: {
      inventoryAdjustmentGroup: { reason: string } | null;
      userErrors: Array<{ field?: string[] | null; message: string; code?: string | null }>;
    };
  }>({
    connectionId: input.connectionId,
    operationType: "mutation",
    operationName: "ShopifyInventorySetQuantities",
    document: `mutation ShopifyInventorySetQuantities($input: InventorySetQuantitiesInput!, $idempotencyKey: String!) {
      inventorySetQuantities(input: $input) @idempotent(key: $idempotencyKey) {
        inventoryAdjustmentGroup { reason referenceDocumentUri }
        userErrors { field message code }
      }
    }`,
    variables: {
      input: {
        name: "available",
        reason: "correction",
        referenceDocumentUri: input.referenceDocumentUri,
        quantities: [
          {
            inventoryItemId: input.inventoryItemId,
            locationId: input.locationId,
            quantity: input.quantity,
            changeFromQuantity: input.changeFromQuantity,
          },
        ],
      },
      idempotencyKey: input.idempotencyKey,
    },
    fetchImpl: input.fetchImpl,
    now: input.now,
  });

  if (!result.ok) {
    if (result.outcomeUnknown || result.class === "NETWORK_UNKNOWN") {
      return {
        ok: false,
        outcome: "RETRY",
        errorClass: "NETWORK_UNKNOWN",
        errorCode: "SET_UNKNOWN",
        errorMessage: result.message,
        outcomeUnknown: true,
      };
    }
    if (result.class === "THROTTLED" || result.class === "TRANSIENT_PROVIDER") {
      return {
        ok: false,
        outcome: "RETRY",
        errorClass: result.class,
        errorCode: "SET",
        errorMessage: result.message,
      };
    }
    return {
      ok: false,
      outcome: "DEAD",
      errorClass: result.class,
      errorCode: "SET",
      errorMessage: result.message,
    };
  }

  const payload = result.data?.inventorySetQuantities;
  const errors = payload?.userErrors ?? [];
  if (errors.length > 0) {
    const codes = userErrorCodes(errors);
    const stale = codes.some((code) => code.includes("CHANGE_FROM_QUANTITY_STALE") || code === "STALE");
    if (stale) {
      return {
        ok: false,
        outcome: "RETRY",
        errorClass: "CAS_STALE",
        errorCode: "CHANGE_FROM_QUANTITY_STALE",
        errorMessage: errors.map((e) => e.message).join("; "),
        casStale: true,
      };
    }
    return {
      ok: false,
      outcome: "DEAD",
      errorClass: "GRAPHQL_PERMANENT",
      errorCode: codes[0] ?? "SET_USER_ERROR",
      errorMessage: errors.map((e) => e.message).join("; "),
    };
  }
  return { ok: true };
}

/**
 * S8: project canonical INW sellable availability to the selected Shopify location.
 * Read-first. Never overwrites unexplained remote quantity. No inbound InventoryState writes.
 */
export async function handleShopifyProjectInventoryJob(
  claim: ShopifySyncJobClaim,
  opts?: { fetchImpl?: ShopifyFetch; now?: Date }
): Promise<ShopifyJobHandlerResult> {
  const parsed = parseProjectInventoryPayload(claim.payload);
  if (!parsed) {
    return {
      outcome: "DEAD",
      errorClass: "GRAPHQL_PERMANENT",
      errorCode: "INVALID_PAYLOAD",
      errorMessage: "PROJECT_INVENTORY payload missing stable IDs/version",
    };
  }

  const connection = await prisma.shopifyConnection.findUnique({
    where: { id: claim.shopifyConnectionId },
    select: {
      id: true,
      status: true,
      primaryLocationId: true,
      memberId: true,
    },
  });
  if (!connection || connection.status !== "ACTIVE") {
    return {
      outcome: "DEAD",
      errorClass: "CONNECTION_INACTIVE",
      errorCode: "CONNECTION_INACTIVE",
      errorMessage: "Shopify connection is not ACTIVE; outbound inventory projection is dead",
    };
  }
  if (!connection.primaryLocationId) {
    return {
      outcome: "DEAD",
      errorClass: "GRAPHQL_PERMANENT",
      errorCode: "PRIMARY_LOCATION_MISSING",
      errorMessage: "ACTIVE connection is missing primaryLocationId",
    };
  }

  const variantMap = await prisma.shopifyVariantMap.findUnique({
    where: {
      shopifyConnectionId_storeVariantId: {
        shopifyConnectionId: connection.id,
        storeVariantId: parsed.storeVariantId,
      },
    },
  });
  if (!variantMap || variantMap.storeItemId !== parsed.storeItemId) {
    return {
      outcome: "DEAD",
      errorClass: "GRAPHQL_PERMANENT",
      errorCode: "MAPPING_MISSING",
      errorMessage: "Current-generation ShopifyVariantMap was not found",
    };
  }

  // Stale job suppression: never mutate for a superseded desired version.
  if (parsed.inventoryDesiredVersion < variantMap.inventoryDesiredVersion) {
    return { outcome: "SUCCESS" };
  }
  if (parsed.inventoryDesiredVersion > variantMap.inventoryDesiredVersion) {
    return {
      outcome: "DEAD",
      errorClass: "GRAPHQL_PERMANENT",
      errorCode: "DESIRE_VERSION_AHEAD",
      errorMessage: "Job desired version is ahead of mapping desire",
    };
  }

  if (variantMap.inventoryInitState === "NOT_APPLICABLE") {
    return { outcome: "SUCCESS" };
  }

  // Listing-scoped inventory pause (S9). Does not block S7 sale ingestion.
  const listingHealth = await prisma.shopifyListingLink.findUnique({
    where: { id: variantMap.shopifyListingLinkId },
    select: { inventoryHealth: true },
  });
  if (
    listingHealth?.inventoryHealth === "PAUSED" ||
    variantMap.inventoryDriftState === "REMOTE_DRIFT" ||
    variantMap.inventoryDriftState === "WAITING_RECONCILIATION"
  ) {
    return { outcome: "SUCCESS" };
  }

  // Read remote first — no DB transaction open during Shopify network.
  const read = await readRemoteInventory({
    connectionId: connection.id,
    inventoryItemId: variantMap.shopifyInventoryItemId,
    locationId: connection.primaryLocationId,
    fetchImpl: opts?.fetchImpl,
    now: opts?.now,
  });
  if (!read.ok) {
    return {
      outcome: read.outcome,
      errorClass: read.errorClass,
      errorCode: read.errorCode,
      errorMessage: read.errorMessage,
    };
  }

  // NETWORK_UNKNOWN recovery: if prior uncertain mutation already converged remote, mark applied.
  if (
    variantMap.inventoryPendingMutationKind &&
    variantMap.inventoryPendingTargetQty != null &&
    read.remote.available === variantMap.inventoryPendingTargetQty &&
    read.remote.levelExists
  ) {
    await markShopifyInventoryProjectionApplied(prisma, {
      variantMapId: variantMap.id,
      desiredVersion: parsed.inventoryDesiredVersion,
      available: variantMap.inventoryPendingTargetQty,
      observedAvailable: read.remote.available,
      now: opts?.now,
    });
    return { outcome: "SUCCESS" };
  }

  const decision = classifyShopifyInventoryProjectionAction({
    initState: variantMap.inventoryInitState,
    desiredAvailable: variantMap.inventoryDesiredAvailable,
    appliedAvailable: variantMap.inventoryAppliedAvailable,
    remoteAvailable: read.remote.available,
    levelExists: read.remote.levelExists,
    tracked: read.remote.tracked,
  });

  if (decision.action === "NOT_APPLICABLE") {
    return { outcome: "SUCCESS" };
  }

  if (decision.action === "INVALID_TARGET" || decision.action === "MISSING_APPLIED_BASE") {
    return {
      outcome: "DEAD",
      errorClass: "GRAPHQL_PERMANENT",
      errorCode: decision.code,
      errorMessage: decision.message,
    };
  }

  if (decision.action === "ALREADY_CONVERGED") {
    await markShopifyInventoryProjectionApplied(prisma, {
      variantMapId: variantMap.id,
      desiredVersion: parsed.inventoryDesiredVersion,
      available: decision.quantity,
      observedAvailable: decision.quantity,
      now: opts?.now,
    });
    return { outcome: "SUCCESS" };
  }

  if (decision.action === "REMOTE_DRIFT") {
    await markShopifyInventoryProjectionRemoteDrift(prisma, {
      variantMapId: variantMap.id,
      remoteAvailable: decision.remote,
      code: decision.code,
      message: `Remote Shopify available ${decision.remote} differs from desired ${decision.desired} and applied base ${String(decision.appliedBase)}; refusing to overwrite`,
      now: opts?.now,
    });
    // Terminate this projection attempt; a later desire/S7 catch-up may enqueue a new version.
    return { outcome: "SUCCESS" };
  }

  const referenceDocumentUri = shopifyInventoryProjectionReferenceUri({
    connectionId: connection.id,
    storeVariantId: variantMap.storeVariantId,
    inventoryDesiredVersion: parsed.inventoryDesiredVersion,
  });

  if (decision.action === "ENABLE_TRACKED") {
    const idempotencyKey =
      variantMap.inventoryPendingMutationKind === "ENABLE_TRACKED" &&
      variantMap.inventoryPendingIdempotencyKey
        ? variantMap.inventoryPendingIdempotencyKey
        : shopifyInventoryTrackedIdempotencyKey({
            connectionId: connection.id,
            storeVariantId: variantMap.storeVariantId,
            inventoryDesiredVersion: parsed.inventoryDesiredVersion,
          });
    await setShopifyInventoryProjectionPendingMutation(prisma, {
      variantMapId: variantMap.id,
      kind: "ENABLE_TRACKED",
      idempotencyKey,
      fingerprint: idempotencyKey,
      targetQty: variantMap.inventoryDesiredAvailable,
    });
    const enabled = await enableTracked({
      connectionId: connection.id,
      inventoryItemId: variantMap.shopifyInventoryItemId,
      idempotencyKey,
      fetchImpl: opts?.fetchImpl,
      now: opts?.now,
    });
    if (!enabled.ok) {
      if (enabled.outcomeUnknown) {
        return {
          outcome: "RETRY",
          errorClass: enabled.errorClass,
          errorCode: enabled.errorCode,
          errorMessage: enabled.errorMessage,
        };
      }
      await clearShopifyInventoryProjectionPendingMutation(prisma, variantMap.id);
      return {
        outcome: enabled.outcome,
        errorClass: enabled.errorClass,
        errorCode: enabled.errorCode,
        errorMessage: enabled.errorMessage,
      };
    }
    await clearShopifyInventoryProjectionPendingMutation(prisma, variantMap.id);
    // Continue same job attempt after enabling tracking (re-read on RETRY keeps flow simple).
    return {
      outcome: "RETRY",
      errorClass: "TRANSIENT_PROVIDER",
      errorCode: "TRACKED_ENABLED_REREAD",
      errorMessage: "Tracking enabled; re-read before quantity mutation",
      retryAt: opts?.now ?? new Date(),
    };
  }

  if (decision.action === "INIT_ACTIVATE") {
    const idempotencyKey =
      variantMap.inventoryPendingMutationKind === "ACTIVATE" &&
      variantMap.inventoryPendingIdempotencyKey &&
      variantMap.inventoryPendingTargetQty === decision.quantity
        ? variantMap.inventoryPendingIdempotencyKey
        : shopifyInventoryActivateIdempotencyKey({
            connectionId: connection.id,
            storeVariantId: variantMap.storeVariantId,
            inventoryDesiredVersion: parsed.inventoryDesiredVersion,
            quantity: decision.quantity,
          });
    await setShopifyInventoryProjectionPendingMutation(prisma, {
      variantMapId: variantMap.id,
      kind: "ACTIVATE",
      idempotencyKey,
      fingerprint: idempotencyKey,
      targetQty: decision.quantity,
    });
    const activated = await activateInventory({
      connectionId: connection.id,
      inventoryItemId: variantMap.shopifyInventoryItemId,
      locationId: connection.primaryLocationId,
      available: decision.quantity,
      idempotencyKey,
      fetchImpl: opts?.fetchImpl,
      now: opts?.now,
    });
    if (!activated.ok) {
      if (activated.outcomeUnknown) {
        return {
          outcome: "RETRY",
          errorClass: activated.errorClass,
          errorCode: activated.errorCode,
          errorMessage: activated.errorMessage,
        };
      }
      await clearShopifyInventoryProjectionPendingMutation(prisma, variantMap.id);
      return {
        outcome: activated.outcome,
        errorClass: activated.errorClass,
        errorCode: activated.errorCode,
        errorMessage: activated.errorMessage,
      };
    }
    if (activated.available !== decision.quantity) {
      // Uncertain activation left unexpected quantity — fail safe as drift, do not overwrite.
      await markShopifyInventoryProjectionRemoteDrift(prisma, {
        variantMapId: variantMap.id,
        remoteAvailable: activated.available,
        code: "ACTIVATE_UNEXPECTED_QTY",
        message: `inventoryActivate returned available ${activated.available}, desired ${decision.quantity}`,
        now: opts?.now,
      });
      return { outcome: "SUCCESS" };
    }
    await markShopifyInventoryProjectionApplied(prisma, {
      variantMapId: variantMap.id,
      desiredVersion: parsed.inventoryDesiredVersion,
      available: decision.quantity,
      observedAvailable: activated.available,
      now: opts?.now,
    });
    return { outcome: "SUCCESS" };
  }

  if (decision.action === "INIT_SET" || decision.action === "SAFE_CAS") {
    const changeFrom = decision.changeFromQuantity;
    const quantity = decision.quantity;
    const idempotencyKey =
      variantMap.inventoryPendingMutationKind === "SET" &&
      variantMap.inventoryPendingIdempotencyKey &&
      variantMap.inventoryPendingChangeFrom === changeFrom &&
      variantMap.inventoryPendingTargetQty === quantity
        ? variantMap.inventoryPendingIdempotencyKey
        : shopifyInventorySetIdempotencyKey({
            connectionId: connection.id,
            storeVariantId: variantMap.storeVariantId,
            inventoryDesiredVersion: parsed.inventoryDesiredVersion,
            changeFromQuantity: changeFrom,
            quantity,
          });

    await setShopifyInventoryProjectionPendingMutation(prisma, {
      variantMapId: variantMap.id,
      kind: "SET",
      idempotencyKey,
      fingerprint: idempotencyKey,
      changeFromQuantity: changeFrom,
      targetQty: quantity,
    });

    const setResult = await setAvailableQuantities({
      connectionId: connection.id,
      inventoryItemId: variantMap.shopifyInventoryItemId,
      locationId: connection.primaryLocationId,
      quantity,
      changeFromQuantity: changeFrom,
      referenceDocumentUri,
      idempotencyKey,
      fetchImpl: opts?.fetchImpl,
      now: opts?.now,
    });

    if (!setResult.ok) {
      if (setResult.casStale) {
        // Definite non-apply: clear pending so a later attempt with new CAS base uses a new key.
        await clearShopifyInventoryProjectionPendingMutation(prisma, variantMap.id);
        return {
          outcome: "RETRY",
          errorClass: setResult.errorClass,
          errorCode: setResult.errorCode,
          errorMessage: setResult.errorMessage,
        };
      }
      if (setResult.outcomeUnknown) {
        return {
          outcome: "RETRY",
          errorClass: setResult.errorClass,
          errorCode: setResult.errorCode,
          errorMessage: setResult.errorMessage,
        };
      }
      await clearShopifyInventoryProjectionPendingMutation(prisma, variantMap.id);
      return {
        outcome: setResult.outcome,
        errorClass: setResult.errorClass,
        errorCode: setResult.errorCode,
        errorMessage: setResult.errorMessage,
      };
    }

    await markShopifyInventoryProjectionApplied(prisma, {
      variantMapId: variantMap.id,
      desiredVersion: parsed.inventoryDesiredVersion,
      available: quantity,
      observedAvailable: quantity,
      now: opts?.now,
    });
    return { outcome: "SUCCESS" };
  }

  return {
    outcome: "DEAD",
    errorClass: "GRAPHQL_PERMANENT",
    errorCode: "UNHANDLED_DECISION",
    errorMessage: "Unhandled inventory projection decision",
  };
}
