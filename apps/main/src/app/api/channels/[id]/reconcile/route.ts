import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { reconcileMemberProvider } from "@/lib/channels/reconcile";
import type { ChannelProvider } from "@/lib/channels/types";

export const dynamic = "force-dynamic";

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

  const conn = await prisma.channelConnection.findUnique({ where: { id } });
  if (!conn || conn.memberId !== userId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (conn.status === "disconnected") {
    return NextResponse.json({ error: "Channel is disconnected" }, { status: 400 });
  }

  try {
    const result = await reconcileMemberProvider(userId, conn.provider as ChannelProvider);
    return NextResponse.json({
      ok: true,
      provider: conn.provider,
      applied: result.applied,
    });
  } catch (e) {
    console.error("[channels] manual reconcile failed", { id, error: String(e) });
    return NextResponse.json(
      { error: "Reconcile failed", details: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
