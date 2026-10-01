import {
  beginEtsyListingImportAttempt,
  completeEtsyListingImportAttempt,
  createEtsyImportedListingMapping,
  failEtsyListingImportAttempt,
  isEtsyWhenMade,
  isEtsyWhoMade,
  prisma,
  provisionNativeFoundationListing,
  EtsyMappingConflictError,
  EtsyMappingError,
} from "database";
import { fetchEtsyImportListingDetail, type EtsyImportCandidate } from "./import-discovery";
import { ensureInwHostedListingPhotos } from "@/lib/listing-photo-rehost";

export type ImportEtsyListingStockMode = "PHYSICAL" | "MADE_TO_ORDER";

export type ImportEtsyListingResult =
  | {
      status: "IMPORTED" | "ALREADY_IMPORTED";
      storeItemId: string;
      listingLinkId: string;
      etsyListingId: string;
    }
  | {
      status: "ERROR";
      code: string;
      message: string;
    };

function uniqueSlug(base: string): string {
  const root =
    base
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "imported-item";
  return `${root}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function matrixFromCandidate(candidate: EtsyImportCandidate) {
  if (candidate.axes.length === 0 || candidate.variants.length <= 1) return null;
  return {
    axes: candidate.axes.map((axis) => ({ name: axis.name, values: axis.values })),
    skus: candidate.variants.map((variant) => ({
      options: variant.options,
      quantity: variant.quantity,
      priceCents: variant.priceCents,
      sku: variant.sku ?? undefined,
    })),
  };
}

/**
 * Import one Etsy listing into INW with durable mapping.
 * Never enqueues outbound publish/sync jobs (including Shopify).
 */
export async function importEtsyListing(input: {
  memberId: string;
  etsyListingId: string;
  stockMode: ImportEtsyListingStockMode;
}): Promise<ImportEtsyListingResult> {
  if (input.stockMode !== "PHYSICAL" && input.stockMode !== "MADE_TO_ORDER") {
    return {
      status: "ERROR",
      code: "STOCK_MODE_REQUIRED",
      message: "Choose PHYSICAL or MADE TO ORDER stock mode before importing.",
    };
  }

  const listingId = input.etsyListingId.trim();
  if (!/^\d+$/.test(listingId)) {
    return { status: "ERROR", code: "INVALID_LISTING", message: "Invalid Etsy listing id." };
  }

  const connection = await prisma.etsyConnection.findFirst({
    where: { memberId: input.memberId, status: "ACTIVE" },
    orderBy: { connectedAt: "desc" },
    select: { id: true },
  });
  if (!connection) {
    return {
      status: "ERROR",
      code: "CONNECTION_REQUIRED",
      message: "Connect Etsy before importing listings.",
    };
  }

  const begin = await beginEtsyListingImportAttempt(prisma, {
    memberId: input.memberId,
    connectionId: connection.id,
    etsyListingId: listingId,
    stockMode: input.stockMode,
  });

  if (begin.status === "ALREADY_COMPLETED") {
    if (!begin.attempt.storeItemId || !begin.attempt.listingLinkId) {
      return {
        status: "ERROR",
        code: "IMPORT_INCONSISTENT",
        message: "Import changed while processing; refresh and retry.",
      };
    }
    return {
      status: "ALREADY_IMPORTED",
      storeItemId: begin.attempt.storeItemId,
      listingLinkId: begin.attempt.listingLinkId,
      etsyListingId: listingId,
    };
  }
  if (begin.status === "IN_PROGRESS") {
    return {
      status: "ERROR",
      code: "IMPORT_IN_PROGRESS",
      message: "An import for this listing is already in progress.",
    };
  }

  const attempt = begin.attempt;
  const bootstrapStartedAt = attempt.bootstrapStartedAt;

  const fresh = await fetchEtsyImportListingDetail({
    memberId: input.memberId,
    etsyListingId: listingId,
  });
  if (fresh.status !== "OK") {
    await failEtsyListingImportAttempt(prisma, {
      attemptId: attempt.id,
      code: fresh.code,
      message: fresh.message,
    });
    return { status: "ERROR", code: fresh.code, message: fresh.message };
  }
  if (fresh.connectionId !== connection.id) {
    await failEtsyListingImportAttempt(prisma, {
      attemptId: attempt.id,
      code: "CONNECTION_CHANGED",
      message: "Etsy connection changed; refresh and try again.",
    });
    return {
      status: "ERROR",
      code: "CONNECTION_CHANGED",
      message: "Etsy connection changed; refresh and try again.",
    };
  }

  const snap = fresh.candidate;
  if (!snap.supported || snap.variants.length === 0) {
    await failEtsyListingImportAttempt(prisma, {
      attemptId: attempt.id,
      code: "UNSUPPORTED_LISTING",
      message: snap.unsupportedReason ?? "Listing cannot be imported.",
    });
    return {
      status: "ERROR",
      code: "UNSUPPORTED_LISTING",
      message: snap.unsupportedReason ?? "Listing cannot be imported.",
    };
  }

  const inventoryTracking = input.stockMode === "PHYSICAL" ? "tracked" : "made_to_order";
  const totalQty =
    input.stockMode === "PHYSICAL"
      ? snap.variants.reduce((sum, variant) => sum + Math.max(0, variant.quantity), 0)
      : 0;
  const title = snap.title.slice(0, 200);
  const description = snap.description.trim() ? snap.description : null;
  const photos = await ensureInwHostedListingPhotos(snap.photos.slice(0, 20));
  const priceCents = snap.variants[0]?.priceCents ?? snap.priceCents ?? 0;
  const sku = snap.variants[0]?.sku ?? null;
  const matrix = matrixFromCandidate(snap);
  const etsyWhoMade = isEtsyWhoMade(snap.etsyWhoMade) ? snap.etsyWhoMade : null;
  const etsyWhenMade = isEtsyWhenMade(snap.etsyWhenMade)
    ? snap.etsyWhenMade
    : inventoryTracking === "made_to_order"
      ? "made_to_order"
      : null;
  const etsyIsSupply = typeof snap.etsyIsSupply === "boolean" ? snap.etsyIsSupply : null;
  const etsyTaxonomyId =
    typeof snap.etsyTaxonomyId === "number" &&
    Number.isInteger(snap.etsyTaxonomyId) &&
    snap.etsyTaxonomyId > 0
      ? snap.etsyTaxonomyId
      : null;

  try {
    const created = await prisma.$transaction(async (tx) => {
      const existingMap = await tx.etsyListingLink.findFirst({
        where: { etsyConnectionId: connection.id, etsyListingId: listingId },
        select: { id: true, storeItemId: true },
      });
      if (existingMap) {
        await completeEtsyListingImportAttempt(tx, {
          attemptId: attempt.id,
          storeItemId: existingMap.storeItemId,
          listingLinkId: existingMap.id,
          etsyProductId: snap.variants[0]?.etsyProductId,
          etsyOfferingId: snap.variants[0]?.etsyOfferingId,
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
          priceCents,
          sku,
          quantity: totalQty,
          inventoryTracking,
          status: "active",
          slug: uniqueSlug(title),
          variants: matrix ?? undefined,
          etsyWhoMade,
          etsyWhenMade,
          etsyIsSupply,
          etsyTaxonomyId,
        },
      });

      const provisioned = await provisionNativeFoundationListing(tx, storeItem.id);
      if (provisioned.variantIds.length !== snap.variants.length) {
        // Fall back to positional pairing when matrix expansion matches inventory products.
        if (provisioned.variantIds.length === 0) {
          throw new EtsyMappingError("INVALID_VARIANTS", "Foundation listing produced no variants");
        }
      }

      const storeVariants = await tx.storeVariant.findMany({
        where: { storeItemId: storeItem.id },
        orderBy: { createdAt: "asc" },
      });

      const pairs =
        storeVariants.length === snap.variants.length
          ? storeVariants.map((sv, index) => ({
              storeVariantId: sv.id,
              remote: snap.variants[index]!,
            }))
          : pairByOptions(storeVariants, snap.variants);

      // Simple listings: one INW variant ↔ first Etsy offering when option matching fails.
      const resolvedPairs =
        pairs.length === snap.variants.length
          ? pairs
          : storeVariants.length === 1 && snap.variants.length === 1
            ? [{ storeVariantId: storeVariants[0]!.id, remote: snap.variants[0]! }]
            : pairs;

      if (resolvedPairs.length !== snap.variants.length) {
        throw new EtsyMappingError(
          "VARIANT_CORRELATION_FAILED",
          "Could not correlate INW variants to Etsy offerings"
        );
      }

      // Apply opening quantities onto foundation inventory for PHYSICAL imports.
      if (input.stockMode === "PHYSICAL") {
        for (const pair of resolvedPairs) {
          await tx.inventoryState.updateMany({
            where: { variantId: pair.storeVariantId },
            data: { onHand: Math.max(0, pair.remote.quantity), reserved: 0 },
          });
        }
        await tx.storeItem.update({
          where: { id: storeItem.id },
          data: { quantity: totalQty },
        });
      }

      const mapping = await createEtsyImportedListingMapping(tx, {
        memberId: input.memberId,
        connectionId: connection.id,
        storeItemId: storeItem.id,
        etsyListingId: listingId,
        remoteListingState: snap.state,
        importBootstrapStartedAt: bootstrapStartedAt,
        variants: resolvedPairs.map((pair) => ({
          storeVariantId: pair.storeVariantId,
          etsyProductId: pair.remote.etsyProductId,
          etsyOfferingId: pair.remote.etsyOfferingId,
          propertyValuesJson: pair.remote.propertyValuesJson as never,
          remoteSku: pair.remote.sku,
          remoteAvailable: input.stockMode === "PHYSICAL" ? pair.remote.quantity : null,
        })),
      });

      await completeEtsyListingImportAttempt(tx, {
        attemptId: attempt.id,
        storeItemId: storeItem.id,
        listingLinkId: mapping.listingLinkId,
        etsyProductId: resolvedPairs[0]?.remote.etsyProductId,
        etsyOfferingId: resolvedPairs[0]?.remote.etsyOfferingId,
      });

      return {
        already: false as const,
        storeItemId: storeItem.id,
        listingLinkId: mapping.listingLinkId,
      };
    });

    return {
      status: created.already ? "ALREADY_IMPORTED" : "IMPORTED",
      storeItemId: created.storeItemId,
      listingLinkId: created.listingLinkId,
      etsyListingId: listingId,
    };
  } catch (error) {
    const code =
      error instanceof EtsyMappingConflictError
        ? "MAPPING_CONFLICT"
        : error instanceof EtsyMappingError
          ? error.code
          : "IMPORT_FAILED";
    const message =
      error instanceof Error ? error.message.slice(0, 500) : "Import failed.";
    await failEtsyListingImportAttempt(prisma, {
      attemptId: attempt.id,
      code,
      message,
    });
    return { status: "ERROR", code, message };
  }
}

function pairByOptions(
  storeVariants: Array<{ id: string; options: unknown }>,
  remotes: EtsyImportCandidate["variants"]
): Array<{ storeVariantId: string; remote: EtsyImportCandidate["variants"][number] }> {
  const remaining = [...remotes];
  const pairs: Array<{ storeVariantId: string; remote: EtsyImportCandidate["variants"][number] }> =
    [];
  for (const sv of storeVariants) {
    const options =
      sv.options && typeof sv.options === "object" && !Array.isArray(sv.options)
        ? (sv.options as Record<string, string>)
        : {};
    const idx = remaining.findIndex((remote) => optionMapsEqual(options, remote.options));
    if (idx < 0) return [];
    const [remote] = remaining.splice(idx, 1);
    pairs.push({ storeVariantId: sv.id, remote: remote! });
  }
  return remaining.length === 0 ? pairs : [];
}

function optionMapsEqual(a: Record<string, string>, b: Record<string, string>): boolean {
  const aKeys = Object.keys(a).sort();
  const bKeys = Object.keys(b).sort();
  if (aKeys.length !== bKeys.length) return false;
  for (let i = 0; i < aKeys.length; i += 1) {
    if (aKeys[i] !== bKeys[i]) return false;
    if ((a[aKeys[i]!] ?? "") !== (b[bKeys[i]!] ?? "")) return false;
  }
  return true;
}
