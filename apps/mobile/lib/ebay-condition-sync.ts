/** Detect eBay condition mismatch errors that can be fixed in-app. */
export function isEbayConditionSyncError(error: string | null | undefined): boolean {
  if (!error?.trim()) return false;
  return /\b25021\b|invalid item condition|condition id is invalid/i.test(error);
}
