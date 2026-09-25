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
  mappedVariantPresent: boolean;
  inventoryItemMatches: boolean;
  inventoryTracked: boolean | null;
  inventoryLevelExists: boolean | null;
  remoteAvailable: number | null;
  remoteProductFingerprint: string | null;
  remoteVariantFingerprint: string | null;
};

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
  variantMap: Pick<
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
  hasCausalSaleConflict: boolean;
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
      "The mapped Shopify product can no longer be found. Automatic updates are paused until this listing is re-exported.",
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

  if (remote && remote.variantCount > 1) {
    return issue(
      "STRUCTURAL_MULTI_VARIANT",
      "Shopify product structure changed (multiple variants). Automatic content updates are paused.",
      "ACTION_REQUIRED",
      {
        contentHealth: "PAUSED",
        inventoryHealth: "DEGRADED",
        blockContentOutbound: true,
        blockInventoryOutbound: false,
        fingerprintParts: [`variants:${remote.variantCount}`],
        remoteProductStatus: remoteStatus,
      }
    );
  }

  if (remote && !remote.mappedVariantPresent) {
    return issue(
      "REMOTE_VARIANT_MISSING",
      "The mapped Shopify variant can no longer be found. Automatic content updates are paused.",
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

  if (input.listing.productContentConflict || input.variantMap.variantContentConflict) {
    const which = [
      input.listing.productContentConflict ? "product" : null,
      input.variantMap.variantContentConflict ? "variant" : null,
    ]
      .filter(Boolean)
      .join("+");
    return issue(
      "CONTENT_CONFLICT",
      "INW found conflicting Shopify and INW edits for this listing. Make a new edit in INW to choose the INW version.",
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

  const inv = input.variantMap;
  if (inv.inventoryInitState === "NOT_APPLICABLE") {
    // MTO — inventory projection correctly skipped.
  } else if (inv.inventoryDriftState === "REMOTE_DRIFT" || inv.inventoryDriftState === "WAITING_RECONCILIATION") {
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
          `remote:${String(remote?.remoteAvailable ?? "local")}`,
        ],
        remoteProductStatus: remoteStatus,
      }
    );
  } else if (inv.inventoryInitState === "FAILED") {
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
  } else if (inv.inventoryInitState === "PENDING") {
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
  } else if (inv.inventoryInitState === "INITIALIZED") {
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
    if (
      inv.inventoryDesiredVersion !== inv.inventoryAppliedVersion ||
      inv.inventoryDesiredAvailable !== inv.inventoryAppliedAvailable
    ) {
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

  const contentConverged =
    input.listing.desiredProductContentVersion === input.listing.appliedProductContentVersion &&
    input.variantMap.desiredVariantContentVersion === input.variantMap.appliedVariantContentVersion &&
    (input.listing.desiredProductFingerprint ?? null) ===
      (input.listing.appliedProductFingerprint ?? null) &&
    (input.variantMap.desiredVariantFingerprint ?? null) ===
      (input.variantMap.appliedVariantFingerprint ?? null);

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

  // DRAFT is expected pre-publication. Unexpected statuses are informational only unless blocking.
  if (remoteStatus && remoteStatus !== "DRAFT" && remoteStatus !== "ACTIVE") {
    return issue(
      "UNEXPECTED_PRODUCT_STATUS",
      `Shopify product status is ${remoteStatus}. Review before publishing from INW.`,
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
