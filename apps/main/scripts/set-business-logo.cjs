/**
 * Set logoUrl for a business by slug (Prisma). Use when a logo was lost or never migrated.
 *
 * From repo root:
 *   node apps/main/scripts/set-business-logo.cjs stand-up-closets-garages "https://..."
 *
 * Default URL for Stand Up Closets & Garages is the stable Wix media id (no /v1/transform).
 */

const path = require("path");
const fs = require("fs");

if (process.env.SEED_DATABASE_URL && !process.env.DATABASE_URL) {
  process.env.DATABASE_URL = process.env.SEED_DATABASE_URL;
}

const possibleRoots = [
  path.resolve(__dirname, "..", "..", "..", ".env"),
  path.resolve(process.cwd(), ".env"),
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

const databaseRoot = path.resolve(__dirname, "..", "..", "..", "packages", "database");
const { PrismaClient } = require(require.resolve("@prisma/client", { paths: [databaseRoot] }));

const DEFAULT_STAND_UP_LOGO =
  "https://static.wixstatic.com/media/2bdd49_305f077208eb46b4b6a809133e8e10aa~mv2.png";

async function main() {
  const slugArg = process.argv[2];
  const urlArg = process.argv[3];

  if (!process.env.DATABASE_URL) {
    console.error("Missing DATABASE_URL.");
    process.exit(1);
  }

  const slug = (slugArg || "stand-up-closets-garages").trim();
  const logoUrl = (urlArg || DEFAULT_STAND_UP_LOGO).trim();

  const prisma = new PrismaClient();
  try {
    const row = await prisma.business.findUnique({
      where: { slug },
      select: { id: true, name: true, logoUrl: true },
    });
    if (!row) {
      console.error(`No business with slug "${slug}".`);
      process.exit(1);
    }
    await prisma.business.update({
      where: { id: row.id },
      data: { logoUrl },
    });
    console.log(`Updated "${row.name}" (${slug})`);
    console.log(`  previous: ${row.logoUrl ?? "(null)"}`);
    console.log(`  new:      ${logoUrl}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
