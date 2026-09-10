/**
 * Pure eBay condition-error detector. Lives in its own module (no server/Node imports) so client
 * components can use it without pulling `ebay/conditions.ts` -> `ebay/client.ts` (and its Node-only
 * `async_hooks` dependency) into the browser bundle.
 */
export function isEbayConditionSyncError(message: string | null | undefined): boolean {
  if (!message?.trim()) return false;
  return /\b25021\b|invalid item condition|condition id is invalid/i.test(message);
}
