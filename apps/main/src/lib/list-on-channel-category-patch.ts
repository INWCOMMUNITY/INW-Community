import { Prisma } from "database";
import { normalizeEbayBrandValue, isBrandAspectName } from "@/lib/channels/ebay/aspect-prep";
import { normalizeListingAspects, parseStoredAspects } from "@/lib/listing-limits";
import type { ListOnCategoryAssignment } from "@/lib/list-on-channel-category";

export type ListOnCategoryStoreItemPatch = {
  etsyTaxonomyId?: number;
  ebayCategoryId?: number;
  etsyWhoMade?: string;
  etsyWhenMade?: string;
  aspects?: Prisma.InputJsonValue | typeof Prisma.JsonNull;
};

export function storeItemPatchFromListOnCategoryAssignment(
  assignment: ListOnCategoryAssignment,
  existingAspects?: unknown
): ListOnCategoryStoreItemPatch {
  const data: ListOnCategoryStoreItemPatch = {};
  if (assignment.etsyTaxonomyId != null) data.etsyTaxonomyId = assignment.etsyTaxonomyId;
  if (assignment.ebayCategoryId != null) data.ebayCategoryId = assignment.ebayCategoryId;
  if (assignment.etsyWhoMade) data.etsyWhoMade = assignment.etsyWhoMade;
  if (assignment.etsyWhenMade) data.etsyWhenMade = assignment.etsyWhenMade;
  if (assignment.aspects) {
    const incoming = normalizeListingAspects(
      assignment.aspects.map((row) => ({
        name: row.name,
        value: isBrandAspectName(row.name) ? normalizeEbayBrandValue(row.value) : row.value,
      }))
    );
    if (incoming.length > 0) {
      const merged = new Map(
        parseStoredAspects(existingAspects).map((row) => [row.name.toLowerCase(), row])
      );
      for (const row of incoming) {
        merged.set(row.name.toLowerCase(), row);
      }
      data.aspects = Array.from(merged.values()) as Prisma.InputJsonValue;
    }
  }
  return data;
}
