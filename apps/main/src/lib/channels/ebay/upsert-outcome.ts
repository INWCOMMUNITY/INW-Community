/**
 * Classify the result of an eBay upsert (create/update listing) so a published listing whose
 * variation quantities failed to write is never reported as a clean success.
 */
export type EbayUpsertOutcome =
  | { kind: "ok" }
  | { kind: "publish_error"; message: string }
  | { kind: "quantity_error"; message: string };

export function classifyEbayUpsertResult(result: {
  publishError?: string;
  quantityError?: string;
}): EbayUpsertOutcome {
  if (result.publishError) return { kind: "publish_error", message: result.publishError };
  if (result.quantityError) return { kind: "quantity_error", message: result.quantityError };
  return { kind: "ok" };
}
