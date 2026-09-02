import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import {
  applyEbayXmlPostcard,
  refreshEbayListingByItemId,
} from "@/lib/channels/ebay/pull-ebay-updates";
import {
  acknowledgeRecentSalesWithoutDecrement,
  reconcileConnectionSales,
} from "@/lib/channels/reconcile";
import { verifyEbayWebhook } from "@/lib/channels/ebay/webhook";
import {
  isEbayClosedNotification,
  isEbayRelevantNotification,
  isEbaySaleNotification,
  parseEbayNotificationBody,
} from "@/lib/channels/ebay/notification-parse";
import { recordEbayWebhookReceipt } from "@/lib/channels/ebay/notifications-setup";
import {
  logWebhookEvent,
  markWebhookProcessing,
  markWebhookCompleted,
  markWebhookFailed,
} from "@/lib/channels/webhook-event";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function findConnectionByEbayUserId(ebayUserId: string) {
  return prisma.channelConnection.findFirst({
    where: {
      provider: "ebay",
      externalShopId: ebayUserId,
      status: { not: "disconnected" },
    },
  });
}

/**
 * eBay Platform Notifications + Commerce Notification receiver.
 *
 * Sale events poll orders (never apply XML qty). Revises GetItem that listing
 * with source=webhook so await-confirm does not hide a real ping. Title/price
 * XML postcard is only used when GetItem fails.
 */
export async function POST(req: NextRequest) {
  if (!verifyEbayWebhook(req)) {
    console.warn("[ebay webhook] rejected: invalid or missing secret");
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let raw: string;
  try {
    raw = await req.text();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (!raw || raw.length < 2) {
    return NextResponse.json({ error: "Empty or invalid body" }, { status: 400 });
  }

  const parsed = parseEbayNotificationBody(raw, req.headers.get("content-type"));
  const itemId = parsed.itemId;
  const eventType = parsed.eventType;
  const ebayUserId = parsed.ebayUserId;

  console.log("[ebay webhook] received notification", {
    source: parsed.source,
    length: raw.length,
    itemId,
    eventType,
    ebayUserId,
    kind: parsed.kind,
    parseable: parsed.parseable,
  });

  if (!parsed.parseable && !itemId) {
    return NextResponse.json({ ok: true, skipped: "unparseable" });
  }

  if (eventType && !isEbayRelevantNotification(eventType) && !itemId) {
    console.log("[ebay webhook] irrelevant event type, skipping", { eventType });
    return NextResponse.json({ ok: true, skipped: "irrelevant_event", eventType });
  }

  if (!itemId && !isEbaySaleNotification(eventType) && !ebayUserId) {
    console.log("[ebay webhook] no ItemID found, skipping");
    return NextResponse.json({ ok: true, skipped: "no_item_id" });
  }

  let connection = null;
  if (ebayUserId) {
    connection = await findConnectionByEbayUserId(ebayUserId);
  }

  if (!connection && itemId) {
    console.info("[ebay webhook] userId lookup missed, falling back to listing link", {
      itemId,
      ebayUserId,
    });
    const link = await prisma.channelListingLink.findFirst({
      where: {
        provider: "ebay",
        OR: [{ externalListingId: itemId }, { externalListingId: `inw${itemId}` }],
        connection: { status: { not: "disconnected" } },
      },
      include: {
        connection: true,
      },
    });
    connection = link?.connection ?? null;
    if (connection?.status === "disconnected") connection = null;
  }

  if (!connection) {
    console.log("[ebay webhook] no connection found for notification", { itemId, ebayUserId });
    return NextResponse.json({ ok: true, skipped: "unknown_seller" });
  }

  await recordEbayWebhookReceipt(connection.id, connection.config, eventType);

  const webhookEventId = await logWebhookEvent(
    "ebay",
    eventType ?? "unknown",
    { itemId, ebayUserId, source: parsed.source, xmlPreview: raw.slice(0, 500) },
    itemId ?? undefined
  );

  try {
    await markWebhookProcessing(webhookEventId);

    const { getConnectionContext } = await import("@/lib/channels/connection");
    const ctx = await getConnectionContext(connection);

    if (!ctx) {
      console.error("[ebay webhook] failed to get connection context", {
        connectionId: connection.id,
      });
      await markWebhookFailed(webhookEventId, "Failed to get connection context");
      return NextResponse.json({
        ok: true,
        processed: false,
        skipped: "connection_context",
        itemId,
        eventType,
      });
    }

    if (isEbaySaleNotification(eventType)) {
      const sales = await reconcileConnectionSales(connection);
      console.log("[ebay webhook] sale reconcile completed", {
        itemId,
        eventType,
        applied: sales.applied,
      });
      if (sales.applied === 0 && itemId) {
        await acknowledgeRecentSalesWithoutDecrement(connection);
        await refreshEbayListingByItemId(ctx.accessToken, itemId, {
          skipContent: true,
          source: "webhook",
        }).catch((e) =>
          console.warn("[ebay webhook] post-sale absolute refresh failed", {
            itemId,
            error: e instanceof Error ? e.message : String(e),
          })
        );
      }
      await markWebhookCompleted(webhookEventId);
      return NextResponse.json({ ok: true, processed: true, itemId, eventType });
    }

    if (!itemId) {
      await markWebhookCompleted(webhookEventId);
      return NextResponse.json({ ok: true, skipped: "no_item_id", eventType });
    }

    if (isEbayClosedNotification(eventType)) {
      const result = await refreshEbayListingByItemId(ctx.accessToken, itemId, { source: "webhook" });
      console.log("[ebay webhook] closed-event refresh completed", {
        itemId,
        eventType,
        result,
      });
      await markWebhookCompleted(webhookEventId);
      return NextResponse.json({ ok: true, processed: true, itemId, eventType });
    }

    let result;
    try {
      result = await refreshEbayListingByItemId(ctx.accessToken, itemId, { source: "webhook" });
      console.log("[ebay webhook] webhook apply", {
        itemId,
        eventType,
        updated: result?.updated ?? false,
        changes: result?.changes ?? [],
      });
    } catch (e) {
      console.warn("[ebay webhook] GetItem failed; trying xml postcard", {
        itemId,
        error: e instanceof Error ? e.message : String(e),
      });
      result = await applyEbayXmlPostcard({ itemId, postcard: parsed.postcard });
    }

    await markWebhookCompleted(webhookEventId);
    return NextResponse.json({
      ok: true,
      processed: true,
      itemId,
      eventType,
    });
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : String(e);
    console.error("[ebay webhook] handler failed", {
      itemId,
      eventType,
      error: errorMsg,
    });
    const { captureChannelSyncError } = await import("@/lib/channels/sentry");
    captureChannelSyncError(e, { provider: "ebay", operation: `webhook:${eventType ?? "unknown"}` });
    await markWebhookFailed(webhookEventId, errorMsg);
    return NextResponse.json({
      ok: true,
      processed: false,
      error: "Webhook processing failed",
      itemId,
      eventType,
    });
  }
}

/**
 * eBay may send GET requests to verify the endpoint.
 */
export async function GET(req: NextRequest) {
  const challenge = req.nextUrl.searchParams.get("challenge_code");
  if (challenge) {
    return NextResponse.json({ challengeResponse: challenge });
  }

  return NextResponse.json({
    ok: true,
    message: "eBay webhook endpoint is active",
    setup: "Configure Platform Notifications in eBay Developer Portal",
  });
}
