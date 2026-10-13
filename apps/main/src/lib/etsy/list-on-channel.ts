import type { EtsyHowItsMadeFormValue } from "@/components/etsy/EtsyHowItsMadeFields";

export type EtsyListOnChannelValidation =
  | { ok: true }
  | { ok: false; error: string };

/** Client-side validation before PATCH etsy-attributes + POST create. */
export function validateEtsyListOnChannelForm(input: {
  howItsMade: EtsyHowItsMadeFormValue;
  inventoryTracking?: string | null;
}): EtsyListOnChannelValidation {
  if (!input.howItsMade.etsyWhoMade) {
    return { ok: false, error: "Choose who made it." };
  }
  if (input.howItsMade.etsyIsSupply !== true && input.howItsMade.etsyIsSupply !== false) {
    return {
      ok: false,
      error: "Choose whether this is a finished product or a supply/tool.",
    };
  }
  const madeToOrder = input.inventoryTracking === "made_to_order";
  if (!madeToOrder && !input.howItsMade.etsyWhenMade) {
    return { ok: false, error: "Choose when it was made." };
  }
  return { ok: true };
}

/** Body for PATCH /api/store-items/[id]/etsy-attributes before create. */
export function buildEtsyListAttributesBody(input: {
  howItsMade: EtsyHowItsMadeFormValue;
  inventoryTracking?: string | null;
}): Record<string, unknown> {
  const madeToOrder = input.inventoryTracking === "made_to_order";
  const taxonomy = input.howItsMade.etsyTaxonomyId.trim();
  return {
    etsyWhoMade: input.howItsMade.etsyWhoMade,
    etsyWhenMade: madeToOrder ? "made_to_order" : input.howItsMade.etsyWhenMade || null,
    etsyIsSupply: input.howItsMade.etsyIsSupply,
    ...(taxonomy && /^\d+$/.test(taxonomy)
      ? { etsyTaxonomyId: Number.parseInt(taxonomy, 10) }
      : {}),
  };
}
