import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import bcrypt from "bcryptjs";
import { signMobileToken, type SubscriptionPlan } from "@/lib/mobile-auth";

const PLANS: SubscriptionPlan[] = ["subscribe", "sponsor", "seller"];

async function resolvePlan(memberId: string, requestedPlan?: SubscriptionPlan): Promise<SubscriptionPlan | null> {
  if (requestedPlan) {
    const s = await prisma.subscription.findFirst({
      where: { memberId, status: "active", plan: requestedPlan },
      select: { plan: true },
    });
    return s ? (s.plan as SubscriptionPlan) : null;
  }
  for (const p of PLANS) {
    const s = await prisma.subscription.findFirst({
      where: { memberId, status: "active", plan: p },
      select: { plan: true },
    });
    if (s) return s.plan as SubscriptionPlan;
  }
  return null;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { email, password, plan } = body;

    if (!email || !password || typeof email !== "string" || typeof password !== "string") {
      return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
    }

    const validPlan = plan && PLANS.includes(plan) ? (plan as SubscriptionPlan) : undefined;

    const member = await prisma.member.findUnique({
      where: { email: email.trim().toLowerCase() },
    });

    if (!member) {
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }

    if (member.status === "suspended") {
      return NextResponse.json({ error: "Account suspended" }, { status: 403 });
    }

    const ok = await bcrypt.compare(password, member.passwordHash);
    if (!ok) {
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }

    const subscriptionPlan = await resolvePlan(member.id, validPlan);

    // Resident (subscribe): no subscription required — they're just creating an account.
    // Business / seller signup: allow without subscription when completing registration.
    if (validPlan && !subscriptionPlan) {
      // subscribe = resident signup; sponsor (Business) / seller = business/seller signup in progress
      // Allow sign-in in all cases; do not require an active subscription for resident.
    }

    const sub = await prisma.subscription.findFirst({
      where: { memberId: member.id, plan: "subscribe", status: "active" },
      select: { id: true },
    });

    const effectivePlan = subscriptionPlan ?? (sub ? "subscribe" : null);

    try {
      // Only update lastLogin; never overwrite profile fields (firstName, lastName, bio, etc.)
      await prisma.member.update({
        where: { id: member.id },
        data: { lastLogin: new Date() },
      });
    } catch {
      // Ignore if last_login column missing or update fails; sign-in still proceeds
    }

    const token = await signMobileToken({
      id: member.id,
      email: member.email,
      name: `${member.firstName} ${member.lastName}`,
      isSubscriber: !!sub,
      subscriptionPlan: effectivePlan ?? undefined,
    });

    return NextResponse.json({
      token,
      subscriptionPlan: effectivePlan,
      member: {
        firstName: member.firstName,
        lastName: member.lastName,
        email: member.email,
        profilePhotoUrl: member.profilePhotoUrl,
        bio: member.bio,
        city: member.city,
      },
    });
  } catch (e) {
    const err = e as Error;
    console.error("[POST /api/auth/mobile-signin]", err);
    const message =
      process.env.NODE_ENV === "development"
        ? err.message || "Internal server error"
        : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
