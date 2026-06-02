import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { z } from "zod";
import { getSessionForApi } from "@/lib/mobile-auth";
import { memberHasStorefrontListingAccess } from "@/lib/storefront-seller-access";
import { getMemberConnectionContext } from "@/lib/channels/connection";
import { getAdapter } from "@/lib/channels/registry";
import { WixApiError } from "@/lib/channels/wix/client";

export const dynamic = "force-dynamic";

function channelErrorMessage(e: unknown, fallback: string): string {
  if (e instanceof WixApiError) return e.message;
  if (e instanceof Error && e.message) return e.message;
  return fallback;
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
function uniqueSlug(base: string): string {
  return `${base || "wix-item"}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

async function loadRemoteWithLinkState(userId: string) {
  const ctx = await getMemberConnectionContext(userId, "wix");
  if (!ctx) {
    return { ctx: null, listings: [] as Awaited<ReturnType<ReturnType<typeof getAdapter>["listRemoteListings"]>> };
  }
  const listings = await getAdapter("wix").listRemoteListings(ctx);
  const linked = await prisma.channelListingLink.findMany({
    where: { provider: "wix", connectionId: ctx.id },
    select: { externalListingId: true },
  });
  const linkedSet = new Set(linked.map((l) => l.externalListingId));
  return {
    ctx,
    listings: listings.map((l) => ({ ...l, alreadyLinked: linkedSet.has(l.externalListingId) })),
  };
}

/** GET: preview the seller's Wix products. */
export async function GET(req: NextRequest) {
  try {
    const session = await getSessionForApi(req);
    const userId = session?.user?.id;
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const ctx = await getMemberConnectionContext(userId, "wix");
    if (!ctx) {
      return NextResponse.json({ error: "Connect your Wix store first.", code: "NOT_CONNECTED" }, { status: 400 });
    }

    const { listings } = await loadRemoteWithLinkState(userId);
    return NextResponse.json({ listings });
  } catch (e) {
    console.error("[channels] wix import GET failed", e);
    const msg = channelErrorMessage(e, "Could not load Wix products.");
    return NextResponse.json(
      { error: msg, code: "WIX_LIST_FAILED", provider: "wix" },
      { status: 502 }
    );
  }
}

const bodySchema = z.object({
  listingIds: z.array(z.string()).min(1, "Select at least one product to import."),
});

/**
 * POST: import selected Wix products. Wix products are already inventory-managed, so there is no
 * migration step (unlike eBay). Each product becomes a StoreItem linked by its Wix product id for
 * ongoing two-way sync.
 */
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

  const ctx = await getMemberConnectionContext(userId, "wix");
  if (!ctx) {
    return NextResponse.json({ error: "Connect your Wix store first.", code: "NOT_CONNECTED" }, { status: 400 });
  }

  let remote;
  try {
    remote = (await getAdapter("wix").listRemoteListings(ctx)).filter((l) =>
      body.listingIds.includes(l.externalListingId)
    );
  } catch (e) {
    console.error("[channels] wix import POST load failed", e);
    const msg = channelErrorMessage(e, "Could not load Wix products.");
    return NextResponse.json({ error: msg, code: "WIX_LIST_FAILED" }, { status: 502 });
  }

  const imported: { externalListingId: string; storeItemId: string }[] = [];
  const skipped: { externalListingId: string; reason: string }[] = [];

  for (const listing of remote) {
    const productId = listing.externalListingId;

    const existing = await prisma.channelListingLink.findUnique({
      where: { provider_externalListingId: { provider: "wix", externalListingId: productId } },
    });
    if (existing) {
      skipped.push({ externalListingId: productId, reason: "already_linked" });
      continue;
    }
    if (listing.priceCents < 1) {
      skipped.push({ externalListingId: productId, reason: "invalid_price" });
      continue;
    }

    try {
      const created = await prisma.$transaction(async (tx) => {
        const storeItem = await tx.storeItem.create({
          data: {
            memberId: userId,
            title: listing.title.slice(0, 200),
            description: listing.description,
            photos: listing.photos,
            priceCents: listing.priceCents,
            quantity: Math.max(0, listing.quantity),
            status: listing.quantity > 0 ? "active" : "sold_out",
            condition: "used",
            listingType: "new",
            acceptOffers: false,
            slug: uniqueSlug(slugify(listing.title)),
          },
        });
        await tx.channelListingLink.create({
          data: {
            storeItemId: storeItem.id,
            connectionId: ctx.id,
            provider: "wix",
            externalListingId: productId,
            externalShopId: ctx.externalShopId,
            syncEnabled: true,
            syncStatus: "synced",
            lastPushedAt: new Date(),
            lastInboundAt: new Date(),
          },
        });
        return storeItem;
      });
      imported.push({ externalListingId: productId, storeItemId: created.id });
    } catch (e) {
      console.error("[channels] wix import failed", { externalListingId: productId, error: String(e) });
      skipped.push({ externalListingId: productId, reason: "create_failed" });
    }
  }

  return NextResponse.json({ ok: true, imported, skipped });
}
