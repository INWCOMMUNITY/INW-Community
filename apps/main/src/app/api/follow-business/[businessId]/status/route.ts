import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { requireVerifiedActiveMember } from "@/lib/require-verified-member";

/**
 * GET /api/follow-business/[businessId]/status - Check if current user follows this business
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ businessId: string }> }
) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ followed: false });
  }
  const verified = await requireVerifiedActiveMember(session.user.id);
  if (!verified.ok) return verified.response;

  const { businessId } = await params;
  const follow = await prisma.followBusiness.findUnique({
    where: {
      memberId_businessId: { memberId: session.user.id, businessId },
    },
  });
  return NextResponse.json({ followed: !!follow });
}
