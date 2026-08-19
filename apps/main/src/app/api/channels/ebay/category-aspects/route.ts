import { NextRequest, NextResponse } from "next/server";
import { getSessionForApi } from "@/lib/mobile-auth";
import { getItemAspectsForCategory, requireEbayTaxonomyConfig } from "@/lib/channels/ebay/aspects";
import { filterSellerVisibleCategoryAspects } from "@/lib/channels/ebay/aspect-prep";
import { describeEbayThrownError, EbayApiError } from "@/lib/channels/ebay/errors";
import { prisma } from "database";
import { isImportedEbayLink } from "@/lib/channels/ebay/listing-origin";

export const dynamic = "force-dynamic";

/**
 * GET /api/channels/ebay/category-aspects?categoryId=
 *
 * Required/recommended item specifics for an eBay leaf category.
 * Uses eBay application credentials (Taxonomy API).
 */
export async function GET(req: NextRequest) {
  const session = await getSessionForApi(req);
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const categoryId = req.nextUrl.searchParams.get("categoryId")?.trim() ?? "";
  if (!categoryId) {
    return NextResponse.json({ error: "categoryId is required" }, { status: 400 });
  }

  const readOnlyParam = req.nextUrl.searchParams.get("readOnly") === "1";
  const storeItemId = req.nextUrl.searchParams.get("storeItemId")?.trim() ?? "";

  let readOnly = readOnlyParam;
  if (!readOnly && storeItemId) {
    const ebayLink = await prisma.channelListingLink.findFirst({
      where: { storeItemId, provider: "ebay" },
      select: { externalListingId: true, linkOrigin: true },
    });
    if (
      ebayLink &&
      isImportedEbayLink({
        provider: "ebay",
        externalListingId: ebayLink.externalListingId,
        storeItemId,
        linkOrigin: ebayLink.linkOrigin,
      })
    ) {
      readOnly = true;
    }
  }

  try {
    requireEbayTaxonomyConfig();
  } catch (e) {
    return NextResponse.json({ error: describeEbayThrownError(e) }, { status: 503 });
  }

  try {
    let aspects = filterSellerVisibleCategoryAspects(await getItemAspectsForCategory(categoryId));
    if (readOnly) {
      aspects = aspects.map((a) => ({ ...a, required: false }));
    }
    return NextResponse.json({ aspects, readOnly });
  } catch (e) {
    const authRejected =
      (e instanceof EbayApiError && e.status === 401) ||
      /invalid access token|unauthorized|#1001/i.test(describeEbayThrownError(e));
    const error = authRejected
      ? "eBay category lookup failed — application credentials were rejected. Check EBAY_CLIENT_ID and EBAY_CLIENT_SECRET (Production keyset)."
      : describeEbayThrownError(e);
    return NextResponse.json({ error }, { status: 502 });
  }
}
