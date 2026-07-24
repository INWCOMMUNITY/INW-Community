import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import {
  shopifyWebhookShopDomain,
  shopifyWebhookTopic,
  verifyShopifyWebhook,
} from "@/lib/channels/shopify/webhook";
import { reconcileConnectionSales } from "@/lib/channels/reconcile";
import { reconcileConnectionInboundCatalog } from "@/lib/channels/reconcile-inbound-catalog";
import { getConnectionContext } from "@/lib/channels/connection";
import { getAdapter } from "@/lib/channels/registry";
import { applyRemoteQuantityToStoreItem } from "@/lib/channels/apply-remote-listing";
import { syncInventoryToChannels } from "@/lib/channels/sync-inventory";
import {
  logWebhookEvent,
  markWebhookProcessing,
  markWebhookCompleted,
  markWebhookFailed,
} from "@/lib/channels/webhook-event";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Shopify webhook receiver.
 * Register in Partner Dashboard / Admin:
 * - orders/paid
 * - inventory_levels/update
 * - products/update
 * - products/delete
 * Delivery URL: https://yoursite.com/api/channels/shopify/webhook
 */
export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  if (!verifyShopifyWebhook(rawBody, req.headers)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const topic = shopifyWebhookTopic(req.headers);
  const shop = shopifyWebhookShopDomain(req.headers);

  let payload: unknown = null;
  try {
    payload = rawBody ? JSON.parse(rawBody) : null;
  } catch {
    payload = null;
  }

  const webhookEventId = await logWebhookEvent(
    "shopify",
    topic ?? "unknown",
    payload,
    shop ?? undefined
  );

  try {
    await markWebhookProcessing(webhookEventId);

    if (!shop) {
      console.warn("[shopify webhook] missing shop domain", { topic });
      await markWebhookFailed(webhookEventId, "Missing shop domain");
      return NextResponse.json({ ok: false, error: "Missing shop domain" }, { status: 400 });
    }

    const conn = await prisma.channelConnection.findFirst({
      where: {
        provider: "shopify",
        OR: [{ externalShopId: shop }, { externalShopId: shop.replace(/\.myshopify\.com$/, "") }],
        status: { not: "disconnected" },
      },
    });
    if (!conn) {
      console.warn("[shopify webhook] no connection", { shop, topic });
      await markWebhookCompleted(webhookEventId);
      return NextResponse.json({ ok: true, skipped: "no_connection" });
    }

    if (topic === "orders/paid") {
      await reconcileConnectionSales(conn);
      await markWebhookCompleted(webhookEventId);
      return NextResponse.json({ ok: true, processed: true, topic });
    }

    if (topic === "products/update" || topic === "products/delete") {
      await reconcileConnectionInboundCatalog(conn);
      await markWebhookCompleted(webhookEventId);
      return NextResponse.json({ ok: true, processed: true, topic });
    }

    if (topic === "inventory_levels/update") {
      const body = payload as {
        inventory_item_id?: number;
        available?: number;
        location_id?: number;
      } | null;
      if (body?.inventory_item_id == null || typeof body.available !== "number") {
        await reconcileConnectionInboundCatalog(conn);
        await markWebhookCompleted(webhookEventId);
        return NextResponse.json({ ok: true, processed: true, topic });
      }

      const ctx = await getConnectionContext(conn);
      if (!ctx) {
        await markWebhookFailed(webhookEventId, "Connection context unavailable");
        return NextResponse.json({ ok: false, error: "Connection context unavailable" }, { status: 500 });
      }
      const adapter = getAdapter("shopify");
      if (!adapter.fetchProductQuantity) {
        await reconcileConnectionInboundCatalog(conn);
        await markWebhookCompleted(webhookEventId);
        return NextResponse.json({ ok: true, processed: true, topic });
      }

      const links = await prisma.channelListingLink.findMany({
        where: { connectionId: conn.id, provider: "shopify", syncEnabled: true },
        select: { id: true, storeItemId: true, externalListingId: true },
      });

      for (const link of links) {
        const { quantity, known } = await adapter.fetchProductQuantity(
          ctx,
          link.externalListingId
        );
        if (!known) continue;
        const changed = await applyRemoteQuantityToStoreItem(link.storeItemId, quantity);
        if (changed) {
          await prisma.channelListingLink.update({
            where: { id: link.id },
            data: {
              syncBaselineQty: quantity,
              syncBaselineAt: new Date(),
              lastInboundAt: new Date(),
            },
          });
          await syncInventoryToChannels(link.storeItemId, { skipProviders: ["shopify"] });
        }
      }
    }

    await markWebhookCompleted(webhookEventId);
    return NextResponse.json({ ok: true, processed: true, topic });
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : String(e);
    console.error("[shopify webhook] processing failed", {
      topic,
      shop,
      error: errorMsg,
    });
    await markWebhookFailed(webhookEventId, errorMsg);
    return NextResponse.json({ ok: false, error: "Webhook processing failed" }, { status: 500 });
  }
}
