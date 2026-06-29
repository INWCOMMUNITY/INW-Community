import { NextRequest, NextResponse } from "next/server";
import { getSessionForApi } from "@/lib/session";
import { prisma } from "database";
import { getConnectionContext } from "@/lib/channels/connection";
import {
  subscribeToEbayNotifications,
  getEbayNotificationPreferences,
} from "@/lib/channels/ebay/trading";

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
    webhookUrl: status.webhookUrl,
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

  // Build the webhook URL
  const host = req.headers.get("host") || "localhost:3000";
  const protocol = host.includes("localhost") ? "http" : "https";
  const webhookUrl = `${protocol}://${host}/api/channels/ebay/webhook`;

  const result = await subscribeToEbayNotifications(ctx.accessToken, webhookUrl);

  if (!result.success) {
    return NextResponse.json(
      { error: result.error || "Failed to subscribe" },
      { status: 500 }
    );
  }

  // Store subscription status in connection config
  const config = (connection.config as Record<string, unknown>) || {};
  await prisma.channelConnection.update({
    where: { id: connection.id },
    data: {
      config: {
        ...config,
        notificationsEnabled: true,
        notificationsWebhookUrl: webhookUrl,
        notificationsEnabledAt: new Date().toISOString(),
      } as object,
    },
  });

  return NextResponse.json({
    success: true,
    webhookUrl,
    message: "eBay notifications enabled. Your listings will now sync automatically when edited on eBay.",
  });
}
