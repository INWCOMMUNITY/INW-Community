import { NextRequest, NextResponse } from "next/server";
import { prisma, Prisma } from "database";
import { z } from "zod";
import { getSessionForApi } from "@/lib/mobile-auth";
import { logSellerActivity } from "@/lib/seller-activity-log";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  storeItemIds: z.array(z.string()).min(1, "Select at least one item to relist."),
  quantity: z.number().int().positive().optional(),
  republishChannels: z.boolean().optional().default(false),
});

/**
 * POST /api/store-items/bulk-relist
 *
 * Relist sold-out or ended items (set status back to "active").
 * Optionally set a new quantity and republish to connected channels.
 */
export async function POST(req: NextRequest) {
  const session = await getSessionForApi(req);
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch (e) {
    const msg = e instanceof z.ZodError ? e.errors[0]?.message : "Invalid input";
    return NextResponse.json({ error: String(msg) }, { status: 400 });
  }

  const { storeItemIds, quantity, republishChannels } = body;

  // Get items owned by this user that are in a relistable state
  const items = await prisma.storeItem.findMany({
    where: {
      id: { in: storeItemIds },
      memberId: userId,
      status: { in: ["sold_out", "inactive", "ended", "draft"] },
    },
    select: {
      id: true,
      title: true,
      status: true,
      quantity: true,
    },
  });

  if (items.length === 0) {
    return NextResponse.json({
      error: "No eligible items found. Items must be sold out, ended (inactive), or draft.",
    }, { status: 400 });
  }

  const itemIds = items.map((i) => i.id);
  const newQuantity = quantity ?? 1;

  // Create snapshot for undo
  const changes: Record<string, { before: object; after: object }> = {};
  for (const item of items) {
    changes[item.id] = {
      before: { status: item.status, quantity: item.quantity },
      after: { status: "active", quantity: newQuantity },
    };
  }

  const snapshot = await prisma.bulkEditSnapshot.create({
    data: {
      memberId: userId,
      operation: "bulk_relist",
      itemCount: items.length,
      changes: changes as Prisma.InputJsonValue,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  });

  // Update all items to active with new quantity
  await prisma.storeItem.updateMany({
    where: { id: { in: itemIds } },
    data: {
      status: "active",
      quantity: newQuantity,
    },
  });

  // Republish to channels if requested
  const channelResults: { itemId: string; provider: string; ok: boolean; error?: string }[] = [];
  if (republishChannels) {
    const { publishStoreItemToChannels } = await import("@/lib/channels/outbound");

    const links = await prisma.channelListingLink.findMany({
      where: {
        storeItemId: { in: itemIds },
        syncEnabled: true,
      },
      select: {
        storeItemId: true,
        provider: true,
      },
    });

    const providersByItem = new Map<string, ("ebay" | "etsy" | "shopify" | "wix")[]>();
    for (const link of links) {
      const list = providersByItem.get(link.storeItemId) ?? [];
      list.push(link.provider as "ebay" | "etsy" | "shopify" | "wix");
      providersByItem.set(link.storeItemId, list);
    }

    for (const [itemId, itemProviders] of providersByItem) {
      try {
        const syncResults = await publishStoreItemToChannels(itemId, userId, {
          providers: itemProviders,
        });
        for (const sr of syncResults) {
          channelResults.push({
            itemId,
            provider: sr.provider,
            ok: sr.ok,
            error: sr.error,
          });
        }
      } catch (e) {
        for (const provider of itemProviders) {
          channelResults.push({
            itemId,
            provider,
            ok: false,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
    }
  }

  // Log activity
  await logSellerActivity(userId, "bulk_relist", "store_item", null, {
    itemIds,
    itemCount: items.length,
    newQuantity,
    republishChannels,
  });

  return NextResponse.json({
    ok: true,
    relisted: items.length,
    notEligible: storeItemIds.length - items.length,
    snapshotId: snapshot.id,
    channelSync: channelResults.length > 0 ? channelResults : undefined,
  });
}
