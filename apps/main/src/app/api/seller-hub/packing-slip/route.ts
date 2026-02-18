import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import {
  generatePackingSlipPdf,
  type PackingSlipGroup,
  type PackingSlipSellerProfile,
} from "@/lib/packing-slip";

export async function POST(req: NextRequest) {
  try {
    const session = await getSessionForApi(req);
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const sub = await prisma.subscription.findFirst({
      where: { memberId: userId, plan: "seller", status: "active" },
    });
    if (!sub) {
      return NextResponse.json({ error: "Seller plan required" }, { status: 403 });
    }

    const body = await req.json();
    const orderIds = Array.isArray(body.orderIds) ? (body.orderIds as string[]) : [];
    const combined = Boolean(body.combined);

    if (orderIds.length === 0) {
      return NextResponse.json({ error: "orderIds required" }, { status: 400 });
    }

    const orders = await prisma.storeOrder.findMany({
      where: { id: { in: orderIds }, sellerId: userId },
      include: {
        buyer: { select: { id: true, firstName: true, lastName: true, email: true } },
        items: {
          include: {
            storeItem: { select: { id: true, title: true } },
          },
        },
      },
    });

    if (orders.length === 0) {
      return NextResponse.json({ error: "No orders found" }, { status: 404 });
    }

    const [member, business] = await Promise.all([
      prisma.member.findUnique({
        where: { id: userId },
        select: { packingSlipNote: true },
      }),
      prisma.business.findFirst({
        where: { memberId: userId },
        select: {
          name: true,
          phone: true,
          address: true,
          city: true,
          logoUrl: true,
          website: true,
          email: true,
        },
      }),
    ]);

    const sellerProfile: PackingSlipSellerProfile = {
      business: business
        ? {
            name: business.name,
            phone: business.phone,
            address: business.address,
            city: business.city,
            logoUrl: business.logoUrl,
            website: business.website,
            email: business.email,
          }
        : null,
      packingSlipNote: member?.packingSlipNote ?? null,
    };

    const groups: PackingSlipGroup[] = combined
      ? (() => {
          const byBuyer = new Map<string, typeof orders>();
          for (const o of orders) {
            const key = o.buyer.email;
            if (!byBuyer.has(key)) byBuyer.set(key, []);
            byBuyer.get(key)!.push(o);
          }
          return Array.from(byBuyer.values()).map((group) => ({
            buyer: group[0].buyer,
            orders: group,
            combinedItems: group.flatMap((o) =>
              o.items.map((oi) => ({
                id: oi.id,
                quantity: oi.quantity,
                priceCentsAtPurchase: oi.priceCentsAtPurchase,
                storeItem: oi.storeItem,
                orderId: o.id,
              }))
            ),
            totalCents: group.reduce((s, o) => s + o.totalCents, 0),
            subtotalCents: group.reduce(
              (s, o) => s + (o.subtotalCents ?? o.totalCents - o.shippingCostCents),
              0
            ),
            shippingCostCents: group.reduce((s, o) => s + o.shippingCostCents, 0),
            taxCents: group.reduce(
              (s, o) => s + ((o as { taxCents?: number }).taxCents ?? 0),
              0
            ),
          }));
        })()
      : orders.map((o) => ({
          buyer: o.buyer,
          orders: [o],
          combinedItems: o.items.map((oi) => ({
            id: oi.id,
            quantity: oi.quantity,
            priceCentsAtPurchase: oi.priceCentsAtPurchase,
            storeItem: oi.storeItem,
            orderId: o.id,
          })),
          totalCents: o.totalCents,
          subtotalCents: o.subtotalCents ?? o.totalCents - o.shippingCostCents,
          shippingCostCents: o.shippingCostCents,
          taxCents: (o as { taxCents?: number }).taxCents,
        }));

    const pdfBytes = await generatePackingSlipPdf(groups, sellerProfile);

    return new NextResponse(Buffer.from(pdfBytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'attachment; filename="packing-slips.pdf"',
      },
    });
  } catch (e) {
    console.error("[seller-hub/packing-slip]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to generate packing slips" },
      { status: 500 }
    );
  }
}
