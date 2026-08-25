/** Public PDP/CUID access: strangers must not enumerate drafts or sold rows by id. */
export function strangerMayViewStoreItemById(args: {
  status: string;
  quantity: number;
  memberId: string;
  viewerId?: string | null;
}): boolean {
  if (args.viewerId && args.viewerId === args.memberId) return true;
  return args.status === "active" && args.quantity > 0;
}

/** includeUnavailable=1: owners see any status; strangers may see sold_out sold pages only. */
export function includeUnavailableVisibleToViewer(args: {
  status: string;
  memberId: string;
  viewerId?: string | null;
}): boolean {
  if (args.viewerId && args.viewerId === args.memberId) return true;
  return args.status === "sold_out";
}
