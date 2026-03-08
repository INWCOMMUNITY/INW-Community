import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

/**
 * POST: Disconnect Stripe Connect for the current user (development only).
 * Sets stripeConnectAccountId to null so you can re-test Stripe Connect onboarding.
 * Only available when NODE_ENV === "development".
 */
export async function POST(req: NextRequest) {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json(
      { error: "This action is only available in development." },
      { status: 403 }
    );
  }
  const session = (await getSessionForApi(req)) ?? (await getServerSession(authOptions));
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await prisma.member.update({
    where: { id: session.user.id },
    data: { stripeConnectAccountId: null },
  });
  return NextResponse.json({ ok: true });
}
