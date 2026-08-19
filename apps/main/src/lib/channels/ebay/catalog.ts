import { ebayGet } from "./client";
import { EBAY_MARKETPLACE_ID } from "./config";
import { withEbayApplicationTokenRetry } from "./oauth";

export type EbayCatalogMatch = {
  epid?: string;
  title?: string;
  gtin?: string[];
};

type CatalogSearchResponse = {
  productSummaries?: {
    epid?: string;
    title?: string;
    gtin?: string[];
  }[];
};

export async function searchCatalogProduct(args: {
  query: string;
  categoryId?: string | null;
  gtin?: string | null;
}): Promise<EbayCatalogMatch | null> {
  const query = args.query.trim();
  const gtin = args.gtin?.trim();
  if (!query && !gtin) return null;

  const params = new URLSearchParams({ marketplace_id: EBAY_MARKETPLACE_ID });
  if (gtin) params.set("gtin", gtin);
  else params.set("q", query);
  if (args.categoryId?.trim()) params.set("category_ids", args.categoryId.trim());

  const res = await withEbayApplicationTokenRetry((token) =>
    ebayGet<CatalogSearchResponse>(
      token,
      `/commerce/catalog/v1_beta/product_summary/search?${params.toString()}`
    )
  );

  const first = res.productSummaries?.[0];
  if (!first?.epid) return null;
  return {
    epid: first.epid,
    title: first.title,
    gtin: first.gtin,
  };
}

export function applyCatalogProductToInventoryBody(
  body: Record<string, unknown>,
  match: EbayCatalogMatch | null
): Record<string, unknown> {
  if (!match?.epid) return body;
  const product =
    body.product && typeof body.product === "object"
      ? ({ ...(body.product as Record<string, unknown>) } as Record<string, unknown>)
      : {};
  product.epid = match.epid;
  return { ...body, product };
}

/** Best-effort catalog lookup for create-path inventory bodies. */
export async function enrichInventoryBodyWithCatalogProduct(args: {
  itemTitle: string;
  categoryId?: string | null;
  gtin?: string | null;
  body: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
  try {
    const match = await searchCatalogProduct({
      query: args.itemTitle,
      categoryId: args.categoryId,
      gtin: args.gtin,
    });
    return applyCatalogProductToInventoryBody(args.body, match);
  } catch (e) {
    console.warn("[ebay] catalog search failed; continuing without ePID", {
      categoryId: args.categoryId,
      error: e instanceof Error ? e.message : String(e),
    });
    return args.body;
  }
}
