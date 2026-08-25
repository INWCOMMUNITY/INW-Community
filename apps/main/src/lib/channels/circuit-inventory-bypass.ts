export function shouldBypassCircuitForInventoryPush(args: {
  quantity: number;
  status: string;
  adjustedQty: number;
}): boolean {
  return args.status === "sold_out" || args.adjustedQty === 0 || args.quantity <= 0;
}
