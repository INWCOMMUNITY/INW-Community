import type { Prisma } from "database";
import { INVENTORY_TRACKING_MADE_TO_ORDER, isMadeToOrderTracking } from "@/lib/listing-variant-matrix";

const publicStockClause: Prisma.StoreItemWhereInput = {
  OR: [{ inventoryTracking: INVENTORY_TRACKING_MADE_TO_ORDER }, { quantity: { gt: 0 } }],
};

/**
 * Prisma: listing has stock for public browse. Wrap other filters so existing OR/AND
 * clauses are not overwritten.
 */
export function withPublicStockWhere(where: Prisma.StoreItemWhereInput = {}): Prisma.StoreItemWhereInput {
  return { AND: [where, publicStockClause] };
}

/** Inner stock clause. Prefer withPublicStockWhere when the query already has OR/AND. */
export const storeItemHasPublicStockWhere: Prisma.StoreItemWhereInput = publicStockClause;

export function listingHasPublicStock(args: {
  quantity: number;
  inventoryTracking?: string | null;
}): boolean {
  if (isMadeToOrderTracking(args.inventoryTracking)) return true;
  return args.quantity > 0;
}

/** Public PDP/CUID access: strangers must not enumerate drafts or sold rows by id. */
export function strangerMayViewStoreItemById(args: {
  status: string;
  quantity: number;
  memberId: string;
  viewerId?: string | null;
  inventoryTracking?: string | null;
}): boolean {
  if (args.viewerId && args.viewerId === args.memberId) return true;
  return args.status === "active" && listingHasPublicStock(args);
}

/** includeUnavailable=1: owners see any status; strangers may see sold_out sold pages only. */
export function includeUnavailableVisibleToViewer(args: {
  status: string;
  memberId: string;
  viewerId?: string | null;
}): boolean {
  if (args.viewerId && args.viewerId === args.memberId) return true;
  return args.status === "sold_out";
}
