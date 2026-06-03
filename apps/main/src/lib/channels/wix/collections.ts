import type { SyncStoreItem } from "../types";
import { normalizeVariantsFromProvider, type InwVariantAxis } from "../variant-sync";
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

function setOptionQty(
  options: Map<string, number>,
  selected: string,
  qty: number
): void {
  const want = selected.trim().toLowerCase();
  if (!want) return;
  for (const [val] of options) {
    if (val.toLowerCase() === want) {
      options.set(val, qty);
      return;
    }
  }
  options.set(selected.trim(), qty);
}

/** Extract INW variant axes from a classic v1 Wix product (query or GET). */
export function wixV1ProductToVariants(product: WixV1Product): InwVariantAxis[] | null {
  const rows = product.variants?.filter((v) => v.id) ?? [];
  const productOptions =
    product.productOptions?.filter((po) => po.name?.trim() && (po.choices?.length ?? 0) > 0) ?? [];

  if (rows.length === 0 && productOptions.length === 0) return null;

  // One option type (Size, Color, …): map each variant row to that option's quantity.
  if (productOptions.length === 1) {
    const po = productOptions[0];
    const axisName = po.name!.trim();
    const qtyByValue = new Map<string, number>();
    for (const c of po.choices ?? []) {
      const val = String(c.description ?? c.value ?? "").trim();
      if (val) qtyByValue.set(val, 0);
    }
    for (const row of rows) {
      const map = wixVariantChoiceMap(row);
      const selected = map[axisName] ?? Object.values(map)[0];
      if (!selected) continue;
      const qty = Math.max(0, row.stock?.quantity ?? 0);
      setOptionQty(qtyByValue, selected, qty);
    }
    const options = [...qtyByValue.entries()].map(([value, quantity]) => ({ value, quantity }));
    return options.length > 0 ? [{ name: axisName, options }] : null;
  }

  // Multiple option types: one INW axis with combined labels ("M / Red").
  if (rows.length > 0) {
    const comboQty = new Map<string, number>();
    for (const row of rows) {
      const map = wixVariantChoiceMap(row);
      const parts = Object.entries(map)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([, v]) => v);
      const label = parts.join(" / ");
      if (!label) continue;
      comboQty.set(label, Math.max(0, row.stock?.quantity ?? 0));
    }
    if (comboQty.size === 0) return null;
    const axisName =
      productOptions.length > 1
        ? productOptions
            .map((o) => o.name?.trim())
            .filter(Boolean)
            .join(" & ")
        : "Variant";
    return [
      {
        name: axisName.slice(0, 80) || "Variant",
        options: [...comboQty.entries()].map(([value, quantity]) => ({ value, quantity })),
      },
    ];
  }

  // Options defined but no variant rows returned — import structure without qty.
  if (productOptions.length > 0) {
    return productOptions.map((po) => ({
      name: po.name!.trim(),
      options: (po.choices ?? [])
        .map((c) => ({
          value: String(c.description ?? c.value ?? "").trim(),
          quantity: 0,
        }))
        .filter((o) => o.value),
    }));
  }

  return null;
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

type WixCollection = { id?: string; name?: string };

/** Find or create a Wix collection by INW category label. */
export async function ensureWixCollection(
  accessToken: string,
  collectionName: string,
  opts: WixRequestOpts,
  v1: boolean
): Promise<string | null> {
  const name = collectionName.trim().slice(0, 80);
  if (!name) return null;
  try {
    if (v1) {
      const list = await wixGet<{ collections?: WixCollection[] }>(
        accessToken,
        `/stores/v1/collections/query`,
        opts
      ).catch(() => null);
      const existing = list?.collections?.find(
        (c) => c.name?.toLowerCase() === name.toLowerCase()
      );
      if (existing?.id) return existing.id;
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
  const axes = normalizeVariantsFromProvider("wix", item.variants) as InwVariantAxis[] | null;
  if (!axes || axes.length === 0) return null;

  const primary = axes[0];
  const productOptions = [
    {
      name: primary.name,
      choices: primary.options.map((o) => ({ value: o.value, description: o.value })),
    },
  ];
  const variants = primary.options.map((o) => ({
    choices: { [primary.name]: o.value },
    stock: { trackInventory: true, quantity: o.quantity, inStock: o.quantity > 0 },
    priceData: { price: Math.max(0, item.priceCents) / 100 },
  }));

  return { product: { productOptions, variants } };
}

function inwPrimaryAxis(item: SyncStoreItem): InwVariantAxis | null {
  const axes = normalizeVariantsFromProvider("wix", item.variants) as InwVariantAxis[] | null;
  return axes?.[0] ?? null;
}

/** True when INW option name + value set matches Wix productOptions (single axis). */
export function wixOptionStructureMatches(
  item: SyncStoreItem,
  existing: WixV1Product | null | undefined
): boolean {
  const primary = inwPrimaryAxis(item);
  if (!primary || !existing) return false;

  const inwValues = new Set(
    primary.options.map((o) => o.value.trim().toLowerCase()).filter(Boolean)
  );
  const existingRows = existing.variants?.filter((v) => v.id) ?? [];
  const wixOptions =
    existing.productOptions?.filter((po) => po.name?.trim() && (po.choices?.length ?? 0) > 0) ?? [];

  if (wixOptions.length === 1) {
    const wixOpt = wixOptions[0];
    const wixName = wixOpt.name?.trim().toLowerCase() ?? "";
    if (wixName && wixName !== primary.name.trim().toLowerCase()) return false;
    const wixValues = new Set(
      (wixOpt.choices ?? [])
        .map((c) => String(c.description ?? c.value ?? "").trim().toLowerCase())
        .filter(Boolean)
    );
    if (inwValues.size !== wixValues.size) return false;
    for (const v of inwValues) {
      if (!wixValues.has(v)) return false;
    }
    return true;
  }

  if (existingRows.length > 0) {
    const wixValues = new Set<string>();
    for (const row of existingRows) {
      for (const v of Object.values(wixVariantChoiceMap(row))) {
        if (v.trim()) wixValues.add(v.trim().toLowerCase());
      }
    }
    if (inwValues.size !== wixValues.size) return false;
    for (const v of inwValues) {
      if (!wixValues.has(v)) return false;
    }
    return true;
  }

  return false;
}

/**
 * PATCH existing variant rows by id (stock + price only). Wix rejects productOptions changes
 * when the product already has variants — omit productOptions entirely.
 */
export function buildWixV1ExistingVariantsPatchBody(
  item: SyncStoreItem,
  existing: WixV1Product
): Record<string, unknown> | null {
  const primary = inwPrimaryAxis(item);
  if (!primary) return null;

  const qtyByValue = new Map(
    primary.options.map((o) => [o.value.trim().toLowerCase(), Math.max(0, o.quantity)])
  );
  const price = Math.max(0, item.priceCents) / 100;
  const rows = existing.variants?.filter((v) => v.id) ?? [];
  if (rows.length === 0) return null;

  const variants: Record<string, unknown>[] = [];
  for (const row of rows) {
    const map = wixVariantChoiceMap(row);
    const axisKey =
      Object.keys(map).find((k) => k.toLowerCase() === primary.name.trim().toLowerCase()) ??
      Object.keys(map)[0];
    const selected = axisKey ? map[axisKey] : Object.values(map)[0];
    const qty = selected ? (qtyByValue.get(selected.trim().toLowerCase()) ?? 0) : 0;
    variants.push({
      id: row.id,
      stock: { trackInventory: true, quantity: qty, inStock: qty > 0 },
      priceData: { price },
    });
  }
  return variants.length > 0 ? { product: { variants } } : null;
}

/** INW option value -> quantity (lowercased keys) for the listing's single axis. */
function inwQtyByValue(item: SyncStoreItem): { axisName: string; qty: Map<string, number> } | null {
  const primary = inwPrimaryAxis(item);
  if (!primary) return null;
  return {
    axisName: primary.name.trim().toLowerCase(),
    qty: new Map(primary.options.map((o) => [o.value.trim().toLowerCase(), Math.max(0, o.quantity)])),
  };
}

/** The option value a v1 product variant row represents (for the listing's axis). */
function v1VariantSelectedValue(row: WixV1VariantRow, axisNameLower: string): string | null {
  const map = wixVariantChoiceMap(row);
  const axisKey =
    Object.keys(map).find((k) => k.toLowerCase() === axisNameLower) ?? Object.keys(map)[0];
  const selected = axisKey ? map[axisKey] : Object.values(map)[0];
  return selected ? selected.trim().toLowerCase() : null;
}

type V2InventoryItem = {
  id?: string;
  productId?: string;
  trackQuantity?: boolean;
  variants?: { variantId?: string; quantity?: number; inStock?: boolean }[];
};

/**
 * Push per-option stock via Stores v2. Wix keys inventory by the inventory item's OWN variantIds
 * (which can differ from the v1 product variant ids), so we PATCH only those ids and resolve each
 * one's quantity by bridging to the v1 product's choice value (id match, then index alignment).
 * Returns false (instead of zeroing) when the structure has not propagated, so the caller surfaces
 * a clear error rather than wiping Wix stock.
 */
export async function pushWixV1PerOptionInventory(
  accessToken: string,
  productId: string,
  item: SyncStoreItem,
  opts: WixRequestOpts
): Promise<boolean> {
  const inw = inwQtyByValue(item);
  if (!inw) return false;

  const fetchInventory = () =>
    wixGet<{ inventoryItem?: V2InventoryItem }>(
      accessToken,
      `/stores/v2/inventoryItems/product/${encodeURIComponent(productId)}`,
      opts
    ).catch(() => null);

  let product = await fetchWixV1Product(accessToken, productId, opts);
  let inv = await fetchInventory();
  let v1vars = product?.variants?.filter((v) => v.id) ?? [];
  let v2vars = (inv?.inventoryItem?.variants ?? []).filter((v) => v.variantId);

  // No managed variants yet (or only the default row): create the option structure first, then refetch.
  if (v1vars.length === 0 || v2vars.length <= 1) {
    const structureOk = await pushWixV1OptionsUpdate(accessToken, productId, item, opts);
    if (!structureOk) return false;
    product = await fetchWixV1Product(accessToken, productId, opts);
    inv = await fetchInventory();
    v1vars = product?.variants?.filter((v) => v.id) ?? [];
    v2vars = (inv?.inventoryItem?.variants ?? []).filter((v) => v.variantId);
  }

  // Without v2 inventory variant ids there is nothing valid to PATCH — bail rather than guess.
  if (v2vars.length === 0) return false;

  const v1ById = new Map(v1vars.map((v) => [v.id as string, v]));
  const sameCount = v1vars.length === v2vars.length;

  const variants: { variantId: string; quantity: number; inStock: boolean }[] = [];
  let resolved = 0;
  for (let i = 0; i < v2vars.length; i++) {
    const v2 = v2vars[i];
    const variantId = v2.variantId as string;
    // Bridge v2 variant -> v1 variant: prefer shared id, fall back to index when counts match.
    const v1row = v1ById.get(variantId) ?? (sameCount ? v1vars[i] : undefined);
    const value = v1row ? v1VariantSelectedValue(v1row, inw.axisName) : null;
    const qty = value != null ? inw.qty.get(value) : undefined;
    if (qty == null) {
      // Keep Wix's current quantity for anything we can't confidently map.
      variants.push({ variantId, quantity: Math.max(0, v2.quantity ?? 0), inStock: (v2.quantity ?? 0) > 0 });
      continue;
    }
    resolved += 1;
    variants.push({ variantId, quantity: qty, inStock: qty > 0 });
  }

  // Could not map any variant to an INW option -> structure mismatch; do not wipe Wix to zeros.
  if (resolved === 0) return false;

  await wixJson(
    accessToken,
    `/stores/v2/inventoryItems/product/${encodeURIComponent(productId)}`,
    "PATCH",
    {
      inventoryItem: {
        ...(inv?.inventoryItem?.id ? { id: inv.inventoryItem.id } : {}),
        productId,
        trackQuantity: true,
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
  const primary = inwPrimaryAxis(item);
  if (!primary) return false;

  const product = await fetchWixV1Product(accessToken, productId, opts);
  const existingRows = product?.variants?.filter((v) => v.id) ?? [];

  if (existingRows.length > 0) {
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
