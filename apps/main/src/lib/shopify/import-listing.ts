import {
  assertShopifyProductGid,
  beginShopifyListingImportAttempt,
  completeShopifyListingImportAttempt,
  correlateVariantsByOptionCombination,
  createShopifyImportedListingMapping,
  failShopifyListingImportAttempt,
  prisma,
  provisionNativeFoundationListing,
  reconcileShopifyImportBootstrapSales,
  seedShopifyVariantMediaConvergence,
  shopifyMediaContentSha256,
  shopifyTopologyToInwMatrix,
  ShopifyMappingConflictError,
  ShopifyMappingError,
  upsertShopifyMediaDesireMaps,
  validateShopifyImportTopology,
} from "database";
import { randomUUID } from "crypto";
import type { ShopifyFetch } from "./admin-graphql";
import { fetchShopifyImportProductDetail } from "./import-discovery";
import type { ShopifyImportCandidate } from "./import-discovery";

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

function isMultiVariant(snap: ShopifyImportCandidate): boolean {
  return snap.variants.length > 1;
}

/**
 * Import one Shopify product (simple or multi-variant) into INW with exact provider mapping.
 *
 * Order of operations (launch-critical):
 * 1. Durably commit import attempt + bootstrapStartedAt (no network)
 * 2. Fresh Shopify provider re-read / inventory snapshot (outside DB TX)
 * 3. Atomic canonical write: StoreItem + Variant(s) + opening + mapping + baselines + COMPLETED
 * 4. Reconcile durable ORDERS_PAID facts against the same cutoff PER variant (idempotent; safe to retry)
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
  if (!snap.supported) {
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

  const multi = isMultiVariant(snap);

  const connectionWithLocation = {
    id: connection.id,
    primaryLocationId: connection.primaryLocationId!,
  };

  // ── Multi-variant import ──
  if (multi) {
    return importMultiVariant({
      snap,
      attempt,
      connection: connectionWithLocation,
      productId,
      bootstrapStartedAt,
      stockMode: input.stockMode,
      memberId: input.memberId,
    });
  }

  // ── Simple single-variant import (preserved) ──
  return importSingleVariant({
    snap,
    attempt,
    connection: connectionWithLocation,
    productId,
    bootstrapStartedAt,
    stockMode: input.stockMode,
    memberId: input.memberId,
  });
}

async function importSingleVariant(ctx: {
  snap: ShopifyImportCandidate;
  attempt: { id: string; bootstrapStartedAt: Date };
  connection: { id: string; primaryLocationId: string };
  productId: string;
  bootstrapStartedAt: Date;
  stockMode: ImportShopifyListingStockMode;
  memberId: string;
}): Promise<ImportShopifyListingResult> {
  const { snap, attempt, connection, productId, bootstrapStartedAt, stockMode, memberId } = ctx;

  if (
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

  if (stockMode === "PHYSICAL") {
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

  const openingQty = stockMode === "PHYSICAL" ? Math.trunc(snap.primaryLocationAvailable ?? 0) : 0;
  const inventoryTracking = stockMode === "PHYSICAL" ? "tracked" : "made_to_order";
  const inventoryMode = stockMode === "PHYSICAL" ? "TRACKED_FINITE" : "MADE_TO_ORDER";
  const title = snap.title.slice(0, 200);
  const description = snap.descriptionHtml.trim().length > 0 ? snap.descriptionHtml : null;
  const photos = snap.imageUrl ? [snap.imageUrl] : [];
  const sku = snap.sku ? snap.sku.trim().slice(0, 50) || null : null;

  let created:
    | { already: true; storeItemId: string; listingLinkId: string }
    | { already: false; storeItemId: string; listingLinkId: string }
    | null = null;

  try {
    created = await prisma.$transaction(async (tx) => {
      const existingMap = await tx.shopifyListingLink.findFirst({
        where: { shopifyConnectionId: connection.id, shopifyProductId: productId },
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
        return { already: true as const, storeItemId: existingMap.storeItemId, listingLinkId: existingMap.id };
      }

      const storeItem = await tx.storeItem.create({
        data: {
          memberId,
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
        memberId,
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
        remoteAvailable: stockMode === "PHYSICAL" ? openingQty : null,
        inventoryMode,
      });

      await completeShopifyListingImportAttempt(tx, {
        attemptId: attempt.id,
        shopifyVariantId: snap.shopifyVariantId!,
        shopifyInventoryItemId: snap.shopifyInventoryItemId!,
        storeItemId: storeItem.id,
        listingLinkId: mapping.listingLink.id,
      });

      return { already: false as const, storeItemId: storeItem.id, listingLinkId: mapping.listingLink.id };
    });
  } catch (error) {
    const code =
      error instanceof ShopifyMappingConflictError
        ? "ALREADY_MAPPED"
        : error instanceof ShopifyMappingError
          ? error.code
          : "IMPORT_FAILED";
    const message = error instanceof Error ? error.message : "Import failed. Refresh and try again.";
    await failShopifyListingImportAttempt(prisma, {
      attemptId: attempt.id,
      code,
      message,
    }).catch(() => undefined);
    return {
      status: "ERROR",
      code,
      message: code === "ALREADY_MAPPED" ? "This Shopify product is already synced." : message.slice(0, 300),
    };
  }

  // 4) Sale reconcile after canonical commit.
  const bootstrap = await runBootstrapReconcile({
    connectionId: connection.id,
    memberId,
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

async function importMultiVariant(ctx: {
  snap: ShopifyImportCandidate;
  attempt: { id: string; bootstrapStartedAt: Date };
  connection: { id: string; primaryLocationId: string };
  productId: string;
  bootstrapStartedAt: Date;
  stockMode: ImportShopifyListingStockMode;
  memberId: string;
}): Promise<ImportShopifyListingResult> {
  const { snap, attempt, connection, productId, bootstrapStartedAt, stockMode, memberId } = ctx;

  if (snap.axes.length === 0 || snap.variants.length === 0 || !snap.matrix) {
    await failShopifyListingImportAttempt(prisma, {
      attemptId: attempt.id,
      code: "TOPOLOGY_INVALID",
      message: "Multi-variant product topology is invalid.",
    });
    return { status: "ERROR", code: "TOPOLOGY_INVALID", message: "Multi-variant product topology is invalid." };
  }

  // Re-validate topology
  const topo = validateShopifyImportTopology({
    axes: snap.axes,
    variants: snap.variants.map((v) => ({
      shopifyVariantId: v.shopifyVariantId,
      shopifyInventoryItemId: v.shopifyInventoryItemId,
      selectedOptions: v.selectedOptions,
      priceCents: v.priceCents,
      sku: v.sku,
      available: v.primaryLocationAvailable,
      tracked: v.inventoryTracked,
    })),
  });
  if (!topo.ok) {
    await failShopifyListingImportAttempt(prisma, {
      attemptId: attempt.id,
      code: topo.code,
      message: topo.message,
    });
    return { status: "ERROR", code: topo.code, message: topo.message };
  }

  if (stockMode === "PHYSICAL") {
    for (const v of snap.variants) {
      if (v.inventoryTracked && (v.primaryLocationAvailable == null || v.primaryLocationAvailable < 0)) {
        await failShopifyListingImportAttempt(prisma, {
          attemptId: attempt.id,
          code: "INVENTORY_UNAVAILABLE",
          message: "Inventory unavailable at selected Shopify location for one or more variants.",
        });
        return {
          status: "ERROR",
          code: "INVENTORY_UNAVAILABLE",
          message: "Inventory unavailable at selected Shopify location for one or more variants.",
        };
      }
    }
  }

  const inventoryTracking = stockMode === "PHYSICAL" ? "tracked" : "made_to_order";
  const inventoryMode = stockMode === "PHYSICAL" ? "TRACKED_FINITE" : "MADE_TO_ORDER";
  const title = snap.title.slice(0, 200);
  const description = snap.descriptionHtml.trim().length > 0 ? snap.descriptionHtml : null;
  const photos = snap.imageUrl ? [snap.imageUrl] : [];

  const matrix = shopifyTopologyToInwMatrix({
    axes: topo.axes,
    variants: topo.variants,
    inventoryTracking,
  });

  const totalQty = matrix.skus.reduce((sum, s) => sum + s.quantity, 0);

  let created:
    | { already: true; storeItemId: string; listingLinkId: string; variantMappings: Array<{ storeVariantId: string; shopifyVariantId: string }> }
    | { already: false; storeItemId: string; listingLinkId: string; variantMappings: Array<{ storeVariantId: string; shopifyVariantId: string }> }
    | null = null;

  try {
    created = await prisma.$transaction(async (tx) => {
      const existingMap = await tx.shopifyListingLink.findFirst({
        where: { shopifyConnectionId: connection.id, shopifyProductId: productId },
        select: { id: true, storeItemId: true },
      });
      if (existingMap) {
        const firstVariant = snap.variants[0]!;
        await completeShopifyListingImportAttempt(tx, {
          attemptId: attempt.id,
          shopifyVariantId: firstVariant.shopifyVariantId,
          shopifyInventoryItemId: firstVariant.shopifyInventoryItemId,
          storeItemId: existingMap.storeItemId,
          listingLinkId: existingMap.id,
        });
        return {
          already: true as const,
          storeItemId: existingMap.storeItemId,
          listingLinkId: existingMap.id,
          variantMappings: [],
        };
      }

      const storeItem = await tx.storeItem.create({
        data: {
          memberId,
          title,
          description,
          photos,
          priceCents: snap.priceCents ?? matrix.skus[0]?.priceCents ?? 0,
          quantity: totalQty,
          inventoryTracking,
          sku: null,
          status: "active",
          slug: uniqueSlug(slugify(title)),
          condition: "new",
          variants: matrix as object,
        },
        select: { id: true },
      });

      const provisioned = await provisionNativeFoundationListing(tx, storeItem.id);
      if (provisioned.variantIds.length !== snap.variants.length) {
        throw new Error(
          `Imported listing provisioned ${provisioned.variantIds.length} variants; expected ${snap.variants.length}`
        );
      }

      // Correlate provisioned INW variants to Shopify variants by option combination
      const inwVariants = await tx.storeVariant.findMany({
        where: { storeItemId: storeItem.id, memberId },
        select: { id: true, options: true },
        orderBy: { createdAt: "asc" },
      });

      const requestedForCorrelation = inwVariants.map((sv) => {
        const opts = typeof sv.options === "string" ? JSON.parse(sv.options) : sv.options;
        const selectedOptions = Object.entries(opts as Record<string, string>).map(([name, value]) => ({
          name,
          value: String(value),
        }));
        return { storeVariantId: sv.id, selectedOptions };
      });

      const remoteForCorrelation = snap.variants.map((v) => ({
        shopifyVariantId: v.shopifyVariantId,
        shopifyInventoryItemId: v.shopifyInventoryItemId,
        selectedOptions: v.selectedOptions,
      }));

      const correlation = correlateVariantsByOptionCombination({
        requested: requestedForCorrelation,
        remote: remoteForCorrelation,
      });

      if (!correlation.ok) {
        throw new ShopifyMappingError(
          "INVALID_VARIANTS",
          `Variant correlation failed: ${correlation.message}`
        );
      }

      const perVariantAvailable = correlation.pairs.map((pair) => {
        const remoteV = snap.variants.find((v) => v.shopifyVariantId === pair.shopifyVariantId);
        if (!remoteV) return null;
        return stockMode === "PHYSICAL" ? Math.trunc(remoteV.primaryLocationAvailable ?? 0) : null;
      });

      const mapping = await createShopifyImportedListingMapping(tx, {
        memberId,
        connectionId: connection.id,
        storeItemId: storeItem.id,
        shopifyProductId: productId,
        variants: correlation.pairs.map((p) => ({
          storeVariantId: p.storeVariantId,
          shopifyVariantId: p.shopifyVariantId,
          shopifyInventoryItemId: p.shopifyInventoryItemId,
        })),
        remoteProductStatus: snap.status,
        importBootstrapStartedAt: bootstrapStartedAt,
        remoteAvailable: perVariantAvailable,
        inventoryMode,
      });

      // Seed durable product media maps + per-variant association BASE=LOCAL=REMOTE.
      // No outbound media association write on import.
      const productMedia =
        snap.productMedia.length > 0
          ? snap.productMedia
          : snap.imageUrl
            ? [{ shopifyMediaId: `import-featured:${productId}`, sourceUrl: snap.imageUrl }]
            : [];
      const desiredMedia = productMedia.map((m, position) => {
        const sourceUrl = m.sourceUrl?.trim() || `shopify-media:${m.shopifyMediaId}`;
        return {
          inwMediaId: randomUUID().replace(/-/g, "").slice(0, 24),
          sourceUrl,
          contentSha256: shopifyMediaContentSha256(sourceUrl),
          position,
        };
      });
      if (desiredMedia.length > 0) {
        await upsertShopifyMediaDesireMaps(tx, {
          connectionId: connection.id,
          listingLinkId: mapping.listingLink.id,
          memberId,
          storeItemId: storeItem.id,
          desired: desiredMedia,
          removeInwMediaIds: [],
        });
        for (let i = 0; i < productMedia.length; i += 1) {
          const media = productMedia[i]!;
          const desire = desiredMedia[i]!;
          if (media.shopifyMediaId.startsWith("import-featured:")) continue;
          await tx.shopifyMediaMap.updateMany({
            where: {
              shopifyListingLinkId: mapping.listingLink.id,
              inwMediaId: desire.inwMediaId,
            },
            data: { shopifyMediaId: media.shopifyMediaId, status: "ACTIVE" },
          });
        }
      }

      const mapsAfter = await tx.shopifyMediaMap.findMany({
        where: { shopifyListingLinkId: mapping.listingLink.id, status: "ACTIVE" },
        select: { inwMediaId: true, sourceUrl: true, shopifyMediaId: true, status: true },
      });
      const byMediaGid = new Map(
        mapsAfter
          .filter((m) => m.shopifyMediaId)
          .map((m) => [m.shopifyMediaId!, m] as const)
      );
      const associations = correlation.pairs.map((pair) => {
        const remote = snap.variants.find((v) => v.shopifyVariantId === pair.shopifyVariantId);
        const mediaIds = remote?.mediaIds ?? [];
        const photos: string[] = [];
        const inwMediaIds: string[] = [];
        for (const mediaId of mediaIds) {
          const map = byMediaGid.get(mediaId);
          if (!map) continue;
          inwMediaIds.push(map.inwMediaId);
          if (map.sourceUrl?.trim()) photos.push(map.sourceUrl.trim());
        }
        return {
          storeVariantId: pair.storeVariantId,
          photos,
          inwMediaIds,
        };
      });
      await seedShopifyVariantMediaConvergence(tx, {
        connectionId: connection.id,
        listingLinkId: mapping.listingLink.id,
        memberId,
        storeItemId: storeItem.id,
        associations,
      });

      const firstPair = correlation.pairs[0]!;
      await completeShopifyListingImportAttempt(tx, {
        attemptId: attempt.id,
        shopifyVariantId: firstPair.shopifyVariantId,
        shopifyInventoryItemId: firstPair.shopifyInventoryItemId,
        storeItemId: storeItem.id,
        listingLinkId: mapping.listingLink.id,
      });

      return {
        already: false as const,
        storeItemId: storeItem.id,
        listingLinkId: mapping.listingLink.id,
        variantMappings: correlation.pairs.map((p) => ({
          storeVariantId: p.storeVariantId,
          shopifyVariantId: p.shopifyVariantId,
        })),
      };
    });
  } catch (error) {
    const code =
      error instanceof ShopifyMappingConflictError
        ? "ALREADY_MAPPED"
        : error instanceof ShopifyMappingError
          ? error.code
          : "IMPORT_FAILED";
    const message = error instanceof Error ? error.message : "Import failed. Refresh and try again.";
    await failShopifyListingImportAttempt(prisma, {
      attemptId: attempt.id,
      code,
      message,
    }).catch(() => undefined);
    return {
      status: "ERROR",
      code,
      message: code === "ALREADY_MAPPED" ? "This Shopify product is already synced." : message.slice(0, 300),
    };
  }

  // 4) Sale reconcile PER variant after canonical commit.
  let totalPreAcked = 0;
  let totalPostApplied = 0;

  if (!created.already && created.variantMappings.length > 0) {
    for (const pair of created.variantMappings) {
      const bootstrap = await runBootstrapReconcile({
        connectionId: connection.id,
        memberId,
        shopifyVariantId: pair.shopifyVariantId,
        bootstrapStartedAt,
      });
      totalPreAcked += bootstrap.preBootstrapAcked;
      totalPostApplied += bootstrap.postBootstrapApplied;
    }
  } else if (snap.variants[0]) {
    const bootstrap = await runBootstrapReconcile({
      connectionId: connection.id,
      memberId,
      shopifyVariantId: snap.variants[0].shopifyVariantId,
      bootstrapStartedAt,
    });
    totalPreAcked = bootstrap.preBootstrapAcked;
    totalPostApplied = bootstrap.postBootstrapApplied;
  }

  return {
    status: created.already ? "ALREADY_IMPORTED" : "IMPORTED",
    storeItemId: created.storeItemId,
    listingLinkId: created.listingLinkId,
    shopifyProductId: productId,
    bootstrap: {
      preBootstrapAcked: totalPreAcked,
      postBootstrapApplied: totalPostApplied,
    },
  };
}
