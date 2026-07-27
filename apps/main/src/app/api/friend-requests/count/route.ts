import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";

/**
 * GET /api/friend-requests/count
 * Returns the count of pending incoming friend requests for the current user.
 * Used for badge count display.
 */
export async function GET(req: NextRequest) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const count = await prisma.friendRequest.count({
    where: {
      addresseeId: session.user.id,
      status: "pending",
    },
  });

  return NextResponse.json({ count });
}
