import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionForApi } from "@/lib/mobile-auth";
import { applyEbayConditionFix } from "@/lib/channels/ebay/fix-condition";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  storeItemId: z.string().min(1),
  /** Inventory API ConditionEnum (e.g. NEW, USED_EXCELLENT). */
  ebayConditionEnum: z.string().min(1).max(80),
});

/** POST /api/channels/ebay/fix-condition — save condition from app and retry eBay sync. */
export async function POST(req: NextRequest) {
  const session = await getSessionForApi(req);
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const result = await applyEbayConditionFix({
    memberId: userId,
    storeItemId: body.storeItemId,
    ebayConditionEnum: body.ebayConditionEnum,
  });

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error, channelSync: result.channelSync },
      { status: 502 }
    );
  }

  return NextResponse.json({ ok: true, channelSync: result.channelSync });
}
