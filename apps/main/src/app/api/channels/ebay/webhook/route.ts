import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { prisma } from "database";
import { refreshEbayListingByItemId } from "@/lib/channels/ebay/pull-ebay-updates";
import { tag, allTags } from "@/lib/channels/ebay/photos";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Extract ItemID from eBay Platform Notification XML.
 * eBay sends SOAP-style XML with the item details.
 */
function extractItemIdFromNotification(xml: string): string | null {
  // Try to get ItemID from various possible locations in the XML
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
  // Look for NotificationEventName or similar
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
  // The externalShopId on the connection should be the eBay username
  return prisma.channelConnection.findFirst({
    where: {
      provider: "ebay",
      externalShopId: ebayUserId,
      status: "active",
    },
  });
}

/**
 * eBay Platform Notifications webhook receiver.
 * 
 * Receives SOAP-based XML notifications from eBay when:
 * - ItemRevised: A listing was edited on eBay
 * - ItemClosed: A listing ended
 * - ItemSold: A sale occurred
 * 
 * Setup required in eBay Developer Portal:
 * 1. Go to Developer Dashboard → Application Settings → User Tokens
 * 2. Set Platform Notification Delivery URL to: https://yoursite.com/api/channels/ebay/webhook
 * 3. Enable notifications using SetNotificationPreferences API call
 * 
 * Note: The user must set up notifications using SetNotificationPreferences
 * with their auth token to receive notifications for their listings.
 */
export async function POST(req: NextRequest) {
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

  // Extract key information from the notification
  const itemId = extractItemIdFromNotification(xml);
  const eventType = extractNotificationType(xml);
  const ebayUserId = extractEbayUserId(xml);

  console.log("[ebay webhook] parsed", { itemId, eventType, ebayUserId });

  if (!itemId) {
    console.log("[ebay webhook] no ItemID found, skipping");
    return NextResponse.json({ ok: true, skipped: "no_item_id" });
  }

  // Only process ItemRevised and similar events
  const relevantEvents = [
    "ItemRevised",
    "ItemRevisionAddedToSchedule",
    "ItemListed",
    "ItemClosed",
    "ItemSold",
    "FixedPriceTransaction",
  ];

  if (eventType && !relevantEvents.some((e) => eventType.includes(e))) {
    console.log("[ebay webhook] irrelevant event type, skipping", { eventType });
    return NextResponse.json({ ok: true, skipped: "irrelevant_event", eventType });
  }

  // Find the connection for this seller
  let connection = null;
  if (ebayUserId) {
    connection = await findConnectionByEbayUserId(ebayUserId);
  }

  // If we couldn't find by userId, try to find by the linked listing
  if (!connection) {
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

  // Process the update in the background
  const run = async () => {
    try {
      // Decrypt the access token
      const { getConnectionContext } = await import("@/lib/channels/connection");
      const ctx = await getConnectionContext(connection!);
      
      if (!ctx) {
        console.error("[ebay webhook] failed to get connection context", { connectionId: connection!.id });
        return;
      }

      // Refresh the listing from eBay
      const result = await refreshEbayListingByItemId(ctx.accessToken, itemId);

      console.log("[ebay webhook] refresh completed", {
        itemId,
        eventType,
        result,
      });
    } catch (e) {
      console.error("[ebay webhook] refresh failed", {
        itemId,
        eventType,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  };

  // Run in background on Vercel, or await locally
  if (process.env.VERCEL) {
    waitUntil(run());
    return NextResponse.json({
      ok: true,
      queued: true,
      itemId,
      eventType,
    });
  }

  await run();
  return NextResponse.json({
    ok: true,
    processed: true,
    itemId,
    eventType,
  });
}

/**
 * eBay may send GET requests to verify the endpoint.
 */
export async function GET(req: NextRequest) {
  // eBay might send a verification challenge
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
