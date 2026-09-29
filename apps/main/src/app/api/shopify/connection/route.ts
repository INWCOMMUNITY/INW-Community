import { NextRequest, NextResponse } from "next/server";
import { listShopifyConnectionsForMember, shopifyRemountListingsDedupeKey } from "database";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { toPublicShopifyConnection } from "@/lib/shopify/connect";
import { memberHasStorefrontListingAccess } from "@/lib/storefront-seller-access";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await getSessionForApi(req);
  const memberId = session?.user?.id;
  if (!memberId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await memberHasStorefrontListingAccess(memberId))) {
    return NextResponse.json({ error: "Seller access required" }, { status: 403 });
  }
  const rows = await listShopifyConnectionsForMember(prisma, memberId);
  const active = rows.find((row) => row.status === "ACTIVE") ?? null;
  let remount: {
    state: string;
    message: string | null;
    errorCode: string | null;
  } | null = null;
  if (active) {
    const remountJob = await prisma.shopifySyncJob.findUnique({
      where: { dedupeKey: shopifyRemountListingsDedupeKey(active.id) },
      select: {
        state: true,
        lastErrorMessage: true,
        lastErrorCode: true,
      },
    });
    if (remountJob) {
      remount = {
        state: remountJob.state,
        message: remountJob.lastErrorMessage,
        errorCode: remountJob.lastErrorCode,
      };
    }
  }
  return NextResponse.json({
    connections: rows.map(toPublicShopifyConnection),
    remount,
  });
}
