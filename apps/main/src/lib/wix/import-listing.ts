import {
  beginWixListingImportAttempt,
  completeWixListingImportAttempt,
  createWixImportedListingMapping,
  failWixListingImportAttempt,
  prisma,
  projectStoreItemQuantity,
  refreshWixListingHealthFromDb,
  type WixPublicConnection,
  type WixVariantMappingInput,
} from "database";
import { readWixAppConfig } from "./config";
import { accessTokenForWixConnection } from "./connect";
import { wixApplicationRequest, type WixFetch } from "./client";
import {
  WIX_V1_PRODUCT_GET,
  WIX_V3_PRODUCTS,
  WIX_CATALOG_V1,
} from "./constants";

export type ImportWixProductInput = {
  connection: WixPublicConnection;
  wixProductId: string;
  stockMode: "PHYSICAL" | "MADE_TO_ORDER";
  fetchImpl?: WixFetch;
};

export type ImportWixProductResult =
  | { status: "IMPORTED"; storeItemId: string; listingLinkId: string }
  | { status: "ALREADY_IMPORTING"; attemptId: string }
  | { status: "ALREADY_IMPORTED"; storeItemId: string; listingLinkId: string }
  | { status: "PRODUCT_NOT_FOUND" }
  | { status: "FAILED"; code: string; message: string };

type WixV1ProductFull = {
  id?: string;
  name?: string;
  description?: string;
  priceData?: { price?: number; currency?: string };
  media?: { mainMedia?: { image?: { url?: string } }; items?: Array<{ image?: { url?: string } }> };
  visible?: boolean;
  productOptions?: Array<{ name?: string; choices?: Array<{ value?: string; description?: string }> }>;
  variants?: Array<{
    id?: string;
    choices?: Record<string, string>;
    priceData?: { price?: number };
    stock?: { quantity?: number; trackQuantity?: boolean };
    sku?: string;
  }>;
  stock?: { quantity?: number; trackQuantity?: boolean };
  sku?: string;
};

type WixV3ProductFull = {
  id?: string;
  name?: string;
  description?: string;
  priceData?: { price?: string; currency?: string };
  media?: { mainMedia?: { image?: { url?: string } }; items?: Array<{ image?: { url?: string } }> };
  visible?: boolean;
  productOptions?: Array<{ name?: string; choices?: Array<{ value?: string; description?: string }> }>;
  variants?: Array<{
    id?: string;
    choices?: Record<string, string>;
    priceData?: { price?: string };
    stock?: { quantity?: number; trackInventory?: boolean };
    sku?: string;
  }>;
  stock?: { quantity?: number; trackInventory?: boolean };
  sku?: string;
};

function parsePhotos(media: { mainMedia?: { image?: { url?: string } }; items?: Array<{ image?: { url?: string } }> } | undefined): string[] {
  const photos: string[] = [];
  if (media?.mainMedia?.image?.url) {
    photos.push(media.mainMedia.image.url);
  }
  if (media?.items) {
    for (const item of media.items) {
      if (item.image?.url && !photos.includes(item.image.url)) {
        photos.push(item.image.url);
      }
    }
  }
  return photos;
}

function priceInCents(price: number | string | undefined): number {
  if (price === undefined) return 0;
  const num = typeof price === "string" ? parseFloat(price) : price;
  if (!Number.isFinite(num) || num < 0) return 0;
  return Math.round(num * 100);
}

/**
 * Import a Wix product into INW foundation (StoreItem + StoreVariants + InventoryState).
 */
export async function importWixProduct(
  input: ImportWixProductInput
): Promise<ImportWixProductResult> {
  const config = readWixAppConfig();
  if (!config) {
    return { status: "FAILED", code: "NOT_CONFIGURED", message: "Wix is not configured" };
  }

  const { connection, wixProductId, stockMode } = input;

  const connWithMember = await prisma.wixConnection.findUnique({
    where: { id: connection.id },
    select: { memberId: true },
  });
  if (!connWithMember) {
    return { status: "FAILED", code: "CONNECTION_NOT_FOUND", message: "Connection not found" };
  }
  const memberId = connWithMember.memberId;

  const attemptResult = await beginWixListingImportAttempt(prisma, {
    wixConnectionId: connection.id,
    memberId,
    wixProductId,
    stockMode,
  });

  if (attemptResult.status === "ALREADY_IMPORTING") {
    return { status: "ALREADY_IMPORTING", attemptId: attemptResult.attemptId };
  }
  if (attemptResult.status === "ALREADY_COMPLETED") {
    return {
      status: "ALREADY_IMPORTED",
      storeItemId: attemptResult.storeItemId ?? "",
      listingLinkId: attemptResult.listingLinkId ?? "",
    };
  }

  const attempt = attemptResult.attempt;

  try {
    // Fetch full product from Wix
    const accessToken = await accessTokenForWixConnection(connection);
    const isV1 = connection.catalogVersion === WIX_CATALOG_V1;

    let productData: {
      id: string;
      name: string;
      description: string | null;
      priceCents: number;
      photos: string[];
      sku: string | null;
      variants: Array<{
        wixVariantId: string;
        options: Record<string, string>;
        priceCents: number;
        quantity: number | null;
        sku: string | null;
      }>;
      totalQuantity: number | null;
    } | null = null;

    if (isV1) {
      const result = await wixApplicationRequest<{ product?: WixV1ProductFull }>({
        method: "GET",
        path: `${WIX_V1_PRODUCT_GET}/${wixProductId}`,
        deps: { config, accessToken, fetchImpl: input.fetchImpl },
      });

      if (!result.ok || !result.data?.product) {
        await failWixListingImportAttempt(prisma, {
          attemptId: attempt.id,
          failureCode: "PRODUCT_NOT_FOUND",
          failureMessage: "Product not found on Wix",
        });
        return { status: "PRODUCT_NOT_FOUND" };
      }

      const p = result.data.product;
      if (!p.id || !p.name) {
        await failWixListingImportAttempt(prisma, {
          attemptId: attempt.id,
          failureCode: "INVALID_PRODUCT",
          failureMessage: "Product data is incomplete",
        });
        return { status: "FAILED", code: "INVALID_PRODUCT", message: "Product data is incomplete" };
      }

      const hasOptions = (p.productOptions?.length ?? 0) > 0 && (p.variants?.length ?? 0) > 0;
      const variants = hasOptions
        ? (p.variants ?? []).map((v) => ({
            wixVariantId: v.id ?? p.id!,
            options: v.choices ?? {},
            priceCents: priceInCents(v.priceData?.price ?? p.priceData?.price),
            quantity: v.stock?.trackQuantity ? (v.stock?.quantity ?? null) : null,
            sku: v.sku ?? null,
          }))
        : [{
            wixVariantId: p.id!,
            options: {},
            priceCents: priceInCents(p.priceData?.price),
            quantity: p.stock?.trackQuantity ? (p.stock?.quantity ?? null) : null,
            sku: p.sku ?? null,
          }];

      productData = {
        id: p.id,
        name: p.name,
        description: p.description || null,
        priceCents: priceInCents(p.priceData?.price),
        photos: parsePhotos(p.media),
        sku: p.sku || null,
        variants,
        totalQuantity: p.stock?.trackQuantity ? (p.stock?.quantity ?? null) : null,
      };
    } else {
      const result = await wixApplicationRequest<{ product?: WixV3ProductFull }>({
        method: "GET",
        path: `${WIX_V3_PRODUCTS}/${wixProductId}`,
        deps: { config, accessToken, fetchImpl: input.fetchImpl },
      });

      if (!result.ok || !result.data?.product) {
        await failWixListingImportAttempt(prisma, {
          attemptId: attempt.id,
          failureCode: "PRODUCT_NOT_FOUND",
          failureMessage: "Product not found on Wix",
        });
        return { status: "PRODUCT_NOT_FOUND" };
      }

      const p = result.data.product;
      if (!p.id || !p.name) {
        await failWixListingImportAttempt(prisma, {
          attemptId: attempt.id,
          failureCode: "INVALID_PRODUCT",
          failureMessage: "Product data is incomplete",
        });
        return { status: "FAILED", code: "INVALID_PRODUCT", message: "Product data is incomplete" };
      }

      const hasOptions = (p.productOptions?.length ?? 0) > 0 && (p.variants?.length ?? 0) > 0;
      const variants = hasOptions
        ? (p.variants ?? []).map((v) => ({
            wixVariantId: v.id ?? p.id!,
            options: v.choices ?? {},
            priceCents: priceInCents(v.priceData?.price ?? p.priceData?.price),
            quantity: v.stock?.trackInventory ? (v.stock?.quantity ?? null) : null,
            sku: v.sku ?? null,
          }))
        : [{
            wixVariantId: p.id!,
            options: {},
            priceCents: priceInCents(p.priceData?.price),
            quantity: p.stock?.trackInventory ? (p.stock?.quantity ?? null) : null,
            sku: p.sku ?? null,
          }];

      productData = {
        id: p.id,
        name: p.name,
        description: p.description || null,
        priceCents: priceInCents(p.priceData?.price),
        photos: parsePhotos(p.media),
        sku: p.sku || null,
        variants,
        totalQuantity: p.stock?.trackInventory ? (p.stock?.quantity ?? null) : null,
      };
    }

    // Create StoreItem + StoreVariants + InventoryState in a transaction
    const result = await prisma.$transaction(async (tx) => {
      // Generate a unique slug
      const slugBase = productData!.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 50);
      const slug = `${slugBase}-${Date.now().toString(36)}`;

      const storeItem = await tx.storeItem.create({
        data: {
          memberId,
          title: productData!.name,
          description: productData!.description,
          priceCents: productData!.priceCents,
          photos: productData!.photos,
          sku: productData!.sku,
          slug,
          quantity: 0,
          status: stockMode === "MADE_TO_ORDER" ? "active" : "sold_out",
          inventoryTracking: stockMode === "MADE_TO_ORDER" ? "made_to_order" : "tracked",
        },
      });

      // Create StoreVariants and InventoryState
      const variantMappings: WixVariantMappingInput[] = [];
      
      for (let i = 0; i < productData!.variants.length; i++) {
        const v = productData!.variants[i]!;
        const isDefault = i === 0;

        const storeVariant = await tx.storeVariant.create({
          data: {
            memberId,
            storeItemId: storeItem.id,
            isDefault,
            sku: v.sku,
            options: v.options,
            priceCents: v.priceCents,
            status: "ACTIVE",
          },
        });

        // Create InventoryState
        const inventoryMode = stockMode === "MADE_TO_ORDER" ? "MADE_TO_ORDER" : "TRACKED_FINITE";
        await tx.inventoryState.create({
          data: {
            variantId: storeVariant.id,
            memberId,
            storeItemId: storeItem.id,
            mode: inventoryMode,
            onHand: stockMode === "PHYSICAL" ? (v.quantity ?? 0) : null,
            reserved: stockMode === "PHYSICAL" ? 0 : null,
          },
        });

        variantMappings.push({
          storeVariantId: storeVariant.id,
          wixVariantId: v.wixVariantId,
          choicesJson: Object.keys(v.options).length > 0 ? v.options : undefined,
          remoteSku: v.sku,
        });
      }

      if (stockMode === "PHYSICAL") {
        const quantity = await projectStoreItemQuantity(tx, storeItem.id);
        await tx.storeItem.update({
          where: { id: storeItem.id },
          data: { status: quantity > 0 ? "active" : "sold_out" },
        });
      }

      // Create WixListingLink + WixVariantMaps
      const mapping = await createWixImportedListingMapping(tx, {
        wixConnectionId: connection.id,
        memberId,
        storeItemId: storeItem.id,
        wixProductId: productData!.id,
        variants: variantMappings,
        bootstrapStartedAt: attempt.bootstrapStartedAt,
      });

      return {
        storeItemId: storeItem.id,
        listingLinkId: mapping.listingLink.id,
      };
    });

    // Mark import attempt as completed
    await completeWixListingImportAttempt(prisma, {
      attemptId: attempt.id,
      storeItemId: result.storeItemId,
      listingLinkId: result.listingLinkId,
    });
    await prisma.wixListingLink.update({
      where: { id: result.listingLinkId },
      data: { remoteProductVisible: true },
    });
    await refreshWixListingHealthFromDb(prisma, result.listingLinkId);

    return {
      status: "IMPORTED",
      storeItemId: result.storeItemId,
      listingLinkId: result.listingLinkId,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    await failWixListingImportAttempt(prisma, {
      attemptId: attempt.id,
      failureCode: "IMPORT_FAILED",
      failureMessage: message.slice(0, 500),
    });
    return { status: "FAILED", code: "IMPORT_FAILED", message };
  }
}
