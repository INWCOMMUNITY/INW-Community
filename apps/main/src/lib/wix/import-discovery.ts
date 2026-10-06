import {
  lookupWixListingByRemoteId,
  prisma,
  type WixMappingDb,
  type WixPublicConnection,
} from "database";
import { readWixAppConfig } from "./config";
import { accessTokenForWixConnection } from "./connect";
import { wixApplicationRequest, type WixFetch } from "./client";
import {
  WIX_V1_PRODUCTS_QUERY,
  WIX_V3_PRODUCTS,
  WIX_CATALOG_V1,
} from "./constants";

export type WixImportCandidate = {
  wixProductId: string;
  name: string;
  description: string | null;
  price: number;
  currency: string;
  photos: string[];
  visible: boolean;
  hasVariants: boolean;
  variantCount: number;
  totalQuantity: number | null;
  sku: string | null;
  alreadyLinked: boolean;
  linkedStoreItemId: string | null;
};

export type ListWixImportCandidatesResult = {
  candidates: WixImportCandidate[];
  hasMore: boolean;
  nextCursor: string | null;
};

type WixV1Product = {
  id?: string;
  name?: string;
  description?: string;
  priceData?: { price?: number; currency?: string };
  media?: { mainMedia?: { image?: { url?: string } }; items?: Array<{ image?: { url?: string } }> };
  visible?: boolean;
  productOptions?: Array<{ choices?: unknown[] }>;
  variants?: unknown[];
  stock?: { quantity?: number; trackQuantity?: boolean };
  sku?: string;
};

type WixV3Product = {
  id?: string;
  name?: string;
  description?: string;
  priceData?: { price?: string; currency?: string };
  media?: { mainMedia?: { image?: { url?: string } }; items?: Array<{ image?: { url?: string } }> };
  visible?: boolean;
  productOptions?: Array<{ choices?: unknown[] }>;
  variants?: Array<{ id?: string }>;
  stock?: { quantity?: number; trackInventory?: boolean };
  sku?: string;
};

function parseWixV1Product(product: WixV1Product): Omit<WixImportCandidate, "alreadyLinked" | "linkedStoreItemId"> | null {
  if (!product.id || !product.name) return null;

  const photos: string[] = [];
  if (product.media?.mainMedia?.image?.url) {
    photos.push(product.media.mainMedia.image.url);
  }
  if (product.media?.items) {
    for (const item of product.media.items) {
      if (item.image?.url && !photos.includes(item.image.url)) {
        photos.push(item.image.url);
      }
    }
  }

  const hasOptions = (product.productOptions?.length ?? 0) > 0;
  const variantCount = hasOptions ? (product.variants?.length ?? 1) : 1;

  return {
    wixProductId: product.id,
    name: product.name,
    description: product.description || null,
    price: product.priceData?.price ?? 0,
    currency: product.priceData?.currency ?? "USD",
    photos,
    visible: product.visible ?? true,
    hasVariants: hasOptions,
    variantCount,
    totalQuantity: product.stock?.trackQuantity ? (product.stock?.quantity ?? null) : null,
    sku: product.sku || null,
  };
}

function parseWixV3Product(product: WixV3Product): Omit<WixImportCandidate, "alreadyLinked" | "linkedStoreItemId"> | null {
  if (!product.id || !product.name) return null;

  const photos: string[] = [];
  if (product.media?.mainMedia?.image?.url) {
    photos.push(product.media.mainMedia.image.url);
  }
  if (product.media?.items) {
    for (const item of product.media.items) {
      if (item.image?.url && !photos.includes(item.image.url)) {
        photos.push(item.image.url);
      }
    }
  }

  const hasOptions = (product.productOptions?.length ?? 0) > 0;
  const variantCount = hasOptions ? (product.variants?.length ?? 1) : 1;

  // V3 price is a string
  const priceStr = product.priceData?.price;
  const price = priceStr ? parseFloat(priceStr) : 0;

  return {
    wixProductId: product.id,
    name: product.name,
    description: product.description || null,
    price: Number.isFinite(price) ? price : 0,
    currency: product.priceData?.currency ?? "USD",
    photos,
    visible: product.visible ?? true,
    hasVariants: hasOptions,
    variantCount,
    totalQuantity: product.stock?.trackInventory ? (product.stock?.quantity ?? null) : null,
    sku: product.sku || null,
  };
}

/**
 * List import candidates from Wix for a connection.
 * Handles both V1 and V3 catalog versions.
 */
export async function listWixImportCandidates(
  connection: WixPublicConnection,
  options?: {
    limit?: number;
    cursor?: string;
    includeHidden?: boolean;
    fetchImpl?: WixFetch;
  }
): Promise<ListWixImportCandidatesResult> {
  const config = readWixAppConfig();
  if (!config) {
    throw new Error("Wix is not configured");
  }

  const accessToken = await accessTokenForWixConnection(connection);
  const limit = options?.limit ?? 50;
  const isV1 = connection.catalogVersion === WIX_CATALOG_V1;

  let products: Array<Omit<WixImportCandidate, "alreadyLinked" | "linkedStoreItemId">> = [];
  let nextCursor: string | null = null;

  if (isV1) {
    // V1 Catalog: POST query
    const query: Record<string, unknown> = {
      query: {
        paging: { limit, offset: options?.cursor ? parseInt(options.cursor, 10) : 0 },
      },
    };
    if (!options?.includeHidden) {
      query.query = { ...query.query as Record<string, unknown>, filter: { visible: true } };
    }

    const result = await wixApplicationRequest<{ products?: WixV1Product[]; totalResults?: number }>({
      method: "POST",
      path: WIX_V1_PRODUCTS_QUERY,
      body: JSON.stringify(query),
      deps: { config, accessToken, fetchImpl: options?.fetchImpl },
    });

    if (!result.ok || !result.data?.products) {
      throw new Error(result.message || "Failed to fetch Wix products");
    }

    products = result.data.products
      .map(parseWixV1Product)
      .filter((p): p is NonNullable<typeof p> => p !== null);

    // V1 uses offset-based paging
    const offset = options?.cursor ? parseInt(options.cursor, 10) : 0;
    const total = result.data.totalResults ?? 0;
    if (offset + limit < total) {
      nextCursor = String(offset + limit);
    }
  } else {
    // V3 Catalog: GET with query params
    const queryParams: Record<string, string> = {
      limit: String(limit),
    };
    if (options?.cursor) {
      queryParams.cursor = options.cursor;
    }

    const result = await wixApplicationRequest<{
      products?: WixV3Product[];
      metadata?: { cursors?: { next?: string } };
    }>({
      method: "GET",
      path: WIX_V3_PRODUCTS,
      query: queryParams,
      deps: { config, accessToken, fetchImpl: options?.fetchImpl },
    });

    if (!result.ok || !result.data?.products) {
      throw new Error(result.message || "Failed to fetch Wix products");
    }

    const allProducts = result.data.products
      .map(parseWixV3Product)
      .filter((p): p is NonNullable<typeof p> => p !== null);

    // Filter out hidden if not requested
    products = options?.includeHidden
      ? allProducts
      : allProducts.filter((p) => p.visible);

    nextCursor = result.data.metadata?.cursors?.next ?? null;
  }

  // Check which products are already linked
  const candidates: WixImportCandidate[] = [];
  for (const product of products) {
    const existing = await lookupWixListingByRemoteId(prisma, connection.id, product.wixProductId);
    candidates.push({
      ...product,
      alreadyLinked: existing !== null,
      linkedStoreItemId: existing?.listingLink.storeItemId ?? null,
    });
  }

  return {
    candidates,
    hasMore: nextCursor !== null,
    nextCursor,
  };
}

/**
 * Get a single Wix product by ID for import.
 */
export async function getWixProductForImport(
  connection: WixPublicConnection,
  wixProductId: string,
  options?: { fetchImpl?: WixFetch }
): Promise<WixImportCandidate | null> {
  const config = readWixAppConfig();
  if (!config) {
    throw new Error("Wix is not configured");
  }

  const accessToken = await accessTokenForWixConnection(connection);
  const isV1 = connection.catalogVersion === WIX_CATALOG_V1;

  let product: Omit<WixImportCandidate, "alreadyLinked" | "linkedStoreItemId"> | null = null;

  if (isV1) {
    const result = await wixApplicationRequest<{ product?: WixV1Product }>({
      method: "GET",
      path: `${WIX_V1_PRODUCTS_QUERY.replace("/query", "")}/${wixProductId}`,
      deps: { config, accessToken, fetchImpl: options?.fetchImpl },
    });

    if (!result.ok || !result.data?.product) {
      return null;
    }

    product = parseWixV1Product(result.data.product);
  } else {
    const result = await wixApplicationRequest<{ product?: WixV3Product }>({
      method: "GET",
      path: `${WIX_V3_PRODUCTS}/${wixProductId}`,
      deps: { config, accessToken, fetchImpl: options?.fetchImpl },
    });

    if (!result.ok || !result.data?.product) {
      return null;
    }

    product = parseWixV3Product(result.data.product);
  }

  if (!product) return null;

  const existing = await lookupWixListingByRemoteId(prisma, connection.id, product.wixProductId);
  return {
    ...product,
    alreadyLinked: existing !== null,
    linkedStoreItemId: existing?.listingLink.storeItemId ?? null,
  };
}
