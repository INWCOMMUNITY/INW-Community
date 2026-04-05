import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { prisma, Prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { syncStripeCustomerShippingFromProfileDelivery } from "@/lib/stripe-storefront-checkout-customer";
import { getCurrentSeasonId } from "@/lib/award-points";
import {
  NWC_PAID_PLAN_ACCESS_STATUSES,
  NWC_PAID_PLAN_SLUGS,
  prismaWhereMemberSellerPlanAccess,
} from "@/lib/nwc-paid-subscription";
import {
  prismaWhereMemberSubscribePlanAccess,
  prismaWhereMemberSubscribeTierPerksAccess,
} from "@/lib/subscribe-plan-access";
import { resolveEffectiveNwcPlan } from "@/lib/resolve-effective-nwc-plan";
import { hasBusinessHubAccess } from "@/lib/business-hub-access";
import { z } from "zod";
import { validateMemberDisplayNameFields } from "@/lib/member-display-name-policy";

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
      allTimePointsEarned: true,
      privacyLevel: true,
      phone: true,
      deliveryAddress: true,
      signupIntent: true,
      acceptCashForPickupDelivery: true,
      sellerShippingPolicy: true,
      sellerLocalDeliveryPolicy: true,
      sellerPickupPolicy: true,
      sellerReturnPolicy: true,
    },
  });
  if (!member) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const seasonId = await getCurrentSeasonId();
  let seasonPointsEarned: number | undefined;
  let currentSeason: { id: string; name: string } | undefined;
  if (seasonId) {
    const season = await prisma.season.findUnique({
      where: { id: seasonId },
      select: { id: true, name: true },
    });
    if (season) {
      currentSeason = season;
      const msp = await prisma.memberSeasonPoints.findUnique({
        where: { memberId_seasonId: { memberId: session.user.id, seasonId } },
        select: { pointsEarned: true },
      });
      seasonPointsEarned = msp?.pointsEarned ?? 0;
    }
  }
  const [subTier, subResaleHub, subscriptions, subscriptionPlan, hasHubAccess, sellerPlanRow] =
    await Promise.all([
    prisma.subscription.findFirst({
      where: prismaWhereMemberSubscribeTierPerksAccess(session.user.id),
      select: { id: true },
    }),
    prisma.subscription.findFirst({
      where: prismaWhereMemberSubscribePlanAccess(session.user.id),
      select: { id: true },
    }),
    prisma.subscription.findMany({
      where: { memberId: session.user.id, status: { in: [...NWC_PAID_PLAN_ACCESS_STATUSES] } },
      select: { plan: true, status: true },
    }),
    resolveEffectiveNwcPlan(session.user.id),
    hasBusinessHubAccess(session.user.id),
    prisma.subscription.findFirst({
      where: prismaWhereMemberSellerPlanAccess(session.user.id),
      select: { id: true },
    }),
  ]);
  const adminEmail = process.env.ADMIN_EMAIL?.trim();
  const isPlatformAdmin =
    !!adminEmail &&
    !!member.email &&
    member.email.toLowerCase() === adminEmail.toLowerCase();
  const canAccessSellerHub = isPlatformAdmin || sellerPlanRow != null;
  const paidSlugSet = new Set<string>(NWC_PAID_PLAN_SLUGS);
  const hasPaidSubscription = subscriptions.some((s) => paidSlugSet.has(s.plan));
  return NextResponse.json({
    ...member,
    seasonPointsEarned,
    currentSeason,
    isSubscriber: !!subTier,
    /** Resident Subscribe ($10/mo) only — NWC Resale Hub; Business/Seller use Seller Hub for resale listings. */
    hasResaleHubAccess: !!subResaleHub,
    /** Active Business/Seller plan or admin-assigned business (`adminGrantedAt`). */
    hasBusinessHubAccess: hasHubAccess,
    /** Seller plan or platform admin — same gate as `/seller-hub` home. */
    canAccessSellerHub,
    hasPaidSubscription,
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

    if (data.firstName !== undefined || data.lastName !== undefined) {
      const current = await prisma.member.findUnique({
        where: { id: session.user.id },
        select: { firstName: true, lastName: true },
      });
      if (!current) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      const mergedFirst = data.firstName !== undefined ? data.firstName : current.firstName;
      const mergedLast = data.lastName !== undefined ? data.lastName : current.lastName;
      const namePolicyError = validateMemberDisplayNameFields(mergedFirst, mergedLast);
      if (namePolicyError) {
        return NextResponse.json({ error: namePolicyError }, { status: 400 });
      }
    }

    const { count } = await prisma.member.updateMany({
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
    if (count === 0) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
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

    if (data.deliveryAddress) {
      const d = data.deliveryAddress;
      if (d.street?.trim() && d.city?.trim() && d.state?.trim() && d.zip?.trim()) {
        const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
        if (stripeSecretKey?.startsWith("sk_") && !stripeSecretKey.includes("...")) {
          try {
            const stripe = new Stripe(stripeSecretKey, {
              apiVersion: "2024-11-20.acacia" as "2023-10-16",
            });
            await syncStripeCustomerShippingFromProfileDelivery(stripe, session.user.id, d);
          } catch (syncErr) {
            console.error("[PATCH /api/me] Stripe delivery sync failed", syncErr);
          }
        }
      }
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof z.ZodError) {
      const first = e.errors[0];
      const msg = first?.message ?? "Please check your input.";
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
