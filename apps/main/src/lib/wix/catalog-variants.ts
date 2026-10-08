import type { WixJobHandlerResult } from "database";

type WixVariantFailure = Extract<WixJobHandlerResult, { outcome: "RETRY" | "DEAD" }>;
import { wixApplicationRequest } from "./client";
import type { WixAppConfig } from "./config";
import {
  WIX_V1_PRODUCT_GET,
  WIX_V1_VARIANTS_QUERY_SUFFIX,
  WIX_V1_VARIANTS_UPDATE_SUFFIX,
  WIX_V3_PRODUCTS,
} from "./constants";

export type WixRemoteVariant = {
  id?: string;
  sku?: string | null;
  choices?: unknown;
  visible?: boolean;
  priceData?: { price?: number | string };
  variant?: { priceData?: { price?: number | string }; sku?: string | null; visible?: boolean };
};

type QueryResponse = {
  variants?: unknown[];
  metadata?: { count?: number; total?: number };
};

/**
 * V1 keeps each Size × Color × Material row on the variants query, not on the product.
 * Fall back to the product payload when the query is empty (simple products).
 */
export async function loadWixCatalogVariants(input: {
  isV1: boolean;
  productId: string;
  fallback: WixRemoteVariant[];
  config: WixAppConfig;
  accessToken: string;
}): Promise<{ ok: true; variants: WixRemoteVariant[] } | { ok: false; failure: WixVariantFailure }> {
  if (!input.isV1) {
    return { ok: true, variants: input.fallback };
  }

  const collected: WixRemoteVariant[] = [];
  let offset = 0;
  const limit = 100;
  for (let page = 0; page < 3; page += 1) {
    const result = await wixApplicationRequest<QueryResponse>({
      method: "POST",
      path: `${WIX_V1_PRODUCT_GET}/${input.productId}${WIX_V1_VARIANTS_QUERY_SUFFIX}`,
      body: JSON.stringify({ query: { paging: { limit, offset } } }),
      deps: { config: input.config, accessToken: input.accessToken, maxAttempts: 2 },
    });
    if (!result.ok) {
      if (collected.length > 0) break;
      if (input.fallback.length > 0 && (result.class === "NOT_FOUND" || result.class === "VALIDATION")) {
        return { ok: true, variants: input.fallback };
      }
      if (result.class === "THROTTLED" || result.class === "TRANSIENT" || result.class === "NETWORK" || result.class === "AUTH") {
        return {
          ok: false,
          failure: {
            outcome: "RETRY",
            errorClass: result.class === "AUTH" ? "AUTH" : result.class,
            errorCode: result.class,
            errorMessage: result.message,
            retryAt: result.retryAfterMs ? new Date(Date.now() + result.retryAfterMs) : undefined,
          },
        };
      }
      if (input.fallback.length > 0) return { ok: true, variants: input.fallback };
      return {
        ok: false,
        failure: {
          outcome: "RETRY",
          errorClass: "TRANSIENT",
          errorCode: "VARIANT_MAP_INCOMPLETE",
          errorMessage: result.message || "Could not read Wix variants",
        },
      };
    }

    const batch = (result.data?.variants ?? []).map(normalizeWixVariant).filter((row) => row.id);
    collected.push(...batch);
    const total = result.data?.metadata?.total ?? result.data?.metadata?.count;
    offset += batch.length;
    if (batch.length < limit) break;
    if (total != null && offset >= total) break;
  }

  if (collected.length === 0 && input.fallback.length > 0) {
    return { ok: true, variants: input.fallback };
  }
  return { ok: true, variants: collected };
}

/** Write each combination's price, SKU, and visibility onto the V1 variant matrix. */
export async function pushWixV1VariantChoices(input: {
  productId: string;
  variants: Array<{
    options: Record<string, string>;
    priceCents: number;
    sku: string | null;
    visible?: boolean;
  }>;
  config: WixAppConfig;
  accessToken: string;
}): Promise<WixVariantFailure | null> {
  const rows = input.variants.filter((variant) => Object.keys(variant.options).length > 0);
  if (rows.length === 0) return null;
  const result = await wixApplicationRequest({
    method: "PATCH",
    path: `${WIX_V1_PRODUCT_GET}/${input.productId}${WIX_V1_VARIANTS_UPDATE_SUFFIX}`,
    body: JSON.stringify({
      variants: rows.map((variant) => ({
        choices: variant.options,
        price: Number((Math.max(0, variant.priceCents) / 100).toFixed(2)),
        ...(variant.sku ? { sku: variant.sku } : {}),
        visible: variant.visible !== false,
      })),
    }),
    deps: { config: input.config, accessToken: input.accessToken, maxAttempts: 1 },
  });
  if (result.ok) return null;
  if (result.class === "THROTTLED" || result.class === "TRANSIENT" || result.class === "NETWORK" || result.class === "AUTH") {
    return {
      outcome: "RETRY",
      errorClass: result.class === "AUTH" ? "AUTH" : result.class,
      errorCode: result.class,
      errorMessage: result.message,
      retryAt: result.retryAfterMs ? new Date(Date.now() + result.retryAfterMs) : undefined,
    };
  }
  return {
    outcome: "RETRY",
    errorClass: "TRANSIENT",
    errorCode: "VARIANT_MAP_INCOMPLETE",
    errorMessage: result.message || "Wix did not accept every option combination",
  };
}

/** Write combo prices on a Catalog V3 product without changing its option set. */
export async function pushWixV3VariantPrices(input: {
  productId: string;
  variants: Array<{
    wixVariantId: string;
    priceCents: number;
    sku: string | null;
    visible?: boolean;
  }>;
  config: WixAppConfig;
  accessToken: string;
}): Promise<WixVariantFailure | null> {
  const rows = input.variants.filter((variant) => variant.wixVariantId);
  if (rows.length === 0) return null;

  const read = async () =>
    wixApplicationRequest<{
      product?: {
        revision?: string | number;
        options?: unknown[];
        variantsInfo?: {
          variants?: Array<{
            id?: string;
            price?: { actualPrice?: { amount?: string } };
            priceData?: { price?: number | string };
          }>;
        };
      };
    }>({
      method: "GET",
      path: `${WIX_V3_PRODUCTS}/${input.productId}`,
      query: { fields: "VARIANT_OPTION_CHOICE_NAMES" },
      deps: { config: input.config, accessToken: input.accessToken, maxAttempts: 1 },
    });

  const current = await read();
  if (!current.ok || !current.data?.product?.revision) {
    return variantTransportFailure(current, "Wix product revision missing for a price update");
  }
  const product = current.data.product;
  const patch = await wixApplicationRequest({
    method: "PATCH",
    path: `${WIX_V3_PRODUCTS}/${input.productId}`,
    body: JSON.stringify({
      product: {
        id: input.productId,
        revision: String(product.revision),
        ...(product.options ? { options: product.options } : {}),
        variantsInfo: {
          variants: rows.map((variant) => ({
            id: variant.wixVariantId,
            visible: variant.visible !== false,
            ...(variant.sku ? { sku: variant.sku } : {}),
            price: { actualPrice: { amount: (Math.max(0, variant.priceCents) / 100).toFixed(2) } },
          })),
        },
      },
    }),
    deps: { config: input.config, accessToken: input.accessToken, maxAttempts: 1 },
  });
  if (!patch.ok) return variantTransportFailure(patch, "Wix did not accept the variant prices");

  const confirmed = await read();
  if (!confirmed.ok || !confirmed.data?.product) {
    return variantTransportFailure(confirmed, "Could not read Wix variant prices back");
  }
  const byId = new Map(
    (confirmed.data.product.variantsInfo?.variants ?? [])
      .filter((variant) => variant.id)
      .map((variant) => [variant.id as string, variant])
  );
  for (const row of rows) {
    const remote = byId.get(row.wixVariantId);
    const amount = remote?.price?.actualPrice?.amount ?? remote?.priceData?.price;
    const cents = amount == null ? null : Math.round(Number(amount) * 100);
    if (cents == null || Math.abs(cents - row.priceCents) > 1) {
      return {
        outcome: "RETRY",
        errorClass: "TRANSIENT",
        errorCode: "VARIANT_PRICE_MISMATCH",
        errorMessage: "Wix variant prices did not match INW",
      };
    }
  }
  return null;
}

function variantTransportFailure(
  result: { ok: boolean; class?: string; message?: string; retryAfterMs?: number | null },
  fallback: string
): WixVariantFailure {
  const errorClass = result.class ?? "TRANSIENT";
  if (errorClass === "THROTTLED" || errorClass === "TRANSIENT" || errorClass === "NETWORK" || errorClass === "AUTH") {
    return {
      outcome: "RETRY",
      errorClass: errorClass === "AUTH" ? "AUTH" : errorClass,
      errorCode: errorClass,
      errorMessage: result.message || fallback,
      retryAt: result.retryAfterMs ? new Date(Date.now() + result.retryAfterMs) : undefined,
    };
  }
  return {
    outcome: "RETRY",
    errorClass: "TRANSIENT",
    errorCode: "VARIANT_MAP_INCOMPLETE",
    errorMessage: result.message || fallback,
  };
}

function normalizeWixVariant(value: unknown): WixRemoteVariant {
  const row = asRecord(value);
  if (!row) return {};
  const nested = asRecord(row.variant);
  const priceData = asRecord(row.priceData) ?? asRecord(nested?.priceData);
  const sku =
    typeof nested?.sku === "string"
      ? nested.sku
      : typeof row.sku === "string"
        ? row.sku
        : null;
  const visible =
    typeof row.visible === "boolean"
      ? row.visible
      : typeof nested?.visible === "boolean"
        ? nested.visible
        : undefined;
  return {
    id: typeof row.id === "string" ? row.id : typeof nested?.id === "string" ? nested.id : undefined,
    sku,
    choices: row.choices,
    visible,
    priceData: priceData
      ? { price: priceData.price as number | string | undefined }
      : undefined,
    variant: nested
      ? {
          sku,
          visible,
          priceData: priceData ? { price: priceData.price as number | string | undefined } : undefined,
        }
      : undefined,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}
