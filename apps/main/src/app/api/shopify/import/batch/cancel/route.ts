import { NextRequest, NextResponse } from "next/server";
import { getSessionForApi } from "@/lib/mobile-auth";
import { memberHasStorefrontListingAccess } from "@/lib/storefront-seller-access";
import { cancelShopifyImportBatch } from "@/lib/shopify/import-batch";
import { runNextShopifySyncJob } from "@/lib/shopify/admin-graphql";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const session = await getSessionForApi(req);
  const memberId = session?.user?.id;
  if (!memberId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await memberHasStorefrontListingAccess(memberId))) {
    return NextResponse.json({ error: "Seller access required" }, { status: 403 });
  }

  const result = await cancelShopifyImportBatch({ memberId });
  if (result.status === "ERROR") {
    return NextResponse.json(
      { error: result.message, code: result.code },
      { status: result.httpStatus }
    );
  }

  void runNextShopifySyncJob({
    workerId: "shopify-import-cancel-inline",
    kind: "IMPORT_BATCH",
  }).catch(() => undefined);

  return NextResponse.json({ ok: true, batch: result.batch });
}
