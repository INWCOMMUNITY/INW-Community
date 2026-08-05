import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { prisma } from "database";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/quantity-audit
 *
 * Get platform-wide quantity audit log with filtering.
 *
 * Query params:
 * - memberId: Filter by seller
 * - storeItemId: Filter by specific item
 * - provider: Filter by provider
 * - reason: Filter by reason
 * - dateFrom: Filter from date (ISO string)
 * - dateTo: Filter to date (ISO string)
 * - limit: Number of records (default 100)
 * - offset: Pagination offset
 * - format: "json" (default) or "csv"
 */
export async function GET(req: NextRequest) {
  const isAdmin = await requireAdmin(req);
  if (!isAdmin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = req.nextUrl;
  const memberId = searchParams.get("memberId") || undefined;
  const storeItemId = searchParams.get("storeItemId") || undefined;
  const provider = searchParams.get("provider") || undefined;
  const reason = searchParams.get("reason") || undefined;
  const dateFrom = searchParams.get("dateFrom");
  const dateTo = searchParams.get("dateTo");
  const limit = Math.min(1000, Math.max(1, parseInt(searchParams.get("limit") || "100", 10)));
  const offset = Math.max(0, parseInt(searchParams.get("offset") || "0", 10));
  const format = searchParams.get("format") || "json";

  try {
    const where: Record<string, unknown> = {};
    if (memberId) where.memberId = memberId;
    if (storeItemId) where.storeItemId = storeItemId;
    if (provider) where.provider = provider;
    if (reason) where.reason = reason;
    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) (where.createdAt as Record<string, unknown>).gte = new Date(dateFrom);
      if (dateTo) (where.createdAt as Record<string, unknown>).lte = new Date(dateTo);
    }

    const [logs, total] = await Promise.all([
      prisma.quantityAuditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: offset,
      }),
      prisma.quantityAuditLog.count({ where }),
    ]);

    // Get member and item info for display
    const memberIds = [...new Set(logs.map((l) => l.memberId))];
    const itemIds = [...new Set(logs.map((l) => l.storeItemId))];

    const [members, items] = await Promise.all([
      prisma.member.findMany({
        where: { id: { in: memberIds } },
        select: { id: true, firstName: true, lastName: true, email: true },
      }),
      prisma.storeItem.findMany({
        where: { id: { in: itemIds } },
        select: { id: true, title: true },
      }),
    ]);

    const memberMap = new Map(members.map((m) => [m.id, m]));
    const itemMap = new Map(items.map((i) => [i.id, i]));

    const enrichedLogs = logs.map((log) => {
      const member = memberMap.get(log.memberId);
      const item = itemMap.get(log.storeItemId);
      return {
        ...log,
        memberName: member ? `${member.firstName} ${member.lastName}`.trim() : "Unknown",
        memberEmail: member?.email ?? "",
        itemTitle: item?.title ?? "Deleted Item",
      };
    });

    // Export as CSV
    if (format === "csv") {
      const headers = [
        "Date",
        "Seller",
        "Email",
        "Item Title",
        "Store Item ID",
        "Provider",
        "Previous Qty",
        "New Qty",
        "Delta",
        "Reason",
        "Order ID",
        "Variant",
      ];
      const rows = enrichedLogs.map((log) => [
        new Date(log.createdAt).toISOString(),
        log.memberName,
        log.memberEmail,
        `"${(log.itemTitle ?? "").replace(/"/g, '""')}"`,
        log.storeItemId,
        log.provider,
        log.previousQty,
        log.newQty,
        log.delta,
        log.reason,
        log.orderId ?? "",
        log.variantValue ?? "",
      ]);

      const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");

      return new NextResponse(csv, {
        status: 200,
        headers: {
          "Content-Type": "text/csv",
          "Content-Disposition": `attachment; filename="quantity-audit-${new Date().toISOString().split("T")[0]}.csv"`,
        },
      });
    }

    return NextResponse.json({
      logs: enrichedLogs,
      total,
      limit,
      offset,
    });
  } catch (e) {
    console.error("[admin-quantity-audit] error:", e);
    return NextResponse.json(
      { error: "Failed to fetch audit log" },
      { status: 500 }
    );
  }
}
