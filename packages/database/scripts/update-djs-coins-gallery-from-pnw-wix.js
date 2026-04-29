/**
 * Set DJs Coins & Collectibles business gallery from the legacy Northwest Community
 * (Wix) sponsor page: shop webp grid only (no coin hero 547da7a…, no NWC-branded jpgs).
 *
 * Source: https://www.pnwcommunity.com/sponsors-1/djs-coins-%26-collectibles
 *
 * Run from repo root:
 *   pnpm --filter database run update:djs-coins-gallery
 *
 * Requires DATABASE_URL (loads .env from repo root when present).
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

const SLUG = "djs-coins-collectibles";

/** Wix media id used as site logo / hero for this sponsor — omit from gallery. */
const LOGO_MEDIA_SUBSTR = "547da7a129704e16be9263c35822a2a4";

/**
 * Shop gallery only (webp grid from the Wix sponsor page). Omits NWC-branded jpgs and
 * the coin logo asset (547da7a…).
 */
const GALLERY_URLS = [
  "https://static.wixstatic.com/media/2bdd49_1d9f85617ef746b8a490fb0b801e87ce~mv2.webp/v1/fit/w_960,h_960,q_90,enc_avif,quality_auto/2bdd49_1d9f85617ef746b8a490fb0b801e87ce~mv2.webp",
  "https://static.wixstatic.com/media/2bdd49_2fa6bb1636484e0eb2bee8348d7ecd41~mv2.webp/v1/fit/w_960,h_960,q_90,enc_avif,quality_auto/2bdd49_2fa6bb1636484e0eb2bee8348d7ecd41~mv2.webp",
  "https://static.wixstatic.com/media/2bdd49_4ad6fc4507454d819d5f361b2038256b~mv2.webp/v1/fit/w_960,h_960,q_90,enc_avif,quality_auto/2bdd49_4ad6fc4507454d819d5f361b2038256b~mv2.webp",
  "https://static.wixstatic.com/media/2bdd49_4b30e3e892ad4438823a7c8f9afad055~mv2.webp/v1/fit/w_780,h_780,q_90,enc_avif,quality_auto/2bdd49_4b30e3e892ad4438823a7c8f9afad055~mv2.webp",
  "https://static.wixstatic.com/media/2bdd49_99aafbc9303c442f92004ba43e5fe83c~mv2.webp/v1/fit/w_780,h_780,q_90,enc_avif,quality_auto/2bdd49_99aafbc9303c442f92004ba43e5fe83c~mv2.webp",
  "https://static.wixstatic.com/media/2bdd49_9f1fdb0897de4ac091366c2cfdff53f5~mv2.webp/v1/fit/w_960,h_960,q_90,enc_avif,quality_auto/2bdd49_9f1fdb0897de4ac091366c2cfdff53f5~mv2.webp",
  "https://static.wixstatic.com/media/2bdd49_af5e9b51952f4248b54463f80f899912~mv2.webp/v1/fit/w_779,h_782,q_90,enc_avif,quality_auto/2bdd49_af5e9b51952f4248b54463f80f899912~mv2.webp",
  "https://static.wixstatic.com/media/2bdd49_d16bfd51c06e409994284b5c6a9f7f14~mv2.webp/v1/fit/w_960,h_960,q_90,enc_avif,quality_auto/2bdd49_d16bfd51c06e409994284b5c6a9f7f14~mv2.webp",
  "https://static.wixstatic.com/media/2bdd49_dcddd7f7f6b642febe8118f45b232ea9~mv2.webp/v1/fit/w_960,h_960,q_90,enc_avif,quality_auto/2bdd49_dcddd7f7f6b642febe8118f45b232ea9~mv2.webp",
];

const MAX_GALLERY = 12;

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("Missing DATABASE_URL. Set it or add to .env at repo root.");
    process.exit(1);
  }

  const photos = GALLERY_URLS.filter((u) => !u.includes(LOGO_MEDIA_SUBSTR)).slice(
    0,
    MAX_GALLERY
  );

  const prisma = new PrismaClient();
  try {
    const row = await prisma.business.findUnique({
      where: { slug: SLUG },
      select: { id: true, name: true, logoUrl: true },
    });
    if (!row) {
      console.error(`No business with slug "${SLUG}".`);
      process.exit(1);
    }

    const logo = row.logoUrl || "";
    if (logo.includes(LOGO_MEDIA_SUBSTR)) {
      console.log(`Logo uses ${LOGO_MEDIA_SUBSTR}; gallery excludes that asset.`);
    }

    await prisma.business.update({
      where: { id: row.id },
      data: { photos },
    });
    console.log(`Updated gallery for "${row.name}" (${SLUG}): ${photos.length} photos`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
