export const SOLD_BEFORE_CHECKOUT_REASON = "Item sold before checkout was complete";

export function isSoldWhilePayingCancel(reason: string | null | undefined): boolean {
  return reason === SOLD_BEFORE_CHECKOUT_REASON;
}
