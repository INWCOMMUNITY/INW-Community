import {
  lookupWixListingByRemoteId,
  prisma,
  type WixPublicConnection,
} from "database";
import { readWixAppConfig } from "./config";
import { accessTokenForWixConnection } from "./connect";
import { wixApplicationRequest, type WixApiResult, type WixFetch } from "./client";
import {
  WIX_V1_PRODUCTS_QUERY,
  WIX_V1_PRODUCT_GET,
  WIX_V3_PRODUCTS,
  WIX_V3_PRODUCTS_QUERY,
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

export class WixImportDiscoveryError extends Error {
  constructor(
    message: string,
    readonly code:
      | "NOT_CONFIGURED"
      | "TOKEN"
      | "CATALOG"
      | "PERMISSION"
      | "TRANSIENT"
      | "UNKNOWN" = "UNKNOWN"
  ) {
    super(message);
    this.name = "WixImportDiscoveryError";
  }
}

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

function parseWixV1Product(
  product: WixV1Product
): Omit<WixImportCandidate, "alreadyLinked" | "linkedStoreItemId"> | null {
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

function parseWixV3Product(
  product: WixV3Product
): Omit<WixImportCandidate, "alreadyLinked" | "linkedStoreItemId"> | null {
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

function classifyDiscoveryFailure(result: WixApiResult): WixImportDiscoveryError {
  if (result.class === "AUTH") {
    return new WixImportDiscoveryError(
      "Wix did not allow reading products. Check app permissions include Read Products.",
      "PERMISSION"
    );
  }
  if (result.class === "CATALOG_VERSION_MISMATCH") {
    return new WixImportDiscoveryError(
      "This Wix site uses a different catalog API than expected. Try reconnecting Wix.",
      "CATALOG"
    );
  }
  if (result.class === "THROTTLED" || result.class === "TRANSIENT" || result.class === "NETWORK") {
    return new WixImportDiscoveryError(
      result.message || "Wix catalog is temporarily unavailable. Try again.",
      "TRANSIENT"
    );
  }
  return new WixImportDiscoveryError(
    result.message || "Could not fetch Wix products",
    "UNKNOWN"
  );
}

async function queryV1Products(input: {
  accessToken: string;
  config: NonNullable<ReturnType<typeof readWixAppConfig>>;
  limit: number;
  cursor?: string;
  includeHidden?: boolean;
  fetchImpl?: WixFetch;
}): Promise<{
  products: Array<Omit<WixImportCandidate, "alreadyLinked" | "linkedStoreItemId">>;
  nextCursor: string | null;
  result: WixApiResult;
}> {
  const offset = input.cursor ? parseInt(input.cursor, 10) : 0;
  const query: Record<string, unknown> = {
    paging: { limit: input.limit, offset: Number.isFinite(offset) ? offset : 0 },
  };
  // V1 requires filter/sort as JSON-encoded strings, not objects.
  if (!input.includeHidden) {
    query.filter = JSON.stringify({ visible: true });
  }

  const result = await wixApplicationRequest<{
    products?: WixV1Product[];
    totalResults?: number;
  }>({
    method: "POST",
    path: WIX_V1_PRODUCTS_QUERY,
    body: JSON.stringify({
      query,
      includeVariants: true,
      includeHiddenProducts: Boolean(input.includeHidden),
    }),
    deps: {
      config: input.config,
      accessToken: input.accessToken,
      fetchImpl: input.fetchImpl,
      maxAttempts: 2,
    },
  });

  if (!result.ok) {
    return { products: [], nextCursor: null, result };
  }

  const products = (result.data?.products ?? [])
    .map(parseWixV1Product)
    .filter((p): p is NonNullable<typeof p> => p !== null);
  const total = result.data?.totalResults ?? products.length;
  const nextOffset = (Number.isFinite(offset) ? offset : 0) + input.limit;
  return {
    products,
    nextCursor: nextOffset < total ? String(nextOffset) : null,
    result,
  };
}

async function queryV3Products(input: {
  accessToken: string;
  config: NonNullable<ReturnType<typeof readWixAppConfig>>;
  limit: number;
  cursor?: string;
  includeHidden?: boolean;
  fetchImpl?: WixFetch;
}): Promise<{
  products: Array<Omit<WixImportCandidate, "alreadyLinked" | "linkedStoreItemId">>;
  nextCursor: string | null;
  result: WixApiResult;
}> {
  const query: Record<string, unknown> = {
    cursorPaging: { limit: input.limit },
  };
  if (input.cursor) {
    (query.cursorPaging as Record<string, unknown>).cursor = input.cursor;
  }
  if (!input.includeHidden) {
    query.filter = { visible: { $eq: true } };
  }

  const result = await wixApplicationRequest<{
    products?: WixV3Product[];
    pagingMetadata?: { cursors?: { next?: string } };
    metadata?: { cursors?: { next?: string } };
  }>({
    method: "POST",
    path: WIX_V3_PRODUCTS_QUERY,
    body: JSON.stringify({ query }),
    deps: {
      config: input.config,
      accessToken: input.accessToken,
      fetchImpl: input.fetchImpl,
      maxAttempts: 2,
    },
  });

  if (!result.ok) {
    return { products: [], nextCursor: null, result };
  }

  const allProducts = (result.data?.products ?? [])
    .map(parseWixV3Product)
    .filter((p): p is NonNullable<typeof p> => p !== null);
  const products = input.includeHidden
    ? allProducts
    : allProducts.filter((p) => p.visible);
  const nextCursor =
    result.data?.pagingMetadata?.cursors?.next ??
    result.data?.metadata?.cursors?.next ??
    null;
  return { products, nextCursor, result };
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
    throw new WixImportDiscoveryError("Wix is not configured", "NOT_CONFIGURED");
  }

  let accessToken: string;
  try {
    accessToken = await accessTokenForWixConnection(connection, {
      config,
      fetchImpl: options?.fetchImpl,
    });
  } catch {
    throw new WixImportDiscoveryError(
      "Could not authorize with Wix. Reconnect your Wix site and try again.",
      "TOKEN"
    );
  }

  const limit = options?.limit ?? 50;
  const preferV1 = connection.catalogVersion === WIX_CATALOG_V1;
  const primary = preferV1 ? queryV1Products : queryV3Products;
  const fallback = preferV1 ? queryV3Products : queryV1Products;

  let page = await primary({
    accessToken,
    config,
    limit,
    cursor: options?.cursor,
    includeHidden: options?.includeHidden,
    fetchImpl: options?.fetchImpl,
  });

  if (!page.result.ok) {
    // Wrong catalog version or reader path — try the other catalog once.
    if (
      page.result.class === "CATALOG_VERSION_MISMATCH" ||
      page.result.class === "NOT_FOUND" ||
      page.result.class === "VALIDATION"
    ) {
      page = await fallback({
        accessToken,
        config,
        limit,
        cursor: options?.cursor,
        includeHidden: options?.includeHidden,
        fetchImpl: options?.fetchImpl,
      });
    }
  }

  if (!page.result.ok) {
    throw classifyDiscoveryFailure(page.result);
  }

  const candidates: WixImportCandidate[] = [];
  for (const product of page.products) {
    const existing = await lookupWixListingByRemoteId(prisma, connection.id, product.wixProductId);
    candidates.push({
      ...product,
      alreadyLinked: existing !== null,
      linkedStoreItemId: existing?.listingLink.storeItemId ?? null,
    });
  }

  return {
    candidates,
    hasMore: page.nextCursor !== null,
    nextCursor: page.nextCursor,
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
    throw new WixImportDiscoveryError("Wix is not configured", "NOT_CONFIGURED");
  }

  const accessToken = await accessTokenForWixConnection(connection, {
    config,
    fetchImpl: options?.fetchImpl,
  });
  const isV1 = connection.catalogVersion === WIX_CATALOG_V1;

  let product: Omit<WixImportCandidate, "alreadyLinked" | "linkedStoreItemId"> | null = null;

  if (isV1) {
    const result = await wixApplicationRequest<{ product?: WixV1Product }>({
      method: "GET",
      path: `${WIX_V1_PRODUCT_GET}/${wixProductId}`,
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
