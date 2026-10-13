import { NextRequest, NextResponse } from "next/server";
import { getSessionForApi } from "@/lib/mobile-auth";
import { memberHasStorefrontListingAccess } from "@/lib/storefront-seller-access";
import { cancelEtsyImportBatch } from "@/lib/etsy/import-batch";
import { runNextEtsySyncJob } from "@/lib/etsy/worker";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const session = await getSessionForApi(req);
  const memberId = session?.user?.id;
  if (!memberId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await memberHasStorefrontListingAccess(memberId))) {
    return NextResponse.json({ error: "Seller access required" }, { status: 403 });
  }

  const result = await cancelEtsyImportBatch({ memberId });
  if (result.status === "ERROR") {
    return NextResponse.json(
      { error: result.message, code: result.code },
      { status: result.httpStatus }
    );
  }

  void runNextEtsySyncJob({
    workerId: "etsy-import-cancel-inline",
    kind: "IMPORT_BATCH",
  }).catch(() => undefined);

  return NextResponse.json({ ok: true, batch: result.batch });
}
