import {
  captureWixInventoryProjectionDesire,
  getUnprojectedWixVariantMaps,
  markWixInventoryProjectionApplied,
  persistWixListingHealth,
  prisma,
  refreshWixListingHealthFromDb,
  trackedAvailable,
  type WixJobHandlerResult,
  type WixSyncJobClaim,
} from "database";
import { readWixAppConfig, type WixAppConfig } from "./config";
import { accessTokenForWixConnection } from "./connect";
import { wixApplicationRequest, type WixApiResult } from "./client";
import {
  WIX_V2_INVENTORY_PATCH,
  WIX_V3_INVENTORY,
  WIX_CATALOG_V1,
} from "./constants";

type ProjectInventoryPayload = {
  listingLinkId: string;
};

type InventoryVariantRow = {
  variantId?: string;
  quantity?: number;
  inStock?: boolean;
};

type InventorySnapshot = {
  trackQuantity?: boolean;
  variants: InventoryVariantRow[];
};

const NIL_VARIANT_ID = "00000000-0000-0000-0000-000000000000";

/**
 * PROJECT_INVENTORY: push INW sellable qty to Wix and mark applied only after read-back matches.
 */
export async function handleWixProjectInventoryJob(
  claim: WixSyncJobClaim
): Promise<WixJobHandlerResult> {
  const payload = claim.payload as ProjectInventoryPayload | null;
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
  });
  if (!link) {
    return {
      outcome: "DEAD",
      errorClass: "PERMANENT",
      errorCode: "LINK_NOT_FOUND",
      errorMessage: "Listing link not found",
    };
  }

  const connection = await prisma.wixConnection.findUnique({
    where: { id: link.wixConnectionId },
  });
  if (!connection || connection.status !== "ACTIVE") {
    return {
      outcome: "DEAD",
      errorClass: "PERMANENT",
      errorCode: "CONNECTION_INACTIVE",
      errorMessage: "Wix connection is not active",
    };
  }

  const unprojectedMaps = await getUnprojectedWixVariantMaps(prisma, link.id);
  if (unprojectedMaps.length === 0) {
    return { outcome: "SUCCESS" };
  }

  const variantIds = unprojectedMaps.map((m) => m.storeVariantId);
  const inventoryStates = await prisma.inventoryState.findMany({
    where: { variantId: { in: variantIds } },
  });
  const inventoryByVariant = new Map(inventoryStates.map((s) => [s.variantId, s]));

  const updates: Array<{
    mapId: string;
    wixVariantId: string;
    quantity: number;
    desiredVersion: number;
  }> = [];

  for (const map of unprojectedMaps) {
    const inv = inventoryByVariant.get(map.storeVariantId);
    let available = map.desiredAvailable;
    if (
      available == null &&
      inv?.mode === "TRACKED_FINITE" &&
      inv.onHand != null &&
      inv.reserved != null
    ) {
      available = Math.max(0, inv.onHand - inv.reserved);
    }
    if (available == null || !Number.isFinite(available)) continue;
    updates.push({
      mapId: map.id,
      wixVariantId: map.wixVariantId,
      quantity: Math.max(0, Math.trunc(available)),
      desiredVersion: map.desiredVersion,
    });
  }

  if (updates.length === 0) {
    await noteInventoryAttention(link.id, "Wix quantities could not be read from INW inventory.");
    return {
      outcome: "RETRY",
      errorClass: "TRANSIENT",
      errorCode: "INVENTORY_UNREADABLE",
      errorMessage: "No sellable quantity was available to push",
    };
  }

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
  const pushed = isV1
    ? await pushV1Inventory({
        config,
        accessToken,
        productId: link.wixProductId,
        updates,
      })
    : await pushV3Inventory({
        config,
        accessToken,
        updates,
      });

  if ("retry" in pushed) {
    if (
      pushed.retry.outcome === "RETRY" &&
      (pushed.retry.errorCode === "INVENTORY_MISMATCH" ||
        pushed.retry.errorCode === "INVENTORY_UNREADABLE")
    ) {
      await noteInventoryAttention(
        link.id,
        pushed.retry.errorMessage || "Wix quantities did not update."
      );
    }
    return pushed.retry;
  }

  const mismatches: string[] = [];
  for (const update of updates) {
    const remoteQty = pushed.quantities.get(normalizeId(update.wixVariantId));
    if (remoteQty == null || remoteQty !== update.quantity) {
      mismatches.push(update.wixVariantId);
      continue;
    }
    await markWixInventoryProjectionApplied(prisma, {
      variantMapId: update.mapId,
      appliedAvailable: update.quantity,
      appliedVersion: update.desiredVersion,
    });
  }

  if (mismatches.length > 0) {
    await noteInventoryAttention(link.id, "Wix quantities did not update.");
    return {
      outcome: "RETRY",
      errorClass: "TRANSIENT",
      errorCode: "INVENTORY_MISMATCH",
      errorMessage: "Wix quantities did not update",
    };
  }

  await refreshWixListingHealthFromDb(prisma, link.id);
  return { outcome: "SUCCESS" };
}

/**
 * Compare live Wix stock with INW after a reload.
 * A positive INW quantity that Wix does not have is queued for a verified push.
 * Rows already saved at 0 are left at 0. They are reported as diverged so the
 * hub can show Needs attention until the seller enters a real quantity.
 */
export async function alignWixInventoryWithInw(input: {
  listingLinkId: string;
  wixConnectionId: string;
  memberId: string;
  wixProductId: string;
  catalogVersion: string;
  instanceId: string;
}): Promise<{ pushed: number; diverged: number; unreadable: number } | { error: string }> {
  const config = readWixAppConfig();
  if (!config) return { error: "Wix is not configured" };

  let accessToken: string;
  try {
    accessToken = await accessTokenForWixConnection({ instanceId: input.instanceId });
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Token mint failed" };
  }

  const maps = await prisma.wixVariantMap.findMany({
    where: { wixListingLinkId: input.listingLinkId },
  });
  if (maps.length === 0) return { pushed: 0, diverged: 0, unreadable: 0 };

  const states = await prisma.inventoryState.findMany({
    where: { variantId: { in: maps.map((m) => m.storeVariantId) } },
  });
  const stateByVariant = new Map(states.map((s) => [s.variantId, s]));
  const isV1 = input.catalogVersion === WIX_CATALOG_V1;
  const remote = isV1
    ? await readV1Inventory({ config, accessToken, productId: input.wixProductId })
    : null;
  const v3 = !isV1
    ? await readV3Quantities({
        config,
        accessToken,
        variantIds: maps.map((m) => m.wixVariantId),
      })
    : null;
  if (isV1 && remote && !remote.ok) return { error: "Could not read Wix inventory" };
  if (!isV1 && v3 && !v3.ok) return { error: v3.message };

  let pushed = 0;
  let diverged = 0;
  let unreadable = 0;
  const singleRemote = Boolean(
    maps.length === 1 && isV1 && remote && remote.ok && remote.snapshot.variants.length === 1
  );

  for (const map of maps) {
    const state = stateByVariant.get(map.storeVariantId);
    if (!state || state.mode !== "TRACKED_FINITE" || state.onHand == null || state.reserved == null) {
      continue;
    }
    let sellable = 0;
    try {
      sellable = trackedAvailable(state.onHand, state.reserved);
    } catch {
      unreadable += 1;
      continue;
    }
    const remoteQty = isV1 && remote && remote.ok
      ? quantityForVariant(remote.snapshot, map.wixVariantId, input.wixProductId, singleRemote)
      : v3 && v3.ok
        ? v3.quantities.get(normalizeId(map.wixVariantId)) ?? null
        : null;
    if (remoteQty == null) {
      unreadable += 1;
      continue;
    }
    if (remoteQty === sellable) continue;

    const pending = map.inventoryDesiredVersion > map.inventoryAppliedVersion;
    if (pending) continue;

    if (sellable > 0) {
      pushed += 1;
      await captureWixInventoryProjectionDesire(prisma, {
        variantMapId: map.id,
        wixConnectionId: input.wixConnectionId,
        listingLinkId: input.listingLinkId,
        desiredAvailable: sellable,
      });
      continue;
    }

    // Already saved at 0. Leave it, and do not push that 0 over Wix.
    diverged += 1;
  }

  return { pushed, diverged, unreadable };
}

async function noteInventoryAttention(listingLinkId: string, message: string): Promise<void> {
  await persistWixListingHealth(prisma, listingLinkId, {
    readiness: "ACTION_REQUIRED",
    contentHealth: "HEALTHY",
    inventoryHealth: "DEGRADED",
    issueCode: "INVENTORY_MISMATCH",
    issueMessage: message,
    issueSeverity: "warning",
  });
}

async function pushV1Inventory(input: {
  config: WixAppConfig;
  accessToken: string;
  productId: string;
  updates: Array<{ wixVariantId: string; quantity: number }>;
}): Promise<{ quantities: Map<string, number> } | { retry: WixJobHandlerResult }> {
  const before = await readV1Inventory(input);
  if (!before.ok) return { retry: before.failure };

  const nextVariants = mergeQuantities(before.snapshot.variants, input.updates, input.productId);
  if (!nextVariants) {
    return {
      retry: {
        outcome: "RETRY",
        errorClass: "TRANSIENT",
        errorCode: "INVENTORY_MISMATCH",
        errorMessage: "Wix inventory is missing a mapped variant",
      },
    };
  }

  const patch = await wixApplicationRequest({
    method: "PATCH",
    path: `${WIX_V2_INVENTORY_PATCH}/${input.productId}`,
    body: JSON.stringify({
      inventoryItem: {
        trackQuantity: true,
        variants: nextVariants.map((row) => ({
          variantId: row.variantId,
          quantity: row.quantity ?? 0,
        })),
      },
    }),
    deps: { config: input.config, accessToken: input.accessToken, maxAttempts: 1 },
  });
  if (!patch.ok) return { retry: transportFailure(patch) };

  const after = await readV1Inventory(input);
  if (!after.ok) {
    return {
      retry: {
        outcome: "RETRY",
        errorClass: "TRANSIENT",
        errorCode: "INVENTORY_UNREADABLE",
        errorMessage: "Could not read Wix inventory after update",
      },
    };
  }
  const quantities = new Map<string, number>();
  const allowSingle = input.updates.length === 1 && after.snapshot.variants.length === 1;
  for (const update of input.updates) {
    const qty = quantityForVariant(
      after.snapshot,
      update.wixVariantId,
      input.productId,
      allowSingle
    );
    if (qty != null) quantities.set(normalizeId(update.wixVariantId), qty);
  }
  return { quantities };
}

async function pushV3Inventory(input: {
  config: WixAppConfig;
  accessToken: string;
  updates: Array<{ wixVariantId: string; quantity: number }>;
}): Promise<{ quantities: Map<string, number> } | { retry: WixJobHandlerResult }> {
  for (const update of input.updates) {
    const patch = await wixApplicationRequest({
      method: "PATCH",
      path: `${WIX_V3_INVENTORY}/${update.wixVariantId}`,
      body: JSON.stringify({
        inventoryItem: {
          trackQuantity: true,
          quantity: update.quantity,
        },
      }),
      deps: { config: input.config, accessToken: input.accessToken, maxAttempts: 1 },
    });
    if (!patch.ok) return { retry: transportFailure(patch) };
  }
  const after = await readV3Quantities({
    config: input.config,
    accessToken: input.accessToken,
    variantIds: input.updates.map((row) => row.wixVariantId),
  });
  if (!after.ok) {
    return {
      retry: {
        outcome: "RETRY",
        errorClass: "TRANSIENT",
        errorCode: "INVENTORY_UNREADABLE",
        errorMessage: after.message,
      },
    };
  }
  return { quantities: after.quantities };
}

async function readV1Inventory(input: {
  config: WixAppConfig;
  accessToken: string;
  productId: string;
}): Promise<{ ok: true; snapshot: InventorySnapshot } | { ok: false; failure: WixJobHandlerResult }> {
  const result = await wixApplicationRequest<unknown>({
    method: "GET",
    path: `${WIX_V2_INVENTORY_PATCH}/${input.productId}`,
    deps: { config: input.config, accessToken: input.accessToken, maxAttempts: 2 },
  });
  if (!result.ok) return { ok: false, failure: transportFailure(result) };
  const snapshot = parseInventorySnapshot(result.data);
  if (!snapshot) {
    return {
      ok: false,
      failure: {
        outcome: "RETRY",
        errorClass: "TRANSIENT",
        errorCode: "INVENTORY_UNREADABLE",
        errorMessage: "Wix inventory response did not include variants",
      },
    };
  }
  return { ok: true, snapshot };
}

async function readV3Quantities(input: {
  config: WixAppConfig;
  accessToken: string;
  variantIds: string[];
}): Promise<{ ok: true; quantities: Map<string, number> } | { ok: false; message: string }> {
  const quantities = new Map<string, number>();
  for (const variantId of input.variantIds) {
    const result = await wixApplicationRequest<unknown>({
      method: "GET",
      path: `${WIX_V3_INVENTORY}/${variantId}`,
      deps: { config: input.config, accessToken: input.accessToken, maxAttempts: 1 },
    });
    if (!result.ok) return { ok: false, message: result.message || "Could not read Wix inventory" };
    const qty = readQuantityField(result.data);
    if (qty == null) return { ok: false, message: "Wix inventory response did not include a quantity" };
    quantities.set(normalizeId(variantId), qty);
  }
  return { ok: true, quantities };
}

function mergeQuantities(
  remote: InventoryVariantRow[],
  updates: Array<{ wixVariantId: string; quantity: number }>,
  productId: string
): InventoryVariantRow[] | null {
  const rows = remote.map((row) => ({ ...row }));
  if (rows.length === 0) {
    return updates.map((update) => ({
      variantId: update.wixVariantId,
      quantity: update.quantity,
      inStock: update.quantity > 0,
    }));
  }
  const allowSingle = updates.length === 1 && rows.length === 1;
  for (const update of updates) {
    const row = findInventoryRow(rows, update.wixVariantId, productId, allowSingle);
    if (!row) return null;
    row.quantity = update.quantity;
    row.inStock = update.quantity > 0;
  }
  return rows;
}

function findInventoryRow(
  rows: InventoryVariantRow[],
  wixVariantId: string,
  productId: string,
  allowSingleFallback: boolean
): InventoryVariantRow | undefined {
  const want = normalizeId(wixVariantId);
  const direct = rows.find((row) => normalizeId(row.variantId) === want);
  if (direct) return direct;
  if (!allowSingleFallback || rows.length !== 1) return undefined;
  const only = rows[0];
  const onlyId = normalizeId(only?.variantId);
  if (
    want === normalizeId(productId) ||
    onlyId === normalizeId(NIL_VARIANT_ID) ||
    onlyId === "" ||
    onlyId === want
  ) {
    return only;
  }
  return undefined;
}

function quantityForVariant(
  snapshot: InventorySnapshot,
  wixVariantId: string,
  productId: string,
  allowSingleFallback: boolean
): number | null {
  const row = findInventoryRow(snapshot.variants, wixVariantId, productId, allowSingleFallback);
  if (row?.quantity == null || !Number.isFinite(row.quantity)) return null;
  return Math.max(0, Math.trunc(row.quantity));
}

function parseInventorySnapshot(data: unknown): InventorySnapshot | null {
  const root = asRecord(data);
  if (!root) return null;
  const item = asRecord(root.inventoryItem) ?? root;
  const variantsRaw = item.variants;
  if (!Array.isArray(variantsRaw)) return null;
  const variants: InventoryVariantRow[] = [];
  for (const entry of variantsRaw) {
    const row = asRecord(entry);
    if (!row) continue;
    const quantity = readQuantityValue(row.quantity ?? row.available);
    variants.push({
      variantId: typeof row.variantId === "string" ? row.variantId : undefined,
      quantity: quantity ?? undefined,
      inStock: typeof row.inStock === "boolean" ? row.inStock : undefined,
    });
  }
  return { trackQuantity: item.trackQuantity === true, variants };
}

function readQuantityField(data: unknown): number | null {
  const root = asRecord(data);
  if (!root) return null;
  const item = asRecord(root.inventoryItem) ?? root;
  return readQuantityValue(item.quantity ?? item.availableQuantity);
}

function readQuantityValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function normalizeId(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function transportFailure(result: WixApiResult): WixJobHandlerResult {
  if (result.class === "THROTTLED" || result.class === "TRANSIENT" || result.class === "NETWORK" || result.class === "AUTH") {
    return {
      outcome: "RETRY",
      errorClass: result.class === "AUTH" ? "AUTH" : result.class,
      errorCode: result.class,
      errorMessage: result.message,
      retryAt: result.retryAfterMs ? new Date(Date.now() + result.retryAfterMs) : undefined,
    };
  }
  return {
    outcome: "RETRY",
    errorClass: "TRANSIENT",
    errorCode: "INVENTORY_MISMATCH",
    errorMessage: result.message || "Wix inventory update failed",
  };
}
