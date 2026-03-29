import { NextRequest, NextResponse } from "next/server";
import { getSessionForApi } from "@/lib/mobile-auth";
import { getBusinessRewardRedemptionsForOwner } from "@/lib/business-reward-redemptions-list";

export const dynamic = "force-dynamic";

/**
 * Merchant view: redemptions for one business (alias for …/reward-redemptions).
 * Shorter path; use if proxies or older deployments differ.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id: businessId } = await params;
  const result = await getBusinessRewardRedemptionsForOwner(businessId, session.user.id);
  if (!result.ok) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(result.data);
}
