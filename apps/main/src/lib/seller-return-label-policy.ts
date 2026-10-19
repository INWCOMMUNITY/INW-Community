export const HANDLING_TIME_PRESETS = ["1-2", "2-3", "3-4", "4-5"] as const;
export type HandlingTimePreset = (typeof HANDLING_TIME_PRESETS)[number];
export type HandlingTime = HandlingTimePreset | "custom";

export const RETURN_LABEL_PAYER_MODES = ["seller", "buyer", "by_reason"] as const;
export type ReturnLabelPayerMode = (typeof RETURN_LABEL_PAYER_MODES)[number];
export type ReasonLabelPayer = "buyer" | "seller" | "later";

export const BUYER_FAULT_REASONS = [
  "Changed my mind",
  "Didn't mean to order",
  "Ordered the wrong size, color, or quantity",
  "Doesn't fit",
  "No longer needed",
] as const;

export const SELLER_FAULT_REASONS = [
  "Order Arrived Damaged",
  "Wrong Item Delivered",
  "Not as described",
  "Missing parts",
  "Defective",
] as const;

export const RETURN_LABEL_REASONS = [...BUYER_FAULT_REASONS, ...SELLER_FAULT_REASONS, "Other"] as const;

export type ReturnLabelReason = (typeof RETURN_LABEL_REASONS)[number];

const DEFAULT_REASON_PAYER: Record<ReturnLabelReason, ReasonLabelPayer> = {
  "Changed my mind": "buyer",
  "Didn't mean to order": "buyer",
  "Ordered the wrong size, color, or quantity": "buyer",
  "Doesn't fit": "buyer",
  "No longer needed": "buyer",
  "Order Arrived Damaged": "seller",
  "Wrong Item Delivered": "seller",
  "Not as described": "seller",
  "Missing parts": "seller",
  Defective: "seller",
  Other: "later",
};

export type SellerReturnLabelPolicy = {
  handlingTime: HandlingTime | null;
  returnLabelPayer: ReturnLabelPayerMode;
  returnLabelPayerByReason: Record<ReturnLabelReason, ReasonLabelPayer>;
};

export function defaultReasonPayers(): Record<ReturnLabelReason, ReasonLabelPayer> {
  return { ...DEFAULT_REASON_PAYER };
}

export function isHandlingTime(value: unknown): value is HandlingTime {
  return value === "custom" || (HANDLING_TIME_PRESETS as readonly string[]).includes(String(value));
}

export function isReturnLabelPayerMode(value: unknown): value is ReturnLabelPayerMode {
  return (RETURN_LABEL_PAYER_MODES as readonly string[]).includes(String(value));
}

export function normalizeReasonPayers(raw: unknown): Record<ReturnLabelReason, ReasonLabelPayer> {
  const next = defaultReasonPayers();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return next;
  const record = raw as Record<string, unknown>;
  for (const reason of RETURN_LABEL_REASONS) {
    const value = record[reason];
    if (reason === "Other" && (value === "buyer" || value === "seller" || value === "later")) {
      next[reason] = value;
    } else if (value === "buyer" || value === "seller") {
      next[reason] = value;
    }
  }
  return next;
}

/** Older sellers only have the charge-return-shipping switch. */
export function policyFromStored(input: {
  handlingTime?: string | null;
  returnLabelPayer?: string | null;
  returnLabelPayerByReason?: unknown;
  chargeReturnShipping?: boolean | null;
}): SellerReturnLabelPolicy {
  return {
    handlingTime: isHandlingTime(input.handlingTime) ? input.handlingTime : null,
    returnLabelPayer: isReturnLabelPayerMode(input.returnLabelPayer)
      ? input.returnLabelPayer
      : input.chargeReturnShipping
        ? "buyer"
        : "seller",
    returnLabelPayerByReason: normalizeReasonPayers(input.returnLabelPayerByReason),
  };
}

export function chargeReturnShippingForMode(mode: ReturnLabelPayerMode): boolean {
  return mode === "buyer";
}

export function sellerPolicyName(input: {
  businessName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
}): string {
  const business = input.businessName?.trim();
  if (business) return business;
  const personal = [input.firstName, input.lastName].filter((part) => part?.trim()).join(" ").trim();
  return personal || "This seller";
}

export function freeShippingPolicyLead(offerFreeShippingOnInw: boolean | null | undefined): string | null {
  return offerFreeShippingOnInw ? "FREE SHIPPING" : null;
}

export function handlingTimeBoldLine(sellerName: string, handlingTime: HandlingTime | null): string | null {
  if (!handlingTime || handlingTime === "custom") return null;
  return `${sellerName} typically ships in ${handlingTime} business days.`;
}

export function showsFreeReturns(policy: SellerReturnLabelPolicy): boolean {
  return policy.returnLabelPayer === "seller";
}

export function reasonKey(reason: string | null | undefined): ReturnLabelReason | null {
  const raw = (reason ?? "").split(" | Note:")[0]?.trim() ?? "";
  const key = raw === "Other" || raw.startsWith("Other:") ? "Other" : raw;
  return (RETURN_LABEL_REASONS as readonly string[]).includes(key) ? (key as ReturnLabelReason) : null;
}

export function reasonGroupSelection(
  payers: Record<ReturnLabelReason, ReasonLabelPayer>,
  reasons: readonly ReturnLabelReason[]
): ReasonLabelPayer | "mixed" {
  const values = new Set(reasons.map((reason) => payers[reason]));
  if (values.size !== 1) return "mixed";
  return [...values][0];
}

export function applyReasonGroup(
  payers: Record<ReturnLabelReason, ReasonLabelPayer>,
  reasons: readonly ReturnLabelReason[],
  payer: ReasonLabelPayer
): Record<ReturnLabelReason, ReasonLabelPayer> {
  const next = { ...payers };
  for (const reason of reasons) next[reason] = payer;
  return next;
}

export function payerForReason(policy: SellerReturnLabelPolicy, reason: string | null | undefined): ReasonLabelPayer | null {
  if (policy.returnLabelPayer === "seller") return "seller";
  if (policy.returnLabelPayer === "buyer") return "buyer";
  const key = reasonKey(reason);
  return key ? policy.returnLabelPayerByReason[key] : null;
}

export function returnLabelChargesBuyer(
  policy: SellerReturnLabelPolicy,
  reason: string | null | undefined
): boolean {
  return payerForReason(policy, reason) === "buyer";
}

/** Seller chooses pay or deduct when sending the label. "Decide at that time" is included. */
export function returnLabelSellerChooses(
  policy: SellerReturnLabelPolicy,
  reason: string | null | undefined
): boolean {
  const payer = payerForReason(policy, reason);
  return payer === "buyer" || payer === "later";
}

export function buyerReturnShippingWarning(sellerName: string): string {
  return `${sellerName} doesn't offer free returns, and the return label cost will be deducted from your refund.`;
}

/** Shown after the buyer submits a return reason, before the request is sent. */
export function buyerReturnLabelFollowup(
  sellerName: string,
  policy: SellerReturnLabelPolicy,
  reason: string | null | undefined
): string {
  const payer = payerForReason(policy, reason);
  if (payer === "seller") {
    return `${sellerName} will send you a return label very soon!`;
  }
  if (payer === "later") {
    return `${sellerName} will decide who pays for the return label when they send it.`;
  }
  if (payer === "buyer") return buyerReturnShippingWarning(sellerName);
  return `${sellerName} does not charge you for the return label on this reason.`;
}

export function formatReturnLabelDeduction(cents: number): string {
  return `$${(Math.max(0, cents) / 100).toFixed(2)}`;
}
