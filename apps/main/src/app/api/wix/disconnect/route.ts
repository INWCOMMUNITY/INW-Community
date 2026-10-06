import { NextRequest, NextResponse } from "next/server";
import {
  disconnectWixConnection,
  getActiveWixConnectionForMember,
  prisma,
} from "database";
import { getSessionForApi } from "@/lib/mobile-auth";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const session = await getSessionForApi(req);
  const memberId = session?.user?.id;
  if (!memberId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const connection = await getActiveWixConnectionForMember(prisma, memberId);
  if (!connection) {
    return NextResponse.json({ error: "No active Wix connection" }, { status: 404 });
  }

  const result = await disconnectWixConnection(prisma, {
    connectionId: connection.id,
    memberId,
  });

  if (!result.disconnected) {
    return NextResponse.json({ error: "Could not disconnect" }, { status: 500 });
  }

  console.info("WIX_CONNECTION_DISCONNECTED", {
    connectionId: connection.id,
    siteId: connection.siteId,
    memberId,
  });

  return NextResponse.json({ disconnected: true });
}
