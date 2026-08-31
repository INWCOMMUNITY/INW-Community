import { Prisma } from "database";
import { normalizeListingAspects } from "@/lib/listing-limits";
import type { ListOnCategoryAssignment } from "@/lib/list-on-channel-category";

export type ListOnCategoryStoreItemPatch = {
  etsyTaxonomyId?: number;
  ebayCategoryId?: number;
  etsyWhoMade?: string;
  etsyWhenMade?: string;
  aspects?: Prisma.InputJsonValue | typeof Prisma.JsonNull;
};

export function storeItemPatchFromListOnCategoryAssignment(
  assignment: ListOnCategoryAssignment
): ListOnCategoryStoreItemPatch {
  const data: ListOnCategoryStoreItemPatch = {};
  if (assignment.etsyTaxonomyId != null) data.etsyTaxonomyId = assignment.etsyTaxonomyId;
  if (assignment.ebayCategoryId != null) data.ebayCategoryId = assignment.ebayCategoryId;
  if (assignment.etsyWhoMade) data.etsyWhoMade = assignment.etsyWhoMade;
  if (assignment.etsyWhenMade) data.etsyWhenMade = assignment.etsyWhenMade;
  if (assignment.aspects) {
    const normalized = normalizeListingAspects(assignment.aspects);
    data.aspects = normalized.length > 0 ? (normalized as Prisma.InputJsonValue) : Prisma.JsonNull;
  }
  return data;
}
