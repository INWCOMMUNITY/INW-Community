import {
  assertShopifyProductGid,
  beginShopifyListingImportAttempt,
  completeShopifyListingImportAttempt,
  createShopifyImportedListingMapping,
  failShopifyListingImportAttempt,
  prisma,
  provisionNativeFoundationListing,
  reconcileShopifyImportBootstrapSales,
  ShopifyMappingConflictError,
  ShopifyMappingError,
} from "database";
import type { ShopifyFetch } from "./admin-graphql";
import { fetchShopifyImportProductDetail } from "./import-discovery";

export type ImportShopifyListingStockMode = "PHYSICAL" | "MADE_TO_ORDER";

export type ImportShopifyListingResult =
  | {
      status: "IMPORTED" | "ALREADY_IMPORTED";
      storeItemId: string;
      listingLinkId: string;
      shopifyProductId: string;
      bootstrap: {
        preBootstrapAcked: number;
        postBootstrapApplied: number;
      };
    }
  | {
      status: "ERROR";
      code: string;
      message: string;
    };

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function uniqueSlug(base: string): string {
  const root = base || "imported-item";
  return `${root}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

async function runBootstrapReconcile(input: {
  connectionId: string;
  memberId: string;
  shopifyVariantId: string;
  bootstrapStartedAt: Date;
}): Promise<{ preBootstrapAcked: number; postBootstrapApplied: number }> {
  const bootstrap = await reconcileShopifyImportBootstrapSales(prisma, input);
  return {
    preBootstrapAcked: bootstrap.preBootstrapAcked,
    postBootstrapApplied: bootstrap.postBootstrapApplied,
  };
}

/**
 * Import one simple Shopify product into INW with exact provider mapping.
 *
 * Order of operations (launch-critical):
 * 1. Durably commit import attempt + bootstrapStartedAt (no network)
 * 2. Fresh Shopify provider re-read / inventory snapshot (outside DB TX)
 * 3. Atomic canonical write: StoreItem + Variant + opening + mapping + baselines + COMPLETED
 * 4. Reconcile durable ORDERS_PAID facts against the same cutoff (idempotent; safe to retry)
 */
export async function importShopifyListing(input: {
  memberId: string;
  shopifyProductId: string;
  stockMode: ImportShopifyListingStockMode;
  fetchImpl?: ShopifyFetch;
}): Promise<ImportShopifyListingResult> {
  if (input.stockMode !== "PHYSICAL" && input.stockMode !== "MADE_TO_ORDER") {
    return {
      status: "ERROR",
      code: "STOCK_MODE_REQUIRED",
      message: "Choose PHYSICAL or MADE TO ORDER stock mode before importing.",
    };
  }

  let productId: string;
  try {
    productId = assertShopifyProductGid(input.shopifyProductId.trim());
  } catch {
    return {
      status: "ERROR",
      code: "INVALID_PRODUCT",
      message: "Invalid Shopify product id.",
    };
  }

  const connection = await prisma.shopifyConnection.findFirst({
    where: { memberId: input.memberId, status: "ACTIVE" },
    orderBy: { connectedAt: "desc" },
    select: { id: true, primaryLocationId: true },
  });
  if (!connection) {
    return {
      status: "ERROR",
      code: "CONNECTION_REQUIRED",
      message: "Connect Shopify before importing listings.",
    };
  }
  if (!connection.primaryLocationId) {
    return {
      status: "ERROR",
      code: "LOCATION_REQUIRED",
      message: "Choose a primary Shopify location before importing listings.",
    };
  }

  // 1) Durable attempt + cutoff BEFORE any Shopify inventory snapshot.
  const begin = await beginShopifyListingImportAttempt(prisma, {
    memberId: input.memberId,
    connectionId: connection.id,
    shopifyProductId: productId,
    stockMode: input.stockMode,
  });

  if (begin.status === "ALREADY_COMPLETED") {
    const attempt = begin.attempt;
    if (!attempt.storeItemId || !attempt.listingLinkId) {
      return {
        status: "ERROR",
        code: "IMPORT_INCONSISTENT",
        message: "Import changed while processing; refresh and retry.",
      };
    }
    // Crash recovery: always re-run idempotent sale reconcile with the ORIGINAL cutoff.
    let bootstrap = { preBootstrapAcked: 0, postBootstrapApplied: 0 };
    if (attempt.shopifyVariantId) {
      bootstrap = await runBootstrapReconcile({
        connectionId: connection.id,
        memberId: input.memberId,
        shopifyVariantId: attempt.shopifyVariantId,
        bootstrapStartedAt: attempt.bootstrapStartedAt,
      });
    }
    return {
      status: "ALREADY_IMPORTED",
      storeItemId: attempt.storeItemId,
      listingLinkId: attempt.listingLinkId,
      shopifyProductId: productId,
      bootstrap,
    };
  }

  if (begin.status === "IN_PROGRESS") {
    return {
      status: "ERROR",
      code: "IMPORT_IN_PROGRESS",
      message: "Import changed while processing; refresh and retry.",
    };
  }

  const attempt = begin.attempt;
  const bootstrapStartedAt = attempt.bootstrapStartedAt;

  // 2) Fresh provider re-read AFTER durable cutoff. Never trust browser discovery payload.
  const fresh = await fetchShopifyImportProductDetail({
    memberId: input.memberId,
    shopifyProductId: productId,
    fetchImpl: input.fetchImpl,
  });
  if (fresh.status === "ERROR") {
    if (fresh.code === "ALREADY_MAPPED") {
      // Mapping appeared between begin and snapshot — heal via begin's mapping check on retry.
      const healed = await beginShopifyListingImportAttempt(prisma, {
        memberId: input.memberId,
        connectionId: connection.id,
        shopifyProductId: productId,
        stockMode: input.stockMode,
      });
      if (
        healed.status === "ALREADY_COMPLETED" &&
        healed.attempt.storeItemId &&
        healed.attempt.listingLinkId
      ) {
        let bootstrap = { preBootstrapAcked: 0, postBootstrapApplied: 0 };
        if (healed.attempt.shopifyVariantId) {
          bootstrap = await runBootstrapReconcile({
            connectionId: connection.id,
            memberId: input.memberId,
            shopifyVariantId: healed.attempt.shopifyVariantId,
            bootstrapStartedAt: healed.attempt.bootstrapStartedAt,
          });
        }
        return {
          status: "ALREADY_IMPORTED",
          storeItemId: healed.attempt.storeItemId,
          listingLinkId: healed.attempt.listingLinkId,
          shopifyProductId: productId,
          bootstrap,
        };
      }
    }
    await failShopifyListingImportAttempt(prisma, {
      attemptId: attempt.id,
      code: fresh.code,
      message: fresh.message,
    });
    return { status: "ERROR", code: fresh.code, message: fresh.message };
  }

  if (fresh.connectionId !== connection.id) {
    await failShopifyListingImportAttempt(prisma, {
      attemptId: attempt.id,
      code: "CONNECTION_CHANGED",
      message: "Shopify connection changed; refresh and try again.",
    });
    return {
      status: "ERROR",
      code: "CONNECTION_CHANGED",
      message: "Shopify connection changed; refresh and try again.",
    };
  }

  const snap = fresh.candidate;
  if (snap.shopifyProductId !== productId) {
    await failShopifyListingImportAttempt(prisma, {
      attemptId: attempt.id,
      code: "PRODUCT_IDENTITY_CHANGED",
      message: "Import changed while processing; refresh and retry.",
    });
    return {
      status: "ERROR",
      code: "PRODUCT_IDENTITY_CHANGED",
      message: "Import changed while processing; refresh and retry.",
    };
  }
  if (
    !snap.supported ||
    !snap.shopifyVariantId ||
    !snap.shopifyInventoryItemId ||
    snap.priceCents == null
  ) {
    await failShopifyListingImportAttempt(prisma, {
      attemptId: attempt.id,
      code: "UNSUPPORTED_PRODUCT",
      message: snap.unsupportedReason ?? "Product became unsupported during import.",
    });
    return {
      status: "ERROR",
      code: "UNSUPPORTED_PRODUCT",
      message: snap.unsupportedReason ?? "Product became unsupported during import.",
    };
  }
  if (input.stockMode === "PHYSICAL") {
    if (snap.primaryLocationAvailable == null || snap.primaryLocationAvailable < 0) {
      await failShopifyListingImportAttempt(prisma, {
        attemptId: attempt.id,
        code: "INVENTORY_UNAVAILABLE",
        message: "Inventory unavailable at selected Shopify location.",
      });
      return {
        status: "ERROR",
        code: "INVENTORY_UNAVAILABLE",
        message: "Inventory unavailable at selected Shopify location.",
      };
    }
  }

  const openingQty =
    input.stockMode === "PHYSICAL" ? Math.trunc(snap.primaryLocationAvailable ?? 0) : 0;
  const inventoryTracking = input.stockMode === "PHYSICAL" ? "tracked" : "made_to_order";
  const inventoryMode = input.stockMode === "PHYSICAL" ? "TRACKED_FINITE" : "MADE_TO_ORDER";
  const title = snap.title.slice(0, 200);
  const description = snap.descriptionHtml.trim().length > 0 ? snap.descriptionHtml : null;
  // Featured image is referenced by URL only (existing listing media semantics). No remote fetch.
  const photos = snap.imageUrl ? [snap.imageUrl] : [];
  const sku = snap.sku ? snap.sku.trim().slice(0, 50) || null : null;

  let created:
    | { already: true; storeItemId: string; listingLinkId: string }
    | { already: false; storeItemId: string; listingLinkId: string }
    | null = null;

  try {
    // 3) Canonical write atomic: listing + foundation opening + mapping/baselines + COMPLETED.
    created = await prisma.$transaction(async (tx) => {
      const existingMap = await tx.shopifyListingLink.findFirst({
        where: {
          shopifyConnectionId: connection.id,
          shopifyProductId: productId,
        },
        select: { id: true, storeItemId: true },
      });
      if (existingMap) {
        await completeShopifyListingImportAttempt(tx, {
          attemptId: attempt.id,
          shopifyVariantId: snap.shopifyVariantId!,
          shopifyInventoryItemId: snap.shopifyInventoryItemId!,
          storeItemId: existingMap.storeItemId,
          listingLinkId: existingMap.id,
        });
        return {
          already: true as const,
          storeItemId: existingMap.storeItemId,
          listingLinkId: existingMap.id,
        };
      }

      const storeItem = await tx.storeItem.create({
        data: {
          memberId: input.memberId,
          title,
          description,
          photos,
          priceCents: snap.priceCents!,
          quantity: openingQty,
          inventoryTracking,
          sku,
          status: "active",
          slug: uniqueSlug(slugify(title)),
          condition: "new",
        },
        select: { id: true },
      });

      const provisioned = await provisionNativeFoundationListing(tx, storeItem.id);
      if (provisioned.variantIds.length !== 1) {
        throw new Error("Imported listing did not provision exactly one variant");
      }

      const mapping = await createShopifyImportedListingMapping(tx, {
        memberId: input.memberId,
        connectionId: connection.id,
        storeItemId: storeItem.id,
        shopifyProductId: productId,
        variants: [
          {
            storeVariantId: provisioned.variantIds[0]!,
            shopifyVariantId: snap.shopifyVariantId!,
            shopifyInventoryItemId: snap.shopifyInventoryItemId!,
          },
        ],
        remoteProductStatus: snap.status,
        importBootstrapStartedAt: bootstrapStartedAt,
        remoteAvailable: input.stockMode === "PHYSICAL" ? openingQty : null,
        inventoryMode,
      });

      await completeShopifyListingImportAttempt(tx, {
        attemptId: attempt.id,
        shopifyVariantId: snap.shopifyVariantId!,
        shopifyInventoryItemId: snap.shopifyInventoryItemId!,
        storeItemId: storeItem.id,
        listingLinkId: mapping.listingLink.id,
      });

      return {
        already: false as const,
        storeItemId: storeItem.id,
        listingLinkId: mapping.listingLink.id,
      };
    });
  } catch (error) {
    const code =
      error instanceof ShopifyMappingConflictError
        ? "ALREADY_MAPPED"
        : error instanceof ShopifyMappingError
          ? error.code
          : "IMPORT_FAILED";
    const message =
      error instanceof Error ? error.message : "Import failed. Refresh and try again.";
    // Only fails STARTED attempts — never downgrades COMPLETED.
    await failShopifyListingImportAttempt(prisma, {
      attemptId: attempt.id,
      code,
      message,
    }).catch(() => undefined);
    return {
      status: "ERROR",
      code,
      message:
        code === "ALREADY_MAPPED"
          ? "This Shopify product is already synced."
          : message.slice(0, 300),
    };
  }

  // 4) Sale reconcile after canonical commit. Failures must NOT undo COMPLETED import.
  const bootstrap = await runBootstrapReconcile({
    connectionId: connection.id,
    memberId: input.memberId,
    shopifyVariantId: snap.shopifyVariantId!,
    bootstrapStartedAt,
  });

  return {
    status: created.already ? "ALREADY_IMPORTED" : "IMPORTED",
    storeItemId: created.storeItemId,
    listingLinkId: created.listingLinkId,
    shopifyProductId: productId,
    bootstrap,
  };
}
