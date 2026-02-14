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

const patchSchema = z.object({
  quantity: z.number().int().min(0).optional(),
  fulfillmentType: z.enum(["ship", "local_delivery", "pickup"]).optional(),
  variant: z.unknown().optional(),
  localDeliveryDetails: localDeliveryDetailsSchema.optional(),
  pickupDetails: pickupDetailsSchema.optional(),
});

export const dynamic = "force-dynamic";

export async function DELETE(
  req: NextRequest,
  { params }: { params: { itemId: string } }
) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const item = await prisma.cartItem.findFirst({
    where: { id: params.itemId, memberId: session.user.id },
  });
  if (!item) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.cartItem.delete({ where: { id: params.itemId } });
  return NextResponse.json({ ok: true });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { itemId: string } }
) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const item = await prisma.cartItem.findFirst({
    where: { id: params.itemId, memberId: session.user.id },
    include: { storeItem: true },
  });
  if (!item) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const storeItem = item.storeItem as {
    quantity: number;
    localDeliveryAvailable?: boolean;
    inStorePickupAvailable?: boolean;
    shippingDisabled?: boolean;
  };

  let body: z.infer<typeof patchSchema>;
  try {
    body = patchSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const requestedFulfillment = body.fulfillmentType ?? item.fulfillmentType ?? "ship";
  if (requestedFulfillment === "local_delivery") {
    if (!storeItem.localDeliveryAvailable) {
      return NextResponse.json(
        { error: "This item does not offer local delivery." },
        { status: 400 }
      );
    }
    if (!body.localDeliveryDetails && !item.localDeliveryDetails) {
      return NextResponse.json(
        { error: "Local delivery requires delivery details. Please complete the delivery form." },
        { status: 400 }
      );
    }
  }

  if (body.quantity !== undefined) {
    if (body.quantity === 0) {
      await prisma.cartItem.delete({ where: { id: params.itemId } });
      return NextResponse.json({ ok: true });
    }
  }

  const updateData: {
    quantity?: number;
    fulfillmentType?: string | null;
    variant?: unknown;
    localDeliveryDetails?: unknown;
    pickupDetails?: unknown;
  } = {};

  if (body.quantity !== undefined) {
    updateData.quantity = Math.min(body.quantity, storeItem.quantity);
  }
  if (body.fulfillmentType !== undefined) {
    updateData.fulfillmentType = body.fulfillmentType;
    if (body.fulfillmentType !== "local_delivery") {
      updateData.localDeliveryDetails = Prisma.JsonNull;
    }
    if (body.fulfillmentType !== "pickup") {
      updateData.pickupDetails = Prisma.JsonNull;
    }
  }
  if (body.variant !== undefined) {
    updateData.variant = body.variant ? (body.variant as object) : Prisma.JsonNull;
  }
  if (body.localDeliveryDetails !== undefined) {
    updateData.localDeliveryDetails = body.localDeliveryDetails as object;
    if (requestedFulfillment === "local_delivery") {
      updateData.fulfillmentType = "local_delivery";
    }
  }
  if (body.pickupDetails !== undefined) {
    updateData.pickupDetails = body.pickupDetails as object;
    if (requestedFulfillment === "pickup") {
      updateData.fulfillmentType = "pickup";
    }
  }

  await prisma.cartItem.update({
    where: { id: params.itemId },
    data: updateData as Prisma.CartItemUpdateInput,
  });
  return NextResponse.json({ ok: true });
}
