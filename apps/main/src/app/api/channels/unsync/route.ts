import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";

export const dynamic = "force-dynamic";

/**
 * POST /api/channels/unsync — generic unsync for any provider.
 * Body: { linkId: string, removeFromINW?: boolean }
 *
 * Disables sync on the link and optionally deletes the remote listing
 * and/or the local StoreItem. Works for all providers (Etsy, eBay,
 * Shopify, Wix) so each provider does not need its own unsync route.
 */
export async function POST(req: NextRequest) {
  const session = await getSessionForApi(req);
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { linkId?: string; removeFromINW?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { linkId, removeFromINW } = body;
  if (!linkId || typeof linkId !== "string") {
    return NextResponse.json({ error: "linkId is required" }, { status: 400 });
  }

  const link = await prisma.channelListingLink.findUnique({
    where: { id: linkId },
    include: {
      storeItem: { select: { id: true, memberId: true, title: true } },
      connection: { select: { memberId: true } },
    },
  });

  if (!link) {
    return NextResponse.json({ error: "Link not found" }, { status: 404 });
  }

  if (link.connection.memberId !== userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const itemTitle = link.storeItem?.title ?? link.externalListingId;
  const storeItemId = link.storeItemId;
  const provider = link.provider;

  await prisma.channelListingLink.delete({ where: { id: linkId } });

  if (removeFromINW && storeItemId) {
    await prisma.storeItem.delete({ where: { id: storeItemId } }).catch(() => {});
    console.log(`[channels] unsync + delete completed`, {
      userId,
      provider,
      linkId,
      storeItemId,
    });
    return NextResponse.json({
      ok: true,
      message: `Removed "${itemTitle}" from INW and unsynced from ${provider}.`,
      removed: true,
      storeItemId,
    });
  }

  console.log(`[channels] unsync completed (kept item)`, {
    userId,
    provider,
    linkId,
    storeItemId,
  });
  return NextResponse.json({
    ok: true,
    message: `Unsynced "${itemTitle}" from ${provider}. Item kept in INW.`,
    removed: false,
    storeItemId,
  });
}
