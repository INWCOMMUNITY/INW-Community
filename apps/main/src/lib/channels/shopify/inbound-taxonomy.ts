import { shopifyGraphql } from "./client";

export type ShopifyProductTaxonomyHint = {
  fullName: string;
  gid: string | null;
};

const PRODUCTS_CATEGORY_QUERY = `
  query InboundProductCategories($cursor: String) {
    products(first: 250, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        legacyResourceId
        category { id name fullName }
      }
    }
  }
`;

const PRODUCT_CATEGORY_QUERY = `
  query InboundProductCategory($id: ID!) {
    product(id: $id) {
      category { id name fullName }
    }
  }
`;

type TaxonomyNode = { id?: string | null; name?: string | null; fullName?: string | null };

type ProductsCategoryData = {
  products?: {
    pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
    nodes?: {
      id?: string | null;
      legacyResourceId?: string | number | null;
      category?: TaxonomyNode | null;
    }[];
  };
};

type ProductCategoryData = {
  product?: { category?: TaxonomyNode | null } | null;
};

function hintFromCategory(category: TaxonomyNode | null | undefined): ShopifyProductTaxonomyHint | null {
  const fullName = category?.fullName?.trim() || category?.name?.trim() || "";
  if (!fullName) return null;
  return { fullName, gid: category?.id?.trim() || null };
}

function restIdFromNode(node: {
  id?: string | null;
  legacyResourceId?: string | number | null;
}): string | null {
  if (node.legacyResourceId != null && String(node.legacyResourceId).trim()) {
    return String(node.legacyResourceId).trim();
  }
  const gid = node.id?.trim() ?? "";
  const match = gid.match(/\/Product\/(\d+)\s*$/);
  return match?.[1] ?? null;
}

/**
 * Shopify Admin Category (Standard Product Taxonomy) is GraphQL-only.
 * REST products.json exposes product_type/tags, not category.fullName.
 */
export async function fetchShopifyProductTaxonomyMaps(
  accessToken: string,
  shop: string,
  apiVersion: string
): Promise<Map<string, ShopifyProductTaxonomyHint>> {
  const out = new Map<string, ShopifyProductTaxonomyHint>();
  let cursor: string | null = null;
  try {
    for (let page = 0; page < 20; page += 1) {
      const data: ProductsCategoryData = await shopifyGraphql<ProductsCategoryData>(
        accessToken,
        shop,
        apiVersion,
        PRODUCTS_CATEGORY_QUERY,
        cursor ? { cursor } : undefined
      );
      for (const node of data.products?.nodes ?? []) {
        const id = restIdFromNode(node);
        const hint = hintFromCategory(node.category);
        if (id && hint) out.set(id, hint);
      }
      if (!data.products?.pageInfo?.hasNextPage || !data.products.pageInfo.endCursor) break;
      cursor = data.products.pageInfo.endCursor;
    }
  } catch (e) {
    console.warn("[shopify] inbound taxonomy fetch failed", {
      error: e instanceof Error ? e.message : String(e),
    });
  }
  return out;
}

export async function fetchShopifyProductTaxonomyHint(
  accessToken: string,
  shop: string,
  apiVersion: string,
  productId: string
): Promise<ShopifyProductTaxonomyHint | null> {
  const id = productId.trim();
  if (!id) return null;
  const gid = id.startsWith("gid://") ? id : `gid://shopify/Product/${id}`;
  try {
    const data: ProductCategoryData = await shopifyGraphql<ProductCategoryData>(
      accessToken,
      shop,
      apiVersion,
      PRODUCT_CATEGORY_QUERY,
      { id: gid }
    );
    return hintFromCategory(data.product?.category);
  } catch (e) {
    console.warn("[shopify] inbound product taxonomy fetch failed", {
      productId: id,
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}
