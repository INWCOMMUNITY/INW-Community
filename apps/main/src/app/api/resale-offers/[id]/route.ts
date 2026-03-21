import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { getAvailableQuantity } from "@/lib/store-item-variants";
import { z } from "zod";

const patchBodySchema = z.object({
  status: z.enum(["accepted", "declined", "countered"]),
  sellerResponse: z.string().max(1000).optional(),
  counterAmountCents: z.number().int().min(1).optional(),
});

const buyerResponseSchema = z.object({
  status: z.enum(["accepted", "declined"]),
});

const OFFER_CHECKOUT_HOURS = 24;

async function placeAcceptedOfferInBuyerCart(
  offer: {
    id: string;
    buyerId: string;
    storeItemId: string;
    storeItem: {
      quantity: number;
      shippingDisabled: boolean;
      localDeliveryAvailable: boolean;
      inStorePickupAvailable: boolean;
      variants: unknown;
    };
  },
  finalAmountCents: number
): Promise<void> {
  const si = offer.storeItem;
  const avail = getAvailableQuantity(si, undefined);
  if (avail < 1) {
    throw new Error("ITEM_UNAVAILABLE");
  }
  let fulfillmentType: "ship" | "local_delivery" | "pickup" = "ship";
  if (si.shippingDisabled) {
    if (si.localDeliveryAvailable) fulfillmentType = "local_delivery";
    else if (si.inStorePickupAvailable) fulfillmentType = "pickup";
  }

  const deadline = new Date(Date.now() + OFFER_CHECKOUT_HOURS * 60 * 60 * 1000);

  await prisma.$transaction(async (tx) => {
    await tx.resaleOffer.update({
      where: { id: offer.id },
      data: {
        status: "accepted",
        finalAmountCents: finalAmountCents,
        acceptedAt: new Date(),
        checkoutDeadlineAt: deadline,
        respondedAt: new Date(),
      },
    });
    await tx.cartItem.deleteMany({
      where: { memberId: offer.buyerId, storeItemId: offer.storeItemId },
    });
    await tx.cartItem.create({
      data: {
        memberId: offer.buyerId,
        storeItemId: offer.storeItemId,
        quantity: 1,
        priceOverrideCents: finalAmountCents,
        resaleOfferId: offer.id,
        fulfillmentType,
      },
    });
  });

  const { sendPushNotification } = await import("@/lib/send-push-notification");
  await sendPushNotification(offer.buyerId, {
    title: "Offer accepted",
    body: `Complete checkout within 24 hours at the agreed price of $${(finalAmountCents / 100).toFixed(2)}.`,
    data: { screen: "cart" },
  }).catch(() => {});
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionForApi(req);
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const offer = await prisma.resaleOffer.findUnique({
    where: { id },
    include: {
      storeItem: {
        select: {
          memberId: true,
          quantity: true,
          shippingDisabled: true,
          localDeliveryAvailable: true,
          inStorePickupAvailable: true,
          variants: true,
        },
      },
    },
  });
  if (!offer) {
    return NextResponse.json({ error: "Offer not found" }, { status: 404 });
  }
  const isSeller = offer.storeItem.memberId === userId;
  const isBuyer = offer.buyerId === userId;

  if (!isSeller && !isBuyer) {
    return NextResponse.json({ error: "You cannot respond to this offer" }, { status: 403 });
  }

  if (isBuyer && offer.status === "countered") {
    let buyerData: z.infer<typeof buyerResponseSchema>;
    try {
      const body = await req.json();
      buyerData = buyerResponseSchema.parse(body);
    } catch (e) {
      const msg = e instanceof z.ZodError ? e.errors[0]?.message : "Invalid input";
      return NextResponse.json({ error: String(msg) }, { status: 400 });
    }
    if (buyerData.status === "accepted") {
      const final = offer.counterAmountCents;
      if (typeof final !== "number" || final < 1) {
        return NextResponse.json({ error: "Invalid counter offer amount" }, { status: 400 });
      }
      try {
        await placeAcceptedOfferInBuyerCart(
          {
            id: offer.id,
            buyerId: offer.buyerId,
            storeItemId: offer.storeItemId,
            storeItem: offer.storeItem,
          },
          final
        );
      } catch (err) {
        if (err instanceof Error && err.message === "ITEM_UNAVAILABLE") {
          return NextResponse.json({ error: "This item is no longer available." }, { status: 400 });
        }
        throw err;
      }
      const updated = await prisma.resaleOffer.findUnique({ where: { id } });
      return NextResponse.json(updated);
    }
    const updated = await prisma.resaleOffer.update({
      where: { id },
      data: {
        status: buyerData.status,
        respondedAt: new Date(),
      },
    });
    return NextResponse.json(updated);
  }

  if (!isSeller) {
    return NextResponse.json({ error: "Only the seller can perform this action" }, { status: 403 });
  }
  if (offer.status !== "pending") {
    return NextResponse.json({ error: "Offer has already been responded to" }, { status: 400 });
  }

  let data: z.infer<typeof patchBodySchema>;
  try {
    const body = await req.json();
    data = patchBodySchema.parse(body);
  } catch (e) {
    const msg = e instanceof z.ZodError ? e.errors[0]?.message : "Invalid input";
    return NextResponse.json({ error: String(msg) }, { status: 400 });
  }

  if (data.status === "countered") {
    if (typeof data.counterAmountCents !== "number" || data.counterAmountCents < 1) {
      return NextResponse.json(
        { error: "Counter offer requires a valid counterAmountCents" },
        { status: 400 }
      );
    }
  }

  if (data.status === "accepted") {
    try {
      await placeAcceptedOfferInBuyerCart(
        {
          id: offer.id,
          buyerId: offer.buyerId,
          storeItemId: offer.storeItemId,
          storeItem: offer.storeItem,
        },
        offer.amountCents
      );
    } catch (err) {
      if (err instanceof Error && err.message === "ITEM_UNAVAILABLE") {
        return NextResponse.json({ error: "This item is no longer available." }, { status: 400 });
      }
      throw err;
    }
    const updated = await prisma.resaleOffer.findUnique({ where: { id } });
    return NextResponse.json(updated);
  }

  const updated = await prisma.resaleOffer.update({
    where: { id },
    data: {
      status: data.status,
      sellerResponse: data.sellerResponse?.trim() || null,
      counterAmountCents: data.status === "countered" ? data.counterAmountCents : null,
      respondedAt: new Date(),
    },
  });
  return NextResponse.json(updated);
}
