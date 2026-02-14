import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { z } from "zod";

const bodySchema = z.object({
  businessId: z.string().nullable().optional(),
  title: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  photos: z.array(z.string()).optional(),
  category: z.string().nullable().optional(),
  priceCents: z.number().int().min(1).optional(),
  variants: z.unknown().nullable().optional(),
  quantity: z.number().int().min(1, "Quantity must be at least 1 to list.").optional(),
  status: z.enum(["active", "sold_out", "inactive"]).optional(),
  listingType: z.enum(["new", "resale"]).optional(),
  shippingCostCents: z.number().int().min(0).nullable().optional(),
  shippingPolicy: z.string().nullable().optional(),
  localDeliveryAvailable: z.boolean().optional(),
  localDeliveryFeeCents: z.number().int().min(0).nullable().optional(),
  inStorePickupAvailable: z.boolean().optional(),
  shippingDisabled: z.boolean().optional(),
  localDeliveryTerms: z.string().nullable().optional(),
  pickupTerms: z.string().nullable().optional(),
  acceptOffers: z.boolean().optional(),
  minOfferCents: z.number().int().min(0).nullable().optional(),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const item = await prisma.storeItem.findUnique({
    where: { id: params.id },
    include: {
      member: { select: { id: true, firstName: true, lastName: true } },
      business: { select: { id: true, name: true, slug: true } },
    },
  });
  if (!item) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(item);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const existing = await prisma.storeItem.findUnique({
    where: { id: params.id },
  });
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (existing.memberId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let data: z.infer<typeof bodySchema>;
  try {
    const body = await req.json();
    data = bodySchema.parse(body);
  } catch (e) {
    const msg = e instanceof z.ZodError ? e.errors[0]?.message : "Invalid input";
    return NextResponse.json({ error: String(msg) }, { status: 400 });
  }

  if (data.listingType !== undefined) {
    const sellerSub = await prisma.subscription.findFirst({
      where: { memberId: session.user.id, plan: "seller", status: "active" },
    });
    const subscribeSub = await prisma.subscription.findFirst({
      where: { memberId: session.user.id, plan: "subscribe", status: "active" },
    });
    if (data.listingType === "new") {
      if (!sellerSub) {
        return NextResponse.json({ error: "Seller plan required to list new items on the storefront" }, { status: 403 });
      }
    } else {
      if (!sellerSub && !subscribeSub) {
        return NextResponse.json({ error: "Subscribe or Seller plan required to list resale items" }, { status: 403 });
      }
    }
  }

  if (data.businessId !== undefined && data.businessId) {
    const biz = await prisma.business.findFirst({
      where: { id: data.businessId, memberId: session.user.id },
    });
    if (!biz) {
      return NextResponse.json({ error: "Business not found" }, { status: 400 });
    }
  }

  const shippingDisabled = data.shippingDisabled ?? existing.shippingDisabled;
  const localDeliveryAvailable = data.localDeliveryAvailable ?? existing.localDeliveryAvailable;
  const inStorePickupAvailable = data.inStorePickupAvailable ?? existing.inStorePickupAvailable;
  if (shippingDisabled && !localDeliveryAvailable && !inStorePickupAvailable) {
    return NextResponse.json(
      { error: "When 'only local delivery/pickup' is on, enable at least local delivery or pickup." },
      { status: 400 }
    );
  }

  const update: Record<string, unknown> = {};
  if (data.title !== undefined) update.title = data.title.trim();
  if (data.description !== undefined) update.description = data.description?.trim() || null;
  if (data.photos !== undefined) update.photos = data.photos;
  if (data.category !== undefined) update.category = data.category?.trim() || null;
  if (data.priceCents !== undefined) update.priceCents = data.priceCents;
  if (data.variants !== undefined) update.variants = data.variants;
  if (data.quantity !== undefined) update.quantity = data.quantity;
  if (data.status !== undefined) update.status = data.status;
  if (data.shippingCostCents !== undefined) update.shippingCostCents = data.shippingCostCents;
  if (data.shippingPolicy !== undefined) update.shippingPolicy = data.shippingPolicy?.trim() || null;
  if (data.localDeliveryAvailable !== undefined) update.localDeliveryAvailable = data.localDeliveryAvailable;
  if (data.localDeliveryFeeCents !== undefined) update.localDeliveryFeeCents = data.localDeliveryFeeCents;
  if (data.inStorePickupAvailable !== undefined) update.inStorePickupAvailable = data.inStorePickupAvailable;
  if (data.shippingDisabled !== undefined) update.shippingDisabled = data.shippingDisabled;
  if (data.localDeliveryTerms !== undefined) update.localDeliveryTerms = data.localDeliveryTerms?.trim() || null;
  if (data.pickupTerms !== undefined) update.pickupTerms = data.pickupTerms?.trim() || null;
  if (data.businessId !== undefined) update.businessId = data.businessId;
  if (data.listingType !== undefined) update.listingType = data.listingType;
  if (data.acceptOffers !== undefined) update.acceptOffers = data.acceptOffers;
  if (data.minOfferCents !== undefined) update.minOfferCents = data.minOfferCents;

  const item = await prisma.storeItem.update({
    where: { id: params.id },
    data: update as object,
  });
  return NextResponse.json(item);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const existing = await prisma.storeItem.findUnique({
    where: { id: params.id },
  });
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (existing.memberId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await prisma.storeItem.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
