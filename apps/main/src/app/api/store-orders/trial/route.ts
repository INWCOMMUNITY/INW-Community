import { NextResponse } from "next/server";
import { prisma } from "database";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { WIX_IMG } from "@/lib/wix-media";

/** Creates a trial sold order for the logged-in seller to test shipping features. */
export async function POST() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const sub = await prisma.subscription.findFirst({
      where: { memberId: session.user.id, plan: "seller", status: "active" },
    });
    if (!sub) {
      return NextResponse.json({ error: "Seller plan required" }, { status: 403 });
    }

    const sellerId = session.user.id;

    // Use seller as buyer for trial (self-order for testing)
    const buyerId = sellerId;

    // Create a trial store item for this seller
    const slug = `trial-shipping-${Date.now()}`;
    const trialItem = await prisma.storeItem.create({
      data: {
        memberId: sellerId,
        title: "Trial item (shipping test)",
        description: "Sample order for testing shipping labels and rates. You can delete this item from your store.",
        photos: [WIX_IMG("2bdd49_46bd85d79e654db9bfc8b6d2a206d9a2~mv2.jpg/v1/fill/w_200,h_200,al_c,q_80,enc_avif,quality_auto/0005_3A.jpg")],
        category: "Test",
        priceCents: 999, // $9.99
        quantity: 1,
        status: "active",
        shippingCostCents: 500, // $5.00
        shippingPolicy: "Standard shipping. Trial item for testing.",
        slug,
      },
    });

    const subtotalCents = 999; // 1 × $9.99
    const shippingCostCents = 500; // $5.00
    const totalCents = subtotalCents + shippingCostCents;

    const shippingAddress = {
      street: "123 Test Street",
      city: "Spokane",
      state: "WA",
      zip: "99201",
    };

    const order = await prisma.storeOrder.create({
      data: {
        buyerId,
        sellerId,
        subtotalCents,
        shippingCostCents,
        totalCents,
        status: "paid",
        shippingAddress,
        items: {
          create: {
            storeItemId: trialItem.id,
            quantity: 1,
            priceCentsAtPurchase: 999,
          },
        },
      },
      include: {
        buyer: { select: { id: true, firstName: true, lastName: true, email: true } },
        items: {
          include: {
            storeItem: { select: { id: true, title: true, slug: true, photos: true } },
          },
        },
      },
    });

    return NextResponse.json(order);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Database error";
    const isConn = /P1001|ECONNREFUSED|connect/i.test(String(e));
    return NextResponse.json(
      { error: isConn ? "Database connection failed. Make sure PostgreSQL is running." : msg },
      { status: 500 }
    );
  }
}
