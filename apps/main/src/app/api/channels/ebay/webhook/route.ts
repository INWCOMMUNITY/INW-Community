import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { refreshEbayListingByItemId } from "@/lib/channels/ebay/pull-ebay-updates";
import {
  acknowledgeRecentSalesWithoutDecrement,
  reconcileConnectionSales,
} from "@/lib/channels/reconcile";
import { tag } from "@/lib/channels/ebay/photos";
import { verifyEbayWebhook } from "@/lib/channels/ebay/webhook";
import {
  logWebhookEvent,
  markWebhookProcessing,
  markWebhookCompleted,
  markWebhookFailed,
} from "@/lib/channels/webhook-event";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Extract ItemID from eBay Platform Notification XML.
 * eBay sends SOAP-style XML with the item details.
 */
function extractItemIdFromNotification(xml: string): string | null {
  const itemId = tag(xml, "ItemID");
  if (itemId && /^\d+$/.test(itemId.trim())) {
    return itemId.trim();
  }
  return null;
}

/**
 * Extract the notification type from eBay XML.
 */
function extractNotificationType(xml: string): string | null {
  const eventName = tag(xml, "NotificationEventName") || tag(xml, "EventName");
  return eventName?.trim() || null;
}

/**
 * Extract the eBay user ID from the notification.
 */
function extractEbayUserId(xml: string): string | null {
  const seller = tag(xml, "Seller");
  if (seller) {
    const userId = tag(seller, "UserID");
    if (userId) return userId.trim();
  }
  const userId = tag(xml, "UserID");
  return userId?.trim() || null;
}

/**
 * Find the eBay connection by the seller's eBay user ID.
 */
async function findConnectionByEbayUserId(ebayUserId: string) {
  return prisma.channelConnection.findFirst({
    where: {
      provider: "ebay",
      externalShopId: ebayUserId,
      status: "active",
    },
  });
}

function isSaleEvent(eventType: string | null): boolean {
  if (!eventType) return false;
  return (
    eventType.includes("ItemSold") ||
    eventType.includes("FixedPriceTransaction") ||
    eventType.includes("AuctionCheckoutComplete")
  );
}

function isClosedEvent(eventType: string | null): boolean {
  if (!eventType) return false;
  return eventType.includes("ItemClosed") || eventType.includes("ItemUnsold");
}

/**
 * eBay Platform Notifications webhook receiver.
 *
 * Sale events go through reconcileConnectionSales (ChannelSyncEvent dedupe) so the
 * sales poll cannot double-decrement. Content/qty revisions use absolute refresh.
 */
export async function POST(req: NextRequest) {
  if (!verifyEbayWebhook(req)) {
    console.warn("[ebay webhook] rejected: invalid or missing secret");
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let xml: string;
  try {
    xml = await req.text();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (!xml || xml.length < 50) {
    return NextResponse.json({ error: "Empty or invalid XML" }, { status: 400 });
  }

  console.log("[ebay webhook] received notification", {
    length: xml.length,
    preview: xml.slice(0, 200),
  });

  const itemId = extractItemIdFromNotification(xml);
  const eventType = extractNotificationType(xml);
  const ebayUserId = extractEbayUserId(xml);

  console.log("[ebay webhook] parsed", { itemId, eventType, ebayUserId });

  if (!itemId) {
    console.log("[ebay webhook] no ItemID found, skipping");
    return NextResponse.json({ ok: true, skipped: "no_item_id" });
  }

  const relevantEvents = [
    "ItemRevised",
    "ItemRevisionAddedToSchedule",
    "ItemListed",
    "ItemClosed",
    "ItemUnsold",
    "ItemSold",
    "FixedPriceTransaction",
    "AuctionCheckoutComplete",
  ];

  if (eventType && !relevantEvents.some((e) => eventType.includes(e))) {
    console.log("[ebay webhook] irrelevant event type, skipping", { eventType });
    return NextResponse.json({ ok: true, skipped: "irrelevant_event", eventType });
  }

  let connection = null;
  if (ebayUserId) {
    connection = await findConnectionByEbayUserId(ebayUserId);
  }

  if (!connection) {
    console.info("[ebay webhook] userId lookup missed, falling back to listing link", {
      itemId,
      ebayUserId,
    });
    const link = await prisma.channelListingLink.findFirst({
      where: {
        provider: "ebay",
        OR: [
          { externalListingId: itemId },
          { externalListingId: `inw${itemId}` },
        ],
      },
      include: {
        connection: true,
      },
    });
    connection = link?.connection ?? null;
  }

  if (!connection) {
    console.log("[ebay webhook] no connection found for notification", { itemId, ebayUserId });
    return NextResponse.json({ ok: true, skipped: "unknown_seller" });
  }

  const webhookEventId = await logWebhookEvent(
    "ebay",
    eventType ?? "unknown",
    { itemId, ebayUserId, xmlPreview: xml.slice(0, 500) },
    itemId
  );

  try {
    await markWebhookProcessing(webhookEventId);

    const { getConnectionContext } = await import("@/lib/channels/connection");
    const ctx = await getConnectionContext(connection!);

    if (!ctx) {
      console.error("[ebay webhook] failed to get connection context", {
        connectionId: connection!.id,
      });
      await markWebhookFailed(webhookEventId, "Failed to get connection context");
      return NextResponse.json({ ok: false, error: "Connection context unavailable" }, { status: 500 });
    }

    if (isSaleEvent(eventType)) {
      const sales = await reconcileConnectionSales(connection!);
      console.log("[ebay webhook] sale reconcile completed", {
        itemId,
        eventType,
        applied: sales.applied,
      });
      if (sales.applied === 0) {
        await acknowledgeRecentSalesWithoutDecrement(connection!);
        await refreshEbayListingByItemId(ctx.accessToken, itemId).catch((e) =>
          console.warn("[ebay webhook] post-sale absolute refresh failed", {
            itemId,
            error: e instanceof Error ? e.message : String(e),
          })
        );
      } else {
        await refreshEbayListingByItemId(ctx.accessToken, itemId, {
          skipQuantity: true,
        }).catch((e) =>
          console.warn("[ebay webhook] post-sale content refresh failed", {
            itemId,
            error: e instanceof Error ? e.message : String(e),
          })
        );
      }
      await markWebhookCompleted(webhookEventId);
      return NextResponse.json({ ok: true, processed: true, itemId, eventType });
    }

    const result = await refreshEbayListingByItemId(ctx.accessToken, itemId);
    if (isClosedEvent(eventType) && result && !result.ended) {
      await refreshEbayListingByItemId(ctx.accessToken, itemId, {
        activeListingIds: new Set(),
      });
    }

    console.log("[ebay webhook] refresh completed", {
      itemId,
      eventType,
      result,
    });

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
    return NextResponse.json({ ok: false, error: "Webhook processing failed" }, { status: 500 });
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
