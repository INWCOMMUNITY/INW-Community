/**
 * Read storefront order IDs from Stripe Checkout Session metadata (same shape as webhook).
 */
export function orderIdsFromCheckoutSessionMetadata(
  meta: Record<string, string | null | undefined> | null | undefined
): string[] {
  if (!meta || typeof meta !== "object") return [];
  const orderIdsRaw = meta.orderIds && typeof meta.orderIds === "string" ? meta.orderIds : null;
  const chunks: string[] = orderIdsRaw?.trim() ? [orderIdsRaw.trim()] : [];
  for (let i = 0; ; i++) {
    const key = `orderIds_${i}`;
    const val = meta[key];
    if (val && typeof val === "string" && val.trim()) chunks.push(val.trim());
    else break;
  }
  const orderIdsList =
    chunks.length > 0 ? chunks.flatMap((s) => s.split(",").map((id) => id.trim()).filter(Boolean)) : [];
  const singleOrderId = meta.orderId && typeof meta.orderId === "string" ? meta.orderId.trim() : null;
  return orderIdsList.length > 0 ? orderIdsList : singleOrderId ? [singleOrderId] : [];
}
