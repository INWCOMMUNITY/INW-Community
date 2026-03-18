/**
 * Deletes the test profile member created by seed-test-profile-member.js.
 * Removes the member and all related data (posts, memberBadges, savedItems, etc.) via cascade.
 *
 * Run from repo root: node packages/database/scripts/delete-test-profile-member.js
 * Or from packages/database: node scripts/delete-test-profile-member.js
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
    const content = fs.readFileSync(rootEnvPath, "utf8");
    for (const line of content.split(/\r?\n/)) {
      const m = line.match(/^([^#=]+)=(.*)$/);
      if (m) {
        const key = m[1].trim();
        const val = m[2].trim().replace(/^["']|["']$/g, "");
        if (!process.env[key]) process.env[key] = val;
      }
    }
  }
}

const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const TEST_PROFILE_EMAIL = "test-profile-design@nwc.local";

async function main() {
  const member = await prisma.member.findUnique({
    where: { email: TEST_PROFILE_EMAIL },
    select: { id: true, firstName: true, lastName: true },
  });

  if (!member) {
    console.log("Test profile member not found (email:", TEST_PROFILE_EMAIL + "). Nothing to delete.");
    return;
  }

  await prisma.member.delete({
    where: { id: member.id },
  });

  console.log("Deleted test profile member:", member.firstName, member.lastName, "(" + TEST_PROFILE_EMAIL + ")");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
