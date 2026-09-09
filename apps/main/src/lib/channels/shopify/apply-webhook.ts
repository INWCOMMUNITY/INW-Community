import { prisma } from "database";
import {
  applyRemoteContentToStoreItem,
  applyRemoteQuantityToStoreItem,
  inboundDescriptionsMatch,
  remoteTitleOrPriceDiffersFromStoreItem,
} from "../apply-remote-listing";
import { applyRemoteCategoryToStoreItem, applyRemoteVariantsToStoreItem } from "../apply-remote-meta";
import { persistRemoteDeletedPending } from "../listing-link-flags";
import { updateStoreItemOnChannels } from "../outbound";
import { syncInventoryToChannels } from "../sync-inventory";
import { inboundListingPhotosDiffer } from "../photo-urls";
import { SYNC_ECHO_SKEW_MS } from "../sync-baseline";
import { patchChannelConnectionConfig } from "../connection";
import { shopifyGet } from "./client";
import { readShopifyConfig } from "./config";
import { shopifyProductToSummary, type ShopifyProduct } from "./mapping";

type ConnectionRow = {
  id: string;
  memberId: string;
  provider: string;
  externalShopId: string | null;
  config?: unknown;
  accessTokenEncrypted?: string | null;
};

export function parseShopifyWebhookProduct(payload: unknown): ShopifyProduct | null {
  if (!payload || typeof payload !== "object") return null;
  const o = payload as Record<string, unknown>;
  if (o.product && typeof o.product === "object") {
    return o.product as ShopifyProduct;
  }
  if (o.id != null) return o as ShopifyProduct;
  return null;
}

/** Pull Shopify-originated edits immediately. Ignore photo-only echoes of our own push. */
export function shopifyWebhookShouldPull(args: {
  lastPushedAt: Date | null;
  titleOrPriceDiffers: boolean;
  descriptionDiffers: boolean;
  qtyDiffers: boolean;
  photosDiffer: boolean;
  nowMs?: number;
}): boolean {
  if (args.titleOrPriceDiffers || args.descriptionDiffers || args.qtyDiffers) return true;
  if (!args.photosDiffer) return false;
  const now = args.nowMs ?? Date.now();
  const inEcho =
    args.lastPushedAt != null && now - args.lastPushedAt.getTime() < SYNC_ECHO_SKEW_MS;
  return !inEcho;
}

function syncDirectionAllowsPull(config: unknown): boolean {
  const direction =
    config && typeof config === "object" && !Array.isArray(config)
      ? String((config as Record<string, unknown>).syncDirection ?? "two_way")
      : "two_way";
  return direction === "two_way" || direction === "pull_only";
}

export async function applyShopifyProductWebhook(args: {
  connection: ConnectionRow;
  topic: "products/update" | "products/delete";
  payload: unknown;
}): Promise<{ applied: boolean; skipped?: string }> {
  const { connection, topic, payload } = args;
  if (!syncDirectionAllowsPull(connection.config)) {
    return { applied: false, skipped: "sync_direction" };
  }

  const product = parseShopifyWebhookProduct(payload);
  const productId = product?.id != null ? String(product.id) : null;
  if (!productId) return { applied: false, skipped: "no_product_id" };

  const link = await prisma.channelListingLink.findFirst({
    where: {
      connectionId: connection.id,
      provider: "shopify",
      syncEnabled: true,
      externalListingId: productId,
    },
    select: {
      id: true,
      storeItemId: true,
      lastPushedAt: true,
      conflictDetails: true,
      storeItem: {
        select: {
          title: true,
          description: true,
          photos: true,
          priceCents: true,
          quantity: true,
          status: true,
        },
      },
    },
  });
  if (!link) return { applied: false, skipped: "no_link" };

  const status = (product?.status ?? "active").toLowerCase();
  const unpublished =
    topic === "products/delete" || status === "draft" || status === "archived";

  if (unpublished) {
    if (link.storeItem.status === "sold_out" || link.storeItem.status === "inactive") {
      return { applied: false, skipped: "already_inactive" };
    }
    const flagged = await persistRemoteDeletedPending({
      linkId: link.id,
      conflictDetails: link.conflictDetails,
      provider: "shopify",
    });
    return { applied: flagged, skipped: flagged ? undefined : "already_flagged" };
  }

  const remote = shopifyProductToSummary(product!);
  const item = link.storeItem;
  const shouldPull = shopifyWebhookShouldPull({
    lastPushedAt: link.lastPushedAt,
    titleOrPriceDiffers: remoteTitleOrPriceDiffersFromStoreItem(item, remote),
    descriptionDiffers: !inboundDescriptionsMatch(item.description, remote.description),
    qtyDiffers: remote.quantity !== item.quantity,
    photosDiffer: inboundListingPhotosDiffer(item.photos, remote.photos),
  });
  if (!shouldPull) return { applied: false, skipped: "echo_or_unchanged" };

  const pulledContent = await applyRemoteContentToStoreItem(link.storeItemId, remote);
  const pulledVariants = await applyRemoteVariantsToStoreItem(link.storeItemId, remote, "shopify");
  const pulledCategory = await applyRemoteCategoryToStoreItem(link.storeItemId, remote, "shopify");
  let pulledQty = false;
  if (!pulledVariants && remote.quantity !== item.quantity) {
    pulledQty = await applyRemoteQuantityToStoreItem(link.storeItemId, remote.quantity, {
      provider: "shopify",
      memberId: connection.memberId,
    });
  }

  const applied = pulledContent || pulledVariants || pulledCategory || pulledQty;
  if (!applied) return { applied: false, skipped: "no_field_changes" };

  await prisma.channelListingLink.update({
    where: { id: link.id },
    data: { lastInboundAt: new Date() },
  });
  if (pulledContent || pulledCategory || pulledVariants) {
    await updateStoreItemOnChannels(link.storeItemId, { skipProviders: ["shopify"] });
  }
  if (pulledQty || pulledVariants) {
    await syncInventoryToChannels(link.storeItemId, { skipProviders: ["shopify"] });
  }
  return { applied: true };
}

export async function applyShopifyInventoryWebhook(args: {
  connection: ConnectionRow;
  accessToken: string;
  payload: unknown;
}): Promise<{ applied: boolean; skipped?: string }> {
  const { connection, accessToken, payload } = args;
  if (!syncDirectionAllowsPull(connection.config)) {
    return { applied: false, skipped: "sync_direction" };
  }
  const body = payload as {
    inventory_item_id?: number;
    available?: number;
    location_id?: number;
  } | null;
  if (body?.inventory_item_id == null || typeof body.available !== "number") {
    return { applied: false, skipped: "incomplete_payload" };
  }

  const cfg = readShopifyConfig(
    (connection.config as Record<string, unknown> | null) ?? null,
    connection.externalShopId
  );
  if (!cfg.shop) return { applied: false, skipped: "no_shop" };
  if (
    cfg.locationId &&
    body.location_id != null &&
    String(body.location_id) !== String(cfg.locationId)
  ) {
    return { applied: false, skipped: "other_location" };
  }

  const links = await prisma.channelListingLink.findMany({
    where: { connectionId: connection.id, provider: "shopify", syncEnabled: true },
    select: { id: true, storeItemId: true, externalListingId: true, lastPushedAt: true },
  });

  for (const link of links) {
    let product: ShopifyProduct | null = null;
    try {
      const res = await shopifyGet<{ product?: ShopifyProduct }>(
        accessToken,
        cfg.shop,
        cfg.apiVersion,
        `/products/${link.externalListingId}.json`
      );
      product = res.product ?? null;
    } catch {
      continue;
    }
    const variant = (product?.variants ?? []).find((v) => v.inventory_item_id === body.inventory_item_id);
    if (!variant || !product) continue;

    const remote = shopifyProductToSummary({
      ...product,
      variants: (product.variants ?? []).map((v) =>
        v.inventory_item_id === body.inventory_item_id
          ? { ...v, inventory_quantity: Math.max(0, Math.round(body.available)) }
          : v
      ),
    });
    const item = await prisma.storeItem.findUnique({
      where: { id: link.storeItemId },
      select: { title: true, description: true, photos: true, priceCents: true, quantity: true },
    });
    if (!item) return { applied: false, skipped: "item_missing" };
    if (
      !shopifyWebhookShouldPull({
        lastPushedAt: link.lastPushedAt,
        titleOrPriceDiffers: false,
        descriptionDiffers: false,
        qtyDiffers: remote.quantity !== item.quantity,
        photosDiffer: false,
      })
    ) {
      return { applied: false, skipped: "echo_or_unchanged" };
    }

    const pulledVariants = await applyRemoteVariantsToStoreItem(link.storeItemId, remote, "shopify");
    let pulledQty = false;
    if (!pulledVariants) {
      pulledQty = await applyRemoteQuantityToStoreItem(link.storeItemId, remote.quantity, {
        provider: "shopify",
        memberId: connection.memberId,
      });
    }
    if (!pulledVariants && !pulledQty) return { applied: false, skipped: "no_field_changes" };
    await prisma.channelListingLink.update({
      where: { id: link.id },
      data: {
        lastInboundAt: new Date(),
        syncBaselineQty: remote.quantity,
        syncBaselineAt: new Date(),
      },
    });
    await syncInventoryToChannels(link.storeItemId, { skipProviders: ["shopify"] });
    return { applied: true };
  }

  return { applied: false, skipped: "inventory_item_unlinked" };
}

export async function stampShopifyWebhookReceipt(connectionId: string, topic: string): Promise<void> {
  await patchChannelConnectionConfig(connectionId, {
    lastShopifyWebhookAt: new Date().toISOString(),
    lastShopifyWebhookTopic: topic,
  }).catch(() => {});
}
