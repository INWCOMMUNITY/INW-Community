import type { WixJobHandlerResult } from "database";

type WixVariantFailure = Extract<WixJobHandlerResult, { outcome: "RETRY" | "DEAD" }>;
import { wixApplicationRequest } from "./client";
import type { WixAppConfig } from "./config";
import { WIX_V1_PRODUCT_GET, WIX_V1_VARIANTS_QUERY_SUFFIX, WIX_V1_VARIANTS_UPDATE_SUFFIX } from "./constants";

export type WixRemoteVariant = {
  id?: string;
  sku?: string | null;
  choices?: unknown;
  priceData?: { price?: number | string };
  variant?: { priceData?: { price?: number | string }; sku?: string | null };
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

/** Write each INW combination, including a third option axis, onto the V1 variant matrix. */
export async function pushWixV1VariantChoices(input: {
  productId: string;
  variants: Array<{ options: Record<string, string>; priceCents: number; sku: string | null }>;
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
        visible: true,
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
  return {
    id: typeof row.id === "string" ? row.id : typeof nested?.id === "string" ? nested.id : undefined,
    sku,
    choices: row.choices,
    priceData: priceData
      ? { price: priceData.price as number | string | undefined }
      : undefined,
    variant: nested
      ? {
          sku,
          priceData: priceData ? { price: priceData.price as number | string | undefined } : undefined,
        }
      : undefined,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}
