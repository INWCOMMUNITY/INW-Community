import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionForApi } from "@/lib/mobile-auth";
import { repairMemberImportedCategories } from "@/lib/channels/repair-categories";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const bodySchema = z
  .object({
    storeItemIds: z.array(z.string()).optional(),
  })
  .optional();

/**
 * POST /api/channels/repair-categories
 * One-time repair for imported items with null/invalid subcategories (and optional qty recovery).
 */
export async function POST(req: NextRequest) {
  const session = await getSessionForApi(req);
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: z.infer<typeof bodySchema> = undefined;
  try {
    const raw = await req.json().catch(() => undefined);
    if (raw !== undefined) {
      body = bodySchema.parse(raw);
    }
  } catch (e) {
    const msg = e instanceof z.ZodError ? e.errors[0]?.message : "Invalid input";
    return NextResponse.json({ error: String(msg) }, { status: 400 });
  }

  try {
    const result = await repairMemberImportedCategories(userId, {
      storeItemIds: body?.storeItemIds,
    });
    return NextResponse.json({
      ok: true,
      ...result,
      summary:
        result.repaired.length > 0
          ? `Repaired ${result.repaired.length} listing${result.repaired.length === 1 ? "" : "s"}.`
          : "No listings needed category repair.",
    });
  } catch (e) {
    console.error("[repair-categories] failed", e);
    return NextResponse.json({ error: "Category repair failed." }, { status: 500 });
  }
}
