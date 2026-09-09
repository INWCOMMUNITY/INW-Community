import { etsyGet, etsyJson } from "./client";
import {
  pickImageVaryingAxisName,
  type VariantMatrix,
} from "@/lib/listing-variant-matrix";
import { variantsToMatrix } from "../variant-sync";
import type { SyncStoreItem } from "../types";
import { etsyListListingImages, type EtsyListingImage } from "./photos";

export type EtsyVariationImageLink = {
  property_id: number;
  value_id: number;
  image_id: number;
};

type InventoryProduct = {
  property_values?: {
    property_id?: number;
    property_name?: string;
    value_ids?: number[];
    values?: string[];
  }[];
};

function urlKey(url: string): string {
  return url.split("?")[0].trim();
}

/**
 * Pair one image-varying axis (usually Color) to listing images.
 * Uses listing-specific value_ids from inventory, not taxonomy globals.
 */
export function buildEtsyVariationImageLinks(args: {
  products: InventoryProduct[];
  images: EtsyListingImage[];
  matrix: VariantMatrix;
}): EtsyVariationImageLink[] {
  const axisName = pickImageVaryingAxisName(args.matrix);
  const axis = args.matrix.axes.find((a) => a.name === axisName);
  if (!axis) return [];

  const imageByUrl = new Map<string, number>();
  for (const img of args.images) {
    const src = img.url_fullxfull || img.url_570xN;
    if (src && img.listing_image_id) imageByUrl.set(urlKey(src), img.listing_image_id);
  }

  const seen = new Set<string>();
  const out: EtsyVariationImageLink[] = [];
  for (const product of args.products) {
    for (const pv of product.property_values ?? []) {
      if ((pv.property_name ?? "").trim().toLowerCase() !== axisName.toLowerCase()) continue;
      const propertyId = pv.property_id;
      const valueId = pv.value_ids?.[0];
      const value = pv.values?.[0]?.trim();
      if (propertyId == null || valueId == null || !value) continue;
      const key = `${propertyId}:${valueId}`;
      if (seen.has(key)) continue;
      const photos =
        axis.photosByValue?.[value] ??
        args.matrix.skus.find((s) => s.options[axisName] === value)?.photos;
      const photo = photos?.[0];
      if (!photo) continue;
      const imageId = imageByUrl.get(urlKey(photo));
      if (imageId == null) continue;
      seen.add(key);
      out.push({ property_id: propertyId, value_id: valueId, image_id: imageId });
    }
  }
  return out;
}

export async function updateEtsyVariationImages(args: {
  accessToken: string;
  shopId: string;
  listingId: string;
  links: EtsyVariationImageLink[];
}): Promise<void> {
  if (args.links.length === 0) return;
  await etsyJson(
    args.accessToken,
    `/shops/${args.shopId}/listings/${args.listingId}/variation-images`,
    "POST",
    { variation_images: args.links }
  );
}

export async function syncEtsyVariationImagesFromItem(args: {
  accessToken: string;
  shopId: string;
  listingId: string;
  item: SyncStoreItem;
}): Promise<void> {
  const matrix = variantsToMatrix(args.item.variants);
  if (!matrix) return;
  const inv = await etsyGet<{ products?: InventoryProduct[] }>(
    args.accessToken,
    `/listings/${args.listingId}/inventory`
  );
  const images = await etsyListListingImages(args.accessToken, args.listingId);
  if (!images?.length) return;
  const links = buildEtsyVariationImageLinks({
    products: inv.products ?? [],
    images,
    matrix,
  });
  await updateEtsyVariationImages({
    accessToken: args.accessToken,
    shopId: args.shopId,
    listingId: args.listingId,
    links,
  });
}
