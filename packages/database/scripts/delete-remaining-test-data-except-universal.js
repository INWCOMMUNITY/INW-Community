/**
 * After keeping only universal@nwc.local (see delete-members-except-universal.js), removes
 * leftover seed/test rows that are not tied to members via FK (or removes known test accounts).
 *
 * Covers (from prisma/seed.js and scripts):
 * - Event slug test-community-meetup (often orphaned when sponsor member was deleted)
 * - SavedItem rows pointing at that event
 * - Store item slug test-resale-item; trial coupon 10DJB / name "Trial Coupon – 10% Off"
 * - Member test-profile-design@nwc.local (seed-test-profile-member.js)
 * - Groups whose slug starts with "test-" (QA convention; adjust if you use real slugs like that)
 *
 * Does NOT remove: admin (ADMIN_EMAIL), categories/tags/badges, or universal-owned data except
 * matching rules above.
 *
 * Run from repo root:
 *   CONFIRM_DELETE_REMAINING_TEST_DATA_EXCEPT_UNIVERSAL=yes node packages/database/scripts/delete-remaining-test-data-except-universal.js
 *
 * Optional DB:
 *   SEED_DATABASE_URL="postgresql://..." CONFIRM_DELETE_REMAINING_TEST_DATA_EXCEPT_UNIVERSAL=yes node ...
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
    /* ignore */
  }
}

const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const UNIVERSAL_EMAIL = "universal@nwc.local";
const TRIAL_COUPON_NAME = "Trial Coupon – 10% Off";
const TEST_EVENT_SLUG = "test-community-meetup";
const TEST_STORE_SLUG = "test-resale-item";
const TEST_PROFILE_EMAIL = "test-profile-design@nwc.local";

async function main() {
  if (process.env.CONFIRM_DELETE_REMAINING_TEST_DATA_EXCEPT_UNIVERSAL !== "yes") {
    console.error(
      "Refusing to run: set CONFIRM_DELETE_REMAINING_TEST_DATA_EXCEPT_UNIVERSAL=yes (backup DB first if production)."
    );
    process.exit(1);
  }

  const universal = await prisma.member.findUnique({
    where: { email: UNIVERSAL_EMAIL },
    select: { id: true },
  });
  if (!universal) {
    console.error(`Member ${UNIVERSAL_EMAIL} not found. Aborting.`);
    process.exit(1);
  }

  const testEvents = await prisma.event.findMany({
    where: { slug: TEST_EVENT_SLUG },
    select: { id: true },
  });
  const testEventIds = testEvents.map((e) => e.id);
  if (testEventIds.length > 0) {
    const saved = await prisma.savedItem.deleteMany({
      where: { type: "event", referenceId: { in: testEventIds } },
    });
    console.log(`Deleted ${saved.count} saved item(s) for ${TEST_EVENT_SLUG}.`);
    const ev = await prisma.event.deleteMany({ where: { id: { in: testEventIds } } });
    console.log(`Deleted ${ev.count} event(s) (${TEST_EVENT_SLUG}).`);
  } else {
    console.log(`No event with slug ${TEST_EVENT_SLUG}.`);
  }

  const items = await prisma.storeItem.deleteMany({ where: { slug: TEST_STORE_SLUG } });
  console.log(`Deleted ${items.count} store item(s) (${TEST_STORE_SLUG}).`);

  const coupons = await prisma.coupon.deleteMany({
    where: { OR: [{ code: "10DJB" }, { name: TRIAL_COUPON_NAME }] },
  });
  console.log(`Deleted ${coupons.count} coupon row(s) (trial / 10DJB).`);

  const testGroups = await prisma.group.deleteMany({
    where: {
      slug: { startsWith: "test-", mode: "insensitive" },
    },
  });
  console.log(`Deleted ${testGroups.count} group(s) (slug starts with "test-").`);

  const testProfile = await prisma.member.deleteMany({
    where: { email: TEST_PROFILE_EMAIL },
  });
  console.log(`Deleted ${testProfile.count} member(s) (${TEST_PROFILE_EMAIL}).`);

  console.log("Done. Kept:", UNIVERSAL_EMAIL);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
