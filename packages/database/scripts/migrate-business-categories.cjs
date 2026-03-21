/**
 * One-time: map existing businesses to v2 primary categories + aligned subcategories.
 * Run: pnpm exec node scripts/migrate-business-categories.cjs
 */
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

/** Match by slug (portable across environments). */
const UPDATES = [
  {
    slug: "boujielashes-tanning",
    name: "BoujieLashes Tanning",
    categories: ["Spa and Massage"],
    subcategories: ["Tanning"],
  },
  {
    slug: "cedar-stone-consulting",
    name: "Cedar & Stone Consulting",
    categories: ["Financial Advisors and Services", "Marketing and Advertising"],
    subcategories: ["Investment Advisory", "Other"],
  },
  {
    slug: "coach-boe",
    name: "Coach Boe",
    categories: ["Fitness and Gym"],
    subcategories: ["Personal Training"],
  },
  {
    slug: "covenant-homes-and-resources",
    name: "Covenant Homes and Resources",
    categories: ["Religious and Nonprofit Org"],
    subcategories: ["Nonprofit Office"],
  },
  {
    slug: "djb-bookkeeping",
    name: "DJB Bookkeeping",
    categories: ["Accounting and Tax Services"],
    subcategories: ["Bookkeeping"],
  },
  {
    slug: "djs-coins-collectibles",
    name: "DJs Coins & Collectibles",
    categories: ["Retail (General Merchandise)"],
    subcategories: ["Hobby"],
  },
  {
    slug: "donivans-vintage",
    name: "Donivans Vintage",
    categories: ["Retail (General Merchandise)"],
    subcategories: ["Thrift and Resale"],
  },
  {
    slug: "dualspan",
    name: "DualSpan",
    categories: ["Handyman"],
    subcategories: ["Aviation Service"],
  },
  {
    slug: "farmhands",
    name: "Farmhands",
    categories: ["Farm and Ranch"],
    subcategories: ["Equipment"],
  },
  {
    slug: "helmszz-deep-ink",
    name: "Helmszz Deep Ink",
    categories: ["Salon and Barbershop"],
    subcategories: ["Tattoo and Body Art"],
  },
  {
    slug: "northwest-community-1",
    name: "Northwest Community",
    categories: ["Marketing and Advertising", "Government and Community"],
    subcategories: ["Digital Marketing", "Community Center"],
  },
  {
    slug: "northwest-community",
    name: "Northwest Community",
    categories: ["Government and Community"],
    subcategories: ["Community Center"],
  },
  {
    slug: "stand-up-closets-garages",
    name: "Stand Up Closets & Garages",
    categories: ["General Contractor", "Retail (General Merchandise)"],
    subcategories: ["Remodel", "Home Goods"],
  },
  {
    slug: "wild-child-socials",
    name: "Wild Child Socials",
    categories: ["Marketing and Advertising"],
    subcategories: ["Digital Marketing"],
  },
];

async function main() {
  for (const u of UPDATES) {
    const row = await prisma.business.findUnique({ where: { slug: u.slug }, select: { id: true, name: true } });
    if (!row) {
      console.warn("Skip missing slug", u.slug, u.name);
      continue;
    }
    await prisma.business.update({
      where: { id: row.id },
      data: {
        categories: u.categories,
        subcategories: u.subcategories,
      },
    });
    console.log("Updated", row.name, "->", u.categories.join(", "));
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
