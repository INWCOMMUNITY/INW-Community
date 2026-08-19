import { ebayJson } from "./client";
import { formatEbayApiBody } from "./errors";

export type EbayListingFeeRow = {
  offerId?: string;
  feeSummary?: {
    totalFeeAmount?: { value?: string; currency?: string };
  };
  errors?: unknown[];
  warnings?: unknown[];
};

export async function getListingFees(
  accessToken: string,
  offerIds: string[]
): Promise<EbayListingFeeRow[]> {
  const ids = offerIds.map((id) => id.trim()).filter(Boolean);
  if (ids.length === 0) return [];
  const res = await ebayJson<{ fees?: EbayListingFeeRow[] }>(
    accessToken,
    "/sell/inventory/v1/offer/get_listing_fees",
    "POST",
    { offers: ids.map((offerId) => ({ offerId })) }
  );
  return res.fees ?? [];
}

export function formatListingFeeSummary(fees: EbayListingFeeRow[]): string | null {
  const row = fees[0];
  const amount = row?.feeSummary?.totalFeeAmount?.value?.trim();
  const currency = row?.feeSummary?.totalFeeAmount?.currency?.trim() || "USD";
  if (!amount) return null;
  return `Estimated listing fee: ${currency} ${amount}`;
}

export function getListingFeeBlockReason(fees: EbayListingFeeRow[]): string | null {
  for (const row of fees) {
    if (Array.isArray(row.errors) && row.errors.length > 0) {
      return formatEbayApiBody({ errors: row.errors as never[] }, 400) || "Listing fee check failed.";
    }
  }
  return null;
}
