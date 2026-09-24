import { NextRequest, NextResponse } from "next/server";
import { disconnectShopifyConnection } from "database";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { toPublicShopifyConnection } from "@/lib/shopify/connect";
import { memberHasStorefrontListingAccess } from "@/lib/storefront-seller-access";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const session = await getSessionForApi(req);
  const memberId = session?.user?.id;
  if (!memberId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await memberHasStorefrontListingAccess(memberId))) {
    return NextResponse.json({ error: "Seller access required" }, { status: 403 });
  }
  let connectionId = "";
  try {
    const body = (await req.json()) as { connectionId?: unknown };
    connectionId = typeof body.connectionId === "string" ? body.connectionId : "";
  } catch {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  const updated = await disconnectShopifyConnection(prisma, { memberId, connectionId });
  if (!updated) return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  return NextResponse.json({ connection: toPublicShopifyConnection(updated) });
}
