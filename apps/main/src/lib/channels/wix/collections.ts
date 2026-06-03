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

/** Build v1 productOptions + variants from INW axes for create/update. */
export function buildWixV1OptionsBody(
  item: SyncStoreItem,
  existing?: WixV1Product | null
): Record<string, unknown> | null {
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

/** Push per-option stock to a v1 Wix product (PATCH productOptions + variants). */
export async function pushWixV1PerOptionInventory(
  accessToken: string,
  productId: string,
  item: SyncStoreItem,
  opts: WixRequestOpts
): Promise<boolean> {
  const got = await wixGet<{ product?: WixV1Product }>(
    accessToken,
    `/stores/v1/products/${encodeURIComponent(productId)}`,
    opts
  ).catch(() => null);
  const optionsBody = buildWixV1OptionsBody(item, got?.product ?? null);
  if (!optionsBody) return false;
  await wixJson(
    accessToken,
    `/stores/v1/products/${encodeURIComponent(productId)}`,
    "PATCH",
    optionsBody,
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
  return got?.product ?? null;
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
