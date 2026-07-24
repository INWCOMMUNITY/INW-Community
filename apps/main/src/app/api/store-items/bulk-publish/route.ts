import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { z } from "zod";
import { getSessionForApi } from "@/lib/mobile-auth";
import { validateForProviders, summarizeValidation } from "@/lib/channels/validate-publish";
import { publishToChannel } from "@/lib/channels/outbound";
import { getActiveConnectionContext } from "@/lib/channels/connection";
import { logSyncEvent } from "@/lib/channels/sync-log";
import { isChannelProvider, type ChannelProvider, type SyncStoreItem } from "@/lib/channels/types";

export const dynamic = "force-dynamic";

const bulkPublishSchema = z.object({
  storeItemIds: z.array(z.string()).min(1).max(50),
  providers: z.array(z.string()).min(1),
  validateFirst: z.boolean().optional().default(true),
  skipInvalid: z.boolean().optional().default(true),
});

type PublishResult = {
  published: number;
  failed: number;
  skipped: number;
  results: {
    itemId: string;
    status: "published" | "failed" | "skipped" | "invalid";
    providers?: Record<string, { ok: boolean; error?: string }>;
    validationErrors?: string[];
  }[];
};

/**
 * POST /api/store-items/bulk-publish
 *
 * Publish multiple store items to specified channels.
 *
 * Request body:
 * {
 *   storeItemIds: ["id1", "id2", ...],
 *   providers: ["ebay", "etsy"],
 *   validateFirst?: boolean,  // Default true - validate before publishing
 *   skipInvalid?: boolean     // Default true - skip items that fail validation
 * }
 *
 * Response:
 * {
 *   published: number,
 *   failed: number,
 *   skipped: number,
 *   results: [{
 *     itemId: string,
 *     status: "published" | "failed" | "skipped" | "invalid",
 *     providers?: { ebay: { ok: true }, etsy: { ok: false, error: "..." } },
 *     validationErrors?: ["Missing eBay category", ...]
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
    const parsed = bulkPublishSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request body", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { storeItemIds, providers: providerStrings, validateFirst, skipInvalid } = parsed.data;

    // Validate provider strings
    const providers: ChannelProvider[] = [];
    for (const p of providerStrings) {
      if (isChannelProvider(p)) {
        providers.push(p);
      }
    }

    if (providers.length === 0) {
      return NextResponse.json(
        { error: "At least one valid provider is required" },
        { status: 400 }
      );
    }

    // Fetch store items with ownership check
    const storeItems = await prisma.storeItem.findMany({
      where: {
        id: { in: storeItemIds },
        memberId: userId,
      },
      include: {
        channelListingLinks: {
          where: { provider: { in: providers } },
        },
      },
    });

    const itemsById = new Map(storeItems.map((item) => [item.id, item]));

    // Fetch connections
    const connections = await prisma.channelConnection.findMany({
      where: {
        memberId: userId,
        provider: { in: providers },
        status: "active",
      },
      select: {
        id: true,
        provider: true,
        status: true,
        etsyShippingProfileId: true,
        config: true,
        accessTokenEncrypted: true,
      },
    });

    const connectionByProvider = new Map(connections.map((c) => [c.provider, c]));

    const result: PublishResult = {
      published: 0,
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
          validationErrors: ["Item not found or not owned"],
        });
        continue;
      }

      // Check if already linked to all requested providers
      const existingLinks = new Set(item.channelListingLinks.map((l) => l.provider));
      const providersToPublish = providers.filter((p) => !existingLinks.has(p));

      if (providersToPublish.length === 0) {
        result.skipped++;
        result.results.push({
          itemId,
          status: "skipped",
          validationErrors: ["Already published to all requested channels"],
        });
        continue;
      }

      // Validate if requested
      if (validateFirst) {
        const validation = await validateForProviders(
          item as unknown as Partial<SyncStoreItem>,
          providersToPublish,
          connections as Parameters<typeof validateForProviders>[2]
        );

        const summary = summarizeValidation(validation);

        if (!summary.canPublish) {
          if (skipInvalid) {
            result.skipped++;
            result.results.push({
              itemId,
              status: "invalid",
              validationErrors: Object.entries(validation.byProvider)
                .flatMap(([provider, pResult]) =>
                  pResult.errors.map((e) => `[${provider}] ${e.message}`)
                ),
            });
            continue;
          }
        }
      }

      // Publish to each provider
      const providerResults: Record<string, { ok: boolean; error?: string }> = {};
      let anySuccess = false;

      for (const provider of providersToPublish) {
        const connection = connectionByProvider.get(provider);
        if (!connection) {
          providerResults[provider] = { ok: false, error: "Not connected" };
          continue;
        }

        try {
          const ctx = await getActiveConnectionContext(connection.id);
          if (!ctx) {
            providerResults[provider] = { ok: false, error: "Connection expired" };
            continue;
          }

          await publishToChannel(ctx, item as unknown as SyncStoreItem, userId);
          providerResults[provider] = { ok: true };
          anySuccess = true;

          await logSyncEvent({
            memberId: userId,
            storeItemId: item.id,
            provider,
            action: "bulk_publish",
            success: true,
          });
        } catch (e) {
          const errorMsg = e instanceof Error ? e.message : "Publish failed";
          providerResults[provider] = { ok: false, error: errorMsg };

          await logSyncEvent({
            memberId: userId,
            storeItemId: item.id,
            provider,
            action: "bulk_publish",
            success: false,
            error: errorMsg,
          });
        }
      }

      if (anySuccess) {
        result.published++;
        result.results.push({
          itemId,
          status: "published",
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
    if (result.published > 0) {
      try {
        const publishedItemIds = result.results
          .filter((r) => r.status === "published")
          .map((r) => r.itemId);
        
        const changes: Record<string, { before: { channels: string[] }; after: { channels: string[] } }> = {};
        for (const r of result.results) {
          if (r.status === "published" && r.providers) {
            const publishedTo = Object.entries(r.providers)
              .filter(([, v]) => v.ok)
              .map(([p]) => p);
            const item = itemsById.get(r.itemId);
            const existingChannels = item?.channelListingLinks.map((l) => l.provider) ?? [];
            changes[r.itemId] = {
              before: { channels: existingChannels },
              after: { channels: [...existingChannels, ...publishedTo] },
            };
          }
        }
        
        const snapshot = await prisma.bulkEditSnapshot.create({
          data: {
            memberId: userId,
            operation: "bulk_publish",
            itemCount: result.published,
            changes,
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          },
        });
        
        // Log activity
        const { logSellerActivity } = await import("@/lib/seller-activity-log");
        logSellerActivity(userId, "bulk_publish", "bulk_operation", snapshot.id, {
          itemIds: publishedItemIds,
          itemCount: result.published,
          providers,
        });
        
        (result as Record<string, unknown>).snapshotId = snapshot.id;
      } catch (e) {
        console.warn("[bulk-publish] snapshot creation failed:", e);
      }
    }
    
    return NextResponse.json(result);
  } catch (e) {
    console.error("[bulk-publish] error:", e);
    return NextResponse.json(
      { error: "Bulk publish failed", detail: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
