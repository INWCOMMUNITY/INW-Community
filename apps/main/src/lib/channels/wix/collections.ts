import type { SyncStoreItem } from "../types";
import { assertSaneInventoryQty } from "../inventory-sanity";
import { normalizeVariantsFromProvider, variantsToMatrix, type InwVariantAxis } from "../variant-sync";
import {
  channelQuantityForTracked,
  isMadeToOrderTracking,
  optionsEqual,
  skuSelectionKey,
  type VariantMatrix,
} from "@/lib/listing-variant-matrix";
import { wixGet, wixJson, type WixRequestOpts } from "./client";
import type { WixV1Product } from "./mapping";

type WixV1VariantRow = NonNullable<WixV1Product["variants"]>[number];

/** Wix v1 returns variant choices as { "OptionName": "value" }, not an array. */
function wixVariantChoiceMap(row: WixV1VariantRow): Record<string, string> {
  const raw = row.choices;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof v === "string" && v.trim()) out[k.trim()] = v.trim();
    }
    return out;
  }
  if (Array.isArray(raw)) {
    const out: Record<string, string> = {};
    for (const c of raw) {
      if (c && typeof c === "object") {
        const val = String(
          (c as { description?: string; value?: string }).description ??
            (c as { description?: string; value?: string }).value ??
            ""
        ).trim();
        if (val) out["Option"] = val;
      }
    }
    return out;
  }
  const nested = row.variant?.choices;
  if (Array.isArray(nested)) {
    const out: Record<string, string> = {};
    for (const c of nested) {
      const val = String(c?.description ?? "").trim();
      if (val) out["Option"] = val;
    }
    return out;
  }
  return {};
}

function wixAmountToCents(raw: unknown): number | undefined {
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    return Math.round(raw * 100);
  }
  if (typeof raw === "string" && raw.trim() !== "") {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return Math.round(n * 100);
  }
  return undefined;
}

/** Catalog v1 GET nests price on `variant.priceData`; list payloads sometimes use the top-level field. */
export function wixV1VariantPriceCents(row: WixV1VariantRow): number | undefined {
  return (
    wixAmountToCents(row.variant?.priceData?.price) ??
    wixAmountToCents(row.variant?.convertedPriceData?.price) ??
    wixAmountToCents(row.priceData?.price) ??
    wixAmountToCents(row.price)
  );
}

/** Extract INW variant matrix from a classic v1 Wix product (query or GET). */
export function wixV1ProductToVariants(product: WixV1Product): VariantMatrix | InwVariantAxis[] | null {
  const rows = product.variants?.filter((v) => v.id) ?? [];
  const productOptions =
    product.productOptions?.filter((po) => po.name?.trim() && (po.choices?.length ?? 0) > 0) ?? [];

  if (rows.length === 0 && productOptions.length === 0) return null;

  const axes = productOptions.map((po) => ({
    name: po.name!.trim(),
    values: (po.choices ?? [])
      .map((c) => String(c.description ?? c.value ?? "").trim())
      .filter(Boolean),
  })).filter((a) => a.name && a.values.length > 0);

  if (axes.length === 0 && rows.length > 0) {
    const comboQty = new Map<
      string,
      { options: Record<string, string>; quantity: number; priceCents?: number }
    >();
    for (const row of rows) {
      const map = wixVariantChoiceMap(row);
      if (Object.keys(map).length === 0) continue;
      const priceCents = wixV1VariantPriceCents(row);
      comboQty.set(JSON.stringify(map), {
        options: map,
        quantity: Math.max(0, row.stock?.quantity ?? 0),
        ...(priceCents != null ? { priceCents } : {}),
      });
    }
    if (comboQty.size === 0) return null;
    const names = [...new Set([...comboQty.values()].flatMap((c) => Object.keys(c.options)))];
    const valuesByName = new Map<string, string[]>();
    for (const name of names) {
      const vals: string[] = [];
      for (const c of comboQty.values()) {
        const v = c.options[name];
        if (v && !vals.some((x) => x.toLowerCase() === v.toLowerCase())) vals.push(v);
      }
      valuesByName.set(name, vals);
    }
    return {
      axes: names.map((name) => ({ name, values: valuesByName.get(name) ?? [] })),
      skus: [...comboQty.values()],
    };
  }

  if (axes.length === 0) return null;
  const skus = rows.map((row) => {
    const map = wixVariantChoiceMap(row);
    const options: Record<string, string> = {};
    for (const axis of axes) {
      const val = map[axis.name] ?? Object.values(map).find((v) =>
        axis.values.some((x) => x.toLowerCase() === v.toLowerCase())
      );
      if (val) options[axis.name] = val;
    }
    const priceCents = wixV1VariantPriceCents(row);
    return {
      options,
      quantity: Math.max(0, row.stock?.quantity ?? 0),
      ...(priceCents != null ? { priceCents } : {}),
    };
  }).filter((s) => Object.keys(s.options).length > 0);

  return { axes, skus };
}

function wixTrackInventory(item: SyncStoreItem): boolean {
  return !isMadeToOrderTracking(item.inventoryTracking);
}

function wixVariantStock(item: SyncStoreItem, qty: number): Record<string, unknown> {
  if (!wixTrackInventory(item)) {
    return { trackInventory: false, inStock: true };
  }
  const quantity = channelQuantityForTracked(qty, item.inventoryTracking);
  return { trackInventory: true, quantity, inStock: quantity > 0 };
}

/** Merge Stores v2 inventory quantities onto v1 product variant rows (in place). */
export async function mergeV2InventoryIntoV1Product(
  accessToken: string,
  productId: string,
  product: WixV1Product,
  opts: WixRequestOpts
): Promise<void> {
  const got = await wixGet<{
    inventoryItem?: { variants?: { variantId?: string; quantity?: number }[] };
  }>(
    accessToken,
    `/stores/v2/inventoryItems/product/${encodeURIComponent(productId)}`,
    opts
  ).catch(() => null);
  const invVariants = got?.inventoryItem?.variants ?? [];
  if (invVariants.length === 0) return;

  const qtyMap = new Map<string, number>();
  for (const v of invVariants) {
    if (v.variantId && typeof v.quantity === "number") {
      qtyMap.set(v.variantId, Math.max(0, Math.round(v.quantity)));
    }
  }

  const rows = product.variants?.filter((v) => v.id) ?? [];
  if (qtyMap.size === 0 && rows.length > 0) {
    const n = Math.min(invVariants.length, rows.length);
    for (let i = 0; i < n; i++) {
      const q = invVariants[i].quantity;
      if (typeof q === "number" && rows[i].id) {
        qtyMap.set(rows[i].id!, Math.max(0, Math.round(q)));
      }
    }
  }

  if (qtyMap.size === 0) return;
  for (const row of product.variants ?? []) {
    if (!row.id) continue;
    const q = qtyMap.get(row.id);
    if (q == null) continue;
    row.stock = {
      ...(row.stock ?? {}),
      trackInventory: true,
      quantity: q,
      inStock: q > 0,
    };
  }
}

type WixCollection = { id?: string; name?: string; productIds?: string[] };

export function isWixCollectionAlreadyExistsError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return /already exists/i.test(msg);
}

async function queryWixCollections(
  accessToken: string,
  opts: WixRequestOpts,
  v1: boolean
): Promise<WixCollection[]> {
  if (v1) {
    const posted = await wixJson<{ collections?: WixCollection[] }>(
      accessToken,
      `/stores/v1/collections/query`,
      "POST",
      { query: { paging: { limit: 100 } } },
      opts
    ).catch(() => null);
    if (posted?.collections?.length) return posted.collections;
    const got = await wixGet<{ collections?: WixCollection[] }>(
      accessToken,
      `/stores/v1/collections/query`,
      opts
    ).catch(() => null);
    return got?.collections ?? [];
  }
  const posted = await wixJson<{ collections?: WixCollection[] }>(
    accessToken,
    `/stores/v3/collections/query`,
    "POST",
    { query: { cursorPaging: { limit: 100 } } },
    opts
  ).catch(() => null);
  return posted?.collections ?? [];
}

function wixCollectionIdByName(collections: WixCollection[], name: string): string | null {
  const want = name.trim().toLowerCase();
  return collections.find((c) => c.name?.trim().toLowerCase() === want)?.id ?? null;
}

/**
 * Build collection id → name map and (best-effort) product id → first collection name
 * for inbound category auto-translate.
 */
export async function fetchWixCollectionCategoryMaps(
  accessToken: string,
  opts: WixRequestOpts,
  v1: boolean
): Promise<{
  collectionNameById: Map<string, string>;
  categoryByProductId: Map<string, string>;
}> {
  const collectionNameById = new Map<string, string>();
  const categoryByProductId = new Map<string, string>();

  try {
    const listed = await queryWixCollections(accessToken, opts, v1);
    for (const c of listed) {
      if (c.id && c.name?.trim()) collectionNameById.set(c.id, c.name.trim());
    }
    if (v1) {
      // Enrich product → collection via each collection's productIds (cap to avoid timeouts).
      let fetched = 0;
      for (const [id, name] of collectionNameById) {
        if (fetched >= 40) break;
        fetched += 1;
        const detail = await wixGet<WixCollection>(
          accessToken,
          `/stores/v1/collections/${encodeURIComponent(id)}`,
          opts
        ).catch(() => null);
        for (const pid of detail?.productIds ?? []) {
          if (pid && !categoryByProductId.has(pid)) {
            categoryByProductId.set(pid, name);
          }
        }
      }
    }
  } catch (e) {
    console.warn("[wix] fetchWixCollectionCategoryMaps failed", { error: String(e) });
  }

  return { collectionNameById, categoryByProductId };
}

/** Find or create a Wix collection by INW category label. */
export async function ensureWixCollection(
  accessToken: string,
  collectionName: string,
  opts: WixRequestOpts,
  v1: boolean
): Promise<string | null> {
  const name = collectionName.trim().slice(0, 80);
  if (!name) return null;
  const existingId = wixCollectionIdByName(await queryWixCollections(accessToken, opts, v1), name);
  if (existingId) return existingId;
  try {
    if (v1) {
      const created = await wixJson<{ collection?: WixCollection }>(
        accessToken,
        `/stores/v1/collections`,
        "POST",
        { collection: { name } },
        opts
      );
      return created.collection?.id ?? null;
    }
    const created = await wixJson<{ collection?: WixCollection }>(
      accessToken,
      `/stores/v3/collections`,
      "POST",
      { collection: { name } },
      opts
    );
    return created.collection?.id ?? null;
  } catch (e) {
    if (isWixCollectionAlreadyExistsError(e)) {
      const retryId = wixCollectionIdByName(await queryWixCollections(accessToken, opts, v1), name);
      if (retryId) return retryId;
    }
    console.error("[wix] ensureWixCollection failed", { name, error: String(e) });
    return null;
  }
}

/** Assign product to collection (best effort). */
export async function assignWixProductCollection(
  accessToken: string,
  productId: string,
  collectionId: string,
  opts: WixRequestOpts,
  v1: boolean
): Promise<void> {
  try {
    if (v1) {
      await wixJson(
        accessToken,
        `/stores/v1/collections/${encodeURIComponent(collectionId)}/productIds`,
        "POST",
        { productIds: [productId] },
        opts
      );
      return;
    }
    await wixJson(
      accessToken,
      `/stores/v3/collections/${encodeURIComponent(collectionId)}/addProducts`,
      "POST",
      { productIds: [productId] },
      opts
    );
  } catch (e) {
    console.error("[wix] assignWixProductCollection failed", { productId, error: String(e) });
  }
}

/** Build v1 productOptions + variants for products that do not yet have variant rows. */
export function buildWixV1OptionsCreateBody(item: SyncStoreItem): Record<string, unknown> | null {
  const matrix = variantsToMatrix(item.variants);
  if (!matrix || matrix.axes.length === 0 || matrix.skus.length === 0) {
    const axes = normalizeVariantsFromProvider("wix", item.variants) as InwVariantAxis[] | null;
    if (!axes || axes.length === 0) return null;
    if (axes.length >= 2) return null;
    const productOptions = axes.map((axis) => ({
      name: axis.name,
      choices: axis.options.map((o) => ({ value: o.value, description: o.value })),
    }));
    const variants = axes[0].options.map((o) => ({
      choices: { [axes[0].name]: o.value },
      stock: wixVariantStock(item, o.quantity),
      priceData: { price: Math.max(0, item.priceCents) / 100 },
    }));
    return { product: { manageVariants: true, productOptions, variants } };
  }

  const productOptions = matrix.axes.map((axis) => ({
    name: axis.name,
    choices: axis.values.map((value) => ({ value, description: value })),
  }));
  const variants = matrix.skus.map((sku) => ({
    choices: sku.options,
    stock: wixVariantStock(item, sku.quantity),
    priceData: {
      price: Math.max(0, sku.priceCents && sku.priceCents > 0 ? sku.priceCents : item.priceCents) / 100,
    },
  }));

  return { product: { manageVariants: true, productOptions, variants } };
}

function inwMatrix(item: SyncStoreItem): VariantMatrix | null {
  return variantsToMatrix(item.variants);
}

function axisValuesMatch(a: string[], b: string[]): boolean {
  const left = new Set(a.map((v) => v.trim().toLowerCase()).filter(Boolean));
  const right = new Set(b.map((v) => v.trim().toLowerCase()).filter(Boolean));
  if (left.size !== right.size) return false;
  for (const v of left) {
    if (!right.has(v)) return false;
  }
  return true;
}

/** True when INW option names + values match Wix productOptions. */
export function wixOptionStructureMatches(
  item: SyncStoreItem,
  existing: WixV1Product | null | undefined
): boolean {
  const matrix = inwMatrix(item);
  if (!matrix || !existing) return false;

  const wixOptions =
    existing.productOptions?.filter((po) => po.name?.trim() && (po.choices?.length ?? 0) > 0) ?? [];
  if (wixOptions.length === matrix.axes.length && wixOptions.length > 0) {
    return matrix.axes.every((axis) => {
      const wixOpt = wixOptions.find((po) => po.name?.trim().toLowerCase() === axis.name.trim().toLowerCase());
      if (!wixOpt) return false;
      const wixValues = (wixOpt.choices ?? [])
        .map((c) => String(c.description ?? c.value ?? "").trim())
        .filter(Boolean);
      return axisValuesMatch(axis.values, wixValues);
    });
  }

  const existingRows = existing.variants?.filter((v) => v.id) ?? [];
  if (existingRows.length === 0) return false;
  const inwKeys = new Set(matrix.skus.map((s) => skuSelectionKey(s.options)));
  const wixKeys = new Set<string>();
  for (const row of existingRows) {
    const map = wixVariantChoiceMap(row);
    if (Object.keys(map).length === 0) continue;
    wixKeys.add(skuSelectionKey(map));
  }
  if (inwKeys.size !== wixKeys.size) return false;
  for (const k of inwKeys) {
    if (!wixKeys.has(k)) return false;
  }
  return true;
}

/** True when Wix still has a dummy/default variant (no choice values) and options need to be created. */
export function wixV1NeedsOptionStructureRebuild(
  product: WixV1Product | null | undefined
): boolean {
  const rows = product?.variants?.filter((v) => v.id) ?? [];
  if (rows.length === 0) return true;
  return rows.every((row) => Object.keys(wixVariantChoiceMap(row)).length === 0);
}

/**
 * PATCH existing variant rows by id (stock + price only). Wix rejects productOptions changes
 * when the product already has variants — omit productOptions entirely.
 */
export function buildWixV1ExistingVariantsPatchBody(
  item: SyncStoreItem,
  existing: WixV1Product
): Record<string, unknown> | null {
  const matrix = inwMatrix(item);
  if (!matrix) return null;

  const rows = existing.variants?.filter((v) => v.id) ?? [];
  if (rows.length === 0) return null;

  const variants: Record<string, unknown>[] = [];
  for (const row of rows) {
    const map = wixVariantChoiceMap(row);
    const sku = matrix.skus.find((s) => optionsEqual(s.options, map));
    const qty = sku ? sku.quantity : Math.max(0, row.stock?.quantity ?? 0);
    const price =
      Math.max(0, sku?.priceCents && sku.priceCents > 0 ? sku.priceCents : item.priceCents) / 100;
    variants.push({
      id: row.id,
      stock: wixVariantStock(item, qty),
      priceData: { price },
    });
  }
  return variants.length > 0 ? { product: { variants } } : null;
}

function inwSkuQtyByChoiceKey(item: SyncStoreItem): Map<string, number> | null {
  const matrix = inwMatrix(item);
  if (!matrix || matrix.skus.length === 0) return null;
  return new Map(matrix.skus.map((s) => [skuSelectionKey(s.options), Math.max(0, s.quantity)]));
}

type V2InventoryItem = {
  id?: string;
  productId?: string;
  trackQuantity?: boolean;
  variants?: { variantId?: string; quantity?: number; inStock?: boolean }[];
};

/**
 * Push per-option stock via Stores v2 inventory.
 *
 * For a Catalog v1 product the Stores v2 inventory is keyed by the *v1 product variant ids*
 * (the same GUIDs `setInventoryViaStoresV2` uses as its fallback), so we PATCH those ids directly,
 * mapping each variant row's option value to its INW quantity. This avoids the fragile v2↔v1
 * index/id bridging that could collapse to "nothing resolved".
 *
 * Safety: we only ever *create* the option structure when the product has no managed variants at
 * all (so we never call the destructive resetToDefault here), and any variant we can't confidently
 * map keeps its current Wix quantity instead of being zeroed. Returns false only when there is no
 * variant structure to write to, so the caller surfaces a clear error rather than wiping stock.
 */
export async function pushWixV1PerOptionInventory(
  accessToken: string,
  productId: string,
  item: SyncStoreItem,
  opts: WixRequestOpts
): Promise<boolean> {
  const qtyByKey = inwSkuQtyByChoiceKey(item);
  if (!qtyByKey) return false;

  const fetchInventory = () =>
    wixGet<{ inventoryItem?: V2InventoryItem }>(
      accessToken,
      `/stores/v2/inventoryItems/product/${encodeURIComponent(productId)}`,
      opts
    ).catch(() => null);

  let product = await fetchWixV1Product(accessToken, productId, opts);
  let rows = product?.variants?.filter((v) => v.id) ?? [];

  // Create the option structure when the product has no managed variants, or only a dummy
  // default variant with empty choices (Wix Catalog v1 before manageVariants is on).
  if (wixV1NeedsOptionStructureRebuild(product)) {
    const structureOk = await pushWixV1OptionsUpdate(accessToken, productId, item, opts);
    if (!structureOk) {
      console.warn("[wix] pushWixV1PerOptionInventory: no variants and structure create failed", {
        productId,
      });
      return false;
    }
    product = await fetchWixV1Product(accessToken, productId, opts);
    rows = product?.variants?.filter((v) => v.id) ?? [];
    if (wixV1NeedsOptionStructureRebuild(product) || rows.length === 0) {
      console.warn("[wix] pushWixV1PerOptionInventory: structure did not propagate", { productId });
      return false;
    }
  }

  const inv = await fetchInventory();
  const v2QtyById = new Map<string, number>();
  for (const v of inv?.inventoryItem?.variants ?? []) {
    if (v.variantId && typeof v.quantity === "number") {
      v2QtyById.set(v.variantId, Math.max(0, Math.round(v.quantity)));
    }
  }

  const track = wixTrackInventory(item);
  const variants: { variantId: string; quantity: number; inStock: boolean }[] = [];
  let resolved = 0;
  for (const row of rows) {
    const variantId = row.id as string;
    const map = wixVariantChoiceMap(row);
    const mapped = qtyByKey.get(skuSelectionKey(map));
    if (mapped == null) {
      const current = v2QtyById.get(variantId) ?? Math.max(0, row.stock?.quantity ?? 0);
      variants.push({ variantId, quantity: current, inStock: current > 0 });
      continue;
    }
    resolved += 1;
    const qty = track ? assertSaneInventoryQty(mapped, "pushWixV1PerOptionInventory") : 0;
    variants.push({ variantId, quantity: qty, inStock: track ? qty > 0 : true });
  }

  if (resolved === 0) {
    console.warn("[wix] pushWixV1PerOptionInventory: no variant matched an INW combination", {
      productId,
      inwKeys: [...qtyByKey.keys()],
      wixKeys: rows.map((r) => skuSelectionKey(wixVariantChoiceMap(r))),
    });
    return false;
  }

  await wixJson(
    accessToken,
    `/stores/v2/inventoryItems/product/${encodeURIComponent(productId)}`,
    "PATCH",
    {
      inventoryItem: {
        ...(inv?.inventoryItem?.id ? { id: inv.inventoryItem.id } : {}),
        productId,
        trackQuantity: track,
        variants,
      },
    },
    opts
  );
  return true;
}

/** @deprecated Prefer pushWixV1OptionsUpdate — kept for callers that only build JSON. */
export function buildWixV1OptionsBody(
  item: SyncStoreItem,
  existing?: WixV1Product | null
): Record<string, unknown> | null {
  const rows = existing?.variants?.filter((v) => v.id) ?? [];
  if (rows.length > 0 && wixOptionStructureMatches(item, existing)) {
    return buildWixV1ExistingVariantsPatchBody(item, existing!);
  }
  return buildWixV1OptionsCreateBody(item);
}

async function resetWixV1VariantsToDefault(
  accessToken: string,
  productId: string,
  opts: WixRequestOpts
): Promise<void> {
  await wixJson(
    accessToken,
    `/stores/v1/products/${encodeURIComponent(productId)}/variants/resetToDefault`,
    "POST",
    {},
    opts
  );
}

/**
 * Push INW option rows to a v1 Wix product. Uses variant-id PATCH when options already exist;
 * resets + full replace when the option structure changed; create body when no variants yet.
 */
export async function pushWixV1OptionsUpdate(
  accessToken: string,
  productId: string,
  item: SyncStoreItem,
  opts: WixRequestOpts
): Promise<boolean> {
  const matrix = inwMatrix(item);
  if (!matrix) return false;

  const product = await fetchWixV1Product(accessToken, productId, opts);
  const existingRows = product?.variants?.filter((v) => v.id) ?? [];
  const needsRebuild = wixV1NeedsOptionStructureRebuild(product);

  if (existingRows.length > 0 && !needsRebuild) {
    if (wixOptionStructureMatches(item, product)) {
      const patchBody = buildWixV1ExistingVariantsPatchBody(item, product!);
      if (!patchBody) return false;
      await wixJson(
        accessToken,
        `/stores/v1/products/${encodeURIComponent(productId)}`,
        "PATCH",
        patchBody,
        opts
      );
      return true;
    }

    // Option names/values changed — Wix requires reset before productOptions can change.
    await resetWixV1VariantsToDefault(accessToken, productId, opts);
    const createBody = buildWixV1OptionsCreateBody(item);
    if (!createBody) return false;
    await wixJson(
      accessToken,
      `/stores/v1/products/${encodeURIComponent(productId)}`,
      "PATCH",
      createBody,
      opts
    );
    return true;
  }

  if (existingRows.length > 0 && needsRebuild) {
    await resetWixV1VariantsToDefault(accessToken, productId, opts).catch(() => {});
  }

  const createBody = buildWixV1OptionsCreateBody(item);
  if (!createBody) return false;
  await wixJson(
    accessToken,
    `/stores/v1/products/${encodeURIComponent(productId)}`,
    "PATCH",
    createBody,
    opts
  );
  return true;
}

/** GET full v1 product (query list may omit productOptions on some paths). */
export async function fetchWixV1Product(
  accessToken: string,
  productId: string,
  opts: WixRequestOpts
): Promise<WixV1Product | null> {
  const got = await wixGet<{ product?: WixV1Product }>(
    accessToken,
    `/stores/v1/products/${encodeURIComponent(productId)}`,
    opts
  ).catch(() => null);
  const product = got?.product ?? null;
  if (product?.id) {
    await mergeV2InventoryIntoV1Product(accessToken, productId, product, opts);
  }
  return product;
}

/** Attach variants to a listing summary from a v1 product payload. */
export function attachWixVariantsToSummary(
  summary: { variants?: unknown; variantsKnown?: boolean },
  product: WixV1Product
): void {
  const vars = wixV1ProductToVariants(product);
  if (vars) {
    summary.variants = vars;
    summary.variantsKnown = true;
  }
}
