import { isChannelProvider, type ChannelProvider } from "@/lib/channels/types";
import { LIST_ON_PROVIDER_ORDER } from "@/lib/channel-connections-client";

export type BulkDestinationAction = "sync" | "end" | "delete";

export type DestinationAssignment = {
  storeItemId: string;
  inw: boolean;
  providers: ChannelProvider[];
};

export type BulkDestinationGridItem = {
  id: string;
  title: string;
  photos: string[];
  status?: string;
  channelLinks?: { provider: string }[];
};

export type GridRowState = {
  storeItemId: string;
  inw: boolean;
  providers: Partial<Record<ChannelProvider, boolean>>;
};

export const UNSYNC_INW_NOTE =
  "Unchecking INW takes this item off our storefront and stops us from matching stock with your other shops. Listings you leave checked stay up, but we will not update their quantities — the same item could sell twice.";

export const MANAGE_LISTINGS_UNCHECK_NOTE =
  "Unchecking a connected store (eBay, Etsy, Shopify, or Wix) deletes that listing on that store. It is removed there, not just unsynced from INW.";

export const BULK_DESTINATION_COPY: Record<
  BulkDestinationAction,
  { title: string; body: string; apply: string }
> = {
  sync: {
    title: "Where these items are listed",
    body: "Check the stores that should stay listed. Uncheck a connected store to delete that listing on that third-party shop. INW is your storefront — unchecking it takes the item off INW but leaves other shops as they are.",
    apply: "Save Listings",
  },
  end: {
    title: "Where to end these listings",
    body: "Check INW and any other shops where you want the listing taken down. Unchecked shops stay live. Ending on INW keeps a record you can Relist; that INW record is removed after 14 days.",
    apply: "End Listings",
  },
  delete: {
    title: "Select where you'd like these listings deleted",
    body: "Delete permanently removes the listing. On INW the record is gone. On other stores the listing is removed and cannot be recovered from INW. End keeps an INW record you can Relist; Delete does not.",
    apply: "Delete listings",
  },
};

export function destinationColumns(connectedProviders: string[]): ChannelProvider[] {
  const wanted = new Set(connectedProviders.filter(isChannelProvider));
  return LIST_ON_PROVIDER_ORDER.filter((p) => wanted.has(p));
}

export function linkedProvidersOf(item: BulkDestinationGridItem): Set<string> {
  return new Set((item.channelLinks ?? []).map((l) => l.provider));
}

export function isProviderCellEnabled(
  action: BulkDestinationAction,
  item: BulkDestinationGridItem,
  provider: ChannelProvider
): boolean {
  if (action === "sync") return true;
  return linkedProvidersOf(item).has(provider);
}

export function initialGridRows(
  action: BulkDestinationAction,
  items: BulkDestinationGridItem[],
  columns: ChannelProvider[]
): GridRowState[] {
  return items.map((item) => {
    const linked = linkedProvidersOf(item);
    const providers: GridRowState["providers"] = {};
    for (const provider of columns) {
      providers[provider] = linked.has(provider);
    }
    return {
      storeItemId: item.id,
      inw: true,
      providers,
    };
  });
}

export function assignmentsFromGrid(rows: GridRowState[]): DestinationAssignment[] {
  return rows.map((row) => ({
    storeItemId: row.storeItemId,
    inw: row.inw,
    providers: (Object.entries(row.providers) as [ChannelProvider, boolean | undefined][])
      .filter(([, on]) => Boolean(on))
      .map(([provider]) => provider),
  }));
}

export function hasUnsyncInw(action: BulkDestinationAction, rows: GridRowState[]): boolean {
  return action === "sync" && rows.some((row) => !row.inw);
}

export function gridHasCheckedCell(rows: GridRowState[]): boolean {
  return rows.some((row) => row.inw || Object.values(row.providers).some(Boolean));
}

export function columnChecked(
  rows: GridRowState[],
  items: BulkDestinationGridItem[],
  column: ChannelProvider | "inw",
  action: BulkDestinationAction
): boolean {
  if (rows.length === 0) return false;
  if (column === "inw") return rows.every((row) => row.inw);
  return rows.every((row, i) => {
    const item = items[i];
    if (!item || !isProviderCellEnabled(action, item, column)) return true;
    return Boolean(row.providers[column]);
  });
}

export function setGridColumn(
  rows: GridRowState[],
  items: BulkDestinationGridItem[],
  column: ChannelProvider | "inw",
  checked: boolean,
  action: BulkDestinationAction
): GridRowState[] {
  return rows.map((row, i) => {
    if (column === "inw") return { ...row, inw: checked };
    const item = items[i];
    if (!item || !isProviderCellEnabled(action, item, column)) return row;
    return { ...row, providers: { ...row.providers, [column]: checked } };
  });
}

export type ItemLinkState = {
  id: string;
  status: string;
  linkedProviders: ChannelProvider[];
};

export type BulkDestinationPlan = {
  publish: { itemId: string; providers: ChannelProvider[] }[];
  unpublish: { itemId: string; providers: ChannelProvider[] }[];
  activateInw: string[];
  unsyncInw: string[];
  endInw: string[];
  deleteInw: string[];
};

function providerSet(list: string[]): Set<ChannelProvider> {
  return new Set(list.filter(isChannelProvider));
}

export function planBulkDestinations(
  action: BulkDestinationAction,
  items: ItemLinkState[],
  assignments: DestinationAssignment[]
): BulkDestinationPlan {
  const byId = new Map(items.map((item) => [item.id, item]));
  const plan: BulkDestinationPlan = {
    publish: [],
    unpublish: [],
    activateInw: [],
    unsyncInw: [],
    endInw: [],
    deleteInw: [],
  };

  for (const assignment of assignments) {
    const item = byId.get(assignment.storeItemId);
    if (!item) continue;
    const current = providerSet(item.linkedProviders);
    const desired = providerSet(assignment.providers);

    if (action === "sync") {
      const toAdd = [...desired].filter((p) => !current.has(p));
      const toRemove = [...current].filter((p) => !desired.has(p));
      if (toAdd.length) plan.publish.push({ itemId: item.id, providers: toAdd });
      if (toRemove.length) plan.unpublish.push({ itemId: item.id, providers: toRemove });
      if (!assignment.inw) plan.unsyncInw.push(item.id);
      else if (item.status === "inactive") plan.activateInw.push(item.id);
      continue;
    }

    const selectedLive = [...desired].filter((p) => current.has(p));
    if (selectedLive.length) plan.unpublish.push({ itemId: item.id, providers: selectedLive });
    if (action === "end" && assignment.inw) plan.endInw.push(item.id);
    if (action === "delete" && assignment.inw) plan.deleteInw.push(item.id);
  }

  return plan;
}

export function desiredProvidersByItemId(assignments: DestinationAssignment[]): Record<string, string[]> {
  return Object.fromEntries(assignments.map((a) => [a.storeItemId, a.providers]));
}

export type BulkDestinationsResultCounts = {
  published: number;
  unpublished: number;
  ended: number;
  deleted: number;
  unsyncedInw: number;
  failed: number;
  skipped: number;
  results?: { itemId: string; status: string; detail?: string }[];
};

export function bulkDestinationFailTitle(action: BulkDestinationAction): string {
  if (action === "sync") return "Couldn't Finish That";
  if (action === "end") return "Couldn't End Those Listings";
  return "Couldn't Delete Those Listings";
}

function listingCount(n: number, word = "listing"): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export function summarizeBulkDestinations(
  action: BulkDestinationAction,
  result: BulkDestinationsResultCounts
): { title: string; message: string; ok: boolean } {
  const ok = result.failed === 0;
  const parts: string[] = [];

  if (result.published) {
    parts.push(
      result.published === 1
        ? "Listed 1 item on a new store. It's live."
        : `Listed ${result.published} items on new stores. They're live.`
    );
  }
  if (result.unpublished) {
    parts.push(
      result.unpublished === 1
        ? "Deleted 1 listing from a connected store. It's gone there — not just unsynced."
        : `Deleted ${result.unpublished} listings from connected stores. They're gone there — not just unsynced.`
    );
  }
  if (result.ended) {
    parts.push(
      `Ended ${listingCount(result.ended)} on INW. You can Relist; we drop the INW record after 14 days.`
    );
  }
  if (result.unsyncedInw) {
    parts.push(
      result.unsyncedInw === 1
        ? "INW quantity tracking is off for 1 item. Shops you left checked stay up — they can still sell, so watch for doubles."
        : `INW quantity tracking is off for ${result.unsyncedInw} items. Shops you left checked stay up — they can still sell, so watch for doubles.`
    );
  }
  if (result.deleted) {
    parts.push(`Permanently deleted ${listingCount(result.deleted)} from INW. That record is gone.`);
  }
  if (result.skipped) {
    parts.push(`Skipped ${listingCount(result.skipped, "item")} — nothing we could change there.`);
  }
  if (result.failed) {
    parts.push(
      result.failed === 1 ? "1 change didn't go through." : `${result.failed} changes didn't go through.`
    );
  }

  const failedDetails = (result.results ?? [])
    .filter((r) => r.status === "failed")
    .map((r) => r.detail)
    .filter(Boolean)
    .slice(0, 4);

  const message =
    [...parts, ...failedDetails].join("\n\n") ||
    "Nothing needed changing. Your checkboxes already matched what's live.";

  let title: string;
  if (!ok) {
    title = bulkDestinationFailTitle(action);
  } else if (parts.length === 0) {
    title = "Nothing To Change";
  } else if (result.unpublished > 0 && result.published === 0) {
    title = "Taken Down";
  } else if (result.published > 0 && result.unpublished === 0 && result.unsyncedInw === 0) {
    title = "You're Live";
  } else if (result.unsyncedInw > 0 && result.published === 0 && result.unpublished === 0) {
    title = "INW Tracking Off";
  } else if (action === "end") {
    title = "Pulled From INW";
  } else if (action === "delete") {
    title = "Gone For Good";
  } else {
    title = "Listings Updated";
  }

  return { title, message, ok };
}
