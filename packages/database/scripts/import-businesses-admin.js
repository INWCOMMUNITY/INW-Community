#!/usr/bin/env node
/**
 * Create Business rows owned by the admin member with adminGrantedAt set (bypasses admin API limits).
 *
 * ADMIN_EMAIL must match Member.email exactly (case-insensitive). That field is the app login id —
 * it does not have to be a real mailbox address (e.g. NWCADMIN57611 is valid if stored that way).
 *
 * Prepare a JSON file (see import-businesses.example.json). Image fields must be full HTTPS URLs
 * (e.g. right‑click image on Wix → "Copy image address" for static.wixstatic.com URLs).
 *
 * If a row includes **slug** and a Business with that slug already exists, the script **updates**
 * that row instead of creating a duplicate (same admin memberId, adminGrantedAt refreshed).
 *
 * **address** is optional (omit or empty string); **city** is required. Use city-only when you do not
 * want the app to show “City, City” from street + city.
 *
 * Usage (from repo root, PowerShell) — paths are relative to repo root:
 *   $env:DATABASE_URL="postgresql://..."
 *   $env:ADMIN_EMAIL="NWCADMIN57611"
 *   pnpm db:import-businesses
 *   # or: node packages/database/scripts/import-businesses-admin.js packages/database/scripts/import-businesses.json
 *
 * If your shell is already in packages/database, use paths relative to that folder only:
 *   node scripts/import-businesses-admin.js scripts/import-businesses.json
 *   (Do not prefix with packages/database/ or the path will be wrong.)
 *
 * Or: IMPORT_BUSINESSES_JSON=path/to/businesses.json node packages/database/scripts/import-businesses-admin.js
 *
 * -----------------------------------------------------------------------------
 * Wix sponsor page → live site (same rules for every business, e.g. DualSpan)
 * -----------------------------------------------------------------------------
 * Sponsor URLs look like: https://www.pnwcommunity.com/sponsors-1/<slug>
 *
 * 1. **slug** — Set JSON `slug` to that `<slug>` segment so re-imports **update** the same row
 *    (no duplicate `slug-1` rows).
 *
 * 2. **Logo** — Use the **page’s top / hero / og:image** for that sponsor (View Source or social
 *    preview image). That is the business creative — not the Northwest Community site favicon or
 *    footer “high quality” mark (`…28de4fc1…` on the shared Wix template).
 *
 * 3. **Cover** — Usually the same hero asset as a wide `coverPhotoUrl` (optional but typical).
 *
 * 4. **Gallery `photos`** — Include every **pro-gallery** image from the sponsor page
 *    (`data-id="…mv2.jpeg"` or `static.wixstatic.com` `img` src). Build `/v1/fill/w_1200,h_800,…`
 *    URLs from the same media id. **Do not** list the same file as the logo in `photos` if it is
 *    only the hero logo — the API also drops any photo whose `/media/…` file matches `logoUrl`.
 *
 * 5. **Location** — **City only** for listings that shouldn’t show “City, City”: `address` empty
 *    string `""`, `city` e.g. `"Spokane"`. Use a street in `address` only when you need it.
 *
 * 6. **Run** — Repo root: `pnpm db:import-businesses`. From `packages/database`: `pnpm run
 *    import-businesses`. Requires `DATABASE_URL` and `ADMIN_EMAIL` in `.env`.
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

function slugify(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

async function uniqueSlug(baseName) {
  let slug = slugify(baseName) || "business";
  let suffix = 0;
  while (await prisma.business.findUnique({ where: { slug } })) {
    slug = `${slugify(baseName)}-${++suffix}`;
  }
  return slug;
}

async function main() {
  const jsonPath =
    process.argv[2] ||
    process.env.IMPORT_BUSINESSES_JSON ||
    path.join(__dirname, "import-businesses.json");
  if (!fs.existsSync(jsonPath)) {
    console.error(`File not found: ${jsonPath}`);
    console.error("Pass path as first argument or set IMPORT_BUSINESSES_JSON.");
    process.exit(1);
  }

  const adminLoginId = (process.env.ADMIN_EMAIL || "").trim();
  if (!adminLoginId) {
    console.error("Set ADMIN_EMAIL in .env to your admin login (same value as Member.email — not required to be a real email).");
    process.exit(1);
  }

  // Member.email holds the login id; match case-insensitively (e.g. NWCADMIN57611 vs nwcadmin57611).
  const member = await prisma.member.findFirst({
    where: { email: { equals: adminLoginId, mode: "insensitive" } },
    select: { id: true, email: true },
  });
  if (!member) {
    console.error(`No Member row with email/login "${adminLoginId}" (case-insensitive).`);
    console.error("Check DATABASE_URL points at the right database. If you ran delete-members-except-universal, recreate admin: pnpm db:seed-admin");
    process.exit(1);
  }

  const raw = fs.readFileSync(jsonPath, "utf8");
  const list = JSON.parse(raw);
  if (!Array.isArray(list)) {
    console.error("JSON root must be an array of business objects.");
    process.exit(1);
  }

  let created = 0;
  let updated = 0;
  for (const row of list) {
    const name = String(row.name || "").trim();
    if (!name) {
      console.warn("Skipping row without name");
      continue;
    }
    const shortDescription = String(row.shortDescription || row.short_description || "").trim();
    const fullDescription = String(row.fullDescription || row.full_description || "").trim();
    if (!shortDescription || !fullDescription) {
      console.warn(`Skipping "${name}": shortDescription and fullDescription required`);
      continue;
    }
    const logoUrl = String(row.logoUrl || row.logo_url || "").trim();
    const addressRaw = String(row.address || "").trim();
    const address = addressRaw || null;
    const city = String(row.city || "").trim();
    if (!logoUrl || !city) {
      console.warn(`Skipping "${name}": logoUrl and city required`);
      continue;
    }
    const categories = Array.isArray(row.categories) ? row.categories.map((c) => String(c).trim()).filter(Boolean) : [];
    if (categories.length < 1 || categories.length > 2) {
      console.warn(`Skipping "${name}": categories must have 1–2 entries`);
      continue;
    }

    const photos = Array.isArray(row.photos) ? row.photos.map((u) => String(u).trim()).filter(Boolean) : [];
    const website = row.website ? String(row.website).trim() || null : null;
    const phone = row.phone != null ? String(row.phone).trim() || null : null;
    const email = row.email != null ? String(row.email).trim() || null : null;
    const coverPhotoUrl = (row.coverPhotoUrl || row.cover_photo_url)
      ? String(row.coverPhotoUrl || row.cover_photo_url).trim() || null
      : null;
    const hoursOfOperation =
      row.hoursOfOperation && typeof row.hoursOfOperation === "object" ? row.hoursOfOperation : undefined;
    const subcategoriesByPrimary =
      row.subcategoriesByPrimary && typeof row.subcategoriesByPrimary === "object"
        ? row.subcategoriesByPrimary
        : {};

    const dataPayload = {
      memberId: member.id,
      name,
      shortDescription,
      fullDescription,
      website,
      phone,
      email,
      logoUrl,
      address,
      city,
      categories,
      subcategoriesByPrimary,
      photos,
      coverPhotoUrl,
      hoursOfOperation,
      adminGrantedAt: new Date(),
      nameApprovalStatus: "approved",
    };

    const wantSlug = row.slug ? String(row.slug).trim() : "";
    if (wantSlug) {
      const existing = await prisma.business.findUnique({ where: { slug: wantSlug } });
      if (existing) {
        await prisma.business.update({
          where: { id: existing.id },
          data: dataPayload,
        });
        console.log(`Updated: ${name} (${wantSlug})`);
        updated++;
        continue;
      }
    }

    let finalSlug;
    if (row.slug) {
      finalSlug = String(row.slug).trim();
    } else {
      finalSlug = await uniqueSlug(name);
    }

    await prisma.business.create({
      data: {
        ...dataPayload,
        slug: finalSlug,
      },
    });
    console.log(`Created: ${name} (${finalSlug})`);
    created++;
  }

  console.log(`Done. Created ${created}, updated ${updated} business(es) for ${member.email}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
