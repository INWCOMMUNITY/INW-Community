import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";

export const dynamic = "force-dynamic";

type ExportType = "listings" | "orders" | "activity" | "sync-log";
type ExportFormat = "csv";

function escapeCSV(value: unknown): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function formatDate(date: Date): string {
  return date.toISOString().split("T")[0];
}

function formatDateTime(date: Date): string {
  return date.toISOString().replace("T", " ").slice(0, 19);
}

/**
 * GET /api/seller-hub/export
 * 
 * Export seller data in CSV format.
 * 
 * Query params:
 * - type: "listings" | "orders" | "activity" | "sync-log"
 * - format: "csv" (default and only supported format for now)
 */
export async function GET(req: NextRequest) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const type = (searchParams.get("type") ?? "listings") as ExportType;
  const format = (searchParams.get("format") ?? "csv") as ExportFormat;

  if (!["listings", "orders", "activity", "sync-log"].includes(type)) {
    return NextResponse.json({ error: "Invalid export type" }, { status: 400 });
  }

  if (format !== "csv") {
    return NextResponse.json({ error: "Only CSV format is supported" }, { status: 400 });
  }

  const memberId = session.user.id;
  let csvContent = "";
  let filename = "";

  switch (type) {
    case "listings": {
      const items = await prisma.storeItem.findMany({
        where: { memberId },
        include: {
          channelLinks: {
            select: { provider: true, externalListingId: true, syncStatus: true },
          },
          business: { select: { name: true } },
        },
        orderBy: { createdAt: "desc" },
      });

      const headers = [
        "ID",
        "Title",
        "Price",
        "Quantity",
        "Status",
        "Condition",
        "Category",
        "Subcategory",
        "Storefront",
        "eBay Link",
        "Etsy Link",
        "Shopify Link",
        "Wix Link",
        "Created",
        "Updated",
      ];

      const rows = items.map((item) => {
        const links = new Map(item.channelLinks.map((l: { provider: string; externalListingId: string }) => [l.provider, l.externalListingId]));
        return [
          item.id,
          item.title,
          (item.priceCents / 100).toFixed(2),
          item.quantity,
          item.status,
          item.condition,
          item.category ?? "",
          item.subcategory ?? "",
          item.business?.name ?? "",
          links.get("ebay") ?? "",
          links.get("etsy") ?? "",
          links.get("shopify") ?? "",
          links.get("wix") ?? "",
          formatDate(item.createdAt),
          formatDate(item.updatedAt),
        ];
      });

      csvContent = [
        headers.map(escapeCSV).join(","),
        ...rows.map((row) => row.map(escapeCSV).join(",")),
      ].join("\n");

      filename = `listings-${formatDate(new Date())}.csv`;
      break;
    }

    case "orders": {
      const orders = await prisma.storeOrder.findMany({
        where: { sellerId: memberId },
        include: {
          buyer: { select: { firstName: true, lastName: true, email: true } },
          items: {
            include: {
              storeItem: { select: { title: true } },
            },
          },
        },
        orderBy: { createdAt: "desc" },
      });

      const headers = [
        "Order ID",
        "Date",
        "Buyer Name",
        "Buyer Email",
        "Items",
        "Subtotal",
        "Shipping",
        "Total",
        "Status",
        "Fulfillment Type",
      ];

      const rows = orders.map((order) => {
        const itemsList = order.items
          .map((i) => `${i.storeItem.title} x${i.quantity}`)
          .join("; ");
        const fulfillmentTypes = [...new Set(order.items.map((i) => i.fulfillmentType))].join(", ");
        return [
          order.id,
          formatDateTime(order.createdAt),
          `${order.buyer.firstName} ${order.buyer.lastName}`,
          order.buyer.email,
          itemsList,
          (order.subtotalCents / 100).toFixed(2),
          (order.shippingCostCents / 100).toFixed(2),
          (order.totalCents / 100).toFixed(2),
          order.status,
          fulfillmentTypes,
        ];
      });

      csvContent = [
        headers.map(escapeCSV).join(","),
        ...rows.map((row) => row.map(escapeCSV).join(",")),
      ].join("\n");

      filename = `orders-${formatDate(new Date())}.csv`;
      break;
    }

    case "activity": {
      const activities = await prisma.sellerActivityLog.findMany({
        where: { memberId },
        orderBy: { createdAt: "desc" },
        take: 1000,
      });

      const headers = [
        "Date",
        "Action",
        "Entity Type",
        "Entity ID",
        "Details",
      ];

      const rows = activities.map((a) => {
        let details = "";
        try {
          if (a.detail) {
            const d = a.detail as Record<string, unknown>;
            details = Object.entries(d)
              .filter(([, v]) => v !== null && v !== undefined)
              .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
              .join("; ");
          }
        } catch {
          details = "";
        }
        return [
          formatDateTime(a.createdAt),
          a.action,
          a.entityType,
          a.entityId ?? "",
          details,
        ];
      });

      csvContent = [
        headers.map(escapeCSV).join(","),
        ...rows.map((row) => row.map(escapeCSV).join(",")),
      ].join("\n");

      filename = `activity-${formatDate(new Date())}.csv`;
      break;
    }

    case "sync-log": {
      const logs = await prisma.channelSyncLog.findMany({
        where: { memberId },
        orderBy: { createdAt: "desc" },
        take: 1000,
      });

      const headers = [
        "Date",
        "Provider",
        "Action",
        "Store Item ID",
        "Detail",
      ];

      const rows = logs.map((log) => [
        formatDateTime(log.createdAt),
        log.provider,
        log.action,
        log.storeItemId ?? "",
        log.detail ?? "",
      ]);

      csvContent = [
        headers.map(escapeCSV).join(","),
        ...rows.map((row) => row.map(escapeCSV).join(",")),
      ].join("\n");

      filename = `sync-log-${formatDate(new Date())}.csv`;
      break;
    }
  }

  // Return CSV as downloadable file
  return new NextResponse(csvContent, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
