/**
 * One-off script: delete all members except the universal account (universal@nwc.local).
 * Run from repo root: node packages/database/scripts/delete-members-except-universal.js
 * Or from packages/database: node scripts/delete-members-except-universal.js
 *
 * Requires DATABASE_URL. Backup your database before running.
 * Many relations use onDelete: Cascade so dependent rows will be removed.
 */
const path = require("path");
const fs = require("fs");
const possibleRoots = [
  path.resolve(__dirname, "..", "..", "..", ".env"),
  path.resolve(process.cwd(), ".env"),
  path.resolve(process.cwd(), "..", ".env"),
];
const rootEnvPath = possibleRoots.find((p) => fs.existsSync(p));
if (rootEnvPath) {
  try {
    require("dotenv").config({ path: rootEnvPath });
  } catch {
    // ignore
  }
}

const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const UNIVERSAL_EMAIL = "universal@nwc.local";

async function main() {
  const universal = await prisma.member.findUnique({
    where: { email: UNIVERSAL_EMAIL },
    select: { id: true, email: true },
  });
  if (!universal) {
    console.error(`Universal account (${UNIVERSAL_EMAIL}) not found. Aborting.`);
    process.exit(1);
  }
  const count = await prisma.member.deleteMany({
    where: { id: { not: universal.id } },
  });
  console.log(`Kept member: ${universal.email}. Deleted ${count.count} other member(s).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
