import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getSessionForApi } from "@/lib/mobile-auth";
import { closeOrDeleteMemberAccountWithBilling } from "@/lib/close-or-delete-member-with-billing";
import { jsonIfCutoverBlocked } from "@/lib/commerce-foundation-cutover-http";

export async function POST(req: NextRequest) {
  const session = (await getSessionForApi(req)) ?? (await getServerSession(authOptions));
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await closeOrDeleteMemberAccountWithBilling(session.user.id);
    if (!result.ok) {
      return NextResponse.json({ error: "Account not found." }, { status: 404 });
    }
    return NextResponse.json({
      ok: true,
      outcome: result.outcome,
      billingCleanupPending: result.billingCleanupPending,
    });
  } catch (e) {
    const cutover = jsonIfCutoverBlocked(e);
    if (cutover) return cutover;
    console.error("[me/delete]", e);
    return NextResponse.json({ error: "Could not close account." }, { status: 500 });
  }
}
