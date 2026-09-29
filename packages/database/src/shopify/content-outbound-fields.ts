import {
  shopifyDescriptionFieldFingerprint,
  shopifyFieldFingerprint,
} from "./field-fingerprint";
import { planShopifyFieldLevelSync, type ShopifyFieldPlan } from "./field-semantic";

export type ShopifyOutboundFieldPlan = {
  plans: ShopifyFieldPlan[];
  pushTitle: boolean;
  pushDescription: boolean;
  pushPrice: boolean;
  pushSku: boolean;
  productConflict: boolean;
  variantConflict: boolean;
  productConverged: boolean;
  variantConverged: boolean;
  /** True when any product field needs a Shopify mutation. */
  needsProductMutation: boolean;
  /** True when any variant field needs a Shopify mutation. */
  needsVariantMutation: boolean;
};

/**
 * Field-level outbound plan for TITLE / DESCRIPTION / PRICE / SKU.
 * Independent fields push; same-field dual divergence conflicts without clocks.
 */
export function planShopifyOutboundContentFields(input: {
  title: { base: string | null; local: string; remote: string; hasLocalSemanticEdit: boolean };
  description: {
    base: string | null;
    local: string | null;
    remote: string | null;
    hasLocalSemanticEdit: boolean;
  };
  price: {
    storeVariantId: string;
    base: string | null;
    localCents: number;
    remoteCents: number;
    hasLocalSemanticEdit: boolean;
  };
  sku: {
    storeVariantId: string;
    base: string | null;
    local: string | null;
    remote: string | null;
    hasLocalSemanticEdit: boolean;
  };
}): ShopifyOutboundFieldPlan {
  const titleLocal = shopifyFieldFingerprint("TITLE", input.title.local);
  const titleRemote = shopifyFieldFingerprint("TITLE", input.title.remote);
  const descLocal = shopifyDescriptionFieldFingerprint(input.description.local);
  const descRemote = shopifyDescriptionFieldFingerprint(input.description.remote);
  const priceLocal = shopifyFieldFingerprint("PRICE", input.price.localCents);
  const priceRemote = shopifyFieldFingerprint("PRICE", input.price.remoteCents);
  const skuLocal = shopifyFieldFingerprint("SKU", input.sku.local);
  const skuRemote = shopifyFieldFingerprint("SKU", input.sku.remote);

  const { plans, pushFields } = planShopifyFieldLevelSync([
    {
      field: "TITLE",
      base: input.title.base,
      local: titleLocal,
      remote: titleRemote,
      hasLocalSemanticEdit: input.title.hasLocalSemanticEdit,
    },
    {
      field: "DESCRIPTION",
      base: input.description.base,
      local: descLocal,
      remote: descRemote,
      hasLocalSemanticEdit: input.description.hasLocalSemanticEdit,
    },
    {
      field: "PRICE",
      storeVariantId: input.price.storeVariantId,
      base: input.price.base,
      local: priceLocal,
      remote: priceRemote,
      hasLocalSemanticEdit: input.price.hasLocalSemanticEdit,
    },
    {
      field: "SKU",
      storeVariantId: input.sku.storeVariantId,
      base: input.sku.base,
      local: skuLocal,
      remote: skuRemote,
      hasLocalSemanticEdit: input.sku.hasLocalSemanticEdit,
    },
  ]);

  const pushTitle = pushFields.some((p) => p.field === "TITLE");
  const pushDescription = pushFields.some((p) => p.field === "DESCRIPTION");
  const pushPrice = pushFields.some((p) => p.field === "PRICE");
  const pushSku = pushFields.some((p) => p.field === "SKU");
  const productConflict = plans.some(
    (p) => (p.field === "TITLE" || p.field === "DESCRIPTION") && p.action === "CONFLICT"
  );
  const variantConflict = plans.some(
    (p) => (p.field === "PRICE" || p.field === "SKU") && p.action === "CONFLICT"
  );
  const productConverged = plans
    .filter((p) => p.field === "TITLE" || p.field === "DESCRIPTION")
    .every((p) => p.action === "CONVERGED" || p.action === "UNCHANGED");
  const variantConverged = plans
    .filter((p) => p.field === "PRICE" || p.field === "SKU")
    .every((p) => p.action === "CONVERGED" || p.action === "UNCHANGED");

  return {
    plans,
    pushTitle,
    pushDescription,
    pushPrice,
    pushSku,
    productConflict,
    variantConflict,
    productConverged,
    variantConverged,
    needsProductMutation: pushTitle || pushDescription,
    needsVariantMutation: pushPrice || pushSku,
  };
}
