import { beforeEach, describe, expect, it, vi } from "vitest";
import { ACTIVE_STORE_RETURN_STATUSES } from "./store-return";

const executeRaw = vi.fn(async () => [{ "?column?": 1 }]);
const findUnique = vi.fn();
const findMany = vi.fn();
const findFirst = vi.fn();
const update = vi.fn();
const create = vi.fn();

const tx = {
  $executeRaw: executeRaw,
  storeOrder: { findUnique },
  storeReturn: { findMany, findFirst, update, create },
};

const prisma = {
  $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
};

describe("convergeCourtesyRefundStoreReturn", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findUnique.mockResolvedValue({ id: "ord1" });
    findMany.mockResolvedValue([]);
    findFirst.mockResolvedValue(null);
  });

  it("locks StoreOrder then creates terminal refunded when none exist", async () => {
    const { convergeCourtesyRefundStoreReturn } = await import("./store-return-courtesy-converge");
    create.mockResolvedValue({
      id: "ret_new",
      orderId: "ord1",
      status: "refunded",
    });

    const result = await convergeCourtesyRefundStoreReturn(prisma as never, {
      storeOrderId: "ord1",
      amountCents: 1200,
    });

    expect(executeRaw).toHaveBeenCalled();
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          orderId: "ord1",
          status: { in: [...ACTIVE_STORE_RETURN_STATUSES] },
        },
      })
    );
    expect(create).toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ok: true, action: "created" });
  });

  it("updates a single requested row instead of creating", async () => {
    const { convergeCourtesyRefundStoreReturn } = await import("./store-return-courtesy-converge");
    findMany.mockResolvedValue([{ id: "ret_req", status: "requested" }]);
    update.mockResolvedValue({ id: "ret_req", status: "refunded" });

    const result = await convergeCourtesyRefundStoreReturn(prisma as never, {
      storeOrderId: "ord1",
      amountCents: 500,
      hintStoreReturnId: "stale_other",
    });

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "ret_req" },
        data: expect.objectContaining({ status: "refunded", requireReturn: false }),
      })
    );
    expect(create).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ok: true, action: "updated" });
  });

  it("fails closed on multiple active returns", async () => {
    const { convergeCourtesyRefundStoreReturn } = await import("./store-return-courtesy-converge");
    findMany.mockResolvedValue([
      { id: "a", status: "requested" },
      { id: "b", status: "awaiting_return" },
    ]);

    const result = await convergeCourtesyRefundStoreReturn(prisma as never, {
      storeOrderId: "ord1",
      amountCents: 500,
    });

    expect(result).toEqual({ ok: false, error: "multiple_active" });
    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("idempotent when refunded already exists", async () => {
    const { convergeCourtesyRefundStoreReturn } = await import("./store-return-courtesy-converge");
    findFirst.mockResolvedValue({ id: "ret_rf", status: "refunded" });

    const result = await convergeCourtesyRefundStoreReturn(prisma as never, {
      storeOrderId: "ord1",
      amountCents: 500,
    });

    expect(result).toMatchObject({ ok: true, action: "already_refunded" });
    expect(create).not.toHaveBeenCalled();
  });
});
