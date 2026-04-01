/**
 * One-off: clear logoUrl for Coach Boe (slug coach-boe) after mistaken hub-logo sync.
 * Run: node packages/database/scripts/revert-coach-boe-logo.js
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

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("Missing DATABASE_URL. Set it or add to .env at repo root.");
    process.exit(1);
  }
  const prisma = new PrismaClient();
  try {
    const row = await prisma.business.findUnique({
      where: { slug: "coach-boe" },
      select: { id: true, name: true },
    });
    if (!row) {
      console.warn('No business with slug "coach-boe".');
      return;
    }
    await prisma.business.update({
      where: { id: row.id },
      data: { logoUrl: null },
    });
    console.log(`Cleared logoUrl for "${row.name}" (${row.id}).`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
