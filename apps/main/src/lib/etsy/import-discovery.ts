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
      etsyReportedCount: number;
      alreadyLinkedCount: number;
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
  const rawId = row.listing_id ?? (row as { listingId?: unknown }).listingId;
  const listingId =
    typeof rawId === "number"
      ? String(rawId)
      : typeof rawId === "string"
        ? rawId.trim()
        : "";
  const photos = listingPhotos(row);
  // Discover list does not include inventory; Review/import hydrates and re-validates.
  return {
    etsyListingId: listingId,
    title: (typeof row.title === "string" ? row.title : "").trim() || "Untitled",
    description: typeof row.description === "string" ? row.description : "",
    state: typeof row.state === "string" ? row.state : "unknown",
    supported: true,
    unsupportedReason: null,
    priceCents: moneyToCents(row.price),
    quantity: typeof row.quantity === "number" ? row.quantity : null,
    sku: typeof row.sku === "string" ? row.sku : null,
    imageUrl: photos[0] ?? null,
    photos,
    recommendedStockMode: "PHYSICAL",
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
  for (const [productIndex, product] of products.entries()) {
    const productId =
      typeof product.product_id === "number"
        ? String(product.product_id)
        : typeof product.product_id === "string"
          ? product.product_id.trim()
          : `p${productIndex}`;
    const offerings = Array.isArray(product.offerings) ? product.offerings : [];
    const offering =
      offerings.find((o) => o?.is_enabled !== false) ?? offerings[0] ?? null;
    const offeringId =
      typeof offering?.offering_id === "number"
        ? String(offering.offering_id)
        : typeof offering?.offering_id === "string"
          ? offering.offering_id.trim()
          : "";
    if (!offeringId) continue;
    const priceCents = moneyToCents(offering?.price) ?? base.priceCents ?? 0;
    const quantity =
      typeof offering?.quantity === "number" ? Math.max(0, Math.trunc(offering.quantity)) : 0;
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

  const enabledVariants = variants.filter((v) => v.enabled);
  const usableVariants = enabledVariants.length > 0 ? enabledVariants : variants;

  if (usableVariants.length === 0) {
    return {
      ...base,
      supported: false,
      unsupportedReason: "No enabled offerings found",
    };
  }

  const axes = buildAxes(usableVariants);
  if (axes.length > 3) {
    return {
      ...base,
      supported: false,
      unsupportedReason: "More than 3 variation axes are not supported",
      variants: usableVariants,
      axes,
    };
  }

  const totalQty = usableVariants.reduce((sum, v) => sum + v.quantity, 0);
  return {
    ...base,
    supported: true,
    unsupportedReason: null,
    priceCents: usableVariants[0]?.priceCents ?? base.priceCents,
    quantity: totalQty,
    sku: usableVariants[0]?.sku ?? base.sku,
    recommendedStockMode: "PHYSICAL",
    variants: usableVariants,
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

  // Prefer shop listings with state=active (stable Open API). Fall back to /listings/active.
  const primary = await etsyConnectionRequest<{
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

  if (primary.ok) {
    return buildDiscoverResult(
      connection,
      Array.isArray(primary.data?.results) ? primary.data!.results! : [],
      typeof primary.data?.count === "number" ? primary.data.count : null,
      limit,
      offset
    );
  }

  const fallback = await etsyConnectionRequest<{
    count?: number;
    results?: EtsyListingRow[];
  }>({
    connectionId: connection.id,
    memberId: input.memberId,
    method: "GET",
    path: `/shops/${encodeURIComponent(connection.shopId)}/listings/active`,
    query: {
      limit,
      offset,
      includes: "Images",
    },
    maxAttempts: 2,
  });
  if (!fallback.ok) {
    return {
      status: "ERROR",
      code:
        primary.class === "AUTH" || fallback.class === "AUTH"
          ? "UNAUTHORIZED"
          : primary.class === "NOT_CONFIGURED" || fallback.class === "NOT_CONFIGURED"
            ? "NOT_CONFIGURED"
            : "PROVIDER_ERROR",
      message:
        fallback.message ||
        primary.message ||
        "Could not list Etsy listings. Reconnect Etsy if this keeps failing.",
    };
  }
  return buildDiscoverResult(
    connection,
    Array.isArray(fallback.data?.results) ? fallback.data!.results! : [],
    typeof fallback.data?.count === "number" ? fallback.data.count : null,
    limit,
    offset
  );
}

async function buildDiscoverResult(
  connection: { id: string; shopId: string; shopName: string | null },
  rows: EtsyListingRow[],
  etsyCount: number | null,
  limit: number,
  offset: number
): Promise<Extract<DiscoverEtsyImportCandidatesResult, { status: "OK" }>> {
  const linked = await prisma.etsyListingLink.findMany({
    where: { etsyConnectionId: connection.id },
    select: { etsyListingId: true },
  });
  const mappedIds = new Set(linked.map((row) => row.etsyListingId));

  const candidates: EtsyImportCandidate[] = [];
  let alreadyLinkedOnPage = 0;
  for (const row of rows) {
    const base = toCandidateFromListing(row);
    if (!base.etsyListingId) continue;
    if (mappedIds.has(base.etsyListingId)) {
      alreadyLinkedOnPage += 1;
      continue;
    }
    candidates.push(base);
  }

  return {
    status: "OK",
    connectionId: connection.id,
    shopId: connection.shopId,
    shopName: connection.shopName,
    candidates,
    etsyReportedCount: etsyCount ?? rows.length,
    alreadyLinkedCount: alreadyLinkedOnPage,
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
      message:
        listingRes.class === "AUTH"
          ? "Etsy authorization expired. Reconnect in Connection Settings."
          : listingRes.message || "Could not load Etsy listing.",
    };
  }

  const inventoryRes = await etsyConnectionRequest<{ products?: EtsyInventoryProduct[] }>({
    connectionId: connection.id,
    memberId: input.memberId,
    method: "GET",
    path: `/listings/${encodeURIComponent(listingId)}/inventory`,
    maxAttempts: 3,
  });
  if (!inventoryRes.ok) {
    return {
      status: "ERROR",
      code: inventoryRes.class === "AUTH" ? "UNAUTHORIZED" : "PROVIDER_ERROR",
      message:
        inventoryRes.class === "AUTH"
          ? "Etsy authorization expired. Reconnect in Connection Settings."
          : inventoryRes.message || "Could not load Etsy inventory.",
    };
  }

  const base = toCandidateFromListing(listingRes.data);
  const candidate = hydrateEtsyCandidateWithInventory(base, inventoryRes.data);
  return { status: "OK", connectionId: connection.id, candidate };
}

