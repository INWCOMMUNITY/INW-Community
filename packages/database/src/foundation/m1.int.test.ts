import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createListing,
  createMember,
  createOrder,
  createStoreItem,
  createVariant,
  expectRejects,
} from "./fixtures";
import { foundationTestDatabaseUrl } from "./local-url";

let prisma: PrismaClient;

beforeAll(() => {
  const url = foundationTestDatabaseUrl();
  prisma = new PrismaClient({
    datasources: { db: { url } },
    log: ["error"],
  });
});

afterAll(async () => {
  await prisma?.$disconnect();
});

describe("M1 commerce foundation (real PostgreSQL)", () => {
  it("A. rejects a second default Variant on the same StoreItem, allows one per item", async () => {
    const listing = await createListing(prisma, { isDefault: true });
    await expectRejects(
      () =>
        createVariant(prisma, {
          memberId: listing.memberId,
          storeItemId: listing.itemId,
          isDefault: true,
        }),
      "unique"
    );
    const other = await createListing(prisma, { isDefault: true, title: "Other listing" });
    expect(other.variantId).toBeTruthy();
    expect(other.itemId).not.toBe(listing.itemId);
  });

  it("B. rejects StoreVariant whose memberId does not own the StoreItem", async () => {
    const owner = await createMember(prisma, "owner");
    const other = await createMember(prisma, "other");
    const item = await createStoreItem(prisma, owner.id);
    await expectRejects(
      () =>
        createVariant(prisma, {
          memberId: other.id,
          storeItemId: item.id,
          isDefault: true,
        }),
      "fk"
    );
  });

  it("C. rejects InventoryState that mixes Variant A with StoreItem B", async () => {
    const a = await createListing(prisma, { title: "Item A" });
    const itemB = await createStoreItem(prisma, a.memberId, "Item B");
    const variantB = await createVariant(prisma, {
      memberId: a.memberId,
      storeItemId: itemB.id,
      isDefault: true,
    });
    expect(variantB.id).toBeTruthy();
    await expectRejects(
      () =>
        prisma.inventoryState.create({
          data: {
            variantId: a.variantId,
            memberId: a.memberId,
            storeItemId: itemB.id,
            mode: "TRACKED_FINITE",
            onHand: 1,
            reserved: 0,
          },
        }),
      "fk"
    );
  });

  it("D. TRACKED_FINITE quantity CHECKs", async () => {
    const listing = await createListing(prisma);
    const valid = await prisma.inventoryState.create({
      data: {
        variantId: listing.variantId,
        memberId: listing.memberId,
        storeItemId: listing.itemId,
        mode: "TRACKED_FINITE",
        onHand: 5,
        reserved: 2,
      },
    });
    expect(valid.onHand).toBe(5);
    expect(valid.reserved).toBe(2);

    const cases: Array<{ onHand: number | null; reserved: number | null }> = [
      { onHand: -1, reserved: 0 },
      { onHand: 1, reserved: -1 },
      { onHand: 1, reserved: 2 },
      { onHand: null, reserved: 0 },
      { onHand: 1, reserved: null },
    ];
    for (const qty of cases) {
      const item = await createStoreItem(prisma, listing.memberId);
      const variant = await createVariant(prisma, {
        memberId: listing.memberId,
        storeItemId: item.id,
        isDefault: true,
      });
      await expectRejects(
        () =>
          prisma.inventoryState.create({
            data: {
              variantId: variant.id,
              memberId: listing.memberId,
              storeItemId: item.id,
              mode: "TRACKED_FINITE",
              onHand: qty.onHand,
              reserved: qty.reserved,
            },
          }),
        "check"
      );
    }
  });

  it("E. MADE_TO_ORDER allows only null quantities", async () => {
    const listing = await createListing(prisma);
    const ok = await prisma.inventoryState.create({
      data: {
        variantId: listing.variantId,
        memberId: listing.memberId,
        storeItemId: listing.itemId,
        mode: "MADE_TO_ORDER",
        onHand: null,
        reserved: null,
      },
    });
    expect(ok.onHand).toBeNull();
    expect(ok.reserved).toBeNull();

    const forbidden: Array<{ onHand: number | null; reserved: number | null }> = [
      { onHand: 999, reserved: 0 },
      { onHand: 0, reserved: 0 },
      { onHand: 1, reserved: null },
      { onHand: null, reserved: 0 },
    ];
    for (const qty of forbidden) {
      const item = await createStoreItem(prisma, listing.memberId);
      const variant = await createVariant(prisma, {
        memberId: listing.memberId,
        storeItemId: item.id,
        isDefault: true,
      });
      await expectRejects(
        () =>
          prisma.inventoryState.create({
            data: {
              variantId: variant.id,
              memberId: listing.memberId,
              storeItemId: item.id,
              mode: "MADE_TO_ORDER",
              onHand: qty.onHand,
              reserved: qty.reserved,
            },
          }),
        "check"
      );
    }
  });

  it("F. InventoryState is 1:1 on variantId", async () => {
    const listing = await createListing(prisma);
    await prisma.inventoryState.create({
      data: {
        variantId: listing.variantId,
        memberId: listing.memberId,
        storeItemId: listing.itemId,
        mode: "TRACKED_FINITE",
        onHand: 1,
        reserved: 0,
      },
    });
    await expectRejects(
      () =>
        prisma.inventoryState.create({
          data: {
            variantId: listing.variantId,
            memberId: listing.memberId,
            storeItemId: listing.itemId,
            mode: "TRACKED_FINITE",
            onHand: 2,
            reserved: 0,
          },
        }),
      "unique"
    );
  });

  it("G. InventoryEvent causal uniqueness; distinct sourceFactId is allowed", async () => {
    const listing = await createListing(prisma);
    const base = {
      memberId: listing.memberId,
      variantId: listing.variantId,
      storeItemId: listing.itemId,
      eventType: "OPENING_BALANCE" as const,
      cause: "SYSTEM_MIGRATION",
      sourceSystem: "inw",
      sourceScope: "backfill",
      sourceFactId: `opening:${listing.variantId}`,
    };
    const first = await prisma.inventoryEvent.create({ data: base });
    expect(first.id).toBeTruthy();
    await expectRejects(() => prisma.inventoryEvent.create({ data: base }), "unique");
    const second = await prisma.inventoryEvent.create({
      data: { ...base, sourceFactId: `opening:${listing.variantId}:retry-distinct` },
    });
    expect(second.id).not.toBe(first.id);
  });

  it("H. sourceScope NULL cannot bypass causal uniqueness", async () => {
    const listing = await createListing(prisma);
    const omitted = await prisma.inventoryEvent.create({
      data: {
        memberId: listing.memberId,
        variantId: listing.variantId,
        storeItemId: listing.itemId,
        eventType: "SET",
        cause: "SELLER",
        sourceSystem: "inw",
        sourceFactId: "cmd-scope-test",
      },
    });
    expect(omitted.sourceScope).toBe("");
    await expectRejects(
      () =>
        prisma.inventoryEvent.create({
          data: {
            memberId: listing.memberId,
            variantId: listing.variantId,
            storeItemId: listing.itemId,
            eventType: "SET",
            cause: "SELLER",
            sourceSystem: "inw",
            sourceScope: "",
            sourceFactId: "cmd-scope-test",
          },
        }),
      "unique"
    );

    await expect(
      prisma.$executeRaw`
        INSERT INTO inventory_event (
          id, member_id, variant_id, store_item_id, event_type, cause,
          source_system, source_scope, source_fact_id
        ) VALUES (
          ${"evt-null-scope"},
          ${listing.memberId},
          ${listing.variantId},
          ${listing.itemId},
          'SET'::inventory_event_type,
          'SELLER',
          'inw',
          NULL,
          'cmd-null-scope'
        )
      `
    ).rejects.toThrow();
  });

  it("I. rejects InventoryEvent mixing Variant A with StoreItem B", async () => {
    const a = await createListing(prisma, { title: "Event A" });
    const itemB = await createStoreItem(prisma, a.memberId, "Event B");
    await createVariant(prisma, {
      memberId: a.memberId,
      storeItemId: itemB.id,
      isDefault: true,
    });
    await expectRejects(
      () =>
        prisma.inventoryEvent.create({
          data: {
            memberId: a.memberId,
            variantId: a.variantId,
            storeItemId: itemB.id,
            eventType: "CORRECTION",
            cause: "ADMIN",
            sourceSystem: "inw",
            sourceFactId: "cross-item-event",
          },
        }),
      "fk"
    );
  });

  it("J. VariantBackfillMap fingerprint and variantId uniqueness", async () => {
    const listing = await createListing(prisma);
    await prisma.variantBackfillMap.create({
      data: {
        storeItemId: listing.itemId,
        memberId: listing.memberId,
        sourceFingerprint: "simple:default",
        variantId: listing.variantId,
      },
    });
    await expectRejects(
      () =>
        prisma.variantBackfillMap.create({
          data: {
            storeItemId: listing.itemId,
            memberId: listing.memberId,
            sourceFingerprint: "simple:default",
            variantId: listing.variantId,
          },
        }),
      "unique"
    );

    const extra = await createVariant(prisma, {
      memberId: listing.memberId,
      storeItemId: listing.itemId,
      isDefault: false,
    });
    await expectRejects(
      () =>
        prisma.variantBackfillMap.create({
          data: {
            storeItemId: listing.itemId,
            memberId: listing.memberId,
            sourceFingerprint: "matrix:color=red",
            variantId: listing.variantId,
          },
        }),
      "unique"
    );
    const otherMap = await prisma.variantBackfillMap.create({
      data: {
        storeItemId: listing.itemId,
        memberId: listing.memberId,
        sourceFingerprint: "matrix:color=red",
        variantId: extra.id,
      },
    });
    expect(otherMap.variantId).toBe(extra.id);
  });

  it("K. OrderItem cannot reference a Variant from another listing; NULL remains allowed", async () => {
    const a = await createListing(prisma, { title: "Order A" });
    const b = await createListing(prisma, { title: "Order B" });
    const buyer = await createMember(prisma, "buyer");
    const order = await createOrder(prisma, { buyerId: buyer.id, sellerId: a.memberId });

    const historical = await prisma.orderItem.create({
      data: {
        orderId: order.id,
        storeItemId: a.itemId,
        quantity: 1,
        priceCentsAtPurchase: 1000,
        variantId: null,
      },
    });
    expect(historical.variantId).toBeNull();

    await expectRejects(
      () =>
        prisma.orderItem.create({
          data: {
            orderId: order.id,
            storeItemId: a.itemId,
            quantity: 1,
            priceCentsAtPurchase: 1000,
            variantId: b.variantId,
          },
        }),
      "fk"
    );

    const linked = await prisma.orderItem.create({
      data: {
        orderId: order.id,
        storeItemId: a.itemId,
        quantity: 1,
        priceCentsAtPurchase: 1000,
        variantId: a.variantId,
      },
    });
    expect(linked.variantId).toBe(a.variantId);
  });

  it("L. CartItem cannot reference a Variant from another listing; NULL remains allowed", async () => {
    const a = await createListing(prisma, { title: "Cart A" });
    const b = await createListing(prisma, { title: "Cart B" });
    const buyer = await createMember(prisma, "cart-buyer");

    const historical = await prisma.cartItem.create({
      data: {
        memberId: buyer.id,
        storeItemId: a.itemId,
        quantity: 1,
        variantId: null,
      },
    });
    expect(historical.variantId).toBeNull();

    await expectRejects(
      () =>
        prisma.cartItem.create({
          data: {
            memberId: buyer.id,
            storeItemId: a.itemId,
            quantity: 1,
            variantId: b.variantId,
          },
        }),
      "fk"
    );
  });

  it("M. Variant delete is RESTRICT while an OrderItem references it", async () => {
    const listing = await createListing(prisma);
    const buyer = await createMember(prisma, "delete-buyer");
    const order = await createOrder(prisma, { buyerId: buyer.id, sellerId: listing.memberId });
    await prisma.orderItem.create({
      data: {
        orderId: order.id,
        storeItemId: listing.itemId,
        quantity: 1,
        priceCentsAtPurchase: 1000,
        variantId: listing.variantId,
      },
    });
    await expectRejects(() => prisma.storeVariant.delete({ where: { id: listing.variantId } }), "restrict");
    const still = await prisma.storeVariant.findUnique({ where: { id: listing.variantId } });
    expect(still).not.toBeNull();
    const line = await prisma.orderItem.findFirst({
      where: { variantId: listing.variantId },
    });
    expect(line).not.toBeNull();
  });

  it("N. StoreItem semantic versions default to 1 and reject values < 1", async () => {
    const member = await createMember(prisma, "ver");
    const item = await createStoreItem(prisma, member.id);
    expect(item.contentVersion).toBe(1);
    expect(item.lifecycleVersion).toBe(1);

    await expect(
      prisma.$executeRaw`
        UPDATE "StoreItem"
        SET content_version = 0
        WHERE id = ${item.id}
      `
    ).rejects.toThrow();
    await expect(
      prisma.$executeRaw`
        UPDATE "StoreItem"
        SET lifecycle_version = 0
        WHERE id = ${item.id}
      `
    ).rejects.toThrow();
  });

  it("catalog: M1 constraints and indexes exist; marketplace v2 migration is absent", async () => {
    const indexes = await prisma.$queryRaw<Array<{ indexname: string }>>`
      SELECT indexname FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname IN (
          'store_variant_one_default_per_item',
          'inventory_event_causal_key',
          'variant_backfill_map_store_item_id_source_fingerprint_key',
          'variant_backfill_map_variant_id_key',
          'store_variant_id_store_item_id_member_id_key'
        )
    `;
    expect(indexes.map((r) => r.indexname).sort()).toEqual([
      "inventory_event_causal_key",
      "store_variant_id_store_item_id_member_id_key",
      "store_variant_one_default_per_item",
      "variant_backfill_map_store_item_id_source_fingerprint_key",
      "variant_backfill_map_variant_id_key",
    ]);

    const checks = await prisma.$queryRaw<Array<{ conname: string }>>`
      SELECT conname FROM pg_constraint
      WHERE contype = 'c'
        AND conname IN (
          'inventory_state_mode_qty_check',
          'StoreItem_content_version_check',
          'StoreItem_lifecycle_version_check'
        )
    `;
    expect(checks.map((r) => r.conname).sort()).toEqual([
      "StoreItem_content_version_check",
      "StoreItem_lifecycle_version_check",
      "inventory_state_mode_qty_check",
    ]);

    const fks = await prisma.$queryRaw<Array<{ conname: string }>>`
      SELECT conname FROM pg_constraint
      WHERE contype = 'f'
        AND conname IN (
          'CartItem_variant_id_store_item_id_fkey',
          'OrderItem_variant_id_store_item_id_fkey',
          'inventory_state_variant_id_store_item_id_member_id_fkey',
          'inventory_event_variant_id_store_item_id_member_id_fkey',
          'store_variant_store_item_id_member_id_fkey'
        )
    `;
    expect(fks.map((r) => r.conname).sort()).toEqual([
      "CartItem_variant_id_store_item_id_fkey",
      "OrderItem_variant_id_store_item_id_fkey",
      "inventory_event_variant_id_store_item_id_member_id_fkey",
      "inventory_state_variant_id_store_item_id_member_id_fkey",
      "store_variant_store_item_id_member_id_fkey",
    ]);

    const m1Tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public'
        AND tablename IN (
          'store_variant', 'inventory_state', 'inventory_event', 'variant_backfill_map',
          'channel_connection', 'sync_job'
        )
    `;
    expect(m1Tables.map((t) => t.tablename).sort()).toEqual([
      "inventory_event",
      "inventory_state",
      "store_variant",
      "variant_backfill_map",
    ]);

    const db = await prisma.$queryRaw<Array<{ current_database: string }>>`
      SELECT current_database()
    `;
    expect(db[0]?.current_database).toBe("inw_foundation_test");
  });
});
