import { prisma } from "database";

export type PushNotificationCategory =
  | "badges"
  | "messages"
  | "comments"
  | "events"
  | "group_admin"
  | "commerce"
  | "social";

export async function isMemberPushCategoryEnabled(
  memberId: string,
  category: PushNotificationCategory
): Promise<boolean> {
  const row = await prisma.memberNotificationPreferences.findUnique({
    where: { memberId },
    select: {
      notifyBadges: true,
      notifyMessages: true,
      notifyComments: true,
      notifyEvents: true,
      notifyGroupAdmin: true,
      notifyCommerce: true,
      notifySocial: true,
    },
  });
  if (!row) return true;
  switch (category) {
    case "badges":
      return row.notifyBadges;
    case "messages":
      return row.notifyMessages;
    case "comments":
      return row.notifyComments;
    case "events":
      return row.notifyEvents;
    case "group_admin":
      return row.notifyGroupAdmin;
    case "commerce":
      return row.notifyCommerce;
    case "social":
      return row.notifySocial;
    default:
      return true;
  }
}
