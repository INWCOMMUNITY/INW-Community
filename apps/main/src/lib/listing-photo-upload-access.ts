import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { prismaWhereActivePaidNwcPlan } from "@/lib/nwc-paid-subscription";
import { hasBusinessHubAccess } from "@/lib/business-hub-access";

export async function requireListingPhotoUploadAccess(
  req: NextRequest
): Promise<{ ok: true; userId: string } | { ok: false; response: NextResponse }> {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const [sub, member, hubAccess] = await Promise.all([
    prisma.subscription.findFirst({
      where: prismaWhereActivePaidNwcPlan(session.user.id),
    }),
    prisma.member.findUnique({
      where: { id: session.user.id },
      select: { signupIntent: true },
    }),
    hasBusinessHubAccess(session.user.id),
  ]);
  const isSignupFlow =
    !sub && !!member?.signupIntent && ["business", "seller"].includes(member.signupIntent);
  if (!sub && !isSignupFlow && !hubAccess) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Business, Seller, or Subscribe plan required" },
        { status: 403 }
      ),
    };
  }

  return { ok: true, userId: session.user.id };
}
