import { LIST_ON_PROVIDER_ORDER, type ChannelProviderId } from "@/lib/channel-connections";

export type ChannelProvider = ChannelProviderId;
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

const PROVIDERS: ChannelProvider[] = ["etsy", "ebay", "shopify", "wix"];

function isChannelProvider(value: string): value is ChannelProvider {
  return (PROVIDERS as string[]).includes(value);
}

export const UNSYNC_INW_NOTE =
  "Unchecking INW takes this item off our storefront and stops us from matching stock with your other shops. Listings you leave checked stay up, but we will not update their quantities — the same item could sell twice.";

export function hasLinkedChannelListings(
  items: { channelLinks?: { provider: string }[] }[]
): boolean {
  return items.some((item) => (item.channelLinks ?? []).length > 0);
}

export function uniqueLinkedShopNames(
  items: { channelLinks?: { provider: string }[] }[],
  labels: Record<string, string>
): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    for (const link of item.channelLinks ?? []) {
      const name = labels[link.provider] ?? link.provider;
      if (seen.has(name)) continue;
      seen.add(name);
      names.push(name);
    }
  }
  return names;
}

export function formatShopList(names: string[]): string {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

export function endOnInwConfirm(count: number, shopNames: string[]): string {
  const endWhat = count === 1 ? "this listing" : "these listings";
  const leave = count === 1 ? "It leaves" : "They leave";
  if (shopNames.length === 0) {
    return `End ${endWhat} on INW? ${leave} our storefront. Ended INW listings are removed after 14 days.`;
  }
  const shops = formatShopList(shopNames);
  const stay = shopNames.length === 1 ? "stays" : "stay";
  const there = shopNames.length === 1 ? "it" : "them";
  return (
    `This will NOT end ${endWhat} on ${shops}.\n\n` +
    `End on INW only? ${leave} our storefront. ${shops} ${stay} live until you end ${there} there. Ended INW listings are removed after 14 days.`
  );
}

export function endOnInwResult(
  updated: number,
  failed: number,
  shopNames: string[]
): { title: string; message: string; ok: boolean } {
  if (failed > 0) {
    return { title: "End Listings", message: `Ended ${updated}. ${failed} failed.`, ok: false };
  }
  const ended = `Ended ${updated} listing${updated === 1 ? "" : "s"} on INW.`;
  if (shopNames.length === 0) {
    return { title: "Ended on INW", message: ended, ok: true };
  }
  const shops = formatShopList(shopNames);
  return {
    title: "Ended on INW only",
    message: `${ended}\n\nThis did not end the listing on ${shops}. End it there separately if you want it down.`,
    ok: true,
  };
}

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
    return { storeItemId: item.id, inw: true, providers };
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
    action === "sync" ? "Manage Listings" : action === "end" ? "End Listings" : "Delete listings";
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
