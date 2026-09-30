import { prisma, shopifyListingIssueDedupeKey } from "database";
import { logSellerActivityOnce } from "@/lib/seller-activity-log";
import { sendPushNotification } from "@/lib/send-push-notification";

/**
 * Persist one seller-visible Shopify listing issue + optional push.
 * Same unresolved signature never spams.
 */
export async function notifyShopifyListingIssueOnce(input: {
  memberId: string;
  storeItemId: string;
  connectionId: string;
  listingLinkId: string;
  issueCode: string;
  issueFingerprint: string;
  severity: string;
  message: string;
}): Promise<{ created: boolean }> {
  if (input.severity !== "ACTION_REQUIRED" && input.severity !== "WARNING") {
    return { created: false };
  }

  const dedupeKey = shopifyListingIssueDedupeKey({
    connectionId: input.connectionId,
    listingLinkId: input.listingLinkId,
    issueCode: input.issueCode,
    issueFingerprint: input.issueFingerprint,
  });

  const item = await prisma.storeItem.findUnique({
    where: { id: input.storeItemId },
    select: { title: true },
  });
  const title = item?.title?.trim() || "your listing";

  const created = await logSellerActivityOnce({
    memberId: input.memberId,
    action: "sync_error",
    entityType: "store_item",
    entityId: input.storeItemId,
    dedupeKey,
    detail: {
      provider: "shopify",
      severity: input.severity,
      issueCode: input.issueCode,
      issueFingerprint: input.issueFingerprint,
      listingLinkId: input.listingLinkId,
      errorMessage: input.message,
      itemTitles: [title],
    },
    metadata: { source: "cron" },
  });

  if (created) {
    await sendPushNotification(input.memberId, {
      category: "seller_ops",
      title: "Shopify listing needs attention",
      body: input.message.includes(title) ? input.message : `${title}: ${input.message}`,
      data: {
        screen: "seller-hub-shopify",
        storeItemId: input.storeItemId,
        listingLinkId: input.listingLinkId,
        issueCode: input.issueCode,
      },
    });
  }

  return { created };
}
