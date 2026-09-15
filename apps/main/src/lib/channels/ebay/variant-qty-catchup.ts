import { inventoryVariantsBaselineMatches } from "../variant-sync";

/**
 * Title/price pushes must not PUT INW SKU qty unless the seller actually changed qty on INW.
 * Hub owns View Item; INW writes offer qty only on real INW stock changes.
 */
export function ebayContentPushShouldWriteVariantQuantities(args: {
  operation: "create" | "update";
  baselineQty: number | null | undefined;
  baselineVariantsHash: string | null | undefined;
  listingQty: number;
  variants: unknown;
}): boolean {
  if (args.operation === "create") return true;
  if (args.baselineQty == null && !args.baselineVariantsHash) return true;
  if (args.baselineQty != null && args.baselineQty !== args.listingQty) return true;
  if (!inventoryVariantsBaselineMatches(args.baselineVariantsHash, args.variants)) return true;
  return false;
}
