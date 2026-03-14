import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";

export const dynamic = "force-dynamic";

/**
 * GET: Returns whether the current seller has a connected Shippo shipping account.
 * Used by ship pages to show connect CTA or the ship UI.
 * From-address comes from Shippo Address Book (no return-address stored in app).
 */
export async function GET(req: NextRequest) {
  const session = await getSessionForApi(req);
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const member = await prisma.member.findUnique({
    where: { id: userId },
    select: { shippoApiKeyEncrypted: true, shippoOAuthTokenEncrypted: true },
  });

  const connected = Boolean(member?.shippoApiKeyEncrypted ?? member?.shippoOAuthTokenEncrypted);

  return NextResponse.json({
    connected,
  });
}
