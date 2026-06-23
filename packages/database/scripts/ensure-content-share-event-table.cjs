const path = require("path");
const { PrismaClient } = require(path.join(__dirname, "../node_modules/@prisma/client"));

async function main() {
  const prisma = new PrismaClient();
  try {
    const existing = await prisma.$queryRaw`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename = 'content_share_event'
    `;
    if (Array.isArray(existing) && existing.length > 0) {
      console.log("content_share_event already exists");
      return;
    }

    await prisma.$executeRawUnsafe(`
      CREATE TABLE "content_share_event" (
          "id" TEXT NOT NULL,
          "member_id" TEXT NOT NULL,
          "content_type" TEXT NOT NULL,
          "content_id" TEXT NOT NULL,
          "channel" TEXT NOT NULL,
          "share_day" DATE NOT NULL,
          "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT "content_share_event_pkey" PRIMARY KEY ("id")
      );
    `);
    await prisma.$executeRawUnsafe(`
      CREATE INDEX "content_share_event_content_type_content_id_idx"
      ON "content_share_event"("content_type", "content_id");
    `);
    await prisma.$executeRawUnsafe(`
      CREATE UNIQUE INDEX "content_share_event_member_id_content_type_content_id_chann_key"
      ON "content_share_event"("member_id", "content_type", "content_id", "channel", "share_day");
    `);
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "content_share_event"
      ADD CONSTRAINT "content_share_event_member_id_fkey"
      FOREIGN KEY ("member_id") REFERENCES "member"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    `);
    console.log("Created content_share_event table");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
