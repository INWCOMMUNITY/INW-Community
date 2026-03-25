import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import bcrypt from "bcryptjs";
import { signMobileToken } from "@/lib/mobile-auth";
import { prismaWhereMemberSubscribeTierPerksAccess } from "@/lib/subscribe-plan-access";
import { resolveEffectiveNwcPlan } from "@/lib/resolve-effective-nwc-plan";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { email, password } = body;

    if (!email || !password || typeof email !== "string" || typeof password !== "string") {
      return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
    }

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

    const sub = await prisma.subscription.findFirst({
      where: prismaWhereMemberSubscribeTierPerksAccess(member.id),
      select: { id: true },
    });

    const effectivePlan = await resolveEffectiveNwcPlan(member.id);

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
