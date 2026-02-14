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

const patchSchema = z.object({
  profilePhotoUrl: z
    .union([z.string().url(), z.string().regex(/^\/.+/)])
    .nullable()
    .optional()
    .or(z.literal("")),
  firstName: z.string().min(1).max(100).optional(),
  lastName: z.string().min(1).max(100).optional(),
  bio: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  privacyLevel: z.enum(["public", "friends_only", "completely_private"]).optional(),
  phone: z.string().nullable().optional(),
  deliveryAddress: deliveryAddressSchema.nullable().optional(),
  acceptCashForPickupDelivery: z.boolean().optional(),
  sellerShippingPolicy: z.string().nullable().optional(),
  sellerLocalDeliveryPolicy: z.string().nullable().optional(),
  sellerPickupPolicy: z.string().nullable().optional(),
  sellerReturnPolicy: z.string().nullable().optional(),
  offerShipping: z.boolean().optional(),
  offerLocalDelivery: z.boolean().optional(),
  offerLocalPickup: z.boolean().optional(),
});

export async function GET(req: NextRequest) {
  try {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const member = await prisma.member.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      profilePhotoUrl: true,
      bio: true,
      city: true,
      points: true,
      privacyLevel: true,
      phone: true,
      deliveryAddress: true,
      acceptCashForPickupDelivery: true,
      sellerShippingPolicy: true,
      sellerLocalDeliveryPolicy: true,
      sellerPickupPolicy: true,
      sellerReturnPolicy: true,
      // offerShipping, offerLocalDelivery, offerLocalPickup omitted until db:push adds columns - prevents sign-in redirect loop
    },
  });
  if (!member) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const [sub, subscriptions] = await Promise.all([
    prisma.subscription.findFirst({
      where: { memberId: session.user.id, plan: "subscribe", status: "active" },
      select: { id: true },
    }),
    prisma.subscription.findMany({
      where: { memberId: session.user.id, status: "active" },
      select: { plan: true, status: true },
    }),
  ]);
  const subscriptionPlan = session.user.subscriptionPlan ?? subscriptions[0]?.plan ?? null;
  return NextResponse.json({
    ...member,
    isSubscriber: !!sub,
    subscriptionPlan,
    subscriptions: subscriptions.map((s) => ({ plan: s.plan, status: s.status })),
  });
  } catch (e) {
    const err = e as Error;
    console.error("[GET /api/me]", err);
    const message =
      process.env.NODE_ENV === "development"
        ? err.message || "Internal server error"
        : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const body = await req.json();
    const data = patchSchema.parse({
      ...body,
      profilePhotoUrl: body.profilePhotoUrl ?? null,
    });
    await prisma.member.update({
      where: { id: session.user.id },
      data: {
        ...(data.profilePhotoUrl !== undefined && {
          profilePhotoUrl: data.profilePhotoUrl || null,
        }),
        ...(data.firstName !== undefined && { firstName: data.firstName }),
        ...(data.lastName !== undefined && { lastName: data.lastName }),
        ...(data.bio !== undefined && { bio: data.bio }),
        ...(data.city !== undefined && { city: data.city }),
        ...(data.privacyLevel !== undefined && { privacyLevel: data.privacyLevel }),
        ...(data.phone !== undefined && { phone: data.phone || null }),
        ...(data.deliveryAddress !== undefined && {
          deliveryAddress: data.deliveryAddress
            ? (data.deliveryAddress as object)
            : Prisma.JsonNull,
        }),
        ...(data.acceptCashForPickupDelivery !== undefined && {
          acceptCashForPickupDelivery: data.acceptCashForPickupDelivery,
        }),
        ...(data.sellerShippingPolicy !== undefined && {
          sellerShippingPolicy: data.sellerShippingPolicy === null || data.sellerShippingPolicy === "" ? null : data.sellerShippingPolicy,
        }),
        ...(data.sellerLocalDeliveryPolicy !== undefined && {
          sellerLocalDeliveryPolicy: data.sellerLocalDeliveryPolicy === null || data.sellerLocalDeliveryPolicy === "" ? null : data.sellerLocalDeliveryPolicy,
        }),
        ...(data.sellerPickupPolicy !== undefined && {
          sellerPickupPolicy: data.sellerPickupPolicy === null || data.sellerPickupPolicy === "" ? null : data.sellerPickupPolicy,
        }),
        ...(data.sellerReturnPolicy !== undefined && {
          sellerReturnPolicy: data.sellerReturnPolicy === null || data.sellerReturnPolicy === "" ? null : data.sellerReturnPolicy,
        }),
      },
    });
    // Update offer columns if present (may fail if db:push not run - ignore)
    if (data.offerShipping !== undefined || data.offerLocalDelivery !== undefined || data.offerLocalPickup !== undefined) {
      try {
        const updates: string[] = [];
        const values: (boolean | string)[] = [];
        let i = 1;
        if (data.offerShipping !== undefined) {
          updates.push(`offer_shipping = $${i++}`);
          values.push(data.offerShipping);
        }
        if (data.offerLocalDelivery !== undefined) {
          updates.push(`offer_local_delivery = $${i++}`);
          values.push(data.offerLocalDelivery);
        }
        if (data.offerLocalPickup !== undefined) {
          updates.push(`offer_local_pickup = $${i++}`);
          values.push(data.offerLocalPickup);
        }
        if (updates.length > 0) {
          await prisma.$executeRawUnsafe(
            `UPDATE "Member" SET ${updates.join(", ")} WHERE id = $${i}`,
            ...values,
            session.user.id
          );
        }
      } catch {
        // Columns may not exist yet - ignore
      }
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: e.flatten() }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
