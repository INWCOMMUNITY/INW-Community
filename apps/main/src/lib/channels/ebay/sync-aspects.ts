/**
 * Prepare StoreItem aspects before eBay inventory/offer push.
 * Delegates to ebay-compat for taxonomy remap, inventory merge, and validation.
 */

import { normalizeListingAspects, parseStoredAspects, type ListingAspect } from "@/lib/listing-limits";
import { prisma, Prisma } from "database";
import type { SyncStoreItem } from "../types";
import { getEffectiveSku } from "../types";
import type { EbayCategoryAspect } from "./aspects";
import {
  formatAspectValidationErrors,
  prepareOutboundAspects,
  validateRemappedAspects,
  remapAspectsToTaxonomy,
  missingRequiredEbayAspects as missingRequiredFromCompat,
  fillEmptyTaxonomyAspectsFromTitle,
  mergeListingAspects,
} from "./ebay-compat";
import { resolveEbayLegacyListingId } from "./mapping";
import { fetchEbayItemDetails } from "./trading";

export { mergeListingAspects };

/** Infer graded-coin specifics from title into empty taxonomy fields only. */
export function inferGradedCoinAspectsFromTitle(
  title: string,
  categoryAspects: EbayCategoryAspect[]
): ListingAspect[] {
  return fillEmptyTaxonomyAspectsFromTitle(title, categoryAspects, []);
}

export function missingRequiredEbayAspects(
  categoryAspects: EbayCategoryAspect[],
  aspects: ListingAspect[]
): string[] {
  return missingRequiredFromCompat(categoryAspects, aspects);
}

export type PrepareEbaySyncAspectsResult = {
  item: SyncStoreItem;
  missingRequired: EbayCategoryAspect[];
  enriched: boolean;
  remaps?: { from: string; to: string; reason?: string }[];
  dropped?: string[];
  categorySchema?: EbayCategoryAspect[];
};

export async function prepareEbaySyncAspects(args: {
  accessToken: string;
  externalListingId: string | undefined;
  item: SyncStoreItem;
  categoryId: string | null;
  sku?: string;
}): Promise<PrepareEbaySyncAspectsResult> {
  const sku = args.sku ?? args.externalListingId ?? getEffectiveSku(args.item);
  const legacyId =
    resolveEbayLegacyListingId(args.externalListingId ?? "") ??
    resolveEbayLegacyListingId(getEffectiveSku(args.item));

  let tradingAspects: ListingAspect[] = [];
  if (legacyId) {
    try {
      const details = await fetchEbayItemDetails(args.accessToken, legacyId);
      tradingAspects = details.aspects;
    } catch {
      /* optional enrichment */
    }
  }

  const prep = await prepareOutboundAspects({
    accessToken: args.accessToken,
    sku,
    item: args.item,
    categoryId: args.categoryId,
    tradingAspects,
    mergeFromInventory: true,
  });

  const validation = validateRemappedAspects(prep.categoryAspects, prep.remappedAspects);

  if (validation.invalidSelectionValues.length > 0) {
    throw new Error(
      formatAspectValidationErrors(validation.missingRequired, validation.invalidSelectionValues)
    );
  }

  // Compute remaps for trace information (compare stored input vs final remapped output)
  const inputAspects = parseStoredAspects(args.item.aspects);
  const remaps: { from: string; to: string; reason?: string }[] = [];

  // Track value adjustments as remaps
  for (const adj of prep.remappedAspects.length > 0
    ? remapAspectsToTaxonomy(prep.categoryAspects, inputAspects).valueAdjustments
    : []) {
    remaps.push({
      from: `${adj.name}: ${adj.from}`,
      to: `${adj.name}: ${adj.to}`,
      reason: "value_normalized",
    });
  }

  // Track name remaps by comparing input to output
  const inputByLower = new Map(inputAspects.map((a) => [a.name.toLowerCase(), a.name]));
  const outputByLower = new Map(prep.remappedAspects.map((a) => [a.name.toLowerCase(), a.name]));
  for (const [lower, inputName] of inputByLower) {
    const outputName = outputByLower.get(lower);
    if (outputName && outputName !== inputName) {
      remaps.push({
        from: inputName,
        to: outputName,
        reason: "taxonomy_remap",
      });
    }
  }

  // Map missingRequired strings to EbayCategoryAspect objects (synthetic when taxonomy load failed)
  const missingRequired: EbayCategoryAspect[] = prep.missingRequired.map((name) => {
    const found = prep.categoryAspects.find((a) => a.name === name);
    return (
      found ?? {
        name,
        required: true,
        mode: "FREE_TEXT",
        cardinality: "SINGLE",
        suggestedValues: [],
      }
    );
  });

  return {
    item: prep.item,
    missingRequired,
    enriched: prep.enriched,
    remaps,
    dropped: prep.dropped,
    categorySchema: prep.categoryAspects,
  };
}

export function formatMissingEbayAspectsError(missing: EbayCategoryAspect[] | string[]): string {
  const names = missing.map((m) => (typeof m === "string" ? m : m.name));
  return formatAspectValidationErrors(names, []);
}

export async function persistEbayAspects(
  storeItemId: string,
  aspects: ListingAspect[]
): Promise<void> {
  const normalized = normalizeListingAspects(aspects);
  await prisma.storeItem.update({
    where: { id: storeItemId },
    data: {
      aspects: normalized.length > 0 ? (normalized as object) : Prisma.JsonNull,
    },
  });
}

export { remapAspectsToTaxonomy };
