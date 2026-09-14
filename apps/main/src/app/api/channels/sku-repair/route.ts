import { NextRequest, NextResponse } from "next/server";
import { getSessionForApi } from "@/lib/mobile-auth";
import { applySkuRepair, parseSkuRepairRequest } from "@/lib/channels/sku-repair";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/channels/sku-repair
 *
 * Method-2 SKU copy: adopt a live eBay pin, PATCH Wix/Etsy SKU fields,
 * clear leftover parent codes, or assign a seller SKU. Never unsync/delete.
 */
export async function POST(req: NextRequest) {
  const session = await getSessionForApi(req);
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const parsed = parseSkuRepairRequest(raw);
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const result = await applySkuRepair(userId, parsed);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true, message: result.message });
}
