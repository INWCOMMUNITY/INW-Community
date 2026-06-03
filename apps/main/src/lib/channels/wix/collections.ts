import type { SyncStoreItem } from "../types";
import { normalizeVariantsFromProvider, type InwVariantAxis } from "../variant-sync";
import { wixGet, wixJson, type WixRequestOpts } from "./client";
import type { WixV1Product } from "./mapping";

/** Extract INW variant axes from a classic v1 Wix product. */
export function wixV1ProductToVariants(product: WixV1Product): InwVariantAxis[] | null {
  const rows = product.variants?.filter((v) => v.id) ?? [];
  if (rows.length <= 1 && !product.productOptions?.length) return null;

  if (product.productOptions?.length) {
    const axes: InwVariantAxis[] = product.productOptions.map((po) => ({
      name: (po.name ?? "Option").trim(),
      options: (po.choices ?? []).map((c) => ({
        value: String(c.description ?? c.value ?? c).trim(),
        quantity: 0,
      })),
    }));
    for (const row of rows) {
      const qty = Math.max(0, row.stock?.quantity ?? 0);
      const label =
        row.choices?.map((c) => c.description ?? c.value).filter(Boolean).join(" / ") ||
        row.variant?.choices?.map((c) => c.description).join(" / ");
      if (!label) continue;
      for (const axis of axes) {
        const opt = axis.options.find((o) => label.includes(o.value));
        if (opt) opt.quantity = qty;
      }
    }
    return axes.some((a) => a.options.length > 0) ? axes : null;
  }

  if (rows.length > 1) {
    return [
      {
        name: "Variant",
        options: rows.map((v) => ({
          value: v.choices?.[0]?.description ?? v.id ?? "Default",
          quantity: Math.max(0, v.stock?.quantity ?? 0),
        })),
      },
    ];
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
    choices: [{ description: o.value }],
    stock: { trackInventory: true, quantity: o.quantity, inStock: o.quantity > 0 },
    priceData: { price: Math.max(0, item.priceCents) / 100 },
  }));

  return { product: { productOptions, variants } };
}
