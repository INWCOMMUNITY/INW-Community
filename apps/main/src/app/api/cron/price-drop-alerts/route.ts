import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { sendPushNotification } from "@/lib/send-push-notification";

export const maxDuration = 60;

function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/** Run daily. Find items where price dropped below alert threshold and notify members. */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }
  if (authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const alerts = await prisma.priceDropAlert.findMany({
      where: { active: true },
      include: {
        storeItem: {
          select: {
            id: true,
            title: true,
            slug: true,
            priceCents: true,
            status: true,
          },
        },
      },
    });

    let triggered = 0;
    let skipped = 0;

    for (const alert of alerts) {
      const item = alert.storeItem;
      
      if (item.status !== "active") {
        skipped++;
        continue;
      }

      const currentPrice = item.priceCents;
      const threshold = alert.targetPrice ?? alert.originalPrice;

      if (currentPrice >= threshold) {
        continue;
      }

      const priceDrop = alert.originalPrice - currentPrice;
      const percentDrop = Math.round((priceDrop / alert.originalPrice) * 100);

      await sendPushNotification(alert.memberId, {
        title: "Price Drop Alert!",
        body: `"${item.title}" dropped ${percentDrop}% to ${formatPrice(currentPrice)} — tap to view.`,
        data: { screen: "product", productSlug: item.slug },
        category: "seller_ops",
      });

      await prisma.priceDropAlert.update({
        where: { id: alert.id },
        data: {
          triggeredAt: new Date(),
          active: false,
        },
      });

      triggered++;
    }

    return NextResponse.json({
      ok: true,
      total: alerts.length,
      triggered,
      skipped,
    });
  } catch (e) {
    console.error("[cron/price-drop-alerts]", e);
    return NextResponse.json({ error: "Failed to run cron" }, { status: 500 });
  }
}
