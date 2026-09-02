import { NextRequest, NextResponse } from "next/server";
import { getSessionForApi } from "@/lib/mobile-auth";
import { prisma } from "database";
import { getConnectionContext, patchChannelConnectionConfig } from "@/lib/channels/connection";
import { getEbayNotificationPreferences } from "@/lib/channels/ebay/trading";
import {
  readEbayWebhookReceipt,
  subscribeEbayInboundNotifications,
} from "@/lib/channels/ebay/notifications-setup";
import { ebayWebhookUrlIsSecured, redactEbayWebhookUrl } from "@/lib/channels/ebay/webhook";

export const dynamic = "force-dynamic";

/**
 * GET /api/channels/ebay/notifications
 * Check if the user is subscribed to eBay notifications.
 */
export async function GET(req: NextRequest) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const connection = await prisma.channelConnection.findFirst({
    where: { memberId: session.user.id, provider: "ebay", status: "active" },
  });

  if (!connection) {
    return NextResponse.json({ error: "No eBay connection" }, { status: 404 });
  }

  const ctx = await getConnectionContext(connection);
  if (!ctx) {
    return NextResponse.json({ error: "Unable to get connection context" }, { status: 500 });
  }

  const status = await getEbayNotificationPreferences(ctx.accessToken);
  const receipt = readEbayWebhookReceipt(connection.config);

  return NextResponse.json({
    subscribed: status.subscribed,
    webhookUrl: status.webhookUrl ? redactEbayWebhookUrl(status.webhookUrl) : undefined,
    urlSecured: status.urlSecured ?? ebayWebhookUrlIsSecured(status.webhookUrl),
    events: status.events,
    lastEbayWebhookAt: receipt.lastEbayWebhookAt,
    lastEbayWebhookEvent: receipt.lastEbayWebhookEvent,
  });
}

/**
 * POST /api/channels/ebay/notifications
 * Subscribe to eBay Platform Notifications for real-time sync.
 */
export async function POST(req: NextRequest) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const connection = await prisma.channelConnection.findFirst({
    where: { memberId: session.user.id, provider: "ebay", status: "active" },
  });

  if (!connection) {
    return NextResponse.json({ error: "No eBay connection" }, { status: 404 });
  }

  const ctx = await getConnectionContext(connection);
  if (!ctx) {
    return NextResponse.json({ error: "Unable to get connection context" }, { status: 500 });
  }

  const result = await subscribeEbayInboundNotifications(ctx.accessToken);

  if (!result.success) {
    return NextResponse.json(
      { error: result.error || "Failed to subscribe" },
      { status: 500 }
    );
  }

  await patchChannelConnectionConfig(
    connection.id,
    result.configPatch as Record<string, unknown>
  );

  return NextResponse.json({
    success: true,
    webhookUrl: redactEbayWebhookUrl(result.webhookUrl),
    message: "eBay notifications enabled. Your listings will now sync automatically when edited on eBay.",
  });
}
