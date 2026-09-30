import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMember, createStoreItem, createVariant } from "./fixtures";
import { foundationTestDatabaseUrl } from "./local-url";
import {
  disconnectShopifyConnection,
  persistShopifyInstall,
} from "../shopify/connection";
import {
  assertShopifyInventoryItemGid,
  assertShopifyProductGid,
  assertShopifyProductVariantGid,
  isShopifyInventoryItemGid,
  isShopifyProductGid,
  isShopifyProductVariantGid,
  ShopifyGidValidationError,
} from "../shopify/gids";
import {
  createShopifyListingMapping,
  lookupShopifyListingByProductId,
  lookupShopifyListingByStoreItem,
  lookupShopifyVariantByInventoryItem,
  lookupShopifyVariantByRemoteVariant,
  lookupShopifyVariantByStoreVariant,
  ShopifyMappingConflictError,
} from "../shopify/mapping";

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

async function activeConnection(memberId: string, shop = `map-${memberId.slice(-8)}.myshopify.com`) {
  return persistShopifyInstall(prisma, {
    memberId,
    shopDomain: shop,
    shopId: `gid://shopify/Shop/${memberId.replace(/\D/g, "").slice(0, 8) || "9001"}`,
    accessTokenEncrypted: "cipher-access",
    refreshTokenEncrypted: "cipher-refresh",
    accessTokenExpiresAt: new Date("2026-09-24T02:00:00Z"),
    refreshTokenExpiresAt: new Date("2026-12-23T00:00:00Z"),
    grantedScopes: "write_products,write_inventory,read_orders,read_locations",
    primaryLocationId: "gid://shopify/Location/1",
  });
}

function productGid(n: number | string) {
  return `gid://shopify/Product/${n}`;
}
function variantGid(n: number | string) {
  return `gid://shopify/ProductVariant/${n}`;
}
function inventoryGid(n: number | string) {
  return `gid://shopify/InventoryItem/${n}`;
}

describe("shopify mapping GIDs", () => {
  it("accepts only canonical Product, ProductVariant, and InventoryItem GIDs", () => {
    expect(isShopifyProductGid(productGid(1))).toBe(true);
    expect(isShopifyProductVariantGid(variantGid(2))).toBe(true);
    expect(isShopifyInventoryItemGid(inventoryGid(3))).toBe(true);
    expect(isShopifyProductGid(variantGid(1))).toBe(false);
    expect(isShopifyProductVariantGid(productGid(1))).toBe(false);
    expect(isShopifyInventoryItemGid("https://shopify.com/InventoryItem/1")).toBe(false);
    expect(isShopifyProductGid("")).toBe(false);
    expect(() => assertShopifyProductGid(variantGid(9))).toThrow(ShopifyGidValidationError);
    expect(() => assertShopifyProductVariantGid(inventoryGid(9))).toThrow(ShopifyGidValidationError);
    expect(() => assertShopifyInventoryItemGid(productGid(9))).toThrow(ShopifyGidValidationError);
  });
});

describe("shopify mapping foundation", () => {
  it("creates, idempotently retries, and fails closed on conflicts", async () => {
    const seller = await createMember(prisma, "map-a");
    const other = await createMember(prisma, "map-b");
    const item = await createStoreItem(prisma, seller.id, "Mapped item");
    const variantA = await createVariant(prisma, {
      memberId: seller.id,
      storeItemId: item.id,
      isDefault: true,
      sku: "SKU-A",
    });
    const variantB = await createVariant(prisma, {
      memberId: seller.id,
      storeItemId: item.id,
      sku: "SKU-B",
    });
    const otherItem = await createStoreItem(prisma, seller.id, "Other item");
    const otherVariant = await createVariant(prisma, {
      memberId: seller.id,
      storeItemId: otherItem.id,
      isDefault: true,
    });
    const foreignItem = await createStoreItem(prisma, other.id, "Foreign item");
    const foreignVariant = await createVariant(prisma, {
      memberId: other.id,
      storeItemId: foreignItem.id,
      isDefault: true,
    });

    const lonelyItem = await createStoreItem(prisma, seller.id, "Lonely");
    const lonelyVariant = await createVariant(prisma, {
      memberId: seller.id,
      storeItemId: lonelyItem.id,
      isDefault: true,
    });

    const connection = await activeConnection(seller.id);
    const otherConnection = await activeConnection(other.id, `other-${other.id.slice(-6)}.myshopify.com`);
    const beforeVariants = await prisma.storeVariant.count();
    const beforeStates = await prisma.inventoryState.count();
    const beforeEvents = await prisma.inventoryEvent.count();
    const beforeOrders = await prisma.storeOrder.count();
    const beforeListingLinks = await prisma.shopifyListingLink.count();
    const beforeVariantMaps = await prisma.shopifyVariantMap.count();

    const created = await createShopifyListingMapping(prisma, {
      memberId: seller.id,
      connectionId: connection.id,
      storeItemId: item.id,
      shopifyProductId: productGid(1001),
      variants: [
        {
          storeVariantId: variantA.id,
          shopifyVariantId: variantGid(2001),
          shopifyInventoryItemId: inventoryGid(3001),
        },
        {
          storeVariantId: variantB.id,
          shopifyVariantId: variantGid(2002),
          shopifyInventoryItemId: inventoryGid(3002),
        },
      ],
    });
    expect(created.listingLink.shopifyProductId).toBe(productGid(1001));
    expect(created.variantMaps).toHaveLength(2);

    const retry = await createShopifyListingMapping(prisma, {
      memberId: seller.id,
      connectionId: connection.id,
      storeItemId: item.id,
      shopifyProductId: productGid(1001),
      variants: [
        {
          storeVariantId: variantB.id,
          shopifyVariantId: variantGid(2002),
          shopifyInventoryItemId: inventoryGid(3002),
        },
        {
          storeVariantId: variantA.id,
          shopifyVariantId: variantGid(2001),
          shopifyInventoryItemId: inventoryGid(3001),
        },
      ],
    });
    expect(retry.listingLink.id).toBe(created.listingLink.id);
    expect(await prisma.shopifyListingLink.count({ where: { shopifyConnectionId: connection.id } })).toBe(1);
    expect(await prisma.shopifyVariantMap.count({ where: { shopifyConnectionId: connection.id } })).toBe(2);

    await expect(
      createShopifyListingMapping(prisma, {
        memberId: seller.id,
        connectionId: connection.id,
        storeItemId: item.id,
        shopifyProductId: productGid(1999),
        variants: [
          {
            storeVariantId: variantA.id,
            shopifyVariantId: variantGid(2001),
            shopifyInventoryItemId: inventoryGid(3001),
          },
        ],
      })
    ).rejects.toBeInstanceOf(ShopifyMappingConflictError);

    await expect(
      createShopifyListingMapping(prisma, {
        memberId: seller.id,
        connectionId: connection.id,
        storeItemId: otherItem.id,
        shopifyProductId: productGid(1001),
        variants: [
          {
            storeVariantId: otherVariant.id,
            shopifyVariantId: variantGid(2100),
            shopifyInventoryItemId: inventoryGid(3100),
          },
        ],
      })
    ).rejects.toBeInstanceOf(ShopifyMappingConflictError);

    await expect(
      createShopifyListingMapping(prisma, {
        memberId: seller.id,
        connectionId: connection.id,
        storeItemId: otherItem.id,
        shopifyProductId: productGid(1002),
        variants: [
          {
            storeVariantId: otherVariant.id,
            shopifyVariantId: variantGid(2001),
            shopifyInventoryItemId: inventoryGid(3101),
          },
        ],
      })
    ).rejects.toBeInstanceOf(ShopifyMappingConflictError);

    await expect(
      createShopifyListingMapping(prisma, {
        memberId: seller.id,
        connectionId: connection.id,
        storeItemId: otherItem.id,
        shopifyProductId: productGid(1003),
        variants: [
          {
            storeVariantId: otherVariant.id,
            shopifyVariantId: variantGid(2102),
            shopifyInventoryItemId: inventoryGid(3001),
          },
        ],
      })
    ).rejects.toBeInstanceOf(ShopifyMappingConflictError);

    await expect(
      createShopifyListingMapping(prisma, {
        memberId: seller.id,
        connectionId: connection.id,
        storeItemId: item.id,
        shopifyProductId: variantGid(1),
        variants: [
          {
            storeVariantId: variantA.id,
            shopifyVariantId: variantGid(1),
            shopifyInventoryItemId: inventoryGid(1),
          },
        ],
      })
    ).rejects.toMatchObject({ code: "INVALID_SHOPIFY_GID" });

    await expect(
      createShopifyListingMapping(prisma, {
        memberId: seller.id,
        connectionId: connection.id,
        storeItemId: item.id,
        shopifyProductId: productGid(1004),
        variants: [
          {
            storeVariantId: otherVariant.id,
            shopifyVariantId: variantGid(2200),
            shopifyInventoryItemId: inventoryGid(3200),
          },
        ],
      })
    ).rejects.toMatchObject({ code: "STORE_VARIANT_NOT_FOUND" });

    await expect(
      createShopifyListingMapping(prisma, {
        memberId: seller.id,
        connectionId: connection.id,
        storeItemId: foreignItem.id,
        shopifyProductId: productGid(1005),
        variants: [
          {
            storeVariantId: foreignVariant.id,
            shopifyVariantId: variantGid(2201),
            shopifyInventoryItemId: inventoryGid(3201),
          },
        ],
      })
    ).rejects.toMatchObject({ code: "STORE_ITEM_NOT_FOUND" });

    await expect(
      createShopifyListingMapping(prisma, {
        memberId: other.id,
        connectionId: connection.id,
        storeItemId: foreignItem.id,
        shopifyProductId: productGid(1006),
        variants: [
          {
            storeVariantId: foreignVariant.id,
            shopifyVariantId: variantGid(2202),
            shopifyInventoryItemId: inventoryGid(3202),
          },
        ],
      })
    ).rejects.toMatchObject({ code: "CONNECTION_NOT_FOUND" });

    const byItem = await lookupShopifyListingByStoreItem(prisma, {
      connectionId: connection.id,
      storeItemId: item.id,
    });
    expect(byItem.status).toBe("MAPPED");
    const byProduct = await lookupShopifyListingByProductId(prisma, {
      connectionId: connection.id,
      shopifyProductId: productGid(1001),
    });
    expect(byProduct.status).toBe("MAPPED");
    const byVariant = await lookupShopifyVariantByStoreVariant(prisma, {
      connectionId: connection.id,
      storeVariantId: variantA.id,
    });
    expect(byVariant.status).toBe("MAPPED");
    const byRemote = await lookupShopifyVariantByRemoteVariant(prisma, {
      connectionId: connection.id,
      shopifyVariantId: variantGid(2002),
    });
    expect(byRemote.status).toBe("MAPPED");
    const byInventory = await lookupShopifyVariantByInventoryItem(prisma, {
      connectionId: connection.id,
      shopifyInventoryItemId: inventoryGid(3001),
    });
    expect(byInventory.status).toBe("MAPPED");
    expect(
      (
        await lookupShopifyListingByStoreItem(prisma, {
          connectionId: connection.id,
          storeItemId: otherItem.id,
        })
      ).status
    ).toBe("UNMAPPED");

    await disconnectShopifyConnection(prisma, { memberId: seller.id, connectionId: connection.id });
    expect(
      (
        await lookupShopifyListingByStoreItem(prisma, {
          connectionId: connection.id,
          storeItemId: item.id,
        })
      ).status
    ).toBe("CONNECTION_INACTIVE");
    await expect(
      createShopifyListingMapping(prisma, {
        memberId: seller.id,
        connectionId: connection.id,
        storeItemId: otherItem.id,
        shopifyProductId: productGid(1007),
        variants: [
          {
            storeVariantId: otherVariant.id,
            shopifyVariantId: variantGid(2300),
            shopifyInventoryItemId: inventoryGid(3300),
          },
        ],
      })
    ).rejects.toMatchObject({ code: "CONNECTION_INACTIVE" });

    const gen2 = await activeConnection(seller.id, connection.shopDomain);
    expect(gen2.generation).toBe(2);
    expect(
      (
        await lookupShopifyListingByStoreItem(prisma, {
          connectionId: gen2.id,
          storeItemId: item.id,
        })
      ).status
    ).toBe("UNMAPPED");
    expect(
      (
        await lookupShopifyListingByProductId(prisma, {
          connectionId: gen2.id,
          shopifyProductId: productGid(1001),
        })
      ).status
    ).toBe("UNMAPPED");
    expect(
      (
        await lookupShopifyVariantByRemoteVariant(prisma, {
          connectionId: gen2.id,
          shopifyVariantId: variantGid(2001),
        })
      ).status
    ).toBe("UNMAPPED");

    const remapped = await createShopifyListingMapping(prisma, {
      memberId: seller.id,
      connectionId: gen2.id,
      storeItemId: item.id,
      shopifyProductId: productGid(5001),
      variants: [
        {
          storeVariantId: variantA.id,
          shopifyVariantId: variantGid(6001),
          shopifyInventoryItemId: inventoryGid(7001),
        },
        {
          storeVariantId: variantB.id,
          shopifyVariantId: variantGid(6002),
          shopifyInventoryItemId: inventoryGid(7002),
        },
      ],
    });
    expect(remapped.listingLink.shopifyConnectionId).toBe(gen2.id);
    expect(remapped.listingLink.shopifyProductId).toBe(productGid(5001));
    expect(
      (
        await prisma.shopifyListingLink.findUniqueOrThrow({
          where: { id: created.listingLink.id },
        })
      ).shopifyProductId
    ).toBe(productGid(1001));

    const raced = await Promise.allSettled([
      createShopifyListingMapping(prisma, {
        memberId: seller.id,
        connectionId: gen2.id,
        storeItemId: otherItem.id,
        shopifyProductId: productGid(8001),
        variants: [
          {
            storeVariantId: otherVariant.id,
            shopifyVariantId: variantGid(9001),
            shopifyInventoryItemId: inventoryGid(9101),
          },
        ],
      }),
      createShopifyListingMapping(prisma, {
        memberId: seller.id,
        connectionId: gen2.id,
        storeItemId: otherItem.id,
        shopifyProductId: productGid(8002),
        variants: [
          {
            storeVariantId: otherVariant.id,
            shopifyVariantId: variantGid(9002),
            shopifyInventoryItemId: inventoryGid(9102),
          },
        ],
      }),
    ]);
    const won = raced.filter((result) => result.status === "fulfilled");
    const lost = raced.filter((result) => result.status === "rejected");
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(1);
    expect((lost[0] as PromiseRejectedResult).reason).toBeInstanceOf(ShopifyMappingConflictError);
    expect(
      await prisma.shopifyListingLink.count({
        where: { shopifyConnectionId: gen2.id, storeItemId: otherItem.id },
      })
    ).toBe(1);
    expect(
      await prisma.shopifyVariantMap.count({
        where: { shopifyConnectionId: gen2.id, storeVariantId: otherVariant.id },
      })
    ).toBe(1);

    // Conflicting product identity fails before any row is written for the new item.
    await expect(
      createShopifyListingMapping(prisma, {
        memberId: seller.id,
        connectionId: gen2.id,
        storeItemId: lonelyItem.id,
        shopifyProductId: productGid(5001),
        variants: [
          {
            storeVariantId: lonelyVariant.id,
            shopifyVariantId: variantGid(9901),
            shopifyInventoryItemId: inventoryGid(9901),
          },
        ],
      })
    ).rejects.toBeInstanceOf(ShopifyMappingConflictError);
    expect(
      await prisma.shopifyListingLink.count({
        where: { shopifyConnectionId: gen2.id, storeItemId: lonelyItem.id },
      })
    ).toBe(0);
    expect(await prisma.shopifyVariantMap.count({ where: { storeVariantId: lonelyVariant.id } })).toBe(0);

    expect(await prisma.storeVariant.count()).toBe(beforeVariants);
    expect(await prisma.inventoryState.count()).toBe(beforeStates);
    expect(await prisma.inventoryEvent.count()).toBe(beforeEvents);
    expect(await prisma.storeOrder.count()).toBe(beforeOrders);
    expect(await prisma.shopifyListingLink.count()).toBeGreaterThan(beforeListingLinks);
    expect(await prisma.shopifyVariantMap.count()).toBeGreaterThan(beforeVariantMaps);
    void otherConnection;
  });
});
