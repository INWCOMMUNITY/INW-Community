export type ImportSkipStep = "migration" | "dedupe" | "validation" | "create";

export type ImportSkipEntry = {
  externalListingId: string;
  title?: string;
  photo?: string;
  step?: ImportSkipStep;
  reason: string;
  hint?: string;
  retryable: boolean;
};

export type ImportSuccessEntry = {
  externalListingId: string;
  storeItemId: string;
  title?: string;
  photo?: string;
};

const PERMANENT_SKIP =
  /not_fixed_price|auction|classified|ended|already_linked|invalid_price|invalid_title|missing_id|25018|Incomplete.*account|business polic|fulfillmentPolicy|paymentPolicy|returnPolicy|merchant location|Cannot migrate listing/i;

const RETRYABLE_SKIP =
  /timed out|504|25001|system error|25025|concurrent|try again|no_response|HTTP 500|HTTP 503|migration_failed/i;

export function isPermanentImportSkip(reason: string): boolean {
  return PERMANENT_SKIP.test(reason ?? "");
}

export function isRetryableImportSkip(reason: string): boolean {
  if (isPermanentImportSkip(reason)) return false;
  return RETRYABLE_SKIP.test(reason ?? "");
}

export function withSkipMeta(
  entry: Omit<ImportSkipEntry, "retryable"> & { retryable?: boolean }
): ImportSkipEntry {
  return {
    ...entry,
    retryable: entry.retryable ?? isRetryableImportSkip(entry.reason),
  };
}
