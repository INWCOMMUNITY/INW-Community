import { randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import { Prisma, type PrismaClient } from "@prisma/client";

export type MemberAccountLifecycleResult =
  | { ok: true; outcome: "deleted" | "closed" }
  | { ok: false; error: "not_found" };

type Tx = Prisma.TransactionClient;

/** Prisma filter: no durable commerce/financial rows. Used by stale-unverified cleanup. */
export function durableCommerceFinancialNone(): Prisma.MemberWhereInput {
  return {
    storeItemsSold: { none: {} },
    storeOrdersAsBuyer: { none: {} },
    storeOrdersAsSeller: { none: {} },
    storeVariants: { none: {} },
    checkoutAttempts: { none: {} },
    inventoryStates: { none: {} },
    inventoryEvents: { none: {} },
    inventoryReservations: { none: {} },
    variantBackfillMaps: { none: {} },
    refundOperations: { none: {} },
    transferOperations: { none: {} },
    sellerBalance: { is: null },
    sellerBalanceTransactions: { none: {} },
    subscriptions: { none: {} },
    planSwitchLogs: { none: {} },
    reports: { none: {} },
    stripeCustomerId: null,
    stripeConnectAccountId: null,
    shippoApiKeyEncrypted: null,
    shippoOAuthTokenEncrypted: null,
  };
}

async function memberMustRetain(tx: Tx, memberId: string): Promise<boolean> {
  const member = await tx.member.findUnique({
    where: { id: memberId },
    select: {
      stripeCustomerId: true,
      stripeConnectAccountId: true,
      shippoApiKeyEncrypted: true,
      shippoOAuthTokenEncrypted: true,
    },
  });
  if (!member) return true;
  if (
    member.stripeCustomerId ||
    member.stripeConnectAccountId ||
    member.shippoApiKeyEncrypted ||
    member.shippoOAuthTokenEncrypted
  ) {
    return true;
  }

  const [
    ordersAsBuyer,
    ordersAsSeller,
    storeItems,
    storeVariants,
    checkoutAttempts,
    inventoryStates,
    inventoryEvents,
    inventoryReservations,
    variantBackfillMaps,
    refundOperations,
    transferOperations,
    sellerBalance,
    sellerBalanceTransactions,
    subscriptions,
    planSwitchLogs,
    reports,
  ] = await Promise.all([
    tx.storeOrder.count({ where: { buyerId: memberId } }),
    tx.storeOrder.count({ where: { sellerId: memberId } }),
    tx.storeItem.count({ where: { memberId } }),
    tx.storeVariant.count({ where: { memberId } }),
    tx.checkoutAttempt.count({ where: { buyerMemberId: memberId } }),
    tx.inventoryState.count({ where: { memberId } }),
    tx.inventoryEvent.count({ where: { memberId } }),
    tx.inventoryReservation.count({ where: { memberId } }),
    tx.variantBackfillMap.count({ where: { memberId } }),
    tx.refundOperation.count({ where: { memberId } }),
    tx.transferOperation.count({ where: { memberId } }),
    tx.sellerBalance.count({ where: { memberId } }),
    tx.sellerBalanceTransaction.count({ where: { memberId } }),
    tx.subscription.count({ where: { memberId } }),
    tx.planSwitchLog.count({ where: { memberId } }),
    tx.report.count({ where: { reporterId: memberId } }),
  ]);

  return (
    ordersAsBuyer +
      ordersAsSeller +
      storeItems +
      storeVariants +
      checkoutAttempts +
      inventoryStates +
      inventoryEvents +
      inventoryReservations +
      variantBackfillMaps +
      refundOperations +
      transferOperations +
      sellerBalance +
      sellerBalanceTransactions +
      subscriptions +
      planSwitchLogs +
      reports >
    0
  );
}

async function purgeDisposableCommunityContent(tx: Tx, memberId: string): Promise<void> {
  await tx.event.updateMany({ where: { memberId }, data: { memberId: null } });
  await tx.couponRedeem.updateMany({ where: { memberId }, data: { memberId: null } });
  await tx.nwcRequest.updateMany({ where: { memberId }, data: { memberId: null } });
  await tx.groupMember.updateMany({ where: { invitedById: memberId }, data: { invitedById: null } });

  await tx.postLike.deleteMany({ where: { memberId } });
  await tx.postCommentLike.deleteMany({ where: { memberId } });
  await tx.postPollVote.deleteMany({ where: { memberId } });
  await tx.postComment.deleteMany({ where: { memberId } });
  await tx.post.deleteMany({ where: { authorId: memberId } });

  await tx.blogComment.deleteMany({ where: { memberId } });
  await tx.blog.deleteMany({ where: { memberId } });

  await tx.groupPostLike.deleteMany({ where: { memberId } });
  await tx.groupPostComment.deleteMany({ where: { memberId } });
  await tx.groupPost.deleteMany({ where: { memberId } });
  await tx.groupMemberBan.deleteMany({
    where: { OR: [{ memberId }, { bannedByMemberId: memberId }] },
  });
  await tx.groupAdminInvite.deleteMany({
    where: { OR: [{ inviterId: memberId }, { inviteeId: memberId }] },
  });
  await tx.groupCreationRequest.deleteMany({ where: { requesterMemberId: memberId } });
  await tx.groupDeletionRequest.deleteMany({ where: { requesterMemberId: memberId } });
  await tx.groupMember.deleteMany({ where: { memberId } });
  await tx.group.deleteMany({ where: { createdById: memberId } });

  await tx.friendRequest.deleteMany({
    where: { OR: [{ requesterId: memberId }, { addresseeId: memberId }] },
  });
  await tx.follow.deleteMany({
    where: { OR: [{ followerId: memberId }, { followingId: memberId }] },
  });
  await tx.followBusiness.deleteMany({ where: { memberId } });
  await tx.followTag.deleteMany({ where: { memberId } });
  await tx.memberBlock.deleteMany({
    where: { OR: [{ blockerId: memberId }, { blockedId: memberId }] },
  });

  await tx.directConversation.deleteMany({
    where: { OR: [{ memberAId: memberId }, { memberBId: memberId }] },
  });
  await tx.groupConversationMessageReaction.deleteMany({ where: { memberId } });
  await tx.groupConversationMessage.deleteMany({ where: { senderId: memberId } });
  await tx.groupConversationMember.deleteMany({ where: { memberId } });
  await tx.groupConversation.deleteMany({ where: { createdById: memberId } });

  await tx.resaleMessage.deleteMany({ where: { senderId: memberId } });
  await tx.resaleConversation.deleteMany({
    where: { OR: [{ buyerId: memberId }, { sellerId: memberId }] },
  });
  await tx.resaleOffer.deleteMany({ where: { buyerId: memberId } });

  await tx.eventInvite.deleteMany({
    where: { OR: [{ inviterId: memberId }, { inviteeId: memberId }] },
  });

  await tx.cartItem.deleteMany({ where: { memberId } });
  await tx.savedItem.deleteMany({ where: { memberId } });
  await tx.collection.deleteMany({ where: { memberId } });
  await tx.listingFeedCollection.deleteMany({ where: { memberId } });
  await tx.priceDropAlert.deleteMany({ where: { memberId } });
  await tx.memberListingView.deleteMany({ where: { viewerId: memberId } });
  await tx.contentShareEvent.deleteMany({ where: { memberId } });
  await tx.memberAppShare.deleteMany({ where: { memberId } });
  await tx.referralSignup.deleteMany({
    where: { OR: [{ referrerId: memberId }, { newMemberId: memberId }] },
  });
  await tx.referralLink.deleteMany({ where: { memberId } });

  await tx.memberPushToken.deleteMany({ where: { memberId } });
  await tx.memberNotificationPreferences.deleteMany({ where: { memberId } });
  await tx.webviewBridgeToken.deleteMany({ where: { memberId } });

  await tx.sellerTimeAway.deleteMany({ where: { memberId } });
  await tx.listingTemplate.deleteMany({ where: { memberId } });
  await tx.bulkEditSnapshot.deleteMany({ where: { memberId } });
  await tx.sellerAnalyticsEvent.deleteMany({ where: { memberId } });
  await tx.sellerActivityLog.deleteMany({ where: { memberId } });
}

async function closeRetainedMember(tx: Tx, memberId: string, now: Date): Promise<void> {
  await tx.storeItem.updateMany({
    where: { memberId, status: "active" },
    data: { status: "inactive", endedAt: now },
  });

  await purgeDisposableCommunityContent(tx, memberId);

  const unusableHash = await bcrypt.hash(randomBytes(32).toString("hex"), 10);
  await tx.member.update({
    where: { id: memberId },
    data: {
      status: "closed",
      closedAt: now,
      authEpoch: { increment: 1 },
      passwordHash: unusableHash,
      emailVerificationTokenHash: null,
      emailVerificationCodeHash: null,
      emailVerificationExpiresAt: null,
      passwordResetTokenHash: null,
      passwordResetExpiresAt: null,
      profilePhotoUrl: null,
      coverPhotoUrl: null,
      bio: null,
      city: null,
      phone: null,
      deliveryAddress: Prisma.DbNull,
    },
  });
}

/**
 * Hard-delete a Member with no durable commerce/financial/provider state, or close and
 * retain the row when history must survive. No network calls.
 */
export async function closeOrDeleteMemberAccount(
  prisma: PrismaClient,
  memberId: string
): Promise<MemberAccountLifecycleResult> {
  return prisma.$transaction(
    async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM "Member" WHERE id = ${memberId} FOR UPDATE
      `;
      if (locked.length === 0) {
        return { ok: false, error: "not_found" } as const;
      }

      const member = await tx.member.findUnique({
        where: { id: memberId },
        select: { id: true, status: true },
      });
      if (!member) {
        return { ok: false, error: "not_found" } as const;
      }

      if (member.status === "closed") {
        return { ok: true, outcome: "closed" } as const;
      }

      const retain = await memberMustRetain(tx, memberId);
      if (!retain) {
        await tx.member.delete({ where: { id: memberId } });
        return { ok: true, outcome: "deleted" } as const;
      }

      await closeRetainedMember(tx, memberId, new Date());
      return { ok: true, outcome: "closed" } as const;
    },
    { timeout: 60_000 }
  );
}
