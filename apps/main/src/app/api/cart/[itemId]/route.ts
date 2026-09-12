import { NextRequest, NextResponse } from "next/server";
import { prisma, Prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import {
  validateRequestedFulfillment,
  validateLocalDeliveryDetails,
  storeItemHasLocalDeliveryPolicy,
  type LocalDeliveryDetailsJson,
} from "@/lib/pickup-delivery-checkout";
import { z } from "zod";
import { getAvailableQuantity } from "@/lib/store-item-variants";
import { findMatchingCartLine, maxQuantityForCartLine } from "@/lib/cart-line-identity";

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
  email: z.string().optional(),
  deliveryAddress: deliveryAddressSchema,
  availableDropOffTimes: z.string().optional(),
  note: z.string().optional(),
  termsAcceptedAt: z.string().optional(),
});
const pickupDetailsSchema = z.object({
  firstName: z.string(),
  lastName: z.string(),
  phone: z.string(),
  email: z.string().optional(),
  preferredPickupDate: z.string().optional(),
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
    include: {
      storeItem: {
        include: {
          member: { select: { sellerLocalDeliveryPolicy: true, sellerPickupPolicy: true } },
        },
      },
    },
  });
  if (!item) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const storeItem = item.storeItem as {
    quantity: number;
    variants?: unknown;
    localDeliveryAvailable?: boolean;
    inStorePickupAvailable?: boolean;
    shippingDisabled?: boolean;
    localDeliveryTerms?: string | null;
    pickupTerms?: string | null;
    member?: {
      sellerLocalDeliveryPolicy?: string | null;
      sellerPickupPolicy?: string | null;
    } | null;
  };

  let body: z.infer<typeof patchSchema>;
  try {
    body = patchSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const requestedFulfillment = body.fulfillmentType ?? item.fulfillmentType ?? "ship";
  const fulfillmentCheck = validateRequestedFulfillment(storeItem, requestedFulfillment);
  if (!fulfillmentCheck.ok) {
    return NextResponse.json({ error: fulfillmentCheck.error }, { status: 400 });
  }
  if (requestedFulfillment === "local_delivery") {
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

  const siblingRows = await prisma.cartItem.findMany({
    where: { memberId: session.user.id, storeItemId: item.storeItemId },
  });

  const updateData: {
    quantity?: number;
    fulfillmentType?: string | null;
    variant?: unknown;
    localDeliveryDetails?: unknown;
    pickupDetails?: unknown;
  } = {};

  const nextVariant = body.variant !== undefined ? body.variant : item.variant;
  const nextFulfillment =
    body.fulfillmentType ??
    (body.localDeliveryDetails !== undefined
      ? "local_delivery"
      : body.pickupDetails !== undefined
        ? "pickup"
        : item.fulfillmentType ?? "ship");

  if (body.quantity !== undefined) {
    const skuAvailable = getAvailableQuantity(storeItem, nextVariant ?? undefined);
    const maxForThisLine = maxQuantityForCartLine(skuAvailable, siblingRows, {
      id: item.id,
      storeItemId: item.storeItemId,
      variant: nextVariant,
    });
    updateData.quantity = Math.min(body.quantity, maxForThisLine);
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

  if (body.localDeliveryDetails !== undefined && requestedFulfillment === "local_delivery") {
    const ldCheck = validateLocalDeliveryDetails(body.localDeliveryDetails as LocalDeliveryDetailsJson, {
      requirePolicyAcceptance: storeItemHasLocalDeliveryPolicy(storeItem),
    });
    if (!ldCheck.ok) {
      return NextResponse.json({ error: ldCheck.error }, { status: 400 });
    }
  }

  const duplicate = findMatchingCartLine(
    siblingRows.filter((row) => row.id !== item.id),
    {
      storeItemId: item.storeItemId,
      variant: nextVariant,
      fulfillmentType: nextFulfillment,
      resaleOfferId: item.resaleOfferId,
    }
  );
  if (duplicate) {
    const skuAvailable = getAvailableQuantity(storeItem, nextVariant ?? undefined);
    const withoutCurrent = siblingRows.filter((row) => row.id !== item.id);
    const maxForDuplicate = maxQuantityForCartLine(skuAvailable, withoutCurrent, {
      id: duplicate.id,
      storeItemId: item.storeItemId,
      variant: nextVariant,
    });
    const incomingQty = updateData.quantity ?? item.quantity;
    const mergedQty = Math.min(duplicate.quantity + incomingQty, maxForDuplicate);
    await prisma.cartItem.update({
      where: { id: duplicate.id },
      data: {
        quantity: Math.max(1, mergedQty),
        ...(updateData.localDeliveryDetails !== undefined
          ? { localDeliveryDetails: updateData.localDeliveryDetails as object }
          : {}),
        ...(updateData.pickupDetails !== undefined
          ? { pickupDetails: updateData.pickupDetails as object }
          : {}),
      },
    });
    await prisma.cartItem.delete({ where: { id: item.id } });
    return NextResponse.json({ ok: true });
  }

  await prisma.cartItem.update({
    where: { id: params.itemId },
    data: updateData as Prisma.CartItemUpdateInput,
  });
  return NextResponse.json({ ok: true });
}
