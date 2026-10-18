export const HANDLING_TIME_PRESETS = ["1-2", "2-3", "3-4", "4-5"] as const;
export type HandlingTimePreset = (typeof HANDLING_TIME_PRESETS)[number];
export type HandlingTime = HandlingTimePreset | "custom";

export const RETURN_LABEL_PAYER_MODES = ["seller", "buyer", "by_reason"] as const;
export type ReturnLabelPayerMode = (typeof RETURN_LABEL_PAYER_MODES)[number];
export type ReasonLabelPayer = "buyer" | "seller";

export const RETURN_LABEL_REASONS = [
  "Changed my mind",
  "Didn't mean to order",
  "Order Arrived Damaged",
  "Wrong Item Delivered",
  "Other",
] as const;

export type ReturnLabelReason = (typeof RETURN_LABEL_REASONS)[number];

const DEFAULT_REASON_PAYER: Record<ReturnLabelReason, ReasonLabelPayer> = {
  "Changed my mind": "buyer",
  "Didn't mean to order": "buyer",
  "Order Arrived Damaged": "seller",
  "Wrong Item Delivered": "seller",
  Other: "buyer",
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
    if (value === "buyer" || value === "seller") next[reason] = value;
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

export function handlingTimeBoldLine(sellerName: string, handlingTime: HandlingTime | null): string | null {
  if (!handlingTime || handlingTime === "custom") return null;
  return `${sellerName} typically ships in ${handlingTime} business days.`;
}

export function showsFreeReturns(policy: SellerReturnLabelPolicy): boolean {
  return policy.returnLabelPayer === "seller";
}

export function returnLabelChargesBuyer(
  policy: SellerReturnLabelPolicy,
  reason: string | null | undefined
): boolean {
  if (policy.returnLabelPayer === "seller") return false;
  if (policy.returnLabelPayer === "buyer") return true;
  const raw = reason?.trim() ?? "";
  const key = raw === "Other" || raw.startsWith("Other:") ? "Other" : raw;
  if ((RETURN_LABEL_REASONS as readonly string[]).includes(key)) {
    return policy.returnLabelPayerByReason[key as ReturnLabelReason] === "buyer";
  }
  return false;
}

export function buyerReturnShippingWarning(sellerName: string): string {
  return `${sellerName} doesn't offer free returns, and the return label cost will be deducted from your refund.`;
}

export function formatReturnLabelDeduction(cents: number): string {
  return `$${(Math.max(0, cents) / 100).toFixed(2)}`;
}
