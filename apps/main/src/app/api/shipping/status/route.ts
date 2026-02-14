import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";

export const dynamic = "force-dynamic";

/**
 * GET: Returns whether the current seller has a connected EasyPost shipping account.
 * Used by ship pages to show connect CTA or the ship UI.
 */
export async function GET(req: NextRequest) {
  const session = await getSessionForApi(req);
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const member = await prisma.member.findUnique({
    where: { id: userId },
    select: {
      easypostReferralCustomerId: true,
      easypostApiKeyEncrypted: true,
    },
  });

  // Connected if we have a stored API key (paste-your-own-key or legacy Referral Customer)
  const connected = Boolean(member?.easypostApiKeyEncrypted);

  return NextResponse.json({
    connected,
    easypostReferralCustomerId: member?.easypostReferralCustomerId ?? null,
  });
}
