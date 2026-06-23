/**
 * Backfill ContentShareEvent rows from existing shared_post feed reshares.
 * Run once after deploying content_share_event migration:
 *   npx tsx scripts/backfill-content-share-events.ts
 */
import { prisma } from "database";

function utcShareDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

async function main() {
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
    } catch (e: unknown) {
      const code = (e as { code?: string })?.code;
      if (code === "P2002") {
        skipped++;
        continue;
      }
      throw e;
    }
  }

  console.log(`Backfill complete: ${inserted} inserted, ${skipped} skipped (duplicate day/channel).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
