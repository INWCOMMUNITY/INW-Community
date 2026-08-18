/**
 * Backfill linkOrigin + ebayInventoryAspects for existing eBay channel links.
 *
 * Usage: npx tsx apps/main/scripts/backfill-ebay-link-origin.ts [--dry-run] [--limit=50]
 */
import { prisma } from "database";
import { getMemberConnectionContext } from "../src/lib/channels/connection";
import {
  fetchAndCacheEbayInventoryAspects,
} from "../src/lib/channels/ebay/inventory-aspects-cache";
import { inferEbayLinkOrigin } from "../src/lib/channels/ebay/listing-origin";

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const limitArg = process.argv.find((a) => a.startsWith("--limit="));
  const limit = limitArg ? Number(limitArg.split("=")[1]) : 50;

  const links = await prisma.channelListingLink.findMany({
    where: { provider: "ebay" },
    take: limit,
    orderBy: { updatedAt: "asc" },
    select: {
      id: true,
      storeItemId: true,
      connectionId: true,
      externalListingId: true,
      linkOrigin: true,
      storeItem: { select: { memberId: true } },
    },
  });

  console.log(`Found ${links.length} eBay links (limit ${limit}), dryRun=${dryRun}`);

  for (const link of links) {
    const origin = inferEbayLinkOrigin({
      provider: "ebay",
      externalListingId: link.externalListingId,
      storeItemId: link.storeItemId,
      linkOrigin: link.linkOrigin,
    });

    console.log(`Link ${link.id} sku=${link.externalListingId} origin=${origin}`);

    if (dryRun) continue;

    await prisma.channelListingLink.update({
      where: { id: link.id },
      data: { linkOrigin: origin },
    });

    if (origin !== "import") continue;

    const conn = await getMemberConnectionContext(link.storeItem.memberId, "ebay");
    if (!conn) {
      console.warn(`  skip: no eBay connection for member`);
      continue;
    }

    try {
      await fetchAndCacheEbayInventoryAspects(conn.accessToken, link.id, link.externalListingId);
      console.log(`  cached inventory aspects`);
    } catch (e) {
      console.warn(`  failed to cache aspects:`, e instanceof Error ? e.message : String(e));
    }
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
