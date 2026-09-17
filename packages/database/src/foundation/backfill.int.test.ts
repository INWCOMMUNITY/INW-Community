import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  OPENING_CAUSE,
  OPENING_SOURCE_SCOPE,
  OPENING_SOURCE_SYSTEM,
  SIMPLE_FINGERPRINT,
  openingFactId,
  runFoundationBackfill,
} from "./backfill";
import {
  createMember,
  createOrder,
  createOrderLine,
  createStoreItem,
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

function sizeMatrix(
  rows: Array<{ size: string; qty: number; sku?: string | null; priceCents?: number; photos?: string[] }>
) {
  return {
    axes: [{ name: "Size", values: rows.map((r) => r.size) }],
    skus: rows.map((r) => ({
      options: { Size: r.size },
      quantity: r.qty,
      ...(r.sku !== undefined ? { sku: r.sku } : {}),
      ...(r.priceCents !== undefined ? { priceCents: r.priceCents } : {}),
      ...(r.photos ? { photos: r.photos } : {}),
    })),
  };
}

function legacySnap(item: {
  quantity: number;
  variants: unknown;
  sku: string | null;
  priceCents: number;
  status: string;
  contentVersion: number;
  lifecycleVersion: number;
  updatedAt: Date;
}) {
  return {
    quantity: item.quantity,
    variants: JSON.stringify(item.variants),
    sku: item.sku,
    priceCents: item.priceCents,
    status: item.status,
    contentVersion: item.contentVersion,
    lifecycleVersion: item.lifecycleVersion,
    updatedAt: item.updatedAt.toISOString(),
  };
}

async function counts(storeItemId: string) {
  const [variants, maps, states, events] = await Promise.all([
    prisma.storeVariant.count({ where: { storeItemId } }),
    prisma.variantBackfillMap.count({ where: { storeItemId } }),
    prisma.inventoryState.count({ where: { storeItemId } }),
    prisma.inventoryEvent.count({ where: { storeItemId } }),
  ]);
  return { variants, maps, states, events };
}

describe("commerce foundation backfill engine (real PostgreSQL)", () => {
  it("A. simple TRACKED qty 5 → default Variant, state 5/0, one OPENING_BALANCE, map simple:default", async () => {
    const member = await createMember(prisma, "bf-a");
    const item = await createStoreItem(prisma, member.id, "Simple tracked 5", {
      quantity: 5,
      sku: "SIMPLE-SKU",
      priceCents: 1500,
      photos: ["https://cdn.example/a.jpg"],
    });
    const before = legacySnap(item);
    const report = await runFoundationBackfill(prisma, { storeItemIds: [item.id] });
    expect(report.itemsBackfilled).toBe(1);
    expect(report.simpleVariantsCreated).toBe(1);
    expect(report.openingBalancesCreated).toBe(1);

    const variants = await prisma.storeVariant.findMany({ where: { storeItemId: item.id } });
    expect(variants).toHaveLength(1);
    expect(variants[0].isDefault).toBe(true);
    expect(variants[0].memberId).toBe(member.id);
    expect(variants[0].storeItemId).toBe(item.id);
    expect(variants[0].sku).toBe("SIMPLE-SKU");
    expect(variants[0].priceCents).toBe(1500);
    expect(variants[0].photos).toEqual(["https://cdn.example/a.jpg"]);
    expect(variants[0].options).toEqual({});
    expect(variants[0].status).toBe("ACTIVE");

    const map = await prisma.variantBackfillMap.findUnique({
      where: { storeItemId_sourceFingerprint: { storeItemId: item.id, sourceFingerprint: SIMPLE_FINGERPRINT } },
    });
    expect(map?.variantId).toBe(variants[0].id);
    expect(map?.memberId).toBe(member.id);

    const state = await prisma.inventoryState.findUnique({ where: { variantId: variants[0].id } });
    expect(state?.mode).toBe("TRACKED_FINITE");
    expect(state?.onHand).toBe(5);
    expect(state?.reserved).toBe(0);
    expect(state?.availabilityVersion).toBe(1);
    expect(state?.storeItemId).toBe(item.id);
    expect(state?.memberId).toBe(member.id);

    const events = await prisma.inventoryEvent.findMany({ where: { variantId: variants[0].id } });
    expect(events).toHaveLength(1);
    expect(events[0].eventType).toBe("OPENING_BALANCE");
    expect(events[0].cause).toBe(OPENING_CAUSE);
    expect(events[0].sourceSystem).toBe(OPENING_SOURCE_SYSTEM);
    expect(events[0].sourceScope).toBe(OPENING_SOURCE_SCOPE);
    expect(events[0].sourceFactId).toBe(openingFactId(variants[0].id));
    expect(events[0].requestedQty).toBe(5);
    expect(events[0].appliedOnHandQty).toBe(5);
    expect(events[0].appliedReservedQty).toBe(0);
    expect(events[0].onHandBefore).toBeNull();
    expect(events[0].reservedBefore).toBeNull();
    expect(events[0].onHandAfter).toBe(5);
    expect(events[0].reservedAfter).toBe(0);
    expect(events[0].storeItemId).toBe(item.id);
    expect(events[0].memberId).toBe(member.id);

    const after = legacySnap(await prisma.storeItem.findUniqueOrThrow({ where: { id: item.id } }));
    expect(after).toEqual(before);
  });

  it("B. simple TRACKED qty 0 is a valid opening balance", async () => {
    const member = await createMember(prisma, "bf-b");
    const item = await createStoreItem(prisma, member.id, "Simple tracked 0", { quantity: 0 });
    await runFoundationBackfill(prisma, { storeItemIds: [item.id] });
    const variant = await prisma.storeVariant.findFirstOrThrow({ where: { storeItemId: item.id } });
    const state = await prisma.inventoryState.findUniqueOrThrow({ where: { variantId: variant.id } });
    expect(state.onHand).toBe(0);
    expect(state.reserved).toBe(0);
    const event = await prisma.inventoryEvent.findFirstOrThrow({ where: { variantId: variant.id } });
    expect(event.eventType).toBe("OPENING_BALANCE");
    expect(event.requestedQty).toBe(0);
    expect(event.appliedOnHandQty).toBe(0);
    expect(event.onHandAfter).toBe(0);
  });

  it("C. simple MTO → one Variant, MTO state, no finite opening event", async () => {
    const member = await createMember(prisma, "bf-c");
    const item = await createStoreItem(prisma, member.id, "Simple MTO", {
      quantity: 0,
      inventoryTracking: "made_to_order",
    });
    const report = await runFoundationBackfill(prisma, { storeItemIds: [item.id] });
    expect(report.mtoVariants).toBe(1);
    expect(report.openingBalancesCreated).toBe(0);
    const variant = await prisma.storeVariant.findFirstOrThrow({ where: { storeItemId: item.id } });
    const state = await prisma.inventoryState.findUniqueOrThrow({ where: { variantId: variant.id } });
    expect(state.mode).toBe("MADE_TO_ORDER");
    expect(state.onHand).toBeNull();
    expect(state.reserved).toBeNull();
    expect(await prisma.inventoryEvent.count({ where: { storeItemId: item.id } })).toBe(0);
  });

  it("D. matrix with 3 combinations → 3 Variants, 3 states, row qty preserved, one default", async () => {
    const member = await createMember(prisma, "bf-d");
    const item = await createStoreItem(prisma, member.id, "Matrix 3", {
      quantity: 9,
      variants: sizeMatrix([
        { size: "S", qty: 2, sku: "M-S" },
        { size: "M", qty: 3, sku: "M-M" },
        { size: "L", qty: 4, sku: "M-L" },
      ]),
    });
    const report = await runFoundationBackfill(prisma, { storeItemIds: [item.id] });
    expect(report.matrixVariantsCreated).toBe(3);
    expect(report.openingBalancesCreated).toBe(3);
    const variants = await prisma.storeVariant.findMany({ where: { storeItemId: item.id } });
    expect(variants).toHaveLength(3);
    expect(variants.filter((v) => v.isDefault)).toHaveLength(1);
    expect(await prisma.inventoryState.count({ where: { storeItemId: item.id } })).toBe(3);
    expect(await prisma.variantBackfillMap.count({ where: { storeItemId: item.id } })).toBe(3);
    const bySize = new Map(
      variants.map((v) => [String((v.options as { Size?: string }).Size), v] as const)
    );
    expect(bySize.get("S")?.sku).toBe("M-S");
    expect(bySize.get("M")?.sku).toBe("M-M");
    expect(bySize.get("L")?.sku).toBe("M-L");
    for (const [size, qty] of [
      ["S", 2],
      ["M", 3],
      ["L", 4],
    ] as const) {
      const state = await prisma.inventoryState.findUniqueOrThrow({ where: { variantId: bySize.get(size)!.id } });
      expect(state.onHand).toBe(qty);
      expect(state.reserved).toBe(0);
      expect(state.mode).toBe("TRACKED_FINITE");
    }
  });

  it("E. matrix parent qty divergence is reported; row qty preserved; parent untouched", async () => {
    const member = await createMember(prisma, "bf-e");
    const item = await createStoreItem(prisma, member.id, "Matrix diverge", {
      quantity: 10,
      variants: sizeMatrix([
        { size: "S", qty: 2 },
        { size: "M", qty: 2 },
        { size: "L", qty: 2 },
      ]),
    });
    const before = legacySnap(item);
    const report = await runFoundationBackfill(prisma, { storeItemIds: [item.id] });
    expect(report.itemsBackfilled).toBe(1);
    expect(report.quantityDivergences).toEqual([{ storeItemId: item.id, parentQuantity: 10, matrixSum: 6 }]);
    const states = await prisma.inventoryState.findMany({ where: { storeItemId: item.id } });
    expect(states.map((s) => s.onHand).sort()).toEqual([2, 2, 2]);
    const after = legacySnap(await prisma.storeItem.findUniqueOrThrow({ where: { id: item.id } }));
    expect(after).toEqual(before);
    expect(after.quantity).toBe(10);
  });

  it("F. rerun reuses the same Variant ids with no extra maps/states/OPENING_BALANCE", async () => {
    const member = await createMember(prisma, "bf-f");
    const item = await createStoreItem(prisma, member.id, "Rerun simple", { quantity: 4, sku: "RERUN" });
    await runFoundationBackfill(prisma, { storeItemIds: [item.id] });
    const first = await prisma.storeVariant.findMany({ where: { storeItemId: item.id } });
    const firstIds = first.map((v) => v.id).sort();
    const report = await runFoundationBackfill(prisma, { storeItemIds: [item.id] });
    expect(report.itemsVerified).toBe(1);
    expect(report.itemsBackfilled).toBe(0);
    expect(report.simpleVariantsCreated).toBe(0);
    expect(report.openingBalancesCreated).toBe(0);
    expect(await counts(item.id)).toEqual({ variants: 1, maps: 1, states: 1, events: 1 });
    const secondIds = (await prisma.storeVariant.findMany({ where: { storeItemId: item.id } })).map((v) => v.id).sort();
    expect(secondIds).toEqual(firstIds);
  });

  it("G. duplicate SKU on two matrix rows stays two Variants and is diagnosed", async () => {
    const member = await createMember(prisma, "bf-g");
    const item = await createStoreItem(prisma, member.id, "Dup SKU", {
      quantity: 5,
      variants: sizeMatrix([
        { size: "S", qty: 2, sku: "DUP" },
        { size: "M", qty: 3, sku: "DUP" },
      ]),
    });
    const report = await runFoundationBackfill(prisma, { storeItemIds: [item.id] });
    expect(report.itemsBackfilled).toBe(1);
    expect(report.matrixVariantsCreated).toBe(2);
    expect(report.duplicateSkus).toEqual([
      expect.objectContaining({ storeItemId: item.id, sku: "dup" }),
    ]);
    expect(report.duplicateSkus[0].fingerprints).toHaveLength(2);
    const variants = await prisma.storeVariant.findMany({ where: { storeItemId: item.id } });
    expect(variants).toHaveLength(2);
    expect(variants.map((v) => v.id)[0]).not.toBe(variants.map((v) => v.id)[1]);
    expect(variants.every((v) => v.sku === "DUP")).toBe(true);
  });

  it("H. missing/null SKU still creates a Variant without fabricating a SKU", async () => {
    const member = await createMember(prisma, "bf-h");
    const item = await createStoreItem(prisma, member.id, "No SKU", { quantity: 1, sku: null });
    await runFoundationBackfill(prisma, { storeItemIds: [item.id] });
    const variant = await prisma.storeVariant.findFirstOrThrow({ where: { storeItemId: item.id } });
    expect(variant.sku).toBeNull();
  });

  it("I. duplicate option fingerprint fails the item transaction with no partial writes", async () => {
    const member = await createMember(prisma, "bf-i");
    const item = await createStoreItem(prisma, member.id, "Ambiguous fp", {
      quantity: 4,
      variants: sizeMatrix([
        { size: "M", qty: 2, sku: "A" },
        { size: "m", qty: 2, sku: "B" },
      ]),
    });
    const report = await runFoundationBackfill(prisma, { storeItemIds: [item.id] });
    expect(report.itemsFailed).toBe(1);
    expect(report.ambiguousFingerprints[0]?.storeItemId).toBe(item.id);
    expect(report.ambiguousFingerprints[0]?.code).toBe("AMBIGUOUS_FINGERPRINT");
    expect(await counts(item.id)).toEqual({ variants: 0, maps: 0, states: 0, events: 0 });
  });

  it("J. invalid matrix payload fails safely with no partial writes", async () => {
    const member = await createMember(prisma, "bf-j");
    const item = await createStoreItem(prisma, member.id, "Bad matrix", {
      quantity: 3,
      variants: { notAMatrix: true },
    });
    const report = await runFoundationBackfill(prisma, { storeItemIds: [item.id] });
    expect(report.itemsFailed).toBe(1);
    expect(report.invalidMatrix[0]?.storeItemId).toBe(item.id);
    expect(report.invalidMatrix[0]?.code).toBe("INVALID_MATRIX");
    expect(await counts(item.id)).toEqual({ variants: 0, maps: 0, states: 0, events: 0 });
  });

  it("K. existing map pointing to a missing Variant is a hard error and does not reallocate", async () => {
    const member = await createMember(prisma, "bf-k");
    const item = await createStoreItem(prisma, member.id, "Corrupt map", { quantity: 2 });
    await runFoundationBackfill(prisma, { storeItemIds: [item.id] });
    const map = await prisma.variantBackfillMap.findFirstOrThrow({ where: { storeItemId: item.id } });
    const missingId = map.variantId;
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL session_replication_role = replica`;
      await tx.$executeRaw`DELETE FROM store_variant WHERE id = ${missingId}`;
    });
    expect(await prisma.storeVariant.count({ where: { storeItemId: item.id } })).toBe(0);

    const report = await runFoundationBackfill(prisma, { storeItemIds: [item.id] });
    expect(report.itemsFailed).toBe(1);
    expect(report.inconsistentExisting[0]?.code).toBe("INCONSISTENT_MAP_MISSING_VARIANT");
    expect(await prisma.storeVariant.count({ where: { storeItemId: item.id } })).toBe(0);
    expect(await prisma.storeVariant.count({ where: { id: missingId } })).toBe(0);
    const maps = await prisma.variantBackfillMap.findMany({ where: { storeItemId: item.id } });
    expect(maps).toHaveLength(1);
    expect(maps[0].variantId).toBe(missingId);
  });

  it("L. existing consistent backfill is verified / no-op", async () => {
    const member = await createMember(prisma, "bf-l");
    const item = await createStoreItem(prisma, member.id, "Already backfilled", { quantity: 7 });
    await runFoundationBackfill(prisma, { storeItemIds: [item.id] });
    const report = await runFoundationBackfill(prisma, { storeItemIds: [item.id] });
    expect(report.itemsVerified).toBe(1);
    expect(report.itemsBackfilled).toBe(0);
    expect(report.itemsFailed).toBe(0);
    expect(await counts(item.id)).toEqual({ variants: 1, maps: 1, states: 1, events: 1 });
  });

  it("M. negative simple quantity is rejected and not clamped", async () => {
    const member = await createMember(prisma, "bf-m");
    const item = await createStoreItem(prisma, member.id, "Negative qty", { quantity: -3 });
    const before = item.quantity;
    const report = await runFoundationBackfill(prisma, { storeItemIds: [item.id] });
    expect(report.itemsFailed).toBe(1);
    expect(report.failures[0]?.code).toBe("NEGATIVE_QUANTITY");
    expect(await counts(item.id)).toEqual({ variants: 0, maps: 0, states: 0, events: 0 });
    const after = await prisma.storeItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(after.quantity).toBe(before);
    expect(after.quantity).toBe(-3);
  });

  it("N. explicit MTO with sentinel-looking qty 999 does not copy finite stock", async () => {
    const member = await createMember(prisma, "bf-n");
    const item = await createStoreItem(prisma, member.id, "MTO sentinel", {
      quantity: 999,
      inventoryTracking: "made_to_order",
    });
    const report = await runFoundationBackfill(prisma, { storeItemIds: [item.id] });
    expect(report.mtoVariants).toBe(1);
    expect(report.openingBalancesCreated).toBe(0);
    const variant = await prisma.storeVariant.findFirstOrThrow({ where: { storeItemId: item.id } });
    const state = await prisma.inventoryState.findUniqueOrThrow({ where: { variantId: variant.id } });
    expect(state.mode).toBe("MADE_TO_ORDER");
    expect(state.onHand).toBeNull();
    expect(state.reserved).toBeNull();
    expect(await prisma.inventoryEvent.count({ where: { variantId: variant.id } })).toBe(0);
    const after = await prisma.storeItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(after.quantity).toBe(999);
    expect(after.inventoryTracking).toBe("made_to_order");
  });

  it("O. StoreItem legacy columns are unchanged after a successful backfill", async () => {
    const member = await createMember(prisma, "bf-o");
    const item = await createStoreItem(prisma, member.id, "Legacy freeze", {
      quantity: 8,
      sku: "KEEP-ME",
      priceCents: 2200,
      status: "sold_out",
      variants: [{ name: "Size", options: ["S", "M"] }],
    });
    const before = await prisma.storeItem.findUniqueOrThrow({ where: { id: item.id } });
    await runFoundationBackfill(prisma, { storeItemIds: [item.id] });
    const after = await prisma.storeItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(legacySnap(after)).toEqual(legacySnap(before));
    expect(after.inventoryTracking).toBe(before.inventoryTracking);
    expect(JSON.stringify(after.variants)).toBe(JSON.stringify(before.variants));
  });

  it("P. OrderItem.variantId is not linked by backfill", async () => {
    const member = await createMember(prisma, "bf-p");
    const buyer = await createMember(prisma, "bf-p-buyer");
    const item = await createStoreItem(prisma, member.id, "Order unlink", { quantity: 2 });
    const order = await createOrder(prisma, { buyerId: buyer.id, sellerId: member.id });
    const line = await createOrderLine(prisma, { orderId: order.id, storeItemId: item.id, variantId: null });
    expect(line.variantId).toBeNull();
    await runFoundationBackfill(prisma, { storeItemIds: [item.id] });
    const after = await prisma.orderItem.findUniqueOrThrow({ where: { id: line.id } });
    expect(after.variantId).toBeNull();
    expect(await prisma.storeVariant.count({ where: { storeItemId: item.id } })).toBe(1);
  });

  it("Q. CartItem.variantId is not linked by backfill", async () => {
    const member = await createMember(prisma, "bf-q");
    const item = await createStoreItem(prisma, member.id, "Cart unlink", { quantity: 2 });
    const cart = await prisma.cartItem.create({
      data: { memberId: member.id, storeItemId: item.id, quantity: 1, variantId: null },
    });
    await runFoundationBackfill(prisma, { storeItemIds: [item.id] });
    const after = await prisma.cartItem.findUniqueOrThrow({ where: { id: cart.id } });
    expect(after.variantId).toBeNull();
  });

  it("R. matrix default Variant is deterministic across row order and rerun", async () => {
    const member = await createMember(prisma, "bf-r");
    const matrix = {
      axes: [{ name: "Color", values: ["Red", "Blue"] }],
      skus: [
        { options: { Color: "Red" }, quantity: 1, sku: "RED" },
        { options: { Color: "Blue" }, quantity: 9, sku: "BLUE" },
      ],
    };
    const item = await createStoreItem(prisma, member.id, "Default rule", { quantity: 10, variants: matrix });
    await runFoundationBackfill(prisma, { storeItemIds: [item.id] });
    const first = await prisma.storeVariant.findMany({ where: { storeItemId: item.id } });
    const defaultVariant = first.find((v) => v.isDefault);
    expect(defaultVariant?.sku).toBe("BLUE");
    expect((defaultVariant?.options as { Color?: string }).Color).toBe("Blue");
    const defaultId = defaultVariant!.id;
    await runFoundationBackfill(prisma, { storeItemIds: [item.id] });
    const second = await prisma.storeVariant.findMany({ where: { storeItemId: item.id } });
    expect(second.filter((v) => v.isDefault)).toHaveLength(1);
    expect(second.find((v) => v.isDefault)?.id).toBe(defaultId);
  });

  it("S. InventoryEvent causal uniqueness prevents a duplicate opening event", async () => {
    const member = await createMember(prisma, "bf-s");
    const item = await createStoreItem(prisma, member.id, "Causal unique", { quantity: 1 });
    await runFoundationBackfill(prisma, { storeItemIds: [item.id] });
    const variant = await prisma.storeVariant.findFirstOrThrow({ where: { storeItemId: item.id } });
    await expectRejects(
      () =>
        prisma.inventoryEvent.create({
          data: {
            memberId: member.id,
            variantId: variant.id,
            storeItemId: item.id,
            eventType: "OPENING_BALANCE",
            cause: OPENING_CAUSE,
            sourceSystem: OPENING_SOURCE_SYSTEM,
            sourceScope: OPENING_SOURCE_SCOPE,
            sourceFactId: openingFactId(variant.id),
            requestedQty: 1,
            appliedOnHandQty: 1,
          },
        }),
      "unique"
    );
    expect(await prisma.inventoryEvent.count({ where: { variantId: variant.id } })).toBe(1);
  });

  it("T. one bad StoreItem does not roll back a separately processed good StoreItem", async () => {
    const member = await createMember(prisma, "bf-t");
    const good = await createStoreItem(prisma, member.id, "Good sibling", { quantity: 6 });
    const bad = await createStoreItem(prisma, member.id, "Bad sibling", {
      quantity: 4,
      variants: { notAMatrix: true },
    });
    const report = await runFoundationBackfill(prisma, { storeItemIds: [bad.id, good.id] });
    expect(report.itemsFailed).toBe(1);
    expect(report.itemsBackfilled).toBe(1);
    expect(report.failures[0]?.storeItemId).toBe(bad.id);
    expect(await counts(bad.id)).toEqual({ variants: 0, maps: 0, states: 0, events: 0 });
    expect(await counts(good.id)).toEqual({ variants: 1, maps: 1, states: 1, events: 1 });
  });

  it("legacy single-axis {value,quantity}[] becomes one Variant per option with row qty", async () => {
    const member = await createMember(prisma, "bf-legacy-qty");
    const item = await createStoreItem(prisma, member.id, "Legacy option qty", {
      quantity: 99,
      variants: [
        {
          name: "Size",
          options: [
            { value: "S", quantity: 2, sku: "LEG-S" },
            { value: "M", quantity: 5, sku: "LEG-M" },
          ],
        },
      ],
    });
    const report = await runFoundationBackfill(prisma, { storeItemIds: [item.id] });
    expect(report.itemsBackfilled).toBe(1);
    expect(report.matrixVariantsCreated).toBe(2);
    expect(report.quantityDivergences[0]).toEqual({
      storeItemId: item.id,
      parentQuantity: 99,
      matrixSum: 7,
    });
    const variants = await prisma.storeVariant.findMany({ where: { storeItemId: item.id } });
    expect(variants).toHaveLength(2);
    const bySize = new Map(variants.map((v) => [String((v.options as { Size?: string }).Size), v]));
    expect(bySize.get("S")?.sku).toBe("LEG-S");
    expect((await prisma.inventoryState.findUniqueOrThrow({ where: { variantId: bySize.get("S")!.id } })).onHand).toBe(2);
    expect((await prisma.inventoryState.findUniqueOrThrow({ where: { variantId: bySize.get("M")!.id } })).onHand).toBe(5);
    const after = await prisma.storeItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(after.quantity).toBe(99);
  });

  it("multi-axis legacy option-quantity arrays fail closed without cartesian invention", async () => {
    const member = await createMember(prisma, "bf-legacy-multi");
    const item = await createStoreItem(prisma, member.id, "Legacy two axes qty", {
      quantity: 4,
      variants: [
        { name: "Size", options: [{ value: "S", quantity: 1 }, { value: "M", quantity: 1 }] },
        { name: "Color", options: [{ value: "Red", quantity: 1 }, { value: "Blue", quantity: 1 }] },
      ],
    });
    const report = await runFoundationBackfill(prisma, { storeItemIds: [item.id] });
    expect(report.itemsFailed).toBe(1);
    expect(report.invalidMatrix[0]?.storeItemId).toBe(item.id);
    expect(await counts(item.id)).toEqual({ variants: 0, maps: 0, states: 0, events: 0 });
  });
});
