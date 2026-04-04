/**
 * Re-fetch a business's current logoUrl, letterbox to 1:1 (white padding), upload, update DB.
 *
 * Default target: slug `marine-rescue-cda` (Marine Rescue CDA). Override with first CLI arg.
 *
 * From repo root (needs DATABASE_URL + BLOB_READ_WRITE_TOKEN in .env for prod blob uploads):
 *   pnpm --filter main exec node scripts/reletterbox-business-logo.cjs
 *   pnpm --filter main exec node scripts/reletterbox-business-logo.cjs -- some-other-slug
 *
 * Optional: LETTERBOX_SITE_ORIGIN=https://www.inwcommunity.com when logoUrl is a relative path.
 */

const path = require("path");
const fs = require("fs");
const fsPromises = require("fs/promises");

if (process.env.SEED_DATABASE_URL && !process.env.DATABASE_URL) {
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

const scriptDir = __dirname;
const mainPackageRoot = path.resolve(scriptDir, "..");
const databasePackageRoot = path.resolve(scriptDir, "..", "..", "..", "packages", "database");

function requireFrom(paths, name) {
  return require(require.resolve(name, { paths }));
}

const { PrismaClient } = requireFrom([databasePackageRoot], "@prisma/client");
const sharp = requireFrom([mainPackageRoot], "sharp");
const { put } = requireFrom([mainPackageRoot], "@vercel/blob");

const LOGO_MAX_EDGE = 2048;
const LOGO_PAD = { r: 255, g: 255, b: 255, alpha: 1 };

const DEFAULT_SLUG = "marine-rescue-cda";

function siteOrigin() {
  const raw =
    process.env.LETTERBOX_SITE_ORIGIN ||
    process.env.NEXTAUTH_URL ||
    "https://www.inwcommunity.com";
  return raw.replace(/\/$/, "");
}

/** Strip Wix `/v1/...` transforms so we fetch full-resolution media. */
function wixOriginalMediaUrl(url) {
  if (!url || typeof url !== "string") return url;
  if (!url.includes("static.wixstatic.com/media")) return url;
  const v1 = url.indexOf("/v1/");
  if (v1 === -1) return url;
  return url.slice(0, v1);
}

function resolveFetchUrl(logoUrl) {
  const cleaned = wixOriginalMediaUrl(logoUrl.trim());
  if (cleaned.startsWith("http://") || cleaned.startsWith("https://")) return cleaned;
  if (cleaned.startsWith("//")) return `https:${cleaned}`;
  const o = siteOrigin();
  return `${o}${cleaned.startsWith("/") ? "" : "/"}${cleaned}`;
}

async function padBusinessLogoToSquareJpeg(input) {
  const { data, info } = await sharp(input)
    .rotate()
    .resize(LOGO_MAX_EDGE, LOGO_MAX_EDGE, {
      fit: "inside",
      withoutEnlargement: true,
    })
    .flatten({ background: LOGO_PAD })
    .toBuffer({ resolveWithObject: true });

  const w = info.width;
  const h = info.height;
  if (!w || !h) throw new Error("Invalid image dimensions");

  const side = Math.max(w, h);
  const top = Math.floor((side - h) / 2);
  const bottom = side - h - top;
  const left = Math.floor((side - w) / 2);
  const right = side - w - left;

  return sharp(data)
    .extend({
      top,
      bottom,
      left,
      right,
      background: LOGO_PAD,
    })
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer();
}

function parseSlugArg() {
  const argv = process.argv.slice(2);
  const dash = argv.indexOf("--");
  const rest = dash === -1 ? argv : argv.slice(dash + 1);
  const slug = (rest[0] || DEFAULT_SLUG).trim();
  return slug || DEFAULT_SLUG;
}

async function main() {
  const slug = parseSlugArg();

  if (!process.env.DATABASE_URL) {
    console.error("Missing DATABASE_URL.");
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    const business = await prisma.business.findUnique({
      where: { slug },
      select: {
        id: true,
        name: true,
        slug: true,
        memberId: true,
        logoUrl: true,
      },
    });

    if (!business) {
      console.error(`No business with slug "${slug}".`);
      const hints = await prisma.business.findMany({
        where: {
          OR: [
            { name: { contains: "Marine", mode: "insensitive" } },
            { name: { contains: "Rescue", mode: "insensitive" } },
          ],
        },
        select: { slug: true, name: true },
        take: 15,
      });
      if (hints.length) {
        console.error("Possible matches:");
        for (const h of hints) console.error(`  ${h.slug} — ${h.name}`);
      }
      process.exit(1);
    }

    const logoUrl = business.logoUrl?.trim();
    if (!logoUrl) {
      console.error(`"${business.name}" has no logoUrl to reprocess.`);
      process.exit(1);
    }

    const fetchUrl = resolveFetchUrl(logoUrl);
    console.log(`Fetching: ${fetchUrl}`);

    const res = await fetch(fetchUrl, {
      headers: {
        "User-Agent": "INW-reletterbox-script/1.0",
        ...(fetchUrl.includes("inwcommunity.com")
          ? { Referer: "https://www.inwcommunity.com/" }
          : {}),
      },
    });
    if (!res.ok) {
      console.error(`Fetch failed ${res.status} ${res.statusText}`);
      process.exit(1);
    }
    const arrayBuffer = await res.arrayBuffer();
    const rawBuffer = Buffer.from(arrayBuffer);

    const outBuffer = await padBusinessLogoToSquareJpeg(rawBuffer);
    const filename = `business/${business.memberId}/reletterbox-${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;

    let newUrl;

    if (process.env.BLOB_READ_WRITE_TOKEN) {
      const blob = await put(filename, outBuffer, {
        access: "public",
        addRandomSuffix: false,
        contentType: "image/jpeg",
      });
      newUrl = blob.url;
      console.log(`Uploaded to blob: ${newUrl}`);
    } else {
      const publicDir = path.join(process.cwd(), "public", "uploads");
      const fullPath = path.join(publicDir, filename);
      await fsPromises.mkdir(path.dirname(fullPath), { recursive: true });
      await fsPromises.writeFile(fullPath, outBuffer);
      newUrl = `/uploads/${filename}`;
      console.log(`Wrote local file: ${newUrl} (no BLOB_READ_WRITE_TOKEN)`);
    }

    await prisma.business.update({
      where: { id: business.id },
      data: { logoUrl: newUrl },
    });

    console.log(`Updated "${business.name}" (${business.slug})`);
    console.log(`  old: ${logoUrl}`);
    console.log(`  new: ${newUrl}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
