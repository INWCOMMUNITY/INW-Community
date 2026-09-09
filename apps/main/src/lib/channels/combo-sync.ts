import { CHANNEL_PROVIDER_LABELS } from "./provider-ui";
import { variantsToMatrix } from "./variant-sync";
import type { VariantMatrix } from "@/lib/listing-variant-matrix";

export class IncompleteChannelListingError extends Error {
  readonly externalListingId: string;
  readonly rolledBack: boolean;

  constructor(message: string, externalListingId: string, rolledBack = false) {
    super(message);
    this.name = "IncompleteChannelListingError";
    this.externalListingId = externalListingId;
    this.rolledBack = rolledBack;
  }
}

export function comboInventoryFailedMessage(provider: string): string {
  const label = CHANNEL_PROVIDER_LABELS[provider] ?? provider;
  return `INW combinations did not update on ${label} — quantities were not applied per Size × Color`;
}

export function isComboInventoryFailedError(message: string | null | undefined): boolean {
  const text = message ?? "";
  return /INW combinations did not update/i.test(text) || /quantities were not applied per Size/i.test(text);
}

export function expectedComboSkuCount(variants: unknown): number {
  return variantsToMatrix(variants)?.skus.length ?? 0;
}

/** Rebuild Etsy inventory instead of patching a Color-only product list. */
export function shouldRebuildEtsyComboInventory(
  matrix: VariantMatrix | null,
  existingProductCount: number
): boolean {
  if (!matrix || matrix.axes.length < 2 || matrix.skus.length <= 1) return false;
  return existingProductCount !== matrix.skus.length || existingProductCount <= 1;
}

export function isIncompleteChannelListingError(
  error: unknown
): error is IncompleteChannelListingError {
  return error instanceof IncompleteChannelListingError;
}
