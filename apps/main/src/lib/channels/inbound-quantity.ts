/**
 * When INW quantity is lower than Wix, the sale likely happened on INW and Wix still shows old stock.
 * Do not pull stale Wix quantity onto INW during catalog reconcile — push INW out instead.
 */
export function shouldPushLocalQuantityToChannels(args: {
  localQuantity: number;
  remoteQuantity: number;
  lastPushedAt: Date | null;
  lastInboundAt: Date | null;
}): boolean {
  const local = Math.max(0, args.localQuantity);
  const remote = Math.max(0, args.remoteQuantity);
  if (local >= remote) return false;
  if (!args.lastPushedAt) return true;
  if (!args.lastInboundAt) return true;
  return args.lastPushedAt >= args.lastInboundAt;
}
