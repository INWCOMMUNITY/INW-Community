import { NextRequest, NextResponse } from "next/server";
import { getSessionForApi } from "@/lib/mobile-auth";
import { resolveRemoteDeletedAttention } from "@/lib/channels/remote-deleted-attention";

export const dynamic = "force-dynamic";

/**
 * POST /api/store-items/:id/remote-delete-decision
 * Body: { action: "keep" | "delete_everywhere" }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionForApi(req);
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { action?: string };
  const action = body.action === "delete_everywhere" ? "delete_everywhere" : body.action === "keep" ? "keep" : null;
  if (!action) {
    return NextResponse.json({ error: "Choose keep or delete_everywhere." }, { status: 400 });
  }
  const result = await resolveRemoteDeletedAttention({
    memberId: userId,
    storeItemId: id,
    action,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 409 });
  }
  return NextResponse.json(result);
}
