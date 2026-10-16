import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { createBusinessDraftInDb } from "@/lib/create-business-draft";
import { prismaWhereMemberSellerPlanAccess } from "@/lib/nwc-paid-subscription";

export const dynamic = "force-dynamic";

/**
 * Temporary localhost skip for seller subscription checkout.
 * Beans: remove this route, the localhost Continue buttons on shipping and payouts,
 * and the nwc_local_onboarding_skip cookie. The form then requires checkout, Shippo, and Stripe.
 */
function localDev(req: NextRequest): boolean {
  if (process.env.NODE_ENV !== "development") return false;
  const host = (req.headers.get("host") ?? "").split(":")[0];
  return host === "localhost" || host === "127.0.0.1";
}

export async function POST(req: NextRequest) {
  if (!localDev(req)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const session = await getSessionForApi(req);
  const memberId = session?.user?.id;
  if (!memberId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let businessData: Record<string, unknown> = {};
  try {
    const body = (await req.json()) as { businessData?: unknown };
    if (body.businessData && typeof body.businessData === "object") {
      businessData = body.businessData as Record<string, unknown>;
    }
  } catch {
    businessData = {};
  }

  const draft = await createBusinessDraftInDb(memberId, businessData, "seller");
  if (!draft) {
    return NextResponse.json(
      { error: "Business details are missing. Go back and save the business step first." },
      { status: 400 }
    );
  }

  const existing = await prisma.subscription.findFirst({
    where: prismaWhereMemberSellerPlanAccess(memberId),
    select: { id: true },
  });
  if (!existing) {
    await prisma.subscription.create({
      data: {
        memberId,
        plan: "seller",
        status: "active",
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });
  }

  return NextResponse.json({ ok: true, step: "shipping" });
}
