import { NextRequest, NextResponse } from "next/server";
import { getSessionForApi } from "@/lib/mobile-auth";
import { memberHasStorefrontListingAccess } from "@/lib/storefront-seller-access";
import { discoverEtsyImportCandidates } from "@/lib/etsy/import-discovery";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await getSessionForApi(req);
  const memberId = session?.user?.id;
  if (!memberId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await memberHasStorefrontListingAccess(memberId))) {
    return NextResponse.json({ error: "Seller access required" }, { status: 403 });
  }

  const offsetRaw = req.nextUrl.searchParams.get("offset");
  const offset = offsetRaw ? Number(offsetRaw) : 0;
  const result = await discoverEtsyImportCandidates({
    memberId,
    offset: Number.isFinite(offset) ? offset : 0,
  });

  if (result.status !== "OK") {
    return NextResponse.json(
      { error: result.message, code: result.code },
      { status: result.code === "CONNECTION_REQUIRED" ? 400 : 502 }
    );
  }

  return NextResponse.json({
    connectionId: result.connectionId,
    shopId: result.shopId,
    shopName: result.shopName,
    candidates: result.candidates,
    pageInfo: result.pageInfo,
  });
}
