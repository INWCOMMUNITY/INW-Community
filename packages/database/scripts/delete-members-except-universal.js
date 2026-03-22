/**
 * One-off script: delete all members except the universal account (universal@nwc.local).
 *
 * Run from repo root:
 *   CONFIRM_DELETE_ALL_MEMBERS_BUT_UNIVERSAL=yes node packages/database/scripts/delete-members-except-universal.js
 *
 * Optional: point at a specific DB (e.g. production) without changing .env:
 *   SEED_DATABASE_URL="postgresql://..." CONFIRM_DELETE_ALL_MEMBERS_BUT_UNIVERSAL=yes node ...
 *
 * Backup first. Cascades remove other members' businesses, store items, orders, posts, messages, etc.
 */
const path = require("path");
const fs = require("fs");

if (process.env.SEED_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.SEED_DATABASE_URL;
}

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
  if (process.env.CONFIRM_DELETE_ALL_MEMBERS_BUT_UNIVERSAL !== "yes") {
    console.error(
      "Refusing to run: set CONFIRM_DELETE_ALL_MEMBERS_BUT_UNIVERSAL=yes to delete every member except universal@nwc.local."
    );
    process.exit(1);
  }

  const universal = await prisma.member.findUnique({
    where: { email: UNIVERSAL_EMAIL },
    select: { id: true, email: true },
  });
  if (!universal) {
    console.error(`Universal account (${UNIVERSAL_EMAIL}) not found. Aborting.`);
    process.exit(1);
  }

  const others = await prisma.member.count({ where: { id: { not: universal.id } } });
  console.log(`Will delete ${others} member(s); keeping ${universal.email} (${universal.id}).`);
  if (others === 0) {
    console.log("Nothing to delete.");
    return;
  }

  const count = await prisma.member.deleteMany({
    where: { id: { not: universal.id } },
  });
  console.log(`Done. Kept member: ${universal.email}. Deleted ${count.count} other member(s).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
