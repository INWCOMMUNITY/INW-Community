import { NextRequest, NextResponse } from "next/server";
import { getSessionForApi } from "@/lib/mobile-auth";
import { memberHasStorefrontListingAccess } from "@/lib/storefront-seller-access";
import { importEtsyListing } from "@/lib/etsy/import-listing";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const session = await getSessionForApi(req);
  const memberId = session?.user?.id;
  if (!memberId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await memberHasStorefrontListingAccess(memberId))) {
    return NextResponse.json({ error: "Seller access required" }, { status: 403 });
  }

  let etsyListingId = "";
  let stockMode: "PHYSICAL" | "MADE_TO_ORDER" | "" = "";
  let shippingCostCents: number | null = null;
  try {
    const body = (await req.json()) as {
      etsyListingId?: unknown;
      stockMode?: unknown;
      shippingCostCents?: unknown;
    };
    etsyListingId = typeof body.etsyListingId === "string" ? body.etsyListingId : "";
    stockMode =
      body.stockMode === "PHYSICAL" || body.stockMode === "MADE_TO_ORDER" ? body.stockMode : "";
    shippingCostCents =
      typeof body.shippingCostCents === "number" && Number.isFinite(body.shippingCostCents)
        ? Math.round(body.shippingCostCents)
        : null;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (!etsyListingId || !stockMode) {
    return NextResponse.json(
      { error: "etsyListingId and stockMode are required", code: "INVALID_REQUEST" },
      { status: 400 }
    );
  }
  if (shippingCostCents == null || shippingCostCents < 0 || shippingCostCents > 10_000_000) {
    return NextResponse.json(
      { error: "Enter a shipping price, or ship for free.", code: "INVALID_REQUEST" },
      { status: 400 }
    );
  }

  const result = await importEtsyListing({ memberId, etsyListingId, stockMode, shippingCostCents });
  if (result.status === "ERROR") {
    return NextResponse.json(
      { error: result.message, code: result.code },
      { status: 400 }
    );
  }

  return NextResponse.json({
    status: result.status,
    storeItemId: result.storeItemId,
    listingLinkId: result.listingLinkId,
    etsyListingId: result.etsyListingId,
    personalizationWarning: result.personalizationWarning,
  });
}
