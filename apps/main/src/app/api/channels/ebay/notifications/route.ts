import { NextRequest, NextResponse } from "next/server";
import { getSessionForApi } from "@/lib/mobile-auth";
import { prisma } from "database";
import { getConnectionContext } from "@/lib/channels/connection";
import { getEbayNotificationPreferences } from "@/lib/channels/ebay/trading";
import { subscribeEbayInboundNotifications } from "@/lib/channels/ebay/notifications-setup";
import { redactEbayWebhookUrl } from "@/lib/channels/ebay/webhook";

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

  return NextResponse.json({
    subscribed: status.subscribed,
    webhookUrl: status.webhookUrl ? redactEbayWebhookUrl(status.webhookUrl) : undefined,
    events: status.events,
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

  const config = (connection.config as Record<string, unknown>) || {};
  await prisma.channelConnection.update({
    where: { id: connection.id },
    data: {
      config: {
        ...config,
        ...result.configPatch,
      } as object,
    },
  });

  return NextResponse.json({
    success: true,
    webhookUrl: redactEbayWebhookUrl(result.webhookUrl),
    message: "eBay notifications enabled. Your listings will now sync automatically when edited on eBay.",
  });
}
