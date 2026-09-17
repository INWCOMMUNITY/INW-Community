import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createMember,
  createOrder,
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

async function fkDeleteType(conname: string): Promise<string> {
  const rows = await prisma.$queryRaw<Array<{ confdeltype: string; confupdtype: string }>>`
    SELECT confdeltype::text AS confdeltype, confupdtype::text AS confupdtype
    FROM pg_constraint WHERE conname = ${conname}
  `;
  return rows[0] ? `${rows[0].confdeltype}:${rows[0].confupdtype}` : "";
}

describe("Member delete-safety FKs (real PostgreSQL)", () => {
  it("catalog FKs are ON DELETE RESTRICT and ON UPDATE CASCADE", async () => {
    for (const name of [
      "StoreOrder_buyer_id_fkey",
      "StoreOrder_seller_id_fkey",
      "StoreItem_member_id_fkey",
      "SellerBalance_member_id_fkey",
      "SellerBalanceTransaction_member_id_fkey",
    ]) {
      expect(await fkDeleteType(name), name).toBe("r:c");
    }
  });

  it("rejects deleting a StoreOrder buyer while the order remains", async () => {
    const buyer = await createMember(prisma, "fk-buyer");
    const seller = await createMember(prisma, "fk-seller");
    const order = await createOrder(prisma, { buyerId: buyer.id, sellerId: seller.id });
    await expectRejects(() => prisma.member.delete({ where: { id: buyer.id } }), "restrict");
    const still = await prisma.storeOrder.findUnique({ where: { id: order.id } });
    expect(still?.buyerId).toBe(buyer.id);
  });

  it("rejects deleting a StoreOrder seller while the order remains", async () => {
    const buyer = await createMember(prisma, "fk-buyer2");
    const seller = await createMember(prisma, "fk-seller2");
    const order = await createOrder(prisma, { buyerId: buyer.id, sellerId: seller.id });
    await expectRejects(() => prisma.member.delete({ where: { id: seller.id } }), "restrict");
    const still = await prisma.storeOrder.findUnique({ where: { id: order.id } });
    expect(still?.sellerId).toBe(seller.id);
  });

  it("rejects deleting a StoreItem owner while the listing remains", async () => {
    const owner = await createMember(prisma, "fk-owner");
    const item = await createStoreItem(prisma, owner.id);
    await expectRejects(() => prisma.member.delete({ where: { id: owner.id } }), "restrict");
    const still = await prisma.storeItem.findUnique({ where: { id: item.id } });
    expect(still?.memberId).toBe(owner.id);
  });

  it("rejects deleting a Member with SellerBalance history", async () => {
    const seller = await createMember(prisma, "fk-bal");
    await prisma.sellerBalance.create({
      data: { memberId: seller.id, balanceCents: 100 },
    });
    await expectRejects(() => prisma.member.delete({ where: { id: seller.id } }), "restrict");
    const still = await prisma.sellerBalance.findUnique({ where: { memberId: seller.id } });
    expect(still?.balanceCents).toBe(100);
  });

  it("allows physical delete of a no-history Member", async () => {
    const member = await createMember(prisma, "fk-free");
    await prisma.member.delete({ where: { id: member.id } });
    const gone = await prisma.member.findUnique({ where: { id: member.id } });
    expect(gone).toBeNull();
  });
});
