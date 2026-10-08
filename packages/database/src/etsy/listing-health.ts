import type {
  EtsyCapabilityHealth,
  EtsyListingLink,
  EtsyListingReadiness,
  EtsyVariantMap,
  Prisma,
  PrismaClient,
} from "@prisma/client";
import { enqueueEtsySyncJob } from "./jobs";
import { etsyVariantContentFingerprint } from "./content-fingerprint";

function comboKeyOf(raw: unknown): string {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return "";
  const options = raw as Record<string, unknown>;
  return Object.keys(options)
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
    .map((key) => {
      const name = key.trim().toLowerCase();
      const value = String(options[key] ?? "").trim().toLowerCase();
      return name && value ? `${name}=${value}` : "";
    })
    .filter(Boolean)
    .join("|");
}

export type EtsyHealthDb = PrismaClient | Prisma.TransactionClient;

export type EtsyListingHealthSnapshot = {
  readiness: EtsyListingReadiness;
  contentHealth: EtsyCapabilityHealth;
  inventoryHealth: EtsyCapabilityHealth;
  issueCode: string | null;
  issueMessage: string | null;
};

export function classifyEtsyListingHealth(input: {
  connectionStatus: string;
  listing: Pick<
    EtsyListingLink,
    | "desiredProductContentVersion"
    | "appliedProductContentVersion"
    | "productContentConflict"
    | "contentHealth"
    | "inventoryHealth"
    | "remoteListingState"
  >;
  variantMaps: Array<
    Pick<
      EtsyVariantMap,
      | "desiredVariantContentVersion"
      | "appliedVariantContentVersion"
      | "variantContentConflict"
      | "inventoryDesiredVersion"
      | "inventoryAppliedVersion"
      | "inventoryDesiredAvailable"
      | "inventoryAppliedAvailable"
      | "lastObservedVariantFingerprint"
      | "appliedVariantFingerprint"
      | "desiredVariantFingerprint"
    >
  >;
  hasCausalSaleConflict: boolean;
  /** Remote product/offering topology does not match ACTIVE INW variants. */
  topologyDiverged?: boolean;
  /** Observed remote price/SKU fingerprint differs from local without a pending INW push. */
  contentObservationDiverged?: boolean;
  /** Observed sellable qty differs from foundation without a pending INW qty push. */
  inventoryObservationDiverged?: boolean;
}): EtsyListingHealthSnapshot {
  if (input.connectionStatus !== "ACTIVE") {
    return {
      readiness: "CONNECTION_REQUIRED",
      contentHealth: "PAUSED",
      inventoryHealth: "PAUSED",
      issueCode: "CONNECTION_INACTIVE",
      issueMessage: "Etsy connection is not active",
    };
  }

  if (input.hasCausalSaleConflict || input.listing.productContentConflict) {
    return {
      readiness: "ACTION_REQUIRED",
      contentHealth: "DEGRADED",
      inventoryHealth: input.listing.inventoryHealth,
      issueCode: input.hasCausalSaleConflict ? "SALE_FACT_CONFLICT" : "CONTENT_CONFLICT",
      issueMessage: input.hasCausalSaleConflict
        ? "A paid order fact conflict needs review"
        : "Etsy listing content conflict needs review",
    };
  }

  if (input.variantMaps.some((m) => m.variantContentConflict)) {
    return {
      readiness: "ACTION_REQUIRED",
      contentHealth: "DEGRADED",
      inventoryHealth: input.listing.inventoryHealth,
      issueCode: "VARIANT_CONTENT_CONFLICT",
      issueMessage: "An Etsy variant price/SKU conflict needs review",
    };
  }

  if (input.topologyDiverged) {
    return {
      readiness: "ACTION_REQUIRED",
      contentHealth: "DEGRADED",
      inventoryHealth: "DEGRADED",
      issueCode: "TOPOLOGY_DIVERGED",
      issueMessage:
        "INW and Etsy variant structure do not match (options vs simple). Needs attention until both sides align.",
    };
  }

  if (input.contentObservationDiverged) {
    return {
      readiness: "ACTION_REQUIRED",
      contentHealth: "DEGRADED",
      inventoryHealth: input.listing.inventoryHealth,
      issueCode: "CONTENT_OBSERVATION_DIVERGED",
      issueMessage:
        "Etsy price/SKU does not match INW. Needs attention until both marketplaces show the same values.",
    };
  }

  if (input.inventoryObservationDiverged) {
    return {
      readiness: "ACTION_REQUIRED",
      contentHealth: input.listing.contentHealth,
      inventoryHealth: "DEGRADED",
      issueCode: "INVENTORY_OBSERVATION_DIVERGED",
      issueMessage:
        "Etsy quantity does not match INW. Needs attention until both marketplaces show the same stock.",
    };
  }

  const contentPending =
    input.listing.desiredProductContentVersion > input.listing.appliedProductContentVersion ||
    input.variantMaps.some((m) => m.desiredVariantContentVersion > m.appliedVariantContentVersion);
  const inventoryPending = input.variantMaps.some(
    (m) =>
      m.inventoryDesiredVersion > m.inventoryAppliedVersion ||
      (m.inventoryDesiredAvailable != null &&
        m.inventoryDesiredAvailable !== m.inventoryAppliedAvailable)
  );

  if (contentPending || inventoryPending) {
    return {
      // Pending outbound must never read as Live — Sync Airport keys off readiness.
      readiness: "ACTION_REQUIRED",
      contentHealth: contentPending ? "DEGRADED" : "HEALTHY",
      inventoryHealth: inventoryPending ? "DEGRADED" : "HEALTHY",
      issueCode: contentPending ? "CONTENT_SYNC_PENDING" : "INVENTORY_SYNC_PENDING",
      issueMessage: contentPending
        ? "INW changes have not finished syncing to Etsy yet"
        : "INW quantity has not finished syncing to Etsy yet",
    };
  }

  const remote = String(input.listing.remoteListingState ?? "")
    .trim()
    .toLowerCase();
  // READY_TO_PUBLISH means buyer-live on Etsy. Drafts must never look healthy/live in Sync Airport.
  if (remote && remote !== "active") {
    return {
      readiness: "ACTION_REQUIRED",
      contentHealth: "DEGRADED",
      inventoryHealth: input.listing.inventoryHealth,
      issueCode: "DRAFT_NOT_ACTIVE",
      issueMessage:
        "Etsy listing is still a draft (not live). Re-list from Sync Airport to upload photos and publish.",
    };
  }

  return {
    readiness: "READY_TO_PUBLISH",
    contentHealth: "HEALTHY",
    inventoryHealth: "HEALTHY",
    issueCode: null,
    issueMessage: null,
  };
}

export async function persistEtsyListingHealth(
  db: EtsyHealthDb,
  input: {
    listingLinkId: string;
    health: EtsyListingHealthSnapshot;
  }
): Promise<void> {
  await db.etsyListingLink.update({
    where: { id: input.listingLinkId },
    data: {
      readiness: input.health.readiness,
      contentHealth: input.health.contentHealth,
      inventoryHealth: input.health.inventoryHealth,
      issueCode: input.health.issueCode,
      issueMessage: input.health.issueMessage,
    },
  });
}

export function etsyReconcileListingDedupeKey(input: {
  connectionId: string;
  listingLinkId: string;
  bucket: number;
}): string {
  return `RECONCILE_LISTING:${input.connectionId}:${input.listingLinkId}:b${input.bucket}`;
}

export async function ensureEtsyReconcileListingJob(
  db: EtsyHealthDb,
  input: {
    connectionId: string;
    listingLinkId: string;
    storeItemId: string;
    bucket: number;
  }
) {
  return enqueueEtsySyncJob(db, {
    etsyConnectionId: input.connectionId,
    kind: "RECONCILE_LISTING",
    dedupeKey: etsyReconcileListingDedupeKey({
      connectionId: input.connectionId,
      listingLinkId: input.listingLinkId,
      bucket: input.bucket,
    }),
    payload: {
      listingLinkId: input.listingLinkId,
      storeItemId: input.storeItemId,
    },
  });
}

/**
 * Enqueue bounded reconcile jobs for mapped Etsy listings (DB health refresh).
 */
export async function enqueueDueEtsyListingReconciliations(
  db: PrismaClient,
  input?: { limit?: number; now?: Date; bucketMs?: number }
): Promise<{ enqueued: number }> {
  const now = input?.now ?? new Date();
  const limit = Math.max(1, Math.min(50, input?.limit ?? 25));
  const bucketMs = input?.bucketMs ?? 15 * 60 * 1000;
  const bucket = Math.floor(now.getTime() / bucketMs);

  const links = await db.etsyListingLink.findMany({
    where: {
      connection: { status: "ACTIVE" },
    },
    orderBy: { updatedAt: "asc" },
    take: limit,
    select: {
      id: true,
      etsyConnectionId: true,
      storeItemId: true,
    },
  });

  let enqueued = 0;
  for (const link of links) {
    const before = await db.etsySyncJob.findUnique({
      where: {
        dedupeKey: etsyReconcileListingDedupeKey({
          connectionId: link.etsyConnectionId,
          listingLinkId: link.id,
          bucket,
        }),
      },
      select: { id: true, state: true },
    });
    const job = await ensureEtsyReconcileListingJob(db, {
      connectionId: link.etsyConnectionId,
      listingLinkId: link.id,
      storeItemId: link.storeItemId,
      bucket,
    });
    if (!before && job.state === "PENDING") {
      enqueued += 1;
    } else if (before && before.state !== "PENDING" && job.state === "PENDING") {
      enqueued += 1;
    }
  }
  return { enqueued };
}

export async function reconcileEtsyListingHealthFromDb(
  db: EtsyHealthDb,
  input: {
    connectionId: string;
    listingLinkId: string;
    /** When known from a live poll, compare to ACTIVE INW variant count. */
    remoteProductCount?: number;
    /** Option combo keys (skuSelectionKey) for remote products that have variations. */
    remoteComboKeys?: string[];
    /** Live offering quantities from the poll inventory GET. */
    remoteOfferings?: Array<{ etsyOfferingId: string; quantity: number | null }>;
  }
): Promise<EtsyListingHealthSnapshot | null> {
  const connection = await db.etsyConnection.findUnique({
    where: { id: input.connectionId },
    select: { id: true, status: true },
  });
  if (!connection) return null;

  const listing = await db.etsyListingLink.findFirst({
    where: { id: input.listingLinkId, etsyConnectionId: input.connectionId },
  });
  if (!listing) return null;

  const variantMaps = await db.etsyVariantMap.findMany({
    where: { etsyListingLinkId: listing.id, etsyConnectionId: input.connectionId },
  });
  const saleConflict = await db.etsyOrderLineSaleFact.count({
    where: {
      etsyConnectionId: input.connectionId,
      storeItemId: listing.storeItemId,
      causalConflict: true,
    },
  });

  const activeVariants = await db.storeVariant.findMany({
    where: { storeItemId: listing.storeItemId, status: "ACTIVE" },
    select: {
      id: true,
      priceCents: true,
      sku: true,
      options: true,
      inventoryState: { select: { onHand: true, reserved: true, mode: true } },
    },
  });
  const activeIds = new Set(activeVariants.map((v) => v.id));
  const mapIds = new Set(variantMaps.map((m) => m.storeVariantId));
  const localComboKeys = activeVariants
    .map((v) => comboKeyOf(v.options))
    .filter((key) => key.length > 0)
    .sort();
  const remoteComboKeys = input.remoteComboKeys ? [...input.remoteComboKeys].sort() : null;
  const mappedOfferingIds = new Set(variantMaps.map((m) => m.etsyOfferingId));
  const unmappedRemote =
    input.remoteOfferings?.filter(
      (row) => row.etsyOfferingId && !mappedOfferingIds.has(row.etsyOfferingId)
    ) ?? [];
  const topologyDiverged =
    activeVariants.length !== variantMaps.length ||
    [...activeIds].some((id) => !mapIds.has(id)) ||
    [...mapIds].some((id) => !activeIds.has(id)) ||
    (typeof input.remoteProductCount === "number" &&
      input.remoteProductCount !== activeVariants.length) ||
    (remoteComboKeys != null && remoteComboKeys.join("\n") !== localComboKeys.join("\n")) ||
    unmappedRemote.length > 0;

  const byVariantId = new Map(activeVariants.map((v) => [v.id, v] as const));
  let contentObservationDiverged = false;
  for (const map of variantMaps) {
    const desireAhead = map.desiredVariantContentVersion > map.appliedVariantContentVersion;
    if (desireAhead || map.variantContentConflict) continue;
    const observed = map.lastObservedVariantFingerprint;
    if (!observed) continue;
    const local = byVariantId.get(map.storeVariantId);
    if (!local) continue;
    const localFp = etsyVariantContentFingerprint({
      priceCents: local.priceCents,
      sku: local.sku,
    });
    // Observed remote fingerprint differs from what INW currently has, and we are not
    // pushing an INW edit — channels are not identical → Needs attention.
    if (observed !== localFp) {
      contentObservationDiverged = true;
      break;
    }
  }

  const remoteQtyByOffering = new Map(
    (input.remoteOfferings ?? [])
      .filter((row) => row.quantity != null)
      .map((row) => [row.etsyOfferingId, row.quantity as number] as const)
  );
  let inventoryObservationDiverged = false;
  if (remoteQtyByOffering.size > 0) {
    const byVariant = new Map(activeVariants.map((v) => [v.id, v] as const));
    for (const map of variantMaps) {
      const remoteQty = remoteQtyByOffering.get(map.etsyOfferingId);
      if (remoteQty == null) continue;
      const pushing =
        map.inventoryDesiredVersion > map.inventoryAppliedVersion ||
        (map.inventoryDesiredAvailable != null &&
          map.inventoryDesiredAvailable !== map.inventoryAppliedAvailable &&
          map.inventoryDesiredVersion > 0);
      if (pushing) continue;
      const local = byVariant.get(map.storeVariantId);
      const state = local?.inventoryState;
      if (!state || state.mode !== "TRACKED_FINITE" || state.onHand == null || state.reserved == null) {
        continue;
      }
      const sellable = Math.max(0, state.onHand - state.reserved);
      if (sellable !== remoteQty) {
        inventoryObservationDiverged = true;
        break;
      }
    }
  }

  const health = classifyEtsyListingHealth({
    connectionStatus: connection.status,
    listing,
    variantMaps,
    hasCausalSaleConflict: saleConflict > 0,
    topologyDiverged,
    contentObservationDiverged,
    inventoryObservationDiverged,
  });
  await persistEtsyListingHealth(db, { listingLinkId: listing.id, health });
  return health;
}

/** Stable seller-activity / push dedupe for Etsy listing issues (mapped or create-failed). */
export function etsyListingIssueDedupeKey(input: {
  connectionId: string;
  /** Listing link id, or `create-job:<jobId>` / `store-item:<id>` for unmapped creates. */
  subjectId: string;
  issueCode: string;
  issueFingerprint: string;
}): string {
  return `etsy-issue:${input.connectionId}:${input.subjectId}:${input.issueCode}:${input.issueFingerprint}`;
}

export type { Prisma };
