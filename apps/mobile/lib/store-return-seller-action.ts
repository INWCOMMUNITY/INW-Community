/** Keep in sync with apps/main/src/lib/store-return.ts seller money-action helpers. */

export type StoreReturnSellerMoneyAction = "receive" | "retry_refund";

export const STORE_RETURN_RECEIVE_ACTION_LABEL = "Mark received & refund";
export const STORE_RETURN_RETRY_REFUND_ACTION_LABEL = "Retry refund";

export function storeReturnSellerMoneyAction(args: {
  returnStatus?: string | null;
  orderStatus?: string | null;
}): StoreReturnSellerMoneyAction | null {
  if (args.orderStatus === "refunded") return null;
  if (args.returnStatus === "refunded") return null;
  if (args.returnStatus === "awaiting_return" || args.returnStatus === "in_transit") return "receive";
  if (args.returnStatus === "received") return "retry_refund";
  return null;
}

export function storeReturnSellerMoneyActionLabel(action: StoreReturnSellerMoneyAction | null): string | null {
  if (action === "receive") return STORE_RETURN_RECEIVE_ACTION_LABEL;
  if (action === "retry_refund") return STORE_RETURN_RETRY_REFUND_ACTION_LABEL;
  return null;
}
