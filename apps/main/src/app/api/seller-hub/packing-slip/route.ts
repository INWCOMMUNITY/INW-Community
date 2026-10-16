import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import {
  generatePackingSlipPdf,
  type PackingSlipGroup,
  type PackingSlipSellerProfile,
} from "@/lib/packing-slip";
import { getSellerShippoCredential, getSellerFromAddress } from "@/lib/shippo-seller";
import { memberHasStorefrontListingAccess } from "@/lib/storefront-seller-access";

/** One slip per label. Explicit groups stay together. Every other order is its own slip. */
function slipIdGroups(orderIds: string[], raw: unknown): string[][] {
  const allowed = new Set(orderIds);
  if (!Array.isArray(raw)) return orderIds.map((id) => [id]);
  const used = new Set<string>();
  const groups: string[][] = [];
  for (const entry of raw) {
    if (!Array.isArray(entry)) continue;
    const ids = [
      ...new Set(entry.filter((id): id is string => typeof id === "string" && allowed.has(id))),
    ];
    if (ids.length === 0) continue;
    ids.forEach((id) => used.add(id));
    groups.push(ids);
  }
  for (const id of orderIds) {
    if (!used.has(id)) groups.push([id]);
  }
  return groups;
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSessionForApi(req);
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const canList = await memberHasStorefrontListingAccess(userId);
    if (!canList) {
      return NextResponse.json(
        { error: "Subscribe or Seller plan required." },
        { status: 403 }
      );
    }

    const body = await req.json();
    const orderIds = Array.isArray(body.orderIds) ? (body.orderIds as string[]) : [];
    const requestedGroups = slipIdGroups(orderIds, body.groups);

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

    const [member, business, shippoCred] = await Promise.all([
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
      getSellerShippoCredential(userId),
    ]);

    let returnAddressFormatted: string | null = null;
    if (shippoCred) {
      const fromAddr = await getSellerFromAddress(shippoCred);
      if (fromAddr?.street1 && fromAddr?.city && fromAddr?.state && fromAddr?.zip) {
        returnAddressFormatted = [
          fromAddr.company ?? business?.name ?? "",
          fromAddr.street1,
          fromAddr.street2,
          [fromAddr.city, fromAddr.state, fromAddr.zip].filter(Boolean).join(", "),
        ]
          .filter(Boolean)
          .join("\n");
      }
    }

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
      returnAddressFormatted,
      packingSlipNote: member?.packingSlipNote ?? null,
    };

    const byId = new Map(orders.map((order) => [order.id, order]));
    const groups: PackingSlipGroup[] = [];
    for (const ids of requestedGroups) {
      const group = ids
        .map((id) => byId.get(id))
        .filter((order): order is (typeof orders)[number] => order != null);
      if (group.length === 0) continue;
      const first = group[0];
      groups.push({
        buyer: {
          firstName: first.buyer.firstName,
          lastName: first.buyer.lastName,
          email: first.buyer.email,
        },
        orders: group.map((order) => ({
          id: order.id,
          shippingAddress: order.shippingAddress,
          createdAt: order.createdAt,
          stripePaymentIntentId: order.stripePaymentIntentId,
        })),
        combinedItems: group.flatMap((order) =>
          order.items.map((item) => ({
            id: item.id,
            quantity: item.quantity,
            priceCentsAtPurchase: item.priceCentsAtPurchase,
            storeItem: { title: item.storeItem.title },
            orderId: order.id,
          }))
        ),
        totalCents: group.reduce((sum, order) => sum + order.totalCents, 0),
        subtotalCents: group.reduce(
          (sum, order) => sum + (order.subtotalCents ?? order.totalCents - order.shippingCostCents),
          0
        ),
        shippingCostCents: group.reduce((sum, order) => sum + order.shippingCostCents, 0),
        taxCents: group.reduce((sum, order) => sum + order.taxCents, 0),
      });
    }

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
