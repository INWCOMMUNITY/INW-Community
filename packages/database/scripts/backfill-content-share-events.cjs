const path = require("path");
const { PrismaClient } = require(path.join(__dirname, "../node_modules/@prisma/client"));

function utcShareDay(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const reshares = await prisma.post.findMany({
      where: { type: "shared_post", sourcePostId: { not: null } },
      select: {
        authorId: true,
        sourcePostId: true,
        groupId: true,
        createdAt: true,
      },
    });

    let inserted = 0;
    let skipped = 0;

    for (const row of reshares) {
      if (!row.sourcePostId) continue;
      const channel = row.groupId ? "group_reshare" : "feed_reshare";
      try {
        await prisma.contentShareEvent.create({
          data: {
            memberId: row.authorId,
            contentType: "post",
            contentId: row.sourcePostId,
            channel,
            shareDay: utcShareDay(row.createdAt),
          },
        });
        inserted++;
      } catch (e) {
        if (e?.code === "P2002") {
          skipped++;
          continue;
        }
        throw e;
      }
    }

    console.log(`Backfill complete: ${inserted} inserted, ${skipped} skipped (duplicate day/channel).`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
