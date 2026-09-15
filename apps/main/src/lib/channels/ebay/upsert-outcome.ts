/**
 * Classify the result of an eBay upsert (create/update listing).
 */
export type EbayUpsertOutcome =
  | { kind: "ok" }
  | { kind: "publish_error"; message: string };

export function classifyEbayUpsertResult(result: {
  publishError?: string;
}): EbayUpsertOutcome {
  if (result.publishError) return { kind: "publish_error", message: result.publishError };
  return { kind: "ok" };
}
