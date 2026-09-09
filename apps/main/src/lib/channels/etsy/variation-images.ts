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

export async function fetchEtsyVariationImageLinks(
  accessToken: string,
  shopId: string,
  listingId: string
): Promise<EtsyVariationImageLink[]> {
  const res = await etsyGet<{ results?: EtsyVariationImageLink[] }>(
    accessToken,
    `/shops/${shopId}/listings/${listingId}/variation-images`
  ).catch(() => ({ results: [] as EtsyVariationImageLink[] }));
  return Array.isArray(res.results) ? res.results : [];
}

export function applyEtsyVariationImagesToMatrix(args: {
  matrix: VariantMatrix;
  products: InventoryProduct[];
  images: EtsyListingImage[];
  links: EtsyVariationImageLink[];
}): VariantMatrix {
  if (args.links.length === 0 || args.images.length === 0) return args.matrix;
  const urlByImageId = new Map<number, string>();
  for (const img of args.images) {
    const src = img.url_fullxfull || img.url_570xN;
    if (src && img.listing_image_id) urlByImageId.set(img.listing_image_id, src);
  }
  const valueByIds = new Map<string, { axis: string; value: string }>();
  for (const product of args.products) {
    for (const pv of product.property_values ?? []) {
      const axis = (pv.property_name ?? "").trim();
      const value = pv.values?.[0]?.trim();
      const propertyId = pv.property_id;
      const valueId = pv.value_ids?.[0];
      if (!axis || !value || propertyId == null || valueId == null) continue;
      valueByIds.set(`${propertyId}:${valueId}`, { axis, value });
    }
  }
  const photosByAxisValue = new Map<string, string[]>();
  for (const link of args.links) {
    const hit = valueByIds.get(`${link.property_id}:${link.value_id}`);
    const url = urlByImageId.get(link.image_id);
    if (!hit || !url) continue;
    const key = `${hit.axis.toLowerCase()}::${hit.value.toLowerCase()}`;
    const current = photosByAxisValue.get(key) ?? [];
    if (!current.includes(url)) current.push(url);
    photosByAxisValue.set(key, current);
  }
  if (photosByAxisValue.size === 0) return args.matrix;

  const counts = new Map<string, number>();
  for (const [key] of photosByAxisValue) {
    const axis = key.split("::")[0];
    counts.set(axis, (counts.get(axis) ?? 0) + 1);
  }
  let imageAxis =
    args.matrix.imageAxis?.trim() ||
    [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ||
    pickImageVaryingAxisName(args.matrix);
  const named = args.matrix.axes.find((a) => a.name.trim().toLowerCase() === imageAxis.toLowerCase());
  imageAxis = named?.name ?? imageAxis;

  const photosByValue: Record<string, string[]> = {};
  for (const [key, urls] of photosByAxisValue) {
    const [axisKey, valueKey] = key.split("::");
    if (axisKey !== imageAxis.trim().toLowerCase()) continue;
    const value = args.matrix.axes
      .find((a) => a.name.trim().toLowerCase() === axisKey)
      ?.values.find((v) => v.trim().toLowerCase() === valueKey);
    if (value) photosByValue[value] = urls;
  }

  return {
    ...args.matrix,
    imageAxis,
    axes: args.matrix.axes.map((a) =>
      a.name === imageAxis && Object.keys(photosByValue).length > 0
        ? { ...a, photosByValue }
        : a
    ),
    skus: args.matrix.skus.map((s) => {
      const value = s.options[imageAxis];
      const photos = value ? photosByValue[value] : undefined;
      return photos?.length ? { ...s, photos } : s;
    }),
  };
}

export async function attachEtsyVariationPhotosToMatrix(args: {
  accessToken: string;
  shopId: string;
  listingId: string;
  matrix: VariantMatrix;
  products: InventoryProduct[];
}): Promise<VariantMatrix> {
  const [images, links] = await Promise.all([
    etsyListListingImages(args.accessToken, args.listingId),
    fetchEtsyVariationImageLinks(args.accessToken, args.shopId, args.listingId),
  ]);
  return applyEtsyVariationImagesToMatrix({
    matrix: args.matrix,
    products: args.products,
    images: images ?? [],
    links,
  });
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
