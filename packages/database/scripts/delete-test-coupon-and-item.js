/**
 * Removes seeded trial coupon(s) and the test resale listing.
 *
 * Coupons: code 10DJB and/or name "Trial Coupon – 10% Off" (seeded in prisma/seed.js).
 * Store item: slug "test-resale-item".
 *
 * Run:
 *   CONFIRM_DELETE_TEST_COUPON_AND_ITEM=yes node packages/database/scripts/delete-test-coupon-and-item.js
 *
 * Optional DB override:
 *   SEED_DATABASE_URL="postgresql://..." CONFIRM_DELETE_TEST_COUPON_AND_ITEM=yes node ...
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

const TRIAL_NAME = "Trial Coupon – 10% Off";

async function main() {
  if (process.env.CONFIRM_DELETE_TEST_COUPON_AND_ITEM !== "yes") {
    console.error(
      "Refusing to run: set CONFIRM_DELETE_TEST_COUPON_AND_ITEM=yes (backup DB first if production)."
    );
    process.exit(1);
  }

  const couponResult = await prisma.coupon.deleteMany({
    where: {
      OR: [{ code: "10DJB" }, { name: TRIAL_NAME }],
    },
  });
  console.log(`Deleted ${couponResult.count} coupon row(s) (10DJB / trial name).`);

  const itemResult = await prisma.storeItem.deleteMany({
    where: { slug: "test-resale-item" },
  });
  console.log(`Deleted ${itemResult.count} store item row(s) (slug test-resale-item).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
