import { prisma } from "database";

async function main() {
  const item = await prisma.storeItem.findUnique({
    where: { id: "cmt7vumcl000dxjujvgwe8dob" },
    select: {
      memberId: true,
      title: true,
      quantity: true,
      updatedAt: true,
      channelLinks: {
        select: {
          provider: true,
          syncStatus: true,
          syncError: true,
          lastPushedAt: true,
          lastInboundAt: true,
          connection: {
            select: {
              provider: true,
              status: true,
              lastError: true,
              lastReconciledAt: true,
              config: true,
            },
          },
        },
      },
    },
  });
  const memberId = item?.memberId;
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const logs = memberId
    ? await prisma.channelSyncLog.groupBy({
        by: ["provider", "action"],
        where: { memberId, createdAt: { gt: since } },
        _count: true,
      })
    : [];
  const recentErrors = memberId
    ? await prisma.channelSyncLog.findMany({
        where: {
          memberId,
          action: { in: ["error", "error_permanent", "retry_exhausted"] },
          createdAt: { gt: since },
        },
        orderBy: { createdAt: "desc" },
        take: 12,
        select: { provider: true, action: true, detail: true, createdAt: true, storeItemId: true },
      })
    : [];
  const conns = memberId
    ? await prisma.channelConnection.findMany({
        where: { memberId },
        select: {
          provider: true,
          status: true,
          lastError: true,
          lastReconciledAt: true,
        },
      })
    : [];
  console.log(
    JSON.stringify(
      {
        title: item?.title,
        quantity: item?.quantity,
        updatedAt: item?.updatedAt,
        links: item?.channelLinks.map((l) => ({
          provider: l.provider,
          syncStatus: l.syncStatus,
          syncError: l.syncError,
          lastPushedAt: l.lastPushedAt,
          lastInboundAt: l.lastInboundAt,
          connStatus: l.connection.status,
          lastError: l.connection.lastError,
          lastReconciledAt: l.connection.lastReconciledAt,
          syncDirection:
            l.connection.config && typeof l.connection.config === "object"
              ? (l.connection.config as { syncDirection?: string }).syncDirection
              : null,
        })),
        connections: conns,
        logCounts24h: logs,
        recentErrors,
      },
      null,
      2
    )
  );
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
