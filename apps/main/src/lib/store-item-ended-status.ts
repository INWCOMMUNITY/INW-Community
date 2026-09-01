/** Ended INW listings are removed from our records after this window. Third-party shops are not touched. */
export const ENDED_LISTING_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;

type ChannelLinkLike = { provider: string; remoteDeletedProvider?: string | null };

function isLiveChannelLink(link: ChannelLinkLike): boolean {
  return !link.remoteDeletedProvider;
}

export function hasLinkedChannelListings(
  items: { channelLinks?: ChannelLinkLike[] }[]
): boolean {
  return items.some((item) => (item.channelLinks ?? []).some(isLiveChannelLink));
}

export function uniqueLinkedShopNames(
  items: { channelLinks?: ChannelLinkLike[] }[],
  labels: Record<string, string>
): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    for (const link of item.channelLinks ?? []) {
      if (!isLiveChannelLink(link)) continue;
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
    return {
      title: "Couldn't End Every Listing",
      message: `Ended ${updated}. ${failed} didn't go through.`,
      ok: false,
    };
  }
  const ended = `Ended ${updated} listing${updated === 1 ? "" : "s"} on INW. Relist anytime — we drop the INW record after 14 days.`;
  if (shopNames.length === 0) {
    return { title: "Off INW", message: ended, ok: true };
  }
  const shops = formatShopList(shopNames);
  return {
    title: "Off INW Only",
    message: `${ended}\n\nThis did not take it down on ${shops}. End it there separately if you want it gone.`,
    ok: true,
  };
}

export function inactiveStoreItemData(now = new Date()): { status: "inactive"; endedAt: Date } {
  return { status: "inactive", endedAt: now };
}

/** Status write that starts or clears the 14-day ended clock. */
export function storeItemStatusWrite(
  nextStatus: string,
  previousStatus?: string | null,
  now = new Date()
): { status: string; endedAt?: Date | null } {
  if (nextStatus === "inactive") {
    if (previousStatus === "inactive") return { status: nextStatus };
    return { status: nextStatus, endedAt: now };
  }
  return { status: nextStatus, endedAt: null };
}
