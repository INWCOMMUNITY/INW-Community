import { NextRequest, NextResponse } from "next/server";
import { listEtsyConnectionsForMember, prisma } from "database";
import { toPublicEtsyConnection } from "@/lib/etsy/connect";
import { getSessionForApi } from "@/lib/mobile-auth";
import { memberHasStorefrontListingAccess } from "@/lib/storefront-seller-access";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await getSessionForApi(req);
  const memberId = session?.user?.id;
  if (!memberId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await memberHasStorefrontListingAccess(memberId))) {
    return NextResponse.json({ error: "Seller access required" }, { status: 403 });
  }
  const rows = await listEtsyConnectionsForMember(prisma, memberId);
  return NextResponse.json({
    connections: rows.map(toPublicEtsyConnection),
  });
}
