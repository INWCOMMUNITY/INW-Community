#!/usr/bin/env node
/**
 * Sets the logo for DJs Coins business.
 * Usage: pnpm set-djs-logo
 * Requires: Image at apps/main/public/uploads/djs-coins-logo.png, DATABASE_URL in .env
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // Find DJs Coins business (try name or slug variations)
  const business = await prisma.business.findFirst({
    where: {
      OR: [
        { name: { contains: "DJs Coins", mode: "insensitive" } },
        { name: { contains: "DJs Coins & Collectibles", mode: "insensitive" } },
        { slug: { contains: "djs-coins", mode: "insensitive" } },
        { slug: { contains: "djscoins", mode: "insensitive" } },
      ],
    },
  });

  if (!business) {
    console.error("Could not find DJs Coins business. Available businesses:");
    const all = await prisma.business.findMany({ select: { id: true, name: true, slug: true } });
    console.error(all);
    process.exit(1);
  }

  // Use image at /uploads/djs-coins-logo.png (already copied there)
  const logoUrl = "/uploads/djs-coins-logo.png";

  await prisma.business.update({
    where: { id: business.id },
    data: { logoUrl },
  });

  console.log("Updated DJs Coins logo to:", logoUrl);
  console.log("Business:", business.name, "(", business.slug, ")");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
