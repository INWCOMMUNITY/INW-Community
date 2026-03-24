import type { Prisma } from "database";
import { ensureRewardFulfillmentStoreItem } from "@/lib/reward-fulfillment-store-item";

export type RewardShippingAddress = {
  street: string;
  aptOrSuite?: string;
  city: string;
  state: string;
  zip: string;
};

/**
 * Creates paid $0 store order for reward redemption (shipping path). Caller must run inside a transaction.
 */
export async function attachPaidStoreOrderToRedemption(
  tx: Prisma.TransactionClient,
  params: {
    redemptionId: string;
    buyerId: string;
    sellerMemberId: string;
    shippingAddress: RewardShippingAddress;
  }
): Promise<string> {
  const { id: storeItemId } = await ensureRewardFulfillmentStoreItem(params.sellerMemberId);

  if (!params.shippingAddress.street?.trim() || !params.shippingAddress.city?.trim()) {
    throw new Error("INVALID_ADDRESS");
  }

  const order = await tx.storeOrder.create({
    data: {
      buyerId: params.buyerId,
      sellerId: params.sellerMemberId,
      subtotalCents: 0,
      shippingCostCents: 0,
      totalCents: 0,
      status: "paid",
      shippingAddress: params.shippingAddress as object,
      orderKind: "reward_redemption",
      pointsAwarded: 0,
      taxCents: 0,
    },
  });

  await tx.orderItem.create({
    data: {
      orderId: order.id,
      storeItemId,
      quantity: 1,
      priceCentsAtPurchase: 0,
      fulfillmentType: "ship",
    },
  });

  await tx.rewardRedemption.update({
    where: { id: params.redemptionId },
    data: { storeOrderId: order.id, fulfillmentStatus: "paid" },
  });

  return order.id;
}
