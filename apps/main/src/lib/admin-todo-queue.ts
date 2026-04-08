import { prisma } from "database";

export const ADMIN_TODO_QUEUE_KEYS = [
  "group_creation_requests",
  "group_deletion_requests",
  "flagged_pending",
  "nwc_requests",
] as const;

export type AdminTodoQueueKey = (typeof ADMIN_TODO_QUEUE_KEYS)[number];

export function isAdminTodoQueueKey(k: string): k is AdminTodoQueueKey {
  return (ADMIN_TODO_QUEUE_KEYS as readonly string[]).includes(k);
}

export type AdminTodoQueueItemDto = {
  key: AdminTodoQueueKey;
  label: string;
  count: number;
  /** Append to dashboard base: `/admin/dashboard` or `/dashboard` */
  hrefSuffix: string;
};

function visibleAfterDismiss(
  pendingCount: number,
  maxPendingCreatedAt: Date | null | undefined,
  dismissedAt: Date | undefined,
): boolean {
  if (pendingCount <= 0) return false;
  if (!dismissedAt) return true;
  if (!maxPendingCreatedAt) return true;
  return maxPendingCreatedAt > dismissedAt;
}

export async function getAdminTodoQueueItems(): Promise<AdminTodoQueueItemDto[]> {
  const dismissals = await prisma.adminDashboardQueueDismissal.findMany();
  const byKey = Object.fromEntries(dismissals.map((d) => [d.queueKey, d.dismissedAt])) as Record<
    string,
    Date | undefined
  >;

  const gcDismiss = byKey.group_creation_requests;
  const gdDismiss = byKey.group_deletion_requests;
  const flDismiss = byKey.flagged_pending;
  const nwcDismiss = byKey.nwc_requests;

  const [
    groupCreCount,
    groupCreMax,
    groupDelCount,
    groupDelMax,
    flaggedCount,
    flaggedMax,
    nwcTotal,
    nwcAllMax,
    nwcSinceCount,
    nwcSinceMax,
  ] = await Promise.all([
    prisma.groupCreationRequest.count({ where: { status: "pending" } }),
    prisma.groupCreationRequest.aggregate({
      where: { status: "pending" },
      _max: { createdAt: true },
    }),
    prisma.groupDeletionRequest.count({ where: { status: "pending" } }),
    prisma.groupDeletionRequest.aggregate({
      where: { status: "pending" },
      _max: { createdAt: true },
    }),
    prisma.flaggedContent.count({ where: { status: "pending" } }),
    prisma.flaggedContent.aggregate({
      where: { status: "pending" },
      _max: { createdAt: true },
    }),
    prisma.nwcRequest.count(),
    prisma.nwcRequest.aggregate({ _max: { createdAt: true } }),
    nwcDismiss
      ? prisma.nwcRequest.count({ where: { createdAt: { gt: nwcDismiss } } })
      : Promise.resolve(0),
    nwcDismiss
      ? prisma.nwcRequest.aggregate({
          where: { createdAt: { gt: nwcDismiss } },
          _max: { createdAt: true },
        })
      : Promise.resolve({ _max: { createdAt: null as Date | null } }),
  ]);

  const items: AdminTodoQueueItemDto[] = [];

  if (visibleAfterDismiss(groupCreCount, groupCreMax._max.createdAt, gcDismiss)) {
    items.push({
      key: "group_creation_requests",
      label: "Review new group requests",
      count: groupCreCount,
      hrefSuffix: "/group-requests",
    });
  }

  if (visibleAfterDismiss(groupDelCount, groupDelMax._max.createdAt, gdDismiss)) {
    items.push({
      key: "group_deletion_requests",
      label: "Review group deletion requests",
      count: groupDelCount,
      hrefSuffix: "/group-deletion-requests",
    });
  }

  if (visibleAfterDismiss(flaggedCount, flaggedMax._max.createdAt, flDismiss)) {
    items.push({
      key: "flagged_pending",
      label: "Review flagged content",
      count: flaggedCount,
      hrefSuffix: "/flagged",
    });
  }

  const nwcCount = nwcDismiss ? nwcSinceCount : nwcTotal;
  const nwcMax = nwcDismiss ? nwcSinceMax._max.createdAt : nwcAllMax._max.createdAt;
  if (visibleAfterDismiss(nwcCount, nwcMax, nwcDismiss)) {
    items.push({
      key: "nwc_requests",
      label: "Review support & contact requests",
      count: nwcCount,
      hrefSuffix: "/nwc-requests",
    });
  }

  return items;
}

export async function dismissAdminTodoQueue(key: AdminTodoQueueKey): Promise<void> {
  const now = new Date();
  await prisma.adminDashboardQueueDismissal.upsert({
    where: { queueKey: key },
    create: { queueKey: key, dismissedAt: now },
    update: { dismissedAt: now },
  });
}
