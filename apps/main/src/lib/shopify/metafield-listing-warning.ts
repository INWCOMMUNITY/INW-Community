/** Custom options that Shopify can only show through product metafields. */
export function listingNeedsShopifyMetafields(
  fields: Array<{ kind?: string | null; title?: string | null }> | null | undefined
): boolean {
  return (fields ?? []).some((field) => {
    const kind = field.kind;
    if (kind !== "TEXT" && kind !== "DROPDOWN" && kind !== "FILE") return false;
    return Boolean(field.title?.trim());
  });
}

export function shopifyMetafieldListingWarning(itemCount = 1): string {
  const item = itemCount > 1 ? "these items" : "this item";
  return `METAFIELDS (Ex, text box, multiple choice, file uploads) must be activated on your storefront product page on Shopify before appearing. You understand this risk when listing ${item} to Shopify. We recommend making sure you are set up on your Shopify store.`;
}
