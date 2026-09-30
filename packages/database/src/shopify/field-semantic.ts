import { classifyShopifyContentSemantics, type ShopifyContentSemanticClass } from "./content-semantic";

/**
 * Semantic field keys for adaptive Shopify ↔ INW content sync.
 * Inventory / publication / variant topology are intentionally excluded.
 */
/** App-level field keys (mirrors Prisma ShopifyContentFieldKey enum values). */
export type ShopifyAdaptiveFieldKey =
  | "TITLE"
  | "DESCRIPTION"
  | "MEDIA"
  | "VENDOR"
  | "TAGS"
  | "ASPECTS"
  | "PRICE"
  | "SKU"
  | "BARCODE"
  | "COMPARE_AT";

export const SHOPIFY_PRODUCT_FIELD_KEYS: ShopifyAdaptiveFieldKey[] = [
  "TITLE",
  "DESCRIPTION",
  "MEDIA",
  "VENDOR",
  "TAGS",
  "ASPECTS",
];

export const SHOPIFY_VARIANT_FIELD_KEYS: ShopifyAdaptiveFieldKey[] = [
  "PRICE",
  "SKU",
  "BARCODE",
  "COMPARE_AT",
];

export type ShopifyFieldSemanticAction =
  | "UNCHANGED"
  | "CONVERGED"
  | "PUSH_LOCAL"
  | "PULL_REMOTE"
  | "CONFLICT";

export type ShopifyFieldObservation = {
  field: ShopifyAdaptiveFieldKey;
  /** Empty string for product-scoped fields. */
  storeVariantId?: string;
  base: string | null;
  local: string;
  remote: string;
  hasLocalSemanticEdit?: boolean;
};

export type ShopifyFieldPlan = {
  field: ShopifyAdaptiveFieldKey;
  storeVariantId: string;
  class: ShopifyContentSemanticClass;
  action: ShopifyFieldSemanticAction;
  base: string | null;
  local: string;
  remote: string;
};

function actionFromClass(cls: ShopifyContentSemanticClass): ShopifyFieldSemanticAction {
  switch (cls) {
    case "UNCHANGED":
      return "UNCHANGED";
    case "CONVERGED":
      return "CONVERGED";
    case "LOCAL_ONLY":
      return "PUSH_LOCAL";
    case "REMOTE_ONLY":
      return "PULL_REMOTE";
    case "CONFLICT":
      return "CONFLICT";
  }
}

/**
 * Plan per-field convergence. Independent fields merge; same-field dual divergence conflicts.
 * Never uses wall-clock or webhook arrival order.
 */
export function planShopifyFieldLevelSync(fields: ShopifyFieldObservation[]): {
  plans: ShopifyFieldPlan[];
  anyConflict: boolean;
  pushFields: ShopifyFieldPlan[];
  pullFields: ShopifyFieldPlan[];
  convergeFields: ShopifyFieldPlan[];
} {
  const plans: ShopifyFieldPlan[] = fields.map((row) => {
    const cls = classifyShopifyContentSemantics({
      base: row.base,
      local: row.local,
      remote: row.remote,
      hasLocalSemanticEdit: row.hasLocalSemanticEdit,
    });
    return {
      field: row.field,
      storeVariantId: row.storeVariantId ?? "",
      class: cls,
      action: actionFromClass(cls),
      base: row.base,
      local: row.local,
      remote: row.remote,
    };
  });

  return {
    plans,
    anyConflict: plans.some((p) => p.action === "CONFLICT"),
    pushFields: plans.filter((p) => p.action === "PUSH_LOCAL"),
    pullFields: plans.filter((p) => p.action === "PULL_REMOTE"),
    convergeFields: plans.filter((p) => p.action === "CONVERGED" || p.action === "UNCHANGED"),
  };
}
