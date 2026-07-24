import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";

export const dynamic = "force-dynamic";

type Period = "7d" | "30d" | "90d";
type GroupBy = "day" | "week" | "item";

function getPeriodStart(period: Period): Date {
  const now = new Date();
  switch (period) {
    case "7d":
      return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    case "30d":
      return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    case "90d":
      return new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    default:
      return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  }
}

interface DayGroup {
  date: string;
  views: number;
  cartAdds: number;
  purchases: number;
  revenue: number;
}

interface ItemMetrics {
  storeItemId: string;
  title: string;
  views: number;
  cartAdds: number;
  purchases: number;
  revenue: number;
  conversionRate: number;
}

export async function GET(req: NextRequest) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const period = (searchParams.get("period") ?? "30d") as Period;
  const groupBy = (searchParams.get("groupBy") ?? "day") as GroupBy;

  if (!["7d", "30d", "90d"].includes(period)) {
    return NextResponse.json({ error: "Invalid period" }, { status: 400 });
  }
  if (!["day", "week", "item"].includes(groupBy)) {
    return NextResponse.json({ error: "Invalid groupBy" }, { status: 400 });
  }

  const periodStart = getPeriodStart(period);
  const memberId = session.user.id;

  // Fetch all analytics events for this seller in the period
  const events = await prisma.sellerAnalyticsEvent.findMany({
    where: {
      memberId,
      createdAt: { gte: periodStart },
    },
    select: {
      eventType: true,
      storeItemId: true,
      provider: true,
      source: true,
      metadata: true,
      createdAt: true,
    },
  });

  // Fetch orders for revenue calculation
  const orders = await prisma.storeOrder.findMany({
    where: {
      sellerId: memberId,
      status: { in: ["paid", "shipped", "delivered"] },
      createdAt: { gte: periodStart },
    },
    select: {
      id: true,
      totalCents: true,
      createdAt: true,
      items: {
        select: {
          storeItemId: true,
          priceCentsAtPurchase: true,
          quantity: true,
        },
      },
    },
  });

  // Fetch store item titles for item grouping
  const storeItemIds = [...new Set(events.filter((e) => e.storeItemId).map((e) => e.storeItemId!))];
  const storeItems = await prisma.storeItem.findMany({
    where: { id: { in: storeItemIds } },
    select: { id: true, title: true },
  });
  const itemTitleMap = new Map(storeItems.map((i) => [i.id, i.title]));

  // Summary totals
  const totalViews = events.filter((e) => e.eventType === "listing_view").length;
  const totalCartAdds = events.filter((e) => e.eventType === "cart_add").length;
  const totalPurchases = orders.length;
  const totalRevenue = orders.reduce((sum, o) => sum + o.totalCents, 0);

  // Source breakdown
  const viewsBySource = {
    web: events.filter((e) => e.eventType === "listing_view" && e.source === "web").length,
    mobile: events.filter((e) => e.eventType === "listing_view" && e.source === "mobile").length,
    external: events.filter((e) => e.eventType === "listing_view" && e.source === "external").length,
  };

  // Provider breakdown (revenue by channel)
  // INW direct orders are "inwc"
  const ordersByChannel: Record<string, number> = {};
  const inwcRevenue = orders.reduce((sum, o) => sum + o.totalCents, 0);
  if (inwcRevenue > 0) {
    ordersByChannel["inwc"] = inwcRevenue;
  }

  // External channel sales from ChannelSyncEvent (quantity sold, estimated revenue from StoreItem price)
  const channelSales = await prisma.channelSyncEvent.findMany({
    where: {
      type: "sale",
      storeItemId: { not: null },
      processedAt: { gte: periodStart },
    },
    select: {
      provider: true,
      storeItemId: true,
      payload: true,
    },
  });

  // Filter to this seller's items and estimate revenue
  const sellerItemIds = new Set(storeItemIds);
  const sellerItems = await prisma.storeItem.findMany({
    where: { memberId },
    select: { id: true, priceCents: true },
  });
  const itemPriceMap = new Map(sellerItems.map((i) => [i.id, i.priceCents]));
  
  for (const sale of channelSales) {
    if (!sale.storeItemId) continue;
    const price = itemPriceMap.get(sale.storeItemId);
    if (price === undefined) continue; // Not this seller's item
    
    // Extract quantity from payload if available, default to 1
    const payload = sale.payload as { quantitySold?: number } | null;
    const qty = payload?.quantitySold ?? 1;
    const estimatedRevenue = price * qty;
    
    ordersByChannel[sale.provider] = (ordersByChannel[sale.provider] ?? 0) + estimatedRevenue;
  }

  // Conversion rates
  const viewToCartRate = totalViews > 0 ? (totalCartAdds / totalViews) * 100 : 0;
  const cartToPurchaseRate = totalCartAdds > 0 ? (totalPurchases / totalCartAdds) * 100 : 0;
  const overallConversionRate = totalViews > 0 ? (totalPurchases / totalViews) * 100 : 0;

  let timeline: DayGroup[] = [];
  let topItems: ItemMetrics[] = [];

  if (groupBy === "day" || groupBy === "week") {
    // Group events by day
    const dayMap = new Map<string, DayGroup>();
    const dayFormat = (d: Date) => d.toISOString().split("T")[0];

    for (const e of events) {
      const dateKey = dayFormat(e.createdAt);
      if (!dayMap.has(dateKey)) {
        dayMap.set(dateKey, { date: dateKey, views: 0, cartAdds: 0, purchases: 0, revenue: 0 });
      }
      const day = dayMap.get(dateKey)!;
      if (e.eventType === "listing_view") day.views++;
      if (e.eventType === "cart_add") day.cartAdds++;
    }

    for (const o of orders) {
      const dateKey = dayFormat(o.createdAt);
      if (!dayMap.has(dateKey)) {
        dayMap.set(dateKey, { date: dateKey, views: 0, cartAdds: 0, purchases: 0, revenue: 0 });
      }
      const day = dayMap.get(dateKey)!;
      day.purchases++;
      day.revenue += o.totalCents;
    }

    timeline = Array.from(dayMap.values()).sort((a, b) => a.date.localeCompare(b.date));

    if (groupBy === "week") {
      const weekMap = new Map<string, DayGroup>();
      for (const day of timeline) {
        const d = new Date(day.date);
        const weekStart = new Date(d);
        weekStart.setDate(d.getDate() - d.getDay());
        const weekKey = weekStart.toISOString().split("T")[0];
        if (!weekMap.has(weekKey)) {
          weekMap.set(weekKey, { date: weekKey, views: 0, cartAdds: 0, purchases: 0, revenue: 0 });
        }
        const week = weekMap.get(weekKey)!;
        week.views += day.views;
        week.cartAdds += day.cartAdds;
        week.purchases += day.purchases;
        week.revenue += day.revenue;
      }
      timeline = Array.from(weekMap.values()).sort((a, b) => a.date.localeCompare(b.date));
    }
  }

  if (groupBy === "item") {
    // Group by item
    const itemMap = new Map<string, ItemMetrics>();

    for (const e of events) {
      if (!e.storeItemId) continue;
      if (!itemMap.has(e.storeItemId)) {
        itemMap.set(e.storeItemId, {
          storeItemId: e.storeItemId,
          title: itemTitleMap.get(e.storeItemId) ?? "Unknown",
          views: 0,
          cartAdds: 0,
          purchases: 0,
          revenue: 0,
          conversionRate: 0,
        });
      }
      const item = itemMap.get(e.storeItemId)!;
      if (e.eventType === "listing_view") item.views++;
      if (e.eventType === "cart_add") item.cartAdds++;
    }

    for (const o of orders) {
      for (const lineItem of o.items) {
        if (!itemMap.has(lineItem.storeItemId)) {
          itemMap.set(lineItem.storeItemId, {
            storeItemId: lineItem.storeItemId,
            title: itemTitleMap.get(lineItem.storeItemId) ?? "Unknown",
            views: 0,
            cartAdds: 0,
            purchases: 0,
            revenue: 0,
            conversionRate: 0,
          });
        }
        const item = itemMap.get(lineItem.storeItemId)!;
        item.purchases += lineItem.quantity;
        item.revenue += lineItem.priceCentsAtPurchase * lineItem.quantity;
      }
    }

    // Calculate conversion rates
    for (const item of itemMap.values()) {
      item.conversionRate = item.views > 0 ? (item.purchases / item.views) * 100 : 0;
    }

    topItems = Array.from(itemMap.values())
      .sort((a, b) => b.views - a.views)
      .slice(0, 20);
  }

  return NextResponse.json({
    period,
    groupBy,
    summary: {
      totalViews,
      totalCartAdds,
      totalPurchases,
      totalRevenueCents: totalRevenue,
      viewToCartRate: Math.round(viewToCartRate * 100) / 100,
      cartToPurchaseRate: Math.round(cartToPurchaseRate * 100) / 100,
      overallConversionRate: Math.round(overallConversionRate * 100) / 100,
    },
    viewsBySource,
    revenueByChannel: ordersByChannel,
    timeline: groupBy !== "item" ? timeline : undefined,
    topItems: groupBy === "item" ? topItems : undefined,
  });
}
