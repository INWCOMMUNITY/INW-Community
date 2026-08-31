import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { requireAdmin } from "@/lib/admin-auth";
import { expectedSellerTransferCents } from "@/lib/stripe/connect-payouts";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/facilitator-payouts
 * Read-only marketplace split: tax + reserve stay on the platform; seller share should have a Connect transfer id.
 */
export async function GET(req: NextRequest) {
  if (!(await requireAdmin(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limit = Math.min(200, Math.max(1, Number(req.nextUrl.searchParams.get("limit") ?? 50) || 50));
  const missingTransferOnly = req.nextUrl.searchParams.get("missingTransfer") === "1";

  const orders = await prisma.storeOrder.findMany({
    where: {
      status: { in: ["paid", "shipped", "delivered", "refunded"] },
      stripePaymentIntentId: { not: null },
      ...(missingTransferOnly ? { stripeSellerTransferId: null } : {}),
    },
    select: {
      id: true,
      sellerId: true,
      status: true,
      totalCents: true,
      subtotalCents: true,
      taxCents: true,
      salesTaxReserveCents: true,
      platformFeeCents: true,
      stripeSellerTransferId: true,
      stripePaymentIntentId: true,
      createdAt: true,
      seller: {
        select: { email: true, firstName: true, lastName: true, stripeConnectAccountId: true },
      },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  const rows = orders.map((o) => {
    const expectedTransferCents = expectedSellerTransferCents(o);
    return {
      orderId: o.id,
      createdAt: o.createdAt.toISOString(),
      status: o.status,
      sellerEmail: o.seller.email,
      sellerName: `${o.seller.firstName ?? ""} ${o.seller.lastName ?? ""}`.trim(),
      connectAccountId: o.seller.stripeConnectAccountId,
      totalCents: o.totalCents,
      subtotalCents: o.subtotalCents,
      taxCents: o.taxCents,
      salesTaxReserveCents: o.salesTaxReserveCents,
      platformFeeCents: o.platformFeeCents,
      expectedTransferCents,
      stripeSellerTransferId: o.stripeSellerTransferId,
      stripePaymentIntentId: o.stripePaymentIntentId,
      transferMissing: !o.stripeSellerTransferId,
    };
  });

  const missingTransferCount = rows.filter((r) => r.transferMissing).length;
  const taxCents = rows.reduce((acc, r) => acc + r.taxCents, 0);
  const reserveCents = rows.reduce((acc, r) => acc + r.salesTaxReserveCents, 0);

  return NextResponse.json({
    orders: rows,
    summary: {
      count: rows.length,
      missingTransferCount,
      taxCentsOnPlatform: taxCents,
      reserveCentsOnPlatform: reserveCents,
    },
  });
}
