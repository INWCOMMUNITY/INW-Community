/**
 * One-off script: delete all store items from the database.
 * Run from repo root: node packages/database/scripts/wipe-store-items.js
 * Or from packages/database: node scripts/wipe-store-items.js
 *
 * Requires DATABASE_URL. Cascades will remove related OrderItem, CartItem, ResaleOffer, ResaleConversation rows.
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

async function main() {
  const count = await prisma.storeItem.deleteMany({});
  console.log(`Deleted ${count.count} store item(s).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
