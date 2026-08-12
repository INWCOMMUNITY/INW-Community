import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { z } from "zod";
import { getSessionForApi } from "@/lib/mobile-auth";
import { memberHasStorefrontListingAccess } from "@/lib/storefront-seller-access";
import { getMemberConnectionContext } from "@/lib/channels/connection";
import { getAdapter } from "@/lib/channels/registry";
import { importRemoteListing } from "@/lib/channels/import-listing";
import { enrichEtsyListingSummaryWithInventory } from "@/lib/channels/etsy/variants";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function loadRemoteWithLinkState(userId: string) {
  const ctx = await getMemberConnectionContext(userId, "etsy");
  if (!ctx) {
    return {
      ctx: null,
      listings: [] as Awaited<ReturnType<ReturnType<typeof getAdapter>["listRemoteListings"]>>,
    };
  }
  const listings = await getAdapter("etsy").listRemoteListings(ctx);
  for (const l of listings) {
    await enrichEtsyListingSummaryWithInventory(ctx.accessToken, l);
  }
  const linked = await prisma.channelListingLink.findMany({
    where: { provider: "etsy", connectionId: ctx.id },
    select: { externalListingId: true, storeItemId: true },
  });
  const linkedByExternalId = new Map(linked.map((l) => [l.externalListingId, l.storeItemId]));
  return {
    ctx,
    listings: listings.map((l) => {
      const storeItemId = linkedByExternalId.get(l.externalListingId);
      return {
        ...l,
        alreadyLinked: storeItemId != null,
        storeItemId: storeItemId ?? undefined,
      };
    }),
  };
}

/** GET: preview the seller's Etsy listings, flagging ones already linked to INW. */
export async function GET(req: NextRequest) {
  const session = await getSessionForApi(req);
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const ctx = await getMemberConnectionContext(userId, "etsy");
  if (!ctx) {
    return NextResponse.json({ error: "Connect your Etsy shop first.", code: "NOT_CONNECTED" }, { status: 400 });
  }

  const searchParams = req.nextUrl.searchParams;
  const autoRefresh = searchParams.get("autoRefresh") === "1";

  try {
    let refreshResults: { updated: number; checked: number; pushed?: number } | undefined;
    if (autoRefresh) {
      const connection = await prisma.channelConnection.findFirst({
        where: { memberId: userId, provider: "etsy", status: "active" },
      });
      if (connection) {
        const { pullEtsyUpdatesForConnection, pushInwUpdatesToEtsyConnection } = await import(
          "@/lib/channels/etsy/pull-etsy-updates"
        );
        const pulled = await pullEtsyUpdatesForConnection(connection);
        const pushed = await pushInwUpdatesToEtsyConnection(connection);
        refreshResults = {
          updated: pulled.updated.length,
          checked: pulled.checked,
          pushed: pushed.pushed,
        };
        console.log("[etsy import] auto-refresh completed", refreshResults);
      }
    }

    const { listings } = await loadRemoteWithLinkState(userId);
    return NextResponse.json({
      listings,
      ...(refreshResults ? { refreshed: refreshResults } : {}),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Could not load Etsy listings.";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}

const bodySchema = z.object({
  listingIds: z.array(z.string()).min(1, "Select at least one listing to import."),
});

/** POST: import selected Etsy listings as StoreItems and link them for ongoing sync. */
export async function POST(req: NextRequest) {
  const session = await getSessionForApi(req);
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const canList = await memberHasStorefrontListingAccess(userId);
  if (!canList) {
    return NextResponse.json({ error: "Seller plan required to import listings." }, { status: 403 });
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch (e) {
    const msg = e instanceof z.ZodError ? e.errors[0]?.message : "Invalid input";
    return NextResponse.json({ error: String(msg) }, { status: 400 });
  }

  const ctx = await getMemberConnectionContext(userId, "etsy");
  if (!ctx) {
    return NextResponse.json({ error: "Connect your Etsy shop first.", code: "NOT_CONNECTED" }, { status: 400 });
  }

  let remote;
  try {
    remote = (await getAdapter("etsy").listRemoteListings(ctx)).filter((l) =>
      body.listingIds.includes(l.externalListingId)
    );
    for (const l of remote) {
      await enrichEtsyListingSummaryWithInventory(ctx.accessToken, l);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Could not load Etsy listings.";
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  const imported: { externalListingId: string; storeItemId: string }[] = [];
  const skipped: { externalListingId: string; reason: string }[] = [];
  let uncategorizedCount = 0;

  for (const listing of remote) {
    const result = await importRemoteListing({
      memberId: userId,
      connectionId: ctx.id,
      provider: "etsy",
      listing,
      externalShopId: ctx.externalShopId,
      postToFeed: true,
    });
    if (result.ok) {
      imported.push({ externalListingId: result.externalListingId, storeItemId: result.storeItemId });
      if (result.needsCategoryReview) {
        uncategorizedCount++;
      }
    } else {
      skipped.push({ externalListingId: result.externalListingId, reason: result.reason });
    }
  }

  return NextResponse.json({ ok: true, imported, skipped, uncategorizedCount });
}
