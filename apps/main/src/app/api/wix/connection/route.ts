import { NextRequest, NextResponse } from "next/server";
import { getActiveWixConnectionForMember, prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { toPublicWixConnection } from "@/lib/wix/connect";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await getSessionForApi(req);
  const memberId = session?.user?.id;
  if (!memberId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const connection = await getActiveWixConnectionForMember(prisma, memberId);
  
  if (!connection) {
    return NextResponse.json({ connection: null });
  }

  return NextResponse.json({
    connection: toPublicWixConnection(connection),
  });
}
