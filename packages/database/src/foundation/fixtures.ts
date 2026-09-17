import type { PrismaClient } from "@prisma/client";

export type ListingFixture = {
  memberId: string;
  itemId: string;
  variantId: string;
};

let seq = 0;

function nonce(): string {
  seq += 1;
  return `${Date.now().toString(36)}${seq}${Math.random().toString(36).slice(2, 8)}`;
}

export async function createMember(prisma: PrismaClient, label = "m") {
  return prisma.member.create({
    data: {
      email: `${label}-${nonce()}@foundation.test`,
      passwordHash: "test-hash",
      firstName: "Foundation",
      lastName: label,
    },
  });
}

export async function createStoreItem(
  prisma: PrismaClient,
  memberId: string,
  title = "Foundation item"
) {
  return prisma.storeItem.create({
    data: {
      memberId,
      title,
      slug: `foundation-${nonce()}`,
      priceCents: 1000,
      photos: [],
      quantity: 0,
    },
  });
}

export async function createVariant(
  prisma: PrismaClient,
  args: {
    memberId: string;
    storeItemId: string;
    isDefault?: boolean;
    sku?: string | null;
    priceCents?: number;
  }
) {
  return prisma.storeVariant.create({
    data: {
      memberId: args.memberId,
      storeItemId: args.storeItemId,
      isDefault: args.isDefault ?? false,
      sku: args.sku ?? null,
      priceCents: args.priceCents ?? 1000,
      options: {},
    },
  });
}

export async function createListing(
  prisma: PrismaClient,
  opts?: { isDefault?: boolean; title?: string }
): Promise<ListingFixture> {
  const member = await createMember(prisma);
  const item = await createStoreItem(prisma, member.id, opts?.title);
  const variant = await createVariant(prisma, {
    memberId: member.id,
    storeItemId: item.id,
    isDefault: opts?.isDefault ?? true,
  });
  return { memberId: member.id, itemId: item.id, variantId: variant.id };
}

export async function createOrder(
  prisma: PrismaClient,
  args: { buyerId: string; sellerId: string }
) {
  return prisma.storeOrder.create({
    data: {
      buyerId: args.buyerId,
      sellerId: args.sellerId,
      totalCents: 1000,
      subtotalCents: 1000,
    },
  });
}

export function dbCode(err: unknown): string {
  if (err && typeof err === "object" && "code" in err) {
    return String((err as { code: unknown }).code);
  }
  return "";
}

export function dbMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

export function isUniqueViolation(err: unknown): boolean {
  const msg = dbMessage(err);
  return dbCode(err) === "P2002" || msg.includes("23505") || /unique/i.test(msg);
}

export function isFkViolation(err: unknown): boolean {
  const msg = dbMessage(err);
  return dbCode(err) === "P2003" || msg.includes("23503") || /foreign key/i.test(msg);
}

export function isCheckViolation(err: unknown): boolean {
  const msg = dbMessage(err);
  return (
    dbCode(err) === "P2004" ||
    msg.includes("23514") ||
    /check constraint/i.test(msg) ||
    /violates check/i.test(msg)
  );
}

export async function expectRejects(
  action: () => Promise<unknown>,
  kind: "unique" | "fk" | "check" | "restrict"
): Promise<unknown> {
  try {
    await action();
  } catch (err) {
    if (kind === "unique" && isUniqueViolation(err)) return err;
    if (kind === "fk" && isFkViolation(err)) return err;
    if (kind === "check" && isCheckViolation(err)) return err;
    if (kind === "restrict") {
      const msg = dbMessage(err);
      if (isFkViolation(err) || msg.includes("23503") || /restrict|referenced/i.test(msg)) {
        return err;
      }
    }
    throw err;
  }
  throw new Error(`Expected ${kind} rejection, but the write succeeded`);
}
