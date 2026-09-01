import { prisma, Prisma } from "database";
import { CHANNEL_PROVIDERS, isChannelProvider, type ChannelProvider } from "@/lib/channels/types";
import {
  publishStoreItemToChannels,
  unpublishStoreItemFromChannels,
  updateStoreItemOnChannels,
} from "@/lib/channels/outbound";
import { logSellerActivity } from "@/lib/seller-activity-log";
import { inactiveStoreItemData } from "@/lib/store-item-ended-status";
import type { ListOnCategoryAssignment } from "@/lib/list-on-channel-category";
import { storeItemPatchFromListOnCategoryAssignment } from "@/lib/list-on-channel-category-patch";
import {
  planBulkDestinations,
  type BulkDestinationAction,
  type DestinationAssignment,
} from "@/lib/store-item-bulk-destinations";

export type BulkDestinationsResult = {
  published: number;
  unpublished: number;
  ended: number;
  deleted: number;
  unsyncedInw: number;
  failed: number;
  skipped: number;
  results: {
    itemId: string;
    status: string;
    detail?: string;
    providers?: Record<string, { ok: boolean; error?: string }>;
  }[];
};

function emptyResult(): BulkDestinationsResult {
  return {
    published: 0,
    unpublished: 0,
    ended: 0,
    deleted: 0,
    unsyncedInw: 0,
    failed: 0,
    skipped: 0,
    results: [],
  };
}

function mergeProviderResults(
  into: Record<string, { ok: boolean; error?: string }>,
  rows: { provider: string; ok: boolean; error?: string }[]
) {
  for (const row of rows) {
    into[row.provider] = { ok: row.ok, error: row.error };
  }
}

async function applyCategoryAssignments(assignments: ListOnCategoryAssignment[] | undefined) {
  if (!assignments?.length) return;
  for (const assignment of assignments) {
    const current = await prisma.storeItem.findUnique({
      where: { id: assignment.storeItemId },
      select: { aspects: true },
    });
    const data = storeItemPatchFromListOnCategoryAssignment(assignment, current?.aspects);
    if (Object.keys(data).length === 0) continue;
    await prisma.storeItem.update({
      where: { id: assignment.storeItemId },
      data: data as Prisma.StoreItemUpdateInput,
    });
  }
}

export async function applyBulkDestinations(input: {
  memberId: string;
  action: BulkDestinationAction;
  assignments: DestinationAssignment[];
  categoryAssignments?: ListOnCategoryAssignment[];
}): Promise<BulkDestinationsResult> {
  const result = emptyResult();
  const ids = input.assignments.map((a) => a.storeItemId);
  if (ids.length === 0) return result;

  const owned = await prisma.storeItem.findMany({
    where: { id: { in: ids }, memberId: input.memberId },
    select: {
      id: true,
      status: true,
      channelLinks: { select: { provider: true, syncEnabled: true } },
    },
  });
  const ownedById = new Map(owned.map((item) => [item.id, item]));

  if (input.action === "sync") {
    await applyCategoryAssignments(input.categoryAssignments);
  }

  const plan = planBulkDestinations(
    input.action,
    owned.map((item) => ({
      id: item.id,
      status: item.status,
      linkedProviders: item.channelLinks.map((l) => l.provider).filter(isChannelProvider),
    })),
    input.assignments
  );

  const publishByItem = new Map(plan.publish.map((row) => [row.itemId, row.providers]));
  const unpublishByItem = new Map(plan.unpublish.map((row) => [row.itemId, row.providers]));
  const unsyncInw = new Set(plan.unsyncInw);
  const activateInw = new Set(plan.activateInw);
  const endInw = new Set(plan.endInw);
  const deleteInw = new Set(plan.deleteInw);

  for (const assignment of input.assignments) {
    const item = ownedById.get(assignment.storeItemId);
    if (!item) {
      result.skipped++;
      result.results.push({
        itemId: assignment.storeItemId,
        status: "skipped",
        detail: "Item not found or not owned",
      });
      continue;
    }

    const providerResults: Record<string, { ok: boolean; error?: string }> = {};
    let failed = false;

    const toRemove = unpublishByItem.get(item.id) ?? [];
    if (toRemove.length) {
      try {
        const rows = await unpublishStoreItemFromChannels(item.id, toRemove);
        mergeProviderResults(providerResults, rows);
        if (rows.some((r) => !r.ok)) failed = true;
        else result.unpublished++;
      } catch (e) {
        failed = true;
        const msg = e instanceof Error ? e.message : "Unpublish failed";
        for (const provider of toRemove) {
          providerResults[provider] = { ok: false, error: msg };
        }
      }
    }

    const toAdd = publishByItem.get(item.id) ?? [];
    if (toAdd.length && !failed) {
      try {
        const rows = await publishStoreItemToChannels(item.id, input.memberId, { providers: toAdd });
        mergeProviderResults(providerResults, rows);
        if (rows.some((r) => !r.ok)) failed = true;
        else result.published++;
      } catch (e) {
        failed = true;
        const msg = e instanceof Error ? e.message : "Publish failed";
        for (const provider of toAdd) {
          providerResults[provider] = { ok: false, error: msg };
        }
      }
    }

    // Force-update only after the picker collected new Type/Brand for an already-live
    // listing (Needs Attention / missing-specifics retry). Unchanged Manage Listings
    // checkboxes do not produce an assignment, so those listings are left alone.
    const ebayAssignment = input.categoryAssignments?.find((row) => row.storeItemId === item.id);
    const alreadyLinkedEbay =
      item.channelLinks.some((link) => link.provider === "ebay") && !toAdd.includes("ebay");
    if (input.action === "sync" && alreadyLinkedEbay && ebayAssignment && !failed) {
      try {
        const rows = await updateStoreItemOnChannels(item.id, {
          skipProviders: CHANNEL_PROVIDERS.filter((provider) => provider !== "ebay"),
          force: true,
        });
        mergeProviderResults(providerResults, rows);
        if (rows.some((row) => !row.ok)) failed = true;
      } catch (e) {
        failed = true;
        providerResults.ebay = {
          ok: false,
          error: e instanceof Error ? e.message : "eBay update failed",
        };
      }
    }

    if (unsyncInw.has(item.id) && !failed) {
      const remaining = assignment.providers.filter(isChannelProvider);
      await prisma.storeItem.update({
        where: { id: item.id },
        data: inactiveStoreItemData(),
      });
      if (remaining.length) {
        await prisma.channelListingLink.updateMany({
          where: { storeItemId: item.id, provider: { in: remaining } },
          data: { syncEnabled: false },
        });
      }
      result.unsyncedInw++;
    } else if (activateInw.has(item.id) && !failed) {
      await prisma.storeItem.update({
        where: { id: item.id },
        data: { status: "active", endedAt: null },
      });
      await prisma.channelListingLink.updateMany({
        where: { storeItemId: item.id },
        data: { syncEnabled: true },
      });
    }

    if (endInw.has(item.id) && !failed) {
      await prisma.storeItem.update({
        where: { id: item.id },
        data: inactiveStoreItemData(),
      });
      result.ended++;
    }

    if (deleteInw.has(item.id)) {
      if (failed) {
        result.failed++;
        result.results.push({
          itemId: item.id,
          status: "failed",
          detail: "INW was not deleted because a selected store delete failed.",
          providers: providerResults,
        });
        continue;
      }
      await prisma.storeItem.delete({ where: { id: item.id } });
      result.deleted++;
    }

    if (failed) {
      result.failed++;
      result.results.push({
        itemId: item.id,
        status: "failed",
        detail: Object.entries(providerResults)
          .filter(([, v]) => !v.ok)
          .map(([p, v]) => `${p}: ${v.error ?? "failed"}`)
          .join("; ") || "Update failed",
        providers: providerResults,
      });
      continue;
    }

    result.results.push({
      itemId: item.id,
      status: "ok",
      providers: Object.keys(providerResults).length ? providerResults : undefined,
    });
  }

  const changed =
    result.published + result.unpublished + result.ended + result.deleted + result.unsyncedInw;
  if (changed > 0) {
    try {
      const actionName =
        input.action === "sync"
          ? "bulk_publish"
          : input.action === "delete"
            ? "bulk_delete"
            : "bulk_edit";
      logSellerActivity(input.memberId, actionName, "bulk_operation", input.memberId, {
        itemIds: ids,
        itemCount: changed,
        action: input.action,
      });
    } catch {
      /* activity is best-effort */
    }
  }

  return result;
}

export function parseDestinationAssignments(raw: unknown): DestinationAssignment[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 50) return null;
  const items: DestinationAssignment[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") return null;
    const rec = row as Record<string, unknown>;
    if (typeof rec.storeItemId !== "string" || rec.storeItemId.length === 0) return null;
    if (typeof rec.inw !== "boolean") return null;
    if (!Array.isArray(rec.providers)) return null;
    const providers: ChannelProvider[] = [];
    for (const p of rec.providers) {
      if (typeof p !== "string" || !isChannelProvider(p)) return null;
      providers.push(p);
    }
    items.push({ storeItemId: rec.storeItemId, inw: rec.inw, providers });
  }
  return items;
}
