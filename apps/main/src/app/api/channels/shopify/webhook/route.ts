import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import {
  shopifyWebhookShopDomain,
  shopifyWebhookTopic,
  verifyShopifyWebhook,
} from "@/lib/channels/shopify/webhook";
import { reconcileConnectionSales } from "@/lib/channels/reconcile";
import { getConnectionContext } from "@/lib/channels/connection";
import {
  applyShopifyInventoryWebhook,
  applyShopifyProductWebhook,
  stampShopifyWebhookReceipt,
} from "@/lib/channels/shopify/apply-webhook";
import {
  logWebhookEvent,
  markWebhookProcessing,
  markWebhookCompleted,
  markWebhookFailed,
} from "@/lib/channels/webhook-event";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Shopify webhook receiver. Subscriptions are created on connect via Admin API
 * (`ensureShopifyWebhooks`) for orders/paid, inventory_levels/update, products/update|delete.
 */
export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  if (!verifyShopifyWebhook(rawBody, req.headers)) {
    console.warn("[shopify webhook] invalid hmac", {
      topic: req.headers.get("x-shopify-topic"),
      shop: req.headers.get("x-shopify-shop-domain"),
    });
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

    await stampShopifyWebhookReceipt(conn.id, topic);

    if (topic === "orders/paid") {
      await reconcileConnectionSales(conn);
      await markWebhookCompleted(webhookEventId);
      return NextResponse.json({ ok: true, processed: true, topic });
    }

    if (topic === "products/update" || topic === "products/delete") {
      const result = await applyShopifyProductWebhook({
        connection: conn,
        topic,
        payload,
      });
      console.log("[shopify webhook] product apply", { shop, topic, ...result });
      await markWebhookCompleted(webhookEventId);
      return NextResponse.json({ ok: true, processed: result.applied, topic, ...result });
    }

    if (topic === "inventory_levels/update") {
      const ctx = await getConnectionContext(conn);
      if (!ctx) {
        await markWebhookFailed(webhookEventId, "Connection context unavailable");
        return NextResponse.json({ ok: false, error: "Connection context unavailable" }, { status: 500 });
      }
      const result = await applyShopifyInventoryWebhook({
        connection: conn,
        accessToken: ctx.accessToken,
        payload,
      });
      console.log("[shopify webhook] inventory apply", { shop, topic, ...result });
      await markWebhookCompleted(webhookEventId);
      return NextResponse.json({ ok: true, processed: result.applied, topic, ...result });
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
