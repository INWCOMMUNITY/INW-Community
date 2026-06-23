const path = require("path");
const { PrismaClient } = require(path.join(__dirname, "../node_modules/@prisma/client"));

async function main() {
  const prisma = new PrismaClient();
  try {
    const count = await prisma.contentShareEvent.count();
    console.log("event count:", count);

    const post = await prisma.post.findFirst({
      select: { id: true },
      orderBy: { createdAt: "desc" },
    });
    if (!post) {
      console.log("no posts to test");
      return;
    }
    const member = await prisma.member.findFirst({ select: { id: true } });
    if (!member) {
      console.log("no members to test");
      return;
    }

    const shareDay = new Date(
      Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate())
    );

    const created = await prisma.contentShareEvent.create({
      data: {
        memberId: member.id,
        contentType: "post",
        contentId: post.id,
        channel: "link_copy",
        shareDay,
      },
    });
    console.log("insert ok:", created.id);

    const grouped = await prisma.contentShareEvent.groupBy({
      by: ["contentId"],
      where: { contentType: "post", contentId: post.id },
      _count: { _all: true },
    });
    console.log("groupBy:", JSON.stringify(grouped));

    await prisma.contentShareEvent.delete({ where: { id: created.id } });
    console.log("cleaned up test row");
  } catch (e) {
    console.error("FAIL:", e);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main();
