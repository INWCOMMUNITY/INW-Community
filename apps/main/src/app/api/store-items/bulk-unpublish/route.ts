import { NextRequest, NextResponse } from "next/server";
import { prisma, Prisma } from "database";
import { z } from "zod";
import { getSessionForApi } from "@/lib/mobile-auth";
import { unpublishStoreItemFromChannels } from "@/lib/channels/outbound";
import { isChannelProvider, type ChannelProvider } from "@/lib/channels/types";

export const dynamic = "force-dynamic";

const bulkUnpublishSchema = z.object({
  storeItemIds: z.array(z.string()).min(1).max(50),
  providers: z.array(z.string()).optional(),
  deleteFromChannel: z.boolean().optional().default(false),
});

type UnpublishResult = {
  unpublished: number;
  failed: number;
  skipped: number;
  results: {
    itemId: string;
    status: "unpublished" | "failed" | "skipped";
    providers?: Record<string, { ok: boolean; error?: string }>;
    reason?: string;
  }[];
};

/**
 * POST /api/store-items/bulk-unpublish
 *
 * Unpublish (unlink) multiple store items from specified channels.
 *
 * Request body:
 * {
 *   storeItemIds: ["id1", "id2", ...],
 *   providers?: ["ebay", "etsy"],  // If not specified, unpublish from all
 *   deleteFromChannel?: boolean    // If true, also delete the listing from the channel
 * }
 *
 * Response:
 * {
 *   unpublished: number,
 *   failed: number,
 *   skipped: number,
 *   results: [{
 *     itemId: string,
 *     status: "unpublished" | "failed" | "skipped",
 *     providers?: { ebay: { ok: true }, etsy: { ok: false, error: "..." } },
 *     reason?: string
 *   }, ...]
 * }
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getSessionForApi(req);
    const userId = session?.user?.id;

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const parsed = bulkUnpublishSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request body", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { storeItemIds, providers: providerStrings, deleteFromChannel } = parsed.data;

    // Parse providers (if specified)
    let providers: ChannelProvider[] | null = null;
    if (providerStrings && providerStrings.length > 0) {
      providers = [];
      for (const p of providerStrings) {
        if (isChannelProvider(p)) {
          providers.push(p);
        }
      }
    }

    // Fetch store items with ownership check and channel links
    const storeItems = await prisma.storeItem.findMany({
      where: {
        id: { in: storeItemIds },
        memberId: userId,
      },
      include: {
        channelLinks: {
          where: {
            syncEnabled: true,
            ...(providers && { provider: { in: providers } }),
          },
        },
      },
    });

    const itemsById = new Map(storeItems.map((item) => [item.id, item]));

    const result: UnpublishResult = {
      unpublished: 0,
      failed: 0,
      skipped: 0,
      results: [],
    };

    // Process each item
    for (const itemId of storeItemIds) {
      const item = itemsById.get(itemId);

      if (!item) {
        result.skipped++;
        result.results.push({
          itemId,
          status: "skipped",
          reason: "Item not found or not owned",
        });
        continue;
      }

      if (item.channelLinks.length === 0) {
        result.skipped++;
        result.results.push({
          itemId,
          status: "skipped",
          reason: "No active channel links",
        });
        continue;
      }

      const providersForItem = item.channelLinks.map(
        (link) => link.provider as ChannelProvider
      );
      const providerResults: Record<string, { ok: boolean; error?: string }> = {};
      let anySuccess = false;

      try {
        if (deleteFromChannel) {
          const syncResults = await unpublishStoreItemFromChannels(itemId, providersForItem);
          for (const sr of syncResults) {
            providerResults[sr.provider] = { ok: sr.ok, error: sr.error };
            if (sr.ok) anySuccess = true;
          }
        } else {
          await prisma.channelListingLink.deleteMany({
            where: { storeItemId: itemId, provider: { in: providersForItem } },
          });
          for (const provider of providersForItem) {
            providerResults[provider] = { ok: true };
            anySuccess = true;
          }
        }
      } catch (e) {
        const errorMsg = e instanceof Error ? e.message : "Unpublish failed";
        for (const provider of providersForItem) {
          providerResults[provider] = { ok: false, error: errorMsg };
        }
      }

      if (anySuccess) {
        result.unpublished++;
        result.results.push({
          itemId,
          status: "unpublished",
          providers: providerResults,
        });
      } else {
        result.failed++;
        result.results.push({
          itemId,
          status: "failed",
          providers: providerResults,
        });
      }
    }

    // Create snapshot for activity tracking
    if (result.unpublished > 0) {
      try {
        const unpublishedItemIds = result.results
          .filter((r) => r.status === "unpublished")
          .map((r) => r.itemId);
        
        const changes: Record<string, { before: { channels: string[] }; after: { channels: string[] } }> = {};
        for (const r of result.results) {
          if (r.status === "unpublished" && r.providers) {
            const unpublishedFrom = Object.entries(r.providers)
              .filter(([, v]) => v.ok)
              .map(([p]) => p);
            const item = itemsById.get(r.itemId);
            const existingChannels = item?.channelLinks.map((l) => l.provider) ?? [];
            changes[r.itemId] = {
              before: { channels: existingChannels },
              after: { channels: existingChannels.filter((c) => !unpublishedFrom.includes(c)) },
            };
          }
        }
        
        const snapshot = await prisma.bulkEditSnapshot.create({
          data: {
            memberId: userId,
            operation: "bulk_unpublish",
            itemCount: result.unpublished,
            changes: changes as Prisma.InputJsonValue,
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          },
        });
        
        // Log activity
        const { logSellerActivity } = await import("@/lib/seller-activity-log");
        logSellerActivity(userId, "bulk_unpublish", "bulk_operation", snapshot.id, {
          itemIds: unpublishedItemIds,
          itemCount: result.unpublished,
          providers: providers ?? ["all"],
        });
        
        (result as Record<string, unknown>).snapshotId = snapshot.id;
      } catch (e) {
        console.warn("[bulk-unpublish] snapshot creation failed:", e);
      }
    }
    
    return NextResponse.json(result);
  } catch (e) {
    console.error("[bulk-unpublish] error:", e);
    return NextResponse.json(
      { error: "Bulk unpublish failed", detail: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
