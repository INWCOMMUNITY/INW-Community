import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMember } from "./fixtures";
import { foundationTestDatabaseUrl } from "./local-url";
import {
  consumeShopifyOAuthState,
  createShopifyOAuthState,
  disconnectShopifyConnection,
  getShopifyConnectionForMember,
  persistShopifyInstall,
  revokeActiveShopifyConnectionsForShop,
  setShopifyPrimaryLocation,
  ShopifyShopOwnershipConflictError,
} from "../shopify/connection";

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

function installInput(memberId: string, shopDomain: string, token = "ciphertext-access") {
  return {
    memberId,
    shopDomain,
    shopId: "gid://shopify/Shop/99",
    accessTokenEncrypted: token,
    refreshTokenEncrypted: "ciphertext-refresh",
    accessTokenExpiresAt: new Date("2026-09-24T01:00:00Z"),
    refreshTokenExpiresAt: new Date("2026-12-23T00:00:00Z"),
    grantedScopes: "write_products,write_inventory,read_orders,read_locations",
    primaryLocationId: "gid://shopify/Location/1",
  };
}

describe("shopify connection foundation", () => {
  it("enforces generation, one active row, ownership, and no foundation side effects", async () => {
    const sellerA = await createMember(prisma, "shopify-a");
    const sellerB = await createMember(prisma, "shopify-b");
    const shop = `shop-${sellerA.id.slice(-8)}.myshopify.com`;
    const beforeVariants = await prisma.storeVariant.count();
    const beforeEvents = await prisma.inventoryEvent.count();
    const beforeStates = await prisma.inventoryState.count();

    const nonce = "d".repeat(64);
    await createShopifyOAuthState(prisma, {
      nonce,
      memberId: sellerA.id,
      shopDomain: shop,
      browserBindingHash: "a".repeat(64),
      expiresAt: new Date(Date.now() + 60_000),
    });
    await expect(
      consumeShopifyOAuthState(prisma, { nonce, memberId: sellerA.id, shopDomain: shop })
    ).resolves.toBe("ok");
    await expect(
      consumeShopifyOAuthState(prisma, { nonce, memberId: sellerA.id, shopDomain: shop })
    ).resolves.toBe("rejected");

    const expiredNonce = "e".repeat(64);
    await createShopifyOAuthState(prisma, {
      nonce: expiredNonce,
      memberId: sellerA.id,
      shopDomain: shop,
      browserBindingHash: "b".repeat(64),
      expiresAt: new Date(Date.now() - 1000),
    });
    await expect(
      consumeShopifyOAuthState(prisma, { nonce: expiredNonce, memberId: sellerA.id, shopDomain: shop })
    ).resolves.toBe("rejected");

    const first = await persistShopifyInstall(prisma, installInput(sellerA.id, shop, "cipher-1"));
    expect(first.generation).toBe(1);
    expect(first.status).toBe("ACTIVE");
    const stored = await prisma.shopifyConnection.findUniqueOrThrow({ where: { id: first.id } });
    expect(stored.accessTokenEncrypted).toBe("cipher-1");
    expect(stored.accessTokenEncrypted).not.toContain("shpat_");
    expect(stored.shopId).toBe("gid://shopify/Shop/99");

    const second = await persistShopifyInstall(prisma, installInput(sellerA.id, shop, "cipher-2"));
    expect(second.generation).toBe(2);
    expect(second.status).toBe("ACTIVE");
    const historical = await prisma.shopifyConnection.findUniqueOrThrow({ where: { id: first.id } });
    expect(historical.generation).toBe(1);
    expect(historical.status).toBe("DISCONNECTED");
    expect(historical.disconnectedAt).not.toBeNull();

    const activeCount = await prisma.shopifyConnection.count({
      where: { memberId: sellerA.id, shopDomain: shop, status: "ACTIVE" },
    });
    expect(activeCount).toBe(1);

    await expect(
      prisma.shopifyConnection.create({
        data: {
          memberId: sellerA.id,
          shopDomain: shop,
          shopId: "gid://shopify/Shop/99",
          generation: 9,
          accessTokenEncrypted: "cipher-x",
          refreshTokenEncrypted: "cipher-y",
          accessTokenExpiresAt: new Date(),
          refreshTokenExpiresAt: new Date(Date.now() + 86_400_000),
          grantedScopes: "read_products",
          status: "ACTIVE",
          connectedAt: new Date(),
        },
      })
    ).rejects.toThrow();

    const [racedA, racedB] = await Promise.all([
      persistShopifyInstall(prisma, installInput(sellerA.id, shop, "cipher-race-a")),
      persistShopifyInstall(prisma, installInput(sellerA.id, shop, "cipher-race-b")),
    ]);
    const generations = [racedA.generation, racedB.generation].sort((a, b) => a - b);
    expect(generations).toEqual([3, 4]);
    const stillActive = await prisma.shopifyConnection.count({
      where: { memberId: sellerA.id, shopDomain: shop, status: "ACTIVE" },
    });
    expect(stillActive).toBe(1);
    const history = await prisma.shopifyConnection.count({
      where: { memberId: sellerA.id, shopDomain: shop },
    });
    expect(history).toBe(4);

    expect(await getShopifyConnectionForMember(prisma, sellerB.id, second.id)).toBeNull();
    expect(
      await setShopifyPrimaryLocation(prisma, {
        memberId: sellerB.id,
        connectionId: racedA.id,
        locationId: "gid://shopify/Location/5",
      })
    ).toBeNull();
    expect(
      await disconnectShopifyConnection(prisma, { memberId: sellerB.id, connectionId: racedA.id })
    ).toBeNull();

    const active = [racedA, racedB].find((row) => row.status === "ACTIVE") ?? racedB;
    const current = await prisma.shopifyConnection.findFirstOrThrow({
      where: { memberId: sellerA.id, shopDomain: shop, status: "ACTIVE" },
    });
    const disconnected = await disconnectShopifyConnection(prisma, {
      memberId: sellerA.id,
      connectionId: current.id,
    });
    expect(disconnected?.status).toBe("DISCONNECTED");
    const stillThere = await prisma.shopifyConnection.findUnique({ where: { id: current.id } });
    expect(stillThere).not.toBeNull();
    expect(stillThere?.shopId).toBe("gid://shopify/Shop/99");

    const reconnected = await persistShopifyInstall(prisma, installInput(sellerA.id, shop, "cipher-3"));
    expect(reconnected.generation).toBe(history + 1);
    const revoked = await revokeActiveShopifyConnectionsForShop(prisma, shop, new Date("2099-01-01T00:00:00Z"));
    expect(revoked).toBe(1);
    const revokedRow = await prisma.shopifyConnection.findUniqueOrThrow({ where: { id: reconnected.id } });
    expect(revokedRow.status).toBe("REVOKED");
    expect(await prisma.shopifyConnection.count({ where: { memberId: sellerA.id, shopDomain: shop } })).toBe(
      history + 1
    );

    expect(await prisma.storeVariant.count()).toBe(beforeVariants);
    expect(await prisma.inventoryEvent.count()).toBe(beforeEvents);
    expect(await prisma.inventoryState.count()).toBe(beforeStates);
    expect(active.id).toBeTruthy();
  });

  it("allows one global ACTIVE owner and ignores a stale uninstall", async () => {
    const sellerA = await createMember(prisma, "own-a");
    const sellerB = await createMember(prisma, "own-b");
    const shop = `owned-${sellerA.id.slice(-8)}.myshopify.com`;
    const shopId = `gid://shopify/Shop/${sellerA.id.replace(/\D/g, "").slice(0, 8) || "4242"}`;
    const beforeOrders = await prisma.storeOrder.count();

    const first = await persistShopifyInstall(prisma, {
      ...installInput(sellerA.id, shop, "cipher-a"),
      shopId,
      connectedAt: new Date("2026-09-24T12:00:00Z"),
    });
    expect(first.generation).toBe(1);
    expect(first.status).toBe("ACTIVE");

    await expect(
      persistShopifyInstall(prisma, {
        ...installInput(sellerB.id, shop, "cipher-b"),
        shopId: "gid://shopify/Shop/777001",
      })
    ).rejects.toBeInstanceOf(ShopifyShopOwnershipConflictError);
    await expect(
      persistShopifyInstall(prisma, {
        ...installInput(sellerB.id, `other-${sellerB.id.slice(-6)}.myshopify.com`, "cipher-c"),
        shopId,
      })
    ).rejects.toBeInstanceOf(ShopifyShopOwnershipConflictError);

    const stillA = await prisma.shopifyConnection.findUniqueOrThrow({ where: { id: first.id } });
    expect(stillA.status).toBe("ACTIVE");
    expect(stillA.generation).toBe(1);
    expect(stillA.accessTokenEncrypted).toBe("cipher-a");

    const raced = await Promise.allSettled([
      persistShopifyInstall(prisma, {
        ...installInput(sellerA.id, `race-${sellerA.id.slice(-6)}.myshopify.com`, "race-a"),
        shopId: "gid://shopify/Shop/88001",
      }),
      persistShopifyInstall(prisma, {
        ...installInput(sellerB.id, `race-${sellerA.id.slice(-6)}.myshopify.com`, "race-b"),
        shopId: "gid://shopify/Shop/88002",
      }),
    ]);
    const won = raced.filter((result) => result.status === "fulfilled");
    const lost = raced.filter((result) => result.status === "rejected");
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(1);
    expect((lost[0] as PromiseRejectedResult).reason).toBeInstanceOf(ShopifyShopOwnershipConflictError);
    expect(
      await prisma.shopifyConnection.count({
        where: { shopDomain: `race-${sellerA.id.slice(-6)}.myshopify.com`, status: "ACTIVE" },
      })
    ).toBe(1);

    const disconnected = await disconnectShopifyConnection(prisma, {
      memberId: sellerA.id,
      connectionId: first.id,
    });
    expect(disconnected?.status).toBe("DISCONNECTED");
    const second = await persistShopifyInstall(prisma, {
      ...installInput(sellerA.id, shop, "cipher-a2"),
      shopId,
      connectedAt: new Date("2026-09-24T13:00:00Z"),
    });
    expect(second.generation).toBe(2);
    expect(second.status).toBe("ACTIVE");
    expect((await prisma.shopifyConnection.findUniqueOrThrow({ where: { id: first.id } })).status).toBe(
      "DISCONNECTED"
    );

    const stale = await revokeActiveShopifyConnectionsForShop(
      prisma,
      shop,
      new Date("2026-09-24T12:30:00Z")
    );
    expect(stale).toBe(0);
    expect((await prisma.shopifyConnection.findUniqueOrThrow({ where: { id: second.id } })).status).toBe(
      "ACTIVE"
    );

    const current = await revokeActiveShopifyConnectionsForShop(
      prisma,
      shop,
      new Date("2026-09-24T13:00:00Z")
    );
    expect(current).toBe(1);
    expect((await prisma.shopifyConnection.findUniqueOrThrow({ where: { id: second.id } })).status).toBe(
      "REVOKED"
    );
    const replay = await revokeActiveShopifyConnectionsForShop(
      prisma,
      shop,
      new Date("2026-09-24T13:00:00Z")
    );
    expect(replay).toBe(0);
    expect(await prisma.storeOrder.count()).toBe(beforeOrders);
  });
});
