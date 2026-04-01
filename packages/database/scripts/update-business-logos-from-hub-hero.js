/**
 * Set `logoUrl` to the same image the Business Hub circle uses:
 * logo → cover photo → first gallery photo (see `hubBusinessHeroImageUri` in the mobile app).
 *
 * Targets: DJs Coins & Collectibles, Cedar & Stone Consulting (not Coach Boe).
 *
 * Run from repo root:
 *   node packages/database/scripts/update-business-logos-from-hub-hero.js
 *
 * Requires DATABASE_URL (or SEED_DATABASE_URL). Loads `.env` from repo root when present.
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

/** Match `wixOriginalMediaUrl` in apps/main — strip Wix `/v1/fill/` transforms. */
function wixOriginalMediaUrl(url) {
  if (!url || typeof url !== "string") return url;
  if (!url.includes("static.wixstatic.com/media")) return url;
  const v1 = url.indexOf("/v1/");
  if (v1 === -1) return url;
  return url.slice(0, v1);
}

function hubHeroLogoUrl(b) {
  const logo = b.logoUrl?.trim() || null;
  const cover = b.coverPhotoUrl?.trim() || null;
  const photos = Array.isArray(b.photos) ? b.photos : [];
  const first = photos[0]?.trim() || null;
  const raw = logo || cover || first;
  if (!raw) return null;
  return wixOriginalMediaUrl(raw);
}

const SLUGS = ["djs-coins-collectibles", "cedar-stone-consulting"];

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("Missing DATABASE_URL. Set it or add to .env at repo root.");
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    for (const slug of SLUGS) {
      const row = await prisma.business.findUnique({
        where: { slug },
        select: {
          id: true,
          name: true,
          slug: true,
          logoUrl: true,
          coverPhotoUrl: true,
          photos: true,
        },
      });
      if (!row) {
        console.warn(`Skip: no business with slug "${slug}"`);
        continue;
      }

      const logoToSet = hubHeroLogoUrl(row);
      if (!logoToSet) {
        console.warn(
          `Skip "${row.name}" (${row.slug}): no logo, cover, or gallery photos to use as hub image.`
        );
        continue;
      }

      await prisma.business.update({
        where: { id: row.id },
        data: { logoUrl: logoToSet },
      });
      console.log(`Updated "${row.name}" (${row.slug})`);
      console.log(`  logoUrl = ${logoToSet}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
