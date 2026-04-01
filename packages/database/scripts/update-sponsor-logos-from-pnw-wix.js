/**
 * Set business logoUrl from the legacy Northwest Community (Wix) sponsor pages.
 * Source: each page's og:image (main sponsor image), stored as original static.wixstatic.com/media/... URLs.
 *
 * Pages:
 * - https://www.pnwcommunity.com/sponsors-1/cedar-%26-stone-consulting
 * - https://www.pnwcommunity.com/sponsors-1/djs-coins-%26-collectibles
 * - https://www.pnwcommunity.com/sponsors-1/coach-boe
 *
 * Run from repo root:
 *   pnpm --filter database run update:pnw-sponsor-logos
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

/** Strip Wix /v1/fill/... transforms; same as apps/main wixOriginalMediaUrl. */
function wixOriginalMediaUrl(url) {
  if (!url || typeof url !== "string") return url;
  if (!url.includes("static.wixstatic.com/media")) return url;
  const v1 = url.indexOf("/v1/");
  if (v1 === -1) return url;
  return url.slice(0, v1);
}

/**
 * og:image from each sponsor page (2026); normalized to stable media URL.
 */
const BY_SLUG = {
  "cedar-stone-consulting": wixOriginalMediaUrl(
    "https://static.wixstatic.com/media/9cc30f_3bacfb80d5314693af72b033177a0c10~mv2.jpeg/v1/fill/w_1563,h_1563,al_c,q_90/IMG_0911.jpeg"
  ),
  "djs-coins-collectibles": wixOriginalMediaUrl(
    "https://static.wixstatic.com/media/2bdd49_547da7a129704e16be9263c35822a2a4~mv2.jpg/v1/fill/w_3557,h_3557,al_c,q_90/0023_22a.jpg"
  ),
  "coach-boe": wixOriginalMediaUrl(
    "https://static.wixstatic.com/media/2bdd49_20681789e7104d3a8d9c795819394858~mv2.jpg/v1/fill/w_788,h_788,al_c,q_85/eeeee861d3be78f34739314f83d3a5f0_edited.jpg"
  ),
};

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("Missing DATABASE_URL. Set it or add to .env at repo root.");
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    for (const [slug, logoUrl] of Object.entries(BY_SLUG)) {
      const row = await prisma.business.findUnique({
        where: { slug },
        select: { id: true, name: true },
      });
      if (!row) {
        console.warn(`Skip: no business with slug "${slug}"`);
        continue;
      }
      await prisma.business.update({
        where: { id: row.id },
        data: { logoUrl },
      });
      console.log(`Updated "${row.name}" (${slug})`);
      console.log(`  logoUrl = ${logoUrl}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
