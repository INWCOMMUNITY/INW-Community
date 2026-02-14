import { NextRequest, NextResponse } from "next/server";
import { prisma, Prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { z } from "zod";

const deliveryAddressSchema = z.object({
  street: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  zip: z.string().optional(),
});
const localDeliveryDetailsSchema = z.object({
  firstName: z.string(),
  lastName: z.string(),
  phone: z.string(),
  deliveryAddress: deliveryAddressSchema,
  note: z.string().optional(),
  termsAcceptedAt: z.string().optional(),
});
const pickupDetailsSchema = z.object({
  firstName: z.string(),
  lastName: z.string(),
  phone: z.string(),
  email: z.string().optional(),
  preferredPickupTime: z.string().optional(),
  note: z.string().optional(),
  termsAcceptedAt: z.string().optional(),
});

const addSchema = z.object({
  storeItemId: z.string().min(1),
  quantity: z.number().int().min(1).default(1),
  variant: z.unknown().optional(),
  fulfillmentType: z.enum(["ship", "local_delivery", "pickup"]).optional(),
  localDeliveryDetails: localDeliveryDetailsSchema.optional(),
  pickupDetails: pickupDetailsSchema.optional(),
});

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json([]);
  }

  const items = await prisma.cartItem.findMany({
    where: { memberId: session.user.id },
    include: {
      storeItem: {
        select: {
          id: true,
          title: true,
          slug: true,
          photos: true,
          priceCents: true,
          quantity: true,
          status: true,
          variants: true,
          memberId: true,
          listingType: true,
          shippingCostCents: true,
          localDeliveryFeeCents: true,
          localDeliveryAvailable: true,
          inStorePickupAvailable: true,
          shippingDisabled: true,
          pickupTerms: true,
          member: {
            select: {
              acceptCashForPickupDelivery: true,
              sellerLocalDeliveryPolicy: true,
              sellerPickupPolicy: true,
            },
          },
        },
      },
    },
  });

  const cart = items.map((i) => ({
    id: i.id,
    storeItemId: i.storeItemId,
    quantity: i.quantity,
    variant: i.variant,
    fulfillmentType: i.fulfillmentType,
    localDeliveryDetails: i.localDeliveryDetails,
    pickupDetails: i.pickupDetails,
    storeItem: i.storeItem,
  }));

  return NextResponse.json(cart);
}

export async function POST(req: NextRequest) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: z.infer<typeof addSchema>;
  try {
    body = addSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const storeItem = await prisma.storeItem.findUnique({
    where: { id: body.storeItemId, status: "active" },
  });
  if (!storeItem || storeItem.quantity < 1) {
    return NextResponse.json({ error: "Item not available" }, { status: 400 });
  }

  const fulfillmentType = body.fulfillmentType ?? "ship";
  let localDeliveryDetails: object | null = null;
  let pickupDetails: object | null = null;
  if (fulfillmentType === "local_delivery") {
    if (body.localDeliveryDetails) {
      localDeliveryDetails = body.localDeliveryDetails as object;
    } else {
      const existingFromSameSeller = await prisma.cartItem.findFirst({
        where: {
          memberId: session.user.id,
          fulfillmentType: "local_delivery",
          localDeliveryDetails: { not: Prisma.DbNull },
          storeItem: { memberId: storeItem.memberId },
        },
        select: { localDeliveryDetails: true },
      });
      if (existingFromSameSeller?.localDeliveryDetails && typeof existingFromSameSeller.localDeliveryDetails === "object") {
        localDeliveryDetails = existingFromSameSeller.localDeliveryDetails as object;
      } else {
        return NextResponse.json(
          { error: "Local Delivery requires delivery details. Please complete the delivery form on the product page." },
          { status: 400 }
        );
      }
    }
  }
  if (fulfillmentType === "pickup" && body.pickupDetails) {
    pickupDetails = body.pickupDetails as object;
  }

  const existing = await prisma.cartItem.findFirst({
    where: {
      memberId: session.user.id,
      storeItemId: body.storeItemId,
    },
  });

  const cartData = {
    quantity: existing
      ? Math.min(existing.quantity + body.quantity, storeItem.quantity)
      : Math.min(body.quantity, storeItem.quantity),
    variant: body.variant ? (body.variant as object) : Prisma.JsonNull,
    fulfillmentType,
    localDeliveryDetails: localDeliveryDetails ? (localDeliveryDetails as object) : Prisma.JsonNull,
    pickupDetails: pickupDetails ? (pickupDetails as object) : Prisma.JsonNull,
  };

  if (existing) {
    await prisma.cartItem.update({
      where: { id: existing.id },
      data: cartData,
    });
  } else {
    await prisma.cartItem.create({
      data: {
        memberId: session.user.id,
        storeItemId: body.storeItemId,
        ...cartData,
      },
    });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await prisma.cartItem.deleteMany({
    where: { memberId: session.user.id },
  });
  return NextResponse.json({ ok: true });
}
