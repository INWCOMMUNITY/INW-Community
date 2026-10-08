import { NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { createWixListing, loadMappedWixListing } from "@/lib/wix/listing-actions";
import { runNextWixSyncJob } from "@/lib/wix/worker";
import { getActiveWixConnectionForMember, prisma } from "database";

export const dynamic = "force-dynamic";

/**
 * GET /api/wix/listing?storeItemId=xxx
 * Get the Wix listing status for a store item.
 */
export async function GET(request: Request): Promise<Response> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const storeItemId = url.searchParams.get("storeItemId");

  if (!storeItemId) {
    return NextResponse.json({ error: "storeItemId required" }, { status: 400 });
  }

  // Verify ownership
  const storeItem = await prisma.storeItem.findUnique({
    where: { id: storeItemId },
    select: { memberId: true },
  });

  if (!storeItem || storeItem.memberId !== session.user.id) {
    return NextResponse.json({ error: "Store item not found" }, { status: 404 });
  }

  const result = await loadMappedWixListing({ storeItemId, memberId: session.user.id });

  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json(result);
}

/**
 * POST /api/wix/listing
 * Create a new Wix listing for a store item.
 * Body: { storeItemId: string }
 */
export async function POST(request: Request): Promise<Response> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { storeItemId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { storeItemId } = body;
  if (!storeItemId) {
    return NextResponse.json({ error: "storeItemId required" }, { status: 400 });
  }

  // Verify ownership
  const storeItem = await prisma.storeItem.findUnique({
    where: { id: storeItemId },
    select: { memberId: true },
  });

  if (!storeItem || storeItem.memberId !== session.user.id) {
    return NextResponse.json({ error: "Store item not found" }, { status: 404 });
  }

  // Get active Wix connection
  const connection = await getActiveWixConnectionForMember(prisma, session.user.id);
  if (!connection) {
    return NextResponse.json({ error: "No active Wix connection" }, { status: 400 });
  }

  const result = await createWixListing({
    storeItemId,
    memberId: session.user.id,
    connection,
  });

  if (result.success) {
    if (result.enqueued) {
      waitUntil(
        (async () => {
          for (let i = 0; i < 16; i += 1) {
            const ran = await runNextWixSyncJob({ workerId: `wix-list-inline-${i}` });
            if (!ran.claimed) break;
          }
        })()
      );
    }
    return NextResponse.json(
      { listingLinkId: result.listingLinkId ?? null, enqueued: result.enqueued ?? false },
      { status: result.enqueued ? 202 : 200 }
    );
  }

  return NextResponse.json(
    { error: result.error },
    { status: result.status ?? 500 }
  );
}
