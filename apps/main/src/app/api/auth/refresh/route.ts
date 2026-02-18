import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { jwtVerify } from "jose";
import { signMobileToken, getBearerToken, type SubscriptionPlan } from "@/lib/mobile-auth";

const JWT_ISSUER = "nwc-mobile";
const GRACE_DAYS = 30; // Accept expired tokens up to 30 days for refresh
const INACTIVITY_DAYS = 30; // Reject if lastLogin older than 30 days

function getSecret() {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("NEXTAUTH_SECRET is required for mobile auth");
  return new TextEncoder().encode(secret);
}

export async function POST(req: NextRequest) {
  const bearer = getBearerToken(req);
  if (!bearer) {
    return NextResponse.json({ error: "Token required" }, { status: 401 });
  }

  try {
    const { payload } = await jwtVerify(bearer, getSecret(), {
      issuer: JWT_ISSUER,
      clockTolerance: GRACE_DAYS * 24 * 60 * 60,
    });
    const id = payload.id as string;
    const email = payload.email as string;
    const name = payload.name as string;
    const isSubscriber = Boolean(payload.isSubscriber);
    const subscriptionPlan = payload.subscriptionPlan as SubscriptionPlan | undefined;
    if (!id || !email) {
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    }

    const member = await prisma.member.findUnique({
      where: { id },
      select: { id: true, status: true, lastLogin: true },
    });

    if (!member || member.status === "suspended") {
      return NextResponse.json({ error: "Account not found or suspended" }, { status: 401 });
    }

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - INACTIVITY_DAYS);
    const lastLogin = member.lastLogin ?? new Date(0);
    if (lastLogin < cutoff) {
      return NextResponse.json(
        { error: "Session expired. Please sign in again." },
        { status: 401 }
      );
    }

    await prisma.member.update({
      where: { id },
      data: { lastLogin: new Date() },
    });

    const token = await signMobileToken({
      id: member.id,
      email,
      name,
      isSubscriber,
      subscriptionPlan,
    });

    return NextResponse.json({ token });
  } catch {
    return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
  }
}
