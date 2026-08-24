import { beforeEach, describe, expect, it, vi } from "vitest";

const { upsert } = vi.hoisted(() => ({
  upsert: vi.fn().mockResolvedValue({}),
}));

vi.mock("database", () => ({
  prisma: {
    syncTrace: {
      upsert,
      create: vi.fn(),
    },
  },
  Prisma: { JsonNull: null },
}));

import { completeTrace, startTrace } from "./sync-trace";

describe("completeTrace", () => {
  beforeEach(() => {
    upsert.mockClear();
  });

  it("is idempotent so passthrough throw + outer catch cannot unique-fail", async () => {
    const ctx = startTrace("member-1", "ebay", "item-1", "update", { sku: "sku-1" });
    await completeTrace(ctx, "failed");
    await completeTrace(ctx, "failed", new Error("eBay passthrough partial sync: quantity: failed"));
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(ctx.completed).toBe(true);
  });
});
