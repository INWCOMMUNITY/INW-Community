/**
 * Whether catalog reconcile should push INW quantity out to linked channels
 * instead of pulling remote quantity onto INW.
 *
 * Quantity decreases from Wix sales use reconcileConnectionSales, not catalog pull.
 * Manual Wix qty edits use inventory webhooks + pullWixInventoryForConnection.
 */
export function shouldPushLocalQuantityToChannels(args: {
  localQuantity: number;
  remoteQuantity: number;
  remoteQuantityKnown: boolean;
  lastPushedAt?: Date | null;
  lastInboundAt?: Date | null;
}): boolean {
  const local = Math.max(0, args.localQuantity);
  if (local === 0) return true;
  if (!args.remoteQuantityKnown) return true;
  const remote = Math.max(0, args.remoteQuantity);
  if (local > remote) return true;
  if (local < remote) return false;
  return false;
}
