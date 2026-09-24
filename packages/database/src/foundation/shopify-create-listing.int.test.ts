import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMember, createStoreItem, createVariant } from "./fixtures";
import { foundationTestDatabaseUrl } from "./local-url";
import {
  disconnectShopifyConnection,
  persistShopifyInstall,
} from "../shopify/connection";
import { createShopifyListingMapping } from "../shopify/mapping";
import { enqueueShopifySyncJob } from "../shopify/jobs";

// Provider handler is unit-tested in apps/main; this covers durable job dedupe + mapping.

let prisma: PrismaClient;

beforeAll(() => {
  prisma = new PrismaClient({
    datasources: { db: { url: foundationTestDatabaseUrl() } },
    log: ["error"],
  });
});

afterAll(async () => {
  await prisma?.$disconnect();
});

async function activeConnection(
  memberId: string,
  shop: string,
  connectedAt: Date,
  shopId: string,
  locationId: string | null = "gid://shopify/Location/1"
) {
  return persistShopifyInstall(prisma, {
    memberId,
    shopDomain: shop,
    shopId,
    accessTokenEncrypted: "cipher-access",
    refreshTokenEncrypted: "cipher-refresh",
    accessTokenExpiresAt: new Date("2026-09-24T02:00:00Z"),
    refreshTokenExpiresAt: new Date("2026-12-23T00:00:00Z"),
    grantedScopes: "write_products,write_inventory,read_orders,read_locations",
    primaryLocationId: locationId,
    connectedAt,
  });
}

describe("shopify CREATE_LISTING foundation", () => {
  it("dedupes create jobs and maps only under the current generation", async () => {
    const seller = await createMember(prisma, "s4");
    const other = await createMember(prisma, "s4o");
    const shop = `s4-${seller.id.slice(-8)}.myshopify.com`;
    const shopId = `gid://shopify/Shop/${seller.id.replace(/\D/g, "").slice(0, 8) || "5501"}`;
    const item = await createStoreItem(prisma, seller.id, "S4 Item");
    const variant = await createVariant(prisma, {
      memberId: seller.id,
      storeItemId: item.id,
      isDefault: true,
      sku: "S4-SKU",
    });
    const multi = await createStoreItem(prisma, seller.id, "Multi");
    await createVariant(prisma, { memberId: seller.id, storeItemId: multi.id, isDefault: true });
    await createVariant(prisma, { memberId: seller.id, storeItemId: multi.id });
    const foreign = await createStoreItem(prisma, other.id, "Foreign");
    await createVariant(prisma, {
      memberId: other.id,
      storeItemId: foreign.id,
      isDefault: true,
    });

    const beforeStates = await prisma.inventoryState.count();
    const beforeEvents = await prisma.inventoryEvent.count();
    const beforeOrders = await prisma.storeOrder.count();

    const noLoc = await activeConnection(
      seller.id,
      `noloc-${seller.id.slice(-6)}.myshopify.com`,
      new Date("2026-09-24T11:00:00Z"),
      `gid://shopify/Shop/55${seller.id.replace(/\D/g, "").slice(0, 4) || "01"}`,
      null
    );
    expect(noLoc.primaryLocationId).toBeNull();

    await disconnectShopifyConnection(prisma, {
      memberId: seller.id,
      connectionId: noLoc.id,
    });

    const gen1 = await activeConnection(
      seller.id,
      shop,
      new Date("2026-09-24T12:00:00Z"),
      shopId
    );

    const dedupeKey = `CREATE_LISTING:${gen1.id}:${item.id}`;
    const payload = { storeItemId: item.id, storeVariantId: variant.id };
    const [a, b] = await Promise.all([
      enqueueShopifySyncJob(prisma, {
        shopifyConnectionId: gen1.id,
        kind: "CREATE_LISTING",
        dedupeKey,
        payload,
      }),
      enqueueShopifySyncJob(prisma, {
        shopifyConnectionId: gen1.id,
        kind: "CREATE_LISTING",
        dedupeKey,
        payload,
      }),
    ]);
    expect(a.id).toBe(b.id);
    expect(await prisma.shopifySyncJob.count({ where: { dedupeKey } })).toBe(1);
    expect(a.shopifyConnectionId).toBe(gen1.id);
    expect(JSON.stringify(a.payload)).not.toMatch(/shpat_|shprt_|token|secret/i);

    await createShopifyListingMapping(prisma, {
      memberId: seller.id,
      connectionId: gen1.id,
      storeItemId: item.id,
      shopifyProductId: "gid://shopify/Product/100",
      variants: [
        {
          storeVariantId: variant.id,
          shopifyVariantId: "gid://shopify/ProductVariant/200",
          shopifyInventoryItemId: "gid://shopify/InventoryItem/300",
        },
      ],
    });
    expect(await prisma.shopifyListingLink.count({ where: { shopifyConnectionId: gen1.id } })).toBe(1);
    expect(await prisma.shopifyVariantMap.count({ where: { shopifyConnectionId: gen1.id } })).toBe(1);

    await disconnectShopifyConnection(prisma, {
      memberId: seller.id,
      connectionId: gen1.id,
    });
    const gen2 = await activeConnection(
      seller.id,
      shop,
      new Date("2026-09-24T14:00:00Z"),
      shopId
    );
    expect(gen2.generation).toBe(2);

    // Old-generation mapping must not block a new CREATE_LISTING job under gen2.
    const gen2Job = await enqueueShopifySyncJob(prisma, {
      shopifyConnectionId: gen2.id,
      kind: "CREATE_LISTING",
      dedupeKey: `CREATE_LISTING:${gen2.id}:${item.id}`,
      payload,
    });
    expect(gen2Job.shopifyConnectionId).toBe(gen2.id);
    expect(gen2Job.dedupeKey).not.toBe(dedupeKey);

    await createShopifyListingMapping(prisma, {
      memberId: seller.id,
      connectionId: gen2.id,
      storeItemId: item.id,
      shopifyProductId: "gid://shopify/Product/101",
      variants: [
        {
          storeVariantId: variant.id,
          shopifyVariantId: "gid://shopify/ProductVariant/201",
          shopifyInventoryItemId: "gid://shopify/InventoryItem/301",
        },
      ],
    });
    expect(
      await prisma.shopifyListingLink.count({
        where: { storeItemId: item.id, shopifyConnectionId: gen1.id },
      })
    ).toBe(1);
    expect(
      await prisma.shopifyListingLink.count({
        where: { storeItemId: item.id, shopifyConnectionId: gen2.id },
      })
    ).toBe(1);

    await expect(
      createShopifyListingMapping(prisma, {
        memberId: seller.id,
        connectionId: gen2.id,
        storeItemId: item.id,
        shopifyProductId: "gid://shopify/Product/999",
        variants: [
          {
            storeVariantId: variant.id,
            shopifyVariantId: "gid://shopify/ProductVariant/201",
            shopifyInventoryItemId: "gid://shopify/InventoryItem/301",
          },
        ],
      })
    ).rejects.toBeTruthy();

    expect(await prisma.inventoryState.count()).toBe(beforeStates);
    expect(await prisma.inventoryEvent.count()).toBe(beforeEvents);
    expect(await prisma.storeOrder.count()).toBe(beforeOrders);
    void multi;
    void foreign;
  });
});
