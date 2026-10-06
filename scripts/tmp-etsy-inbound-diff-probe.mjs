import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const require = createRequire(path.join(root, "packages/database/package.json"));
const { PrismaClient } = require("@prisma/client");

function loadEnv(filePath) {
  return Object.fromEntries(
    fs
      .readFileSync(filePath, "utf8")
      .split(/\r?\n/)
      .filter((l) => l && !l.startsWith("#") && l.includes("="))
      .map((l) => {
        const i = l.indexOf("=");
        return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, "")];
      })
  );
}

const env = loadEnv(path.join(root, ".env"));
const prisma = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });

const links = await prisma.$queryRawUnsafe(`
  SELECT
    ell.id AS link_id,
    ell.etsy_listing_id,
    ell.etsy_connection_id,
    ell.member_id,
    si.id AS store_item_id,
    si.title AS inw_title,
    LEFT(COALESCE(si.description,''), 80) AS inw_desc,
    si.price_cents AS inw_price,
    ell.desired_product_content_version AS d,
    ell.applied_product_content_version AS a,
    ell.desired_product_fingerprint AS desired_fp,
    ell.applied_product_fingerprint AS applied_fp,
    ell.last_observed_product_fingerprint AS observed_fp,
    ell.product_content_conflict AS conflict,
    ell.updated_at
  FROM etsy_listing_link ell
  JOIN "StoreItem" si ON si.id = ell.store_item_id
  ORDER BY ell.updated_at DESC
`);
console.log("LINKS_DETAIL", JSON.stringify(links, null, 2));

for (const link of links) {
  const maps = await prisma.$queryRawUnsafe(
    `
    SELECT
      evm.id,
      evm.etsy_offering_id,
      evm.etsy_product_id,
      evm.inventory_desired_available AS inv_d,
      evm.inventory_applied_available AS inv_a,
      evm.inventory_desired_version AS inv_dv,
      evm.inventory_applied_version AS inv_av,
      evm.desired_variant_content_version AS vd,
      evm.applied_variant_content_version AS va,
      evm.desired_variant_fingerprint AS v_desired_fp,
      evm.applied_variant_fingerprint AS v_applied_fp,
      sv.price_cents,
      sv.sku,
      sv.options,
      ist.on_hand,
      ist.reserved
    FROM etsy_variant_map evm
    JOIN "StoreVariant" sv ON sv.id = evm.store_variant_id
    LEFT JOIN inventory_state ist ON ist.variant_id = sv.id
    WHERE evm.etsy_listing_link_id = $1
    ORDER BY evm.created_at ASC
  `,
    link.link_id
  );
  console.log("MAPS", link.inw_title, JSON.stringify(maps, null, 2));
}

const conn = await prisma.etsyConnection.findFirst({
  where: { status: "ACTIVE" },
  select: {
    id: true,
    shopId: true,
    memberId: true,
    lastListingContentPollAt: true,
    listingContentPollCursor: true,
  },
});
console.log("CONN", JSON.stringify(conn, null, 2));

await prisma.$disconnect();
