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

export const BULK_DESTINATION_COPY: Record<
  BulkDestinationAction,
  { title: string; body: string; apply: string }
> = {
  sync: {
    title: "Where these items are listed",
    body: "Check the stores that should stay listed. Uncheck a store to unsync and take that listing down. INW is your storefront — unchecking it takes the item off INW but leaves other shops as they are.",
    apply: "Save Listings",
  },
  end: {
    title: "Select where you'd like these listings ended",
    body: "End takes the listing down but keeps the INW record so you can Relist later. On other stores we close the live listing. End and Delete both take eBay, Etsy, and Wix listings down; the difference is whether INW keeps a record.",
    apply: "End listings",
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
  results?: { status: string; detail?: string }[];
};

export function summarizeBulkDestinations(
  action: BulkDestinationAction,
  result: BulkDestinationsResultCounts
): { title: string; message: string; ok: boolean } {
  const title =
    action === "sync" ? "Manage Listings" : action === "end" ? "End listings" : "Delete listings";
  const lines = [
    result.published ? `Listed: ${result.published}` : null,
    result.unpublished ? `Removed from stores: ${result.unpublished}` : null,
    result.ended ? `Ended on INW: ${result.ended}` : null,
    result.unsyncedInw ? `Stopped INW quantity tracking: ${result.unsyncedInw}` : null,
    result.deleted ? `Deleted from INW: ${result.deleted}` : null,
    result.failed ? `Failed: ${result.failed}` : null,
    result.skipped ? `Skipped: ${result.skipped}` : null,
  ].filter(Boolean);
  const failedDetails = (result.results ?? [])
    .filter((r) => r.status === "failed")
    .map((r) => r.detail)
    .filter(Boolean)
    .slice(0, 4);
  const message = [...lines, ...failedDetails].join("\n") || "No changes.";
  return { title, message, ok: result.failed === 0 };
}
