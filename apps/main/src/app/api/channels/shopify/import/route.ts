import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { z } from "zod";
import { getSessionForApi } from "@/lib/mobile-auth";
import { memberHasStorefrontListingAccess } from "@/lib/storefront-seller-access";
import { getMemberConnectionContext } from "@/lib/channels/connection";
import { getAdapter } from "@/lib/channels/registry";
import { importedChannelLinkWhere } from "@/lib/channels/unsync-listing";
import { importRemoteListing } from "@/lib/channels/import-listing";
import { withSkipMeta } from "@/lib/channels/import-skip";
import {
  importPostBodySchema,
  loadListingsForImport,
  notifyImportJobSkip,
  notifyImportJobStart,
  notifyImportJobSuccess,
} from "@/lib/channels/import-job-runtime";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function loadRemoteWithLinkState(userId: string) {
  const ctx = await getMemberConnectionContext(userId, "shopify");
  if (!ctx) {
    return { ctx: null, listings: [] as Awaited<ReturnType<ReturnType<typeof getAdapter>["listRemoteListings"]>> };
  }
  const listings = await getAdapter("shopify").listRemoteListings(ctx);
  const linked = await prisma.channelListingLink.findMany({
    where: importedChannelLinkWhere(ctx.id, "shopify"),
    select: { externalListingId: true },
  });
  const linkedSet = new Set(linked.map((l) => l.externalListingId));
  return {
    ctx,
    listings: listings.map((l) => ({ ...l, alreadyLinked: linkedSet.has(l.externalListingId) })),
  };
}

/** GET: preview the seller's Shopify products. */
export async function GET(req: NextRequest) {
  const session = await getSessionForApi(req);
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const ctx = await getMemberConnectionContext(userId, "shopify");
  if (!ctx) {
    return NextResponse.json(
      { error: "Connect your Shopify store first.", code: "NOT_CONNECTED" },
      { status: 400 }
    );
  }
  try {
    const { listings } = await loadRemoteWithLinkState(userId);
    return NextResponse.json({ listings });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Could not load Shopify products.";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}

const bodySchema = importPostBodySchema;

/** POST: import selected Shopify products as StoreItems linked by product id. */
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

  const ctx = await getMemberConnectionContext(userId, "shopify");
  if (!ctx) {
    return NextResponse.json(
      { error: "Connect your Shopify store first.", code: "NOT_CONNECTED" },
      { status: 400 }
    );
  }

  const loaded = await loadListingsForImport({
    jobId: body.jobId,
    memberId: userId,
    listingIds: body.listingIds,
    fetchAll: () => getAdapter("shopify").listRemoteListings(ctx),
  });

  if (body.jobId && !loaded.job) {
    return NextResponse.json({ error: loaded.loadError ?? "Import job not found." }, { status: 404 });
  }

  if (loaded.loadError && !loaded.job) {
    return NextResponse.json({ error: loaded.loadError }, { status: 502 });
  }

  const imported: { externalListingId: string; storeItemId: string; title?: string; photo?: string }[] = [];
  const skipped: ReturnType<typeof withSkipMeta>[] = [];
  let uncategorizedCount = 0;
  const jobId = loaded.job?.id;

  if (loaded.loadError && loaded.job) {
    for (const id of body.listingIds) {
      const row = withSkipMeta({
        externalListingId: id,
        step: "create",
        reason: loaded.loadError,
      });
      skipped.push(row);
      await notifyImportJobSkip(jobId, row);
    }
    return NextResponse.json({ ok: true, jobId, imported, skipped, uncategorizedCount });
  }

  for (const id of loaded.unmatchedIds) {
    const row = withSkipMeta({
      externalListingId: id,
      step: "create",
      reason: "Could not match this product. Refresh and try again.",
      retryable: true,
    });
    skipped.push(row);
    await notifyImportJobSkip(jobId, row);
  }

  for (const listing of loaded.listings) {
    await notifyImportJobStart(jobId, listing.title);
    const result = await importRemoteListing({
      memberId: userId,
      connectionId: ctx.id,
      provider: "shopify",
      listing,
      externalShopId: ctx.externalShopId,
      postToFeed: false,
    });
    if (result.ok) {
      const row = {
        externalListingId: result.externalListingId,
        storeItemId: result.storeItemId,
        title: listing.title,
        photo: listing.photos?.[0],
      };
      imported.push(row);
      await notifyImportJobSuccess(jobId, row);
      if (result.needsCategoryReview) {
        uncategorizedCount++;
      }
    } else {
      const row = withSkipMeta({
        externalListingId: result.externalListingId,
        title: listing.title,
        photo: listing.photos?.[0],
        step: "create",
        reason: result.reason,
      });
      skipped.push(row);
      await notifyImportJobSkip(jobId, row);
    }
  }

  return NextResponse.json({ ok: true, jobId, imported, skipped, uncategorizedCount });
}
