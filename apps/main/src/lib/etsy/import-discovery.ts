import { prisma } from "database";
import { etsyConnectionRequest } from "./connection-request";
import { clampEtsySku } from "@/lib/listing-sku";

export type EtsyImportCandidateVariant = {
  etsyProductId: string;
  etsyOfferingId: string;
  priceCents: number;
  quantity: number;
  sku: string | null;
  enabled: boolean;
  options: Record<string, string>;
  propertyValuesJson: unknown;
};

export type EtsyImportCandidate = {
  etsyListingId: string;
  title: string;
  description: string;
  state: string;
  supported: boolean;
  unsupportedReason: string | null;
  priceCents: number | null;
  quantity: number | null;
  sku: string | null;
  imageUrl: string | null;
  photos: string[];
  recommendedStockMode: "PHYSICAL" | "MADE_TO_ORDER" | null;
  variants: EtsyImportCandidateVariant[];
  axes: Array<{ name: string; values: string[] }>;
};

export type DiscoverEtsyImportCandidatesResult =
  | {
      status: "OK";
      connectionId: string;
      shopId: string;
      shopName: string | null;
      candidates: EtsyImportCandidate[];
      pageInfo: { hasNextPage: boolean; offset: number };
    }
  | {
      status: "ERROR";
      code: "CONNECTION_REQUIRED" | "PROVIDER_ERROR" | "UNAUTHORIZED" | "NOT_CONFIGURED";
      message: string;
    };

type EtsyListingRow = {
  listing_id?: unknown;
  title?: unknown;
  description?: unknown;
  state?: unknown;
  price?: unknown;
  quantity?: unknown;
  sku?: unknown;
  images?: Array<{ url_570xN?: unknown; url_fullxfull?: unknown }>;
};

type EtsyInventoryProduct = {
  product_id?: unknown;
  sku?: unknown;
  property_values?: Array<{
    property_id?: unknown;
    property_name?: unknown;
    values?: unknown[];
  }>;
  offerings?: Array<{
    offering_id?: unknown;
    quantity?: unknown;
    is_enabled?: unknown;
    price?: unknown;
  }>;
};

function moneyToCents(price: unknown): number | null {
  if (price == null) return null;
  if (typeof price === "number" && Number.isFinite(price)) {
    return Math.round(price * 100);
  }
  if (typeof price === "object") {
    const p = price as { amount?: unknown; divisor?: unknown; currency_code?: unknown };
    const amount = typeof p.amount === "number" ? p.amount : Number(p.amount);
    const divisor = typeof p.divisor === "number" ? p.divisor : Number(p.divisor);
    if (Number.isFinite(amount) && Number.isFinite(divisor) && divisor > 0) {
      return Math.round((amount / divisor) * 100);
    }
  }
  return null;
}

function listingPhotos(row: EtsyListingRow): string[] {
  const images = Array.isArray(row.images) ? row.images : [];
  const urls: string[] = [];
  for (const image of images) {
    const url =
      (typeof image.url_fullxfull === "string" && image.url_fullxfull) ||
      (typeof image.url_570xN === "string" && image.url_570xN) ||
      null;
    if (url) urls.push(url);
  }
  return urls;
}

function optionsFromPropertyValues(
  propertyValues: EtsyInventoryProduct["property_values"]
): Record<string, string> {
  const options: Record<string, string> = {};
  for (const pv of propertyValues ?? []) {
    const name = typeof pv.property_name === "string" ? pv.property_name.trim() : "";
    const values = Array.isArray(pv.values) ? pv.values : [];
    const value = values.map((v) => String(v)).filter(Boolean).join(" / ");
    if (name && value) options[name] = value;
  }
  return options;
}

function buildAxes(variants: EtsyImportCandidateVariant[]): Array<{ name: string; values: string[] }> {
  const map = new Map<string, Set<string>>();
  for (const variant of variants) {
    for (const [name, value] of Object.entries(variant.options)) {
      if (!map.has(name)) map.set(name, new Set());
      map.get(name)!.add(value);
    }
  }
  return [...map.entries()].map(([name, values]) => ({
    name,
    values: [...values],
  }));
}

function toCandidateFromListing(row: EtsyListingRow): EtsyImportCandidate {
  const listingId =
    typeof row.listing_id === "number"
      ? String(row.listing_id)
      : typeof row.listing_id === "string"
        ? row.listing_id.trim()
        : "";
  const photos = listingPhotos(row);
  return {
    etsyListingId: listingId,
    title: (typeof row.title === "string" ? row.title : "").trim() || "Untitled",
    description: typeof row.description === "string" ? row.description : "",
    state: typeof row.state === "string" ? row.state : "unknown",
    supported: false,
    unsupportedReason: "Inventory detail not loaded",
    priceCents: moneyToCents(row.price),
    quantity: typeof row.quantity === "number" ? row.quantity : null,
    sku: typeof row.sku === "string" ? row.sku : null,
    imageUrl: photos[0] ?? null,
    photos,
    recommendedStockMode: null,
    variants: [],
    axes: [],
  };
}

export function hydrateEtsyCandidateWithInventory(
  base: EtsyImportCandidate,
  inventory: { products?: EtsyInventoryProduct[] } | null
): EtsyImportCandidate {
  const products = Array.isArray(inventory?.products) ? inventory!.products! : [];
  if (products.length === 0) {
    return {
      ...base,
      supported: false,
      unsupportedReason: "Listing inventory has no products",
    };
  }

  const variants: EtsyImportCandidateVariant[] = [];
  for (const product of products) {
    const productId =
      typeof product.product_id === "number"
        ? String(product.product_id)
        : typeof product.product_id === "string"
          ? product.product_id.trim()
          : "";
    const offering = Array.isArray(product.offerings) ? product.offerings[0] : null;
    const offeringId =
      typeof offering?.offering_id === "number"
        ? String(offering.offering_id)
        : typeof offering?.offering_id === "string"
          ? offering.offering_id.trim()
          : "";
    if (!productId || !offeringId) continue;
    const priceCents = moneyToCents(offering?.price) ?? base.priceCents ?? 0;
    const quantity = typeof offering?.quantity === "number" ? Math.max(0, Math.trunc(offering.quantity)) : 0;
    const skuRaw = typeof product.sku === "string" ? product.sku.trim() : "";
    variants.push({
      etsyProductId: productId,
      etsyOfferingId: offeringId,
      priceCents,
      quantity,
      sku: skuRaw ? clampEtsySku(skuRaw) : null,
      enabled: offering?.is_enabled !== false,
      options: optionsFromPropertyValues(product.property_values),
      propertyValuesJson: product.property_values ?? null,
    });
  }

  if (variants.length === 0) {
    return {
      ...base,
      supported: false,
      unsupportedReason: "No enabled offerings found",
    };
  }

  const axes = buildAxes(variants);
  if (axes.length > 3) {
    return {
      ...base,
      supported: false,
      unsupportedReason: "More than 3 variation axes are not supported",
      variants,
      axes,
    };
  }

  const totalQty = variants.reduce((sum, v) => sum + v.quantity, 0);
  return {
    ...base,
    supported: true,
    unsupportedReason: null,
    priceCents: variants[0]?.priceCents ?? base.priceCents,
    quantity: totalQty,
    sku: variants[0]?.sku ?? base.sku,
    recommendedStockMode: "PHYSICAL",
    variants,
    axes,
  };
}

export async function discoverEtsyImportCandidates(input: {
  memberId: string;
  offset?: number;
  limit?: number;
}): Promise<DiscoverEtsyImportCandidatesResult> {
  const connection = await prisma.etsyConnection.findFirst({
    where: { memberId: input.memberId, status: "ACTIVE" },
    orderBy: { connectedAt: "desc" },
  });
  if (!connection) {
    return {
      status: "ERROR",
      code: "CONNECTION_REQUIRED",
      message: "Connect Etsy before importing listings.",
    };
  }

  const limit = Math.min(Math.max(input.limit ?? 25, 1), 50);
  const offset = Math.max(input.offset ?? 0, 0);

  const result = await etsyConnectionRequest<{
    count?: number;
    results?: EtsyListingRow[];
  }>({
    connectionId: connection.id,
    memberId: input.memberId,
    method: "GET",
    path: `/shops/${encodeURIComponent(connection.shopId)}/listings`,
    query: {
      state: "active",
      limit,
      offset,
      includes: "Images",
    },
    maxAttempts: 3,
  });

  if (!result.ok) {
    return {
      status: "ERROR",
      code: result.class === "AUTH" ? "UNAUTHORIZED" : result.class === "NOT_CONFIGURED" ? "NOT_CONFIGURED" : "PROVIDER_ERROR",
      message: result.message || "Could not list Etsy listings.",
    };
  }

  const rows = Array.isArray(result.data?.results) ? result.data!.results! : [];
  const mappedIds = new Set(
    (
      await prisma.etsyListingLink.findMany({
        where: { etsyConnectionId: connection.id },
        select: { etsyListingId: true },
      })
    ).map((row) => row.etsyListingId)
  );

  const candidates: EtsyImportCandidate[] = [];
  for (const row of rows) {
    const base = toCandidateFromListing(row);
    if (!base.etsyListingId || mappedIds.has(base.etsyListingId)) continue;
    candidates.push(base);
  }

  return {
    status: "OK",
    connectionId: connection.id,
    shopId: connection.shopId,
    shopName: connection.shopName,
    candidates,
    pageInfo: {
      hasNextPage: rows.length === limit,
      offset: offset + rows.length,
    },
  };
}

export async function fetchEtsyImportListingDetail(input: {
  memberId: string;
  etsyListingId: string;
}): Promise<
  | { status: "OK"; connectionId: string; candidate: EtsyImportCandidate }
  | { status: "ERROR"; code: string; message: string }
> {
  const listingId = input.etsyListingId.trim();
  if (!/^\d+$/.test(listingId)) {
    return { status: "ERROR", code: "INVALID_LISTING", message: "Invalid Etsy listing id." };
  }

  const connection = await prisma.etsyConnection.findFirst({
    where: { memberId: input.memberId, status: "ACTIVE" },
    orderBy: { connectedAt: "desc" },
  });
  if (!connection) {
    return {
      status: "ERROR",
      code: "CONNECTION_REQUIRED",
      message: "Connect Etsy before importing listings.",
    };
  }

  const listingRes = await etsyConnectionRequest<EtsyListingRow>({
    connectionId: connection.id,
    memberId: input.memberId,
    method: "GET",
    path: `/listings/${encodeURIComponent(listingId)}`,
    query: { includes: "Images" },
    maxAttempts: 3,
  });
  if (!listingRes.ok || !listingRes.data) {
    return {
      status: "ERROR",
      code: listingRes.class === "AUTH" ? "UNAUTHORIZED" : "PROVIDER_ERROR",
      message: listingRes.message || "Could not load Etsy listing.",
    };
  }

  const inventoryRes = await etsyConnectionRequest<{ products?: EtsyInventoryProduct[] }>({
    connectionId: connection.id,
    memberId: input.memberId,
    method: "GET",
    path: `/listings/${encodeURIComponent(listingId)}/inventory`,
    query: { max_variations_supported: 3 },
    maxAttempts: 3,
  });
  if (!inventoryRes.ok) {
    return {
      status: "ERROR",
      code: inventoryRes.class === "AUTH" ? "UNAUTHORIZED" : "PROVIDER_ERROR",
      message: inventoryRes.message || "Could not load Etsy inventory.",
    };
  }

  const base = toCandidateFromListing(listingRes.data);
  const candidate = hydrateEtsyCandidateWithInventory(base, inventoryRes.data);
  return { status: "OK", connectionId: connection.id, candidate };
}
