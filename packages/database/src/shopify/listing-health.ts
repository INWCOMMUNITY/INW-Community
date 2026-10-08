import { createHash } from "crypto";
import type {
  Prisma,
  PrismaClient,
  ShopifyCapabilityHealth,
  ShopifyListingLink,
  ShopifyListingReadiness,
  ShopifySyncJob,
  ShopifyVariantMap,
} from "@prisma/client";
import { enqueueShopifySyncJob } from "./jobs";

export type ShopifyHealthDb = PrismaClient | Prisma.TransactionClient;

export type ShopifyListingIssueSeverity = "INFO" | "WARNING" | "ACTION_REQUIRED";

export type ShopifyListingRemoteObservation = {
  productExists: boolean;
  productStatus: string | null;
  variantCount: number;
  /** Count of current-generation ShopifyVariantMap rows for this listing. */
  mappedVariantCount?: number;
  /**
   * Mapped GIDs still present on the Shopify product.
   * For multi-variant listings this is true when at least one mapped variant remains.
   * Content updates pause only when every mapped variant is gone.
   */
  mappedVariantPresent: boolean;
  /** How many of the mapped GIDs were found. Omit on legacy single-variant observations. */
  presentMappedVariantCount?: number;
  inventoryItemMatches: boolean;
  inventoryTracked: boolean | null;
  inventoryLevelExists: boolean | null;
  remoteAvailable: number | null;
  remoteProductFingerprint: string | null;
  remoteVariantFingerprint: string | null;
};

/** Shopify Admin hard ceiling; INW adapter refuses larger topologies. */
const SHOPIFY_VARIANT_HARD_CEILING = 100;

export type ShopifyListingHealthSnapshot = {
  readiness: ShopifyListingReadiness;
  contentHealth: ShopifyCapabilityHealth;
  inventoryHealth: ShopifyCapabilityHealth;
  issueCode: string | null;
  issueFingerprint: string | null;
  issueSeverity: ShopifyListingIssueSeverity | null;
  issueMessage: string | null;
  blockContentOutbound: boolean;
  blockInventoryOutbound: boolean;
  remoteProductStatus: string | null;
};

export type ShopifyListingHealthVariantMapFacts = Pick<
  ShopifyVariantMap,
  | "desiredVariantContentVersion"
  | "appliedVariantContentVersion"
  | "desiredVariantFingerprint"
  | "appliedVariantFingerprint"
  | "variantContentConflict"
  | "inventoryInitState"
  | "inventoryDesiredVersion"
  | "inventoryAppliedVersion"
  | "inventoryDesiredAvailable"
  | "inventoryAppliedAvailable"
  | "inventoryDriftState"
>;

export type ClassifyShopifyListingHealthInput = {
  connectionStatus: "ACTIVE" | "DISCONNECTED" | "REVOKED" | string;
  primaryLocationId: string | null;
  listing: Pick<
    ShopifyListingLink,
    | "desiredProductContentVersion"
    | "appliedProductContentVersion"
    | "desiredProductFingerprint"
    | "appliedProductFingerprint"
    | "productContentConflict"
  >;
  /**
   * Primary map used for remote inventory observation (usually maps[0]).
   * Prefer also passing `variantMaps` so sibling drift/conflict is not masked.
   */
  variantMap: ShopifyListingHealthVariantMapFacts;
  /** All mapped variants for this listing — aggregated for health when provided. */
  variantMaps?: ShopifyListingHealthVariantMapFacts[];
  hasCausalSaleConflict: boolean;
  /** Per-field conflict keys (TITLE, PRICE, …) from ShopifyListingFieldState. */
  fieldConflictKeys?: string[];
  remote?: ShopifyListingRemoteObservation | null;
};

function fingerprint(parts: string[]): string {
  return createHash("sha256").update(parts.join("|"), "utf8").digest("hex").slice(0, 32);
}

function issue(
  code: string,
  message: string,
  severity: ShopifyListingIssueSeverity,
  extras: {
    contentHealth?: ShopifyCapabilityHealth;
    inventoryHealth?: ShopifyCapabilityHealth;
    blockContentOutbound?: boolean;
    blockInventoryOutbound?: boolean;
    fingerprintParts?: string[];
    remoteProductStatus?: string | null;
  } = {}
): ShopifyListingHealthSnapshot {
  return {
    readiness: severity === "ACTION_REQUIRED" ? "ACTION_REQUIRED" : "SYNCING",
    contentHealth: extras.contentHealth ?? "HEALTHY",
    inventoryHealth: extras.inventoryHealth ?? "HEALTHY",
    issueCode: code,
    issueFingerprint: fingerprint([code, ...(extras.fingerprintParts ?? [message])]),
    issueSeverity: severity,
    issueMessage: message,
    blockContentOutbound: extras.blockContentOutbound ?? false,
    blockInventoryOutbound: extras.blockInventoryOutbound ?? false,
    remoteProductStatus: extras.remoteProductStatus ?? null,
  };
}

/**
 * Deterministic listing health from durable local facts (+ optional remote observation).
 * Never mutates Shopify quantity/content/status.
 */
export function classifyShopifyListingHealth(
  input: ClassifyShopifyListingHealthInput
): ShopifyListingHealthSnapshot {
  if (input.connectionStatus !== "ACTIVE") {
    return issue("CONNECTION_INACTIVE", "Shopify connection is not active", "ACTION_REQUIRED", {
      contentHealth: "PAUSED",
      inventoryHealth: "PAUSED",
      blockContentOutbound: true,
      blockInventoryOutbound: true,
      fingerprintParts: [input.connectionStatus],
    });
  }

  const remote = input.remote ?? null;
  const remoteStatus = remote?.productStatus ?? null;

  if (remote && !remote.productExists) {
    return issue(
      "REMOTE_PRODUCT_MISSING",
      "The Shopify product this item was linked to is gone. Use Reconnect listing to list it again.",
      "ACTION_REQUIRED",
      {
        contentHealth: "PAUSED",
        inventoryHealth: "PAUSED",
        blockContentOutbound: true,
        blockInventoryOutbound: true,
        fingerprintParts: ["missing-product"],
        remoteProductStatus: null,
      }
    );
  }

  if (remote && remote.variantCount > SHOPIFY_VARIANT_HARD_CEILING) {
    return issue(
      "STRUCTURAL_VARIANT_LIMIT",
      `Shopify product has ${remote.variantCount} variants; INW supports at most ${SHOPIFY_VARIANT_HARD_CEILING}.`,
      "ACTION_REQUIRED",
      {
        contentHealth: "PAUSED",
        inventoryHealth: "PAUSED",
        blockContentOutbound: true,
        blockInventoryOutbound: true,
        fingerprintParts: [`variants:${remote.variantCount}`],
        remoteProductStatus: remoteStatus,
      }
    );
  }

  const mappedCount = remote?.mappedVariantCount;
  if (
    remote &&
    typeof mappedCount === "number" &&
    mappedCount >= 1 &&
    remote.variantCount > mappedCount
  ) {
    return issue(
      "TOPOLOGY_UNMAPPED_VARIANTS",
      "Shopify has variants that are not yet mapped to INW. Topology import/reconcile is required before full sync.",
      "ACTION_REQUIRED",
      {
        contentHealth: "DEGRADED",
        inventoryHealth: "DEGRADED",
        blockContentOutbound: false,
        blockInventoryOutbound: false,
        fingerprintParts: [`remote:${remote.variantCount}`, `mapped:${mappedCount}`],
        remoteProductStatus: remoteStatus,
      }
    );
  }

  const presentMapped = remote?.presentMappedVariantCount;
  const anyMappedVariantRemains =
    remote?.mappedVariantPresent === true ||
    (typeof presentMapped === "number" && presentMapped > 0);
  if (remote && !anyMappedVariantRemains) {
    return issue(
      "REMOTE_VARIANT_MISSING",
      "This item is still linked to a Shopify product, but the options no longer match. Use Reconnect listing to match them again.",
      "ACTION_REQUIRED",
      {
        contentHealth: "PAUSED",
        inventoryHealth: "PAUSED",
        blockContentOutbound: true,
        blockInventoryOutbound: true,
        fingerprintParts: ["missing-variant"],
        remoteProductStatus: remoteStatus,
      }
    );
  }

  if (remote && !remote.inventoryItemMatches) {
    return issue(
      "REMOTE_INVENTORY_ITEM_MISMATCH",
      "Shopify inventory item identity no longer matches this listing. Quantity updates are paused.",
      "ACTION_REQUIRED",
      {
        contentHealth: "DEGRADED",
        inventoryHealth: "PAUSED",
        blockContentOutbound: false,
        blockInventoryOutbound: true,
        fingerprintParts: ["inventory-item-mismatch"],
        remoteProductStatus: remoteStatus,
      }
    );
  }

  const allMaps =
    input.variantMaps && input.variantMaps.length > 0
      ? input.variantMaps
      : [input.variantMap];
  const anyVariantContentConflict = allMaps.some((m) => m.variantContentConflict);

  const fieldConflicts = (input.fieldConflictKeys ?? []).filter(Boolean);
  if (
    input.listing.productContentConflict ||
    anyVariantContentConflict ||
    fieldConflicts.length > 0
  ) {
    const which = [
      input.listing.productContentConflict ? "product" : null,
      anyVariantContentConflict ? "variant" : null,
      ...fieldConflicts.map((key) => `field:${key}`),
    ]
      .filter(Boolean)
      .join("+");
    const fieldLabel =
      fieldConflicts.length > 0 ? ` Conflicting fields: ${fieldConflicts.join(", ")}.` : "";
    return issue(
      "CONTENT_CONFLICT",
      `INW found conflicting Shopify and INW edits for this listing. Make a new edit in INW to choose the INW version.${fieldLabel}`,
      "ACTION_REQUIRED",
      {
        contentHealth: "PAUSED",
        inventoryHealth: "HEALTHY",
        blockContentOutbound: true,
        blockInventoryOutbound: false,
        fingerprintParts: [which],
        remoteProductStatus: remoteStatus,
      }
    );
  }

  if (input.hasCausalSaleConflict) {
    return issue(
      "SALE_FACT_CAUSAL_CONFLICT",
      "Conflicting Shopify sale facts were recorded for this listing. Quantity updates are paused pending review.",
      "ACTION_REQUIRED",
      {
        contentHealth: "HEALTHY",
        inventoryHealth: "PAUSED",
        blockContentOutbound: false,
        blockInventoryOutbound: true,
        fingerprintParts: ["causal-sale"],
        remoteProductStatus: remoteStatus,
      }
    );
  }

  // Aggregate inventory health across all maps; remote level observation still uses primary map.
  const inv = input.variantMap;
  const driftedSibling = allMaps.find(
    (m) =>
      m.inventoryDriftState === "REMOTE_DRIFT" || m.inventoryDriftState === "WAITING_RECONCILIATION"
  );
  const failedSibling = allMaps.find((m) => m.inventoryInitState === "FAILED");
  const pendingSibling = allMaps.find((m) => m.inventoryInitState === "PENDING");
  const laggingSibling = allMaps.find(
    (m) =>
      m.inventoryInitState === "INITIALIZED" &&
      (m.inventoryDesiredVersion !== m.inventoryAppliedVersion ||
        m.inventoryDesiredAvailable !== m.inventoryAppliedAvailable)
  );

  if (allMaps.every((m) => m.inventoryInitState === "NOT_APPLICABLE")) {
    // All MTO — inventory projection correctly skipped.
  } else if (driftedSibling) {
    return issue(
      "INVENTORY_REMOTE_DRIFT",
      "Shopify inventory changed unexpectedly for this listing. INW paused quantity updates to avoid overwriting a possible sale.",
      "ACTION_REQUIRED",
      {
        contentHealth: "HEALTHY",
        inventoryHealth: "PAUSED",
        blockContentOutbound: false,
        blockInventoryOutbound: true,
        fingerprintParts: [
          `desired:${String(driftedSibling.inventoryDesiredAvailable)}`,
          `applied:${String(driftedSibling.inventoryAppliedAvailable)}`,
          `remote:${String(remote?.remoteAvailable ?? "local")}`,
        ],
        remoteProductStatus: remoteStatus,
      }
    );
  } else if (failedSibling) {
    return issue(
      "INVENTORY_INIT_FAILED",
      "Shopify inventory initialization failed for this listing. Quantity updates are paused.",
      "ACTION_REQUIRED",
      {
        contentHealth: "HEALTHY",
        inventoryHealth: "PAUSED",
        blockContentOutbound: false,
        blockInventoryOutbound: true,
        fingerprintParts: ["init-failed"],
        remoteProductStatus: remoteStatus,
      }
    );
  } else if (pendingSibling) {
    return {
      readiness: "SYNCING",
      contentHealth: "HEALTHY",
      inventoryHealth: "DEGRADED",
      issueCode: null,
      issueFingerprint: null,
      issueSeverity: null,
      issueMessage: null,
      blockContentOutbound: false,
      blockInventoryOutbound: false,
      remoteProductStatus: remoteStatus,
    };
  } else if (allMaps.some((m) => m.inventoryInitState === "INITIALIZED")) {
    if (!input.primaryLocationId) {
      return issue(
        "PRIMARY_LOCATION_MISSING",
        "A selected Shopify location is required before this listing is ready to publish.",
        "ACTION_REQUIRED",
        {
          contentHealth: "HEALTHY",
          inventoryHealth: "PAUSED",
          blockContentOutbound: false,
          blockInventoryOutbound: true,
          fingerprintParts: ["no-location"],
          remoteProductStatus: remoteStatus,
        }
      );
    }
    if (laggingSibling) {
      return {
        readiness: "SYNCING",
        contentHealth: "HEALTHY",
        inventoryHealth: "DEGRADED",
        issueCode: null,
        issueFingerprint: null,
        issueSeverity: null,
        issueMessage: null,
        blockContentOutbound: false,
        blockInventoryOutbound: false,
        remoteProductStatus: remoteStatus,
      };
    }
    if (remote && remote.inventoryLevelExists === false) {
      return issue(
        "INVENTORY_LEVEL_MISSING",
        "Shopify inventory level is missing at the selected location. Quantity updates are paused.",
        "ACTION_REQUIRED",
        {
          contentHealth: "HEALTHY",
          inventoryHealth: "PAUSED",
          blockContentOutbound: false,
          blockInventoryOutbound: true,
          fingerprintParts: ["level-missing"],
          remoteProductStatus: remoteStatus,
        }
      );
    }
    if (
      remote &&
      remote.remoteAvailable != null &&
      inv.inventoryAppliedAvailable != null &&
      remote.remoteAvailable !== inv.inventoryDesiredAvailable &&
      remote.remoteAvailable !== inv.inventoryAppliedAvailable
    ) {
      return issue(
        "INVENTORY_REMOTE_DRIFT",
        "Shopify inventory changed unexpectedly for this listing. INW paused quantity updates to avoid overwriting a possible sale.",
        "ACTION_REQUIRED",
        {
          contentHealth: "HEALTHY",
          inventoryHealth: "PAUSED",
          blockContentOutbound: false,
          blockInventoryOutbound: true,
          fingerprintParts: [
            `desired:${String(inv.inventoryDesiredAvailable)}`,
            `applied:${String(inv.inventoryAppliedAvailable)}`,
            `remote:${String(remote.remoteAvailable)}`,
          ],
          remoteProductStatus: remoteStatus,
        }
      );
    }
  }

  const variantContentConverged = allMaps.every(
    (m) =>
      m.desiredVariantContentVersion === m.appliedVariantContentVersion &&
      (m.desiredVariantFingerprint ?? null) === (m.appliedVariantFingerprint ?? null)
  );
  const contentConverged =
    input.listing.desiredProductContentVersion === input.listing.appliedProductContentVersion &&
    variantContentConverged &&
    (input.listing.desiredProductFingerprint ?? null) ===
      (input.listing.appliedProductFingerprint ?? null);

  if (!contentConverged) {
    return {
      readiness: "SYNCING",
      contentHealth: "DEGRADED",
      inventoryHealth: "HEALTHY",
      issueCode: null,
      issueFingerprint: null,
      issueSeverity: null,
      issueMessage: null,
      blockContentOutbound: false,
      blockInventoryOutbound: false,
      remoteProductStatus: remoteStatus,
    };
  }

  // DRAFT after inventory/content convergence means publication is still pending
  // (or a seller intentionally set Draft). ACTIVE is the healthy live export state.
  // Content sync never forces ACTIVE/publication; Sync's PUBLISH_LISTING does.
  if (remoteStatus === "DRAFT") {
    return {
      readiness: "SYNCING",
      contentHealth: "HEALTHY",
      inventoryHealth: "HEALTHY",
      issueCode: null,
      issueFingerprint: null,
      issueSeverity: null,
      issueMessage: null,
      blockContentOutbound: false,
      blockInventoryOutbound: false,
      remoteProductStatus: remoteStatus,
    };
  }
  if (remoteStatus && remoteStatus !== "ACTIVE") {
    return issue(
      "UNEXPECTED_PRODUCT_STATUS",
      `Shopify product status is ${remoteStatus}. Review this listing in Shopify Admin.`,
      "WARNING",
      {
        contentHealth: "DEGRADED",
        inventoryHealth: "HEALTHY",
        fingerprintParts: [remoteStatus],
        remoteProductStatus: remoteStatus,
      }
    );
  }

  return {
    readiness: "READY_TO_PUBLISH",
    contentHealth: "HEALTHY",
    inventoryHealth: "HEALTHY",
    issueCode: null,
    issueFingerprint: null,
    issueSeverity: null,
    issueMessage: null,
    blockContentOutbound: false,
    blockInventoryOutbound: false,
    remoteProductStatus: remoteStatus,
  };
}

export function shopifyReconcileListingDedupeKey(input: {
  connectionId: string;
  listingLinkId: string;
  bucket: string | number;
}): string {
  return `RECONCILE_LISTING:${input.connectionId}:${input.listingLinkId}:b${input.bucket}`;
}

/** 6-hour reconcile cadence bucket. */
export function shopifyReconcileTimeBucket(now = Date.now()): number {
  return Math.floor(now / (6 * 60 * 60 * 1000));
}

export async function ensureShopifyReconcileListingJob(
  db: ShopifyHealthDb,
  input: {
    connectionId: string;
    listingLinkId: string;
    storeItemId: string;
    bucket?: string | number;
    now?: Date;
  }
): Promise<ShopifySyncJob> {
  const bucket = input.bucket ?? shopifyReconcileTimeBucket((input.now ?? new Date()).getTime());
  return enqueueShopifySyncJob(db, {
    shopifyConnectionId: input.connectionId,
    kind: "RECONCILE_LISTING",
    dedupeKey: shopifyReconcileListingDedupeKey({
      connectionId: input.connectionId,
      listingLinkId: input.listingLinkId,
      bucket,
    }),
    payload: {
      listingLinkId: input.listingLinkId,
      storeItemId: input.storeItemId,
    },
  });
}

export type PersistShopifyListingHealthResult = {
  previous: {
    readiness: ShopifyListingReadiness;
    issueCode: string | null;
    issueFingerprint: string | null;
  };
  next: ShopifyListingHealthSnapshot;
  issueChanged: boolean;
  issueCleared: boolean;
  issueOpened: boolean;
};

export async function persistShopifyListingHealth(
  db: ShopifyHealthDb,
  input: {
    listingLinkId: string;
    health: ShopifyListingHealthSnapshot;
    previous?: Pick<
      ShopifyListingLink,
      "readiness" | "issueCode" | "issueFingerprint" | "issueFirstSeenAt"
    > | null;
    now?: Date;
  }
): Promise<PersistShopifyListingHealthResult> {
  const now = input.now ?? new Date();
  const prev =
    input.previous ??
    (await db.shopifyListingLink.findUniqueOrThrow({
      where: { id: input.listingLinkId },
      select: {
        readiness: true,
        issueCode: true,
        issueFingerprint: true,
        issueFirstSeenAt: true,
      },
    }));

  const sameIssue =
    (prev.issueCode ?? null) === (input.health.issueCode ?? null) &&
    (prev.issueFingerprint ?? null) === (input.health.issueFingerprint ?? null);

  const issueOpened = Boolean(input.health.issueCode) && !sameIssue;
  const issueCleared = Boolean(prev.issueCode) && !input.health.issueCode;
  const issueChanged = issueOpened || issueCleared || !sameIssue;

  await db.shopifyListingLink.update({
    where: { id: input.listingLinkId },
    data: {
      readiness: input.health.readiness,
      contentHealth: input.health.contentHealth,
      inventoryHealth: input.health.inventoryHealth,
      issueCode: input.health.issueCode,
      issueFingerprint: input.health.issueFingerprint,
      issueSeverity: input.health.issueSeverity,
      issueMessage: input.health.issueMessage,
      issueFirstSeenAt: input.health.issueCode
        ? sameIssue
          ? prev.issueFirstSeenAt ?? now
          : now
        : null,
      issueLastSeenAt: input.health.issueCode ? now : null,
      lastReconciledAt: now,
      readinessUpdatedAt: now,
      remoteProductStatus: input.health.remoteProductStatus,
    },
  });

  return {
    previous: {
      readiness: prev.readiness,
      issueCode: prev.issueCode,
      issueFingerprint: prev.issueFingerprint,
    },
    next: input.health,
    issueChanged,
    issueCleared,
    issueOpened,
  };
}

export function shopifyListingIssueDedupeKey(input: {
  connectionId: string;
  listingLinkId: string;
  issueCode: string;
  issueFingerprint: string;
}): string {
  return `shopify-issue:${input.connectionId}:${input.listingLinkId}:${input.issueCode}:${input.issueFingerprint}`;
}

/**
 * Enqueue reconcile jobs for a bounded set of current-generation ACTIVE listings.
 * No network. No backfill of unmapped items.
 */
export async function enqueueDueShopifyListingReconciliations(
  db: PrismaClient,
  input?: { limit?: number; now?: Date; staleAfterMs?: number }
): Promise<{ enqueued: number; listingLinkIds: string[] }> {
  const now = input?.now ?? new Date();
  const limit = input?.limit ?? 25;
  const staleAfterMs = input?.staleAfterMs ?? 6 * 60 * 60 * 1000;
  const staleBefore = new Date(now.getTime() - staleAfterMs);
  const bucket = shopifyReconcileTimeBucket(now.getTime());

  const listings = await db.shopifyListingLink.findMany({
    where: {
      connection: { status: "ACTIVE" },
      OR: [{ lastReconciledAt: null }, { lastReconciledAt: { lt: staleBefore } }],
    },
    orderBy: [{ lastReconciledAt: "asc" }, { createdAt: "asc" }],
    take: limit,
    select: {
      id: true,
      shopifyConnectionId: true,
      storeItemId: true,
    },
  });

  const listingLinkIds: string[] = [];
  for (const row of listings) {
    await ensureShopifyReconcileListingJob(db, {
      connectionId: row.shopifyConnectionId,
      listingLinkId: row.id,
      storeItemId: row.storeItemId,
      bucket,
      now,
    });
    listingLinkIds.push(row.id);
  }
  return { enqueued: listingLinkIds.length, listingLinkIds };
}

/**
 * Seller added or removed color/size options on a mapped listing.
 * Queue reconcile now so Shopify is updated instead of waiting for the 6-hour pass.
 */
export async function recordShopifyListingVariantTopologyDesire(
  db: ShopifyHealthDb,
  input: { memberId: string; storeItemId: string; now?: Date }
): Promise<void> {
  const connection = await db.shopifyConnection.findFirst({
    where: { memberId: input.memberId, status: "ACTIVE" },
    orderBy: { connectedAt: "desc" },
    select: { id: true },
  });
  if (!connection) return;
  const link = await db.shopifyListingLink.findFirst({
    where: { shopifyConnectionId: connection.id, storeItemId: input.storeItemId },
    select: { id: true },
  });
  if (!link) return;
  await ensureShopifyReconcileListingJob(db, {
    connectionId: connection.id,
    listingLinkId: link.id,
    storeItemId: input.storeItemId,
    bucket: `topology-${(input.now ?? new Date()).getTime()}`,
    now: input.now,
  });
}

export type ShopifyListingPublicStatus = {
  listingLinkId: string;
  storeItemId: string;
  shopifyProductId: string;
  readiness: ShopifyListingReadiness;
  contentHealth: ShopifyCapabilityHealth;
  inventoryHealth: ShopifyCapabilityHealth;
  issueCode: string | null;
  issueSeverity: string | null;
  issueMessage: string | null;
  lastReconciledAt: Date | null;
  remoteProductStatus: string | null;
  blockContentOutbound: boolean;
  blockInventoryOutbound: boolean;
};

export function toPublicShopifyListingStatus(
  listing: Pick<
    ShopifyListingLink,
    | "id"
    | "storeItemId"
    | "shopifyProductId"
    | "readiness"
    | "contentHealth"
    | "inventoryHealth"
    | "issueCode"
    | "issueSeverity"
    | "issueMessage"
    | "lastReconciledAt"
    | "remoteProductStatus"
  >
): ShopifyListingPublicStatus {
  return {
    listingLinkId: listing.id,
    storeItemId: listing.storeItemId,
    shopifyProductId: listing.shopifyProductId,
    readiness: listing.readiness,
    contentHealth: listing.contentHealth,
    inventoryHealth: listing.inventoryHealth,
    issueCode: listing.issueCode,
    issueSeverity: listing.issueSeverity,
    issueMessage: listing.issueMessage,
    lastReconciledAt: listing.lastReconciledAt,
    remoteProductStatus: listing.remoteProductStatus,
    blockContentOutbound: listing.contentHealth === "PAUSED",
    blockInventoryOutbound: listing.inventoryHealth === "PAUSED",
  };
}
