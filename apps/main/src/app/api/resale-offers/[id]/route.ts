import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { z } from "zod";

const patchBodySchema = z.object({
  status: z.enum(["accepted", "declined", "countered"]),
  sellerResponse: z.string().max(1000).optional(),
  counterAmountCents: z.number().int().min(1).optional(),
});

const buyerResponseSchema = z.object({
  status: z.enum(["accepted", "declined"]),
});

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
    include: { storeItem: { select: { memberId: true } } },
  });
  if (!offer) {
    return NextResponse.json({ error: "Offer not found" }, { status: 404 });
  }
  const isSeller = offer.storeItem.memberId === userId;
  const isBuyer = offer.buyerId === userId;

  if (!isSeller && !isBuyer) {
    return NextResponse.json({ error: "You cannot respond to this offer" }, { status: 403 });
  }

  // Buyer responding to a counter offer
  if (isBuyer && offer.status === "countered") {
    let buyerData: z.infer<typeof buyerResponseSchema>;
    try {
      const body = await req.json();
      buyerData = buyerResponseSchema.parse(body);
    } catch (e) {
      const msg = e instanceof z.ZodError ? e.errors[0]?.message : "Invalid input";
      return NextResponse.json({ error: String(msg) }, { status: 400 });
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
