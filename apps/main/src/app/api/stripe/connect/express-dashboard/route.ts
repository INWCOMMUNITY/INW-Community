import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? "", {
  apiVersion: "2024-11-20.acacia" as "2023-10-16",
});

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await getSessionForApi(req);
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sub = await prisma.subscription.findFirst({
    where: { memberId: userId, plan: { in: ["seller", "subscribe"] }, status: "active" },
  });
  if (!sub) {
    return NextResponse.json({ error: "Seller or Subscribe plan required" }, { status: 403 });
  }

  const member = await prisma.member.findUnique({
    where: { id: userId },
    select: { stripeConnectAccountId: true },
  });
  if (!member?.stripeConnectAccountId?.trim()) {
    return NextResponse.json(
      { error: "Complete Stripe Connect setup first" },
      { status: 400 }
    );
  }

  try {
    const loginLink = await stripe.accounts.createLoginLink(member.stripeConnectAccountId);
    return NextResponse.json({ url: loginLink.url });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to create dashboard link";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
