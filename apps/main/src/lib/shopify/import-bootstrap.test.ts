import { beforeEach, describe, expect, it, vi } from "vitest";
import { reconcileShopifyImportBootstrapSales } from "database";

describe("reconcileShopifyImportBootstrapSales", () => {
  const findMany = vi.fn();
  const updateMany = vi.fn();
  const applySale = vi.fn();
  const db = {
    shopifyOrderLineSaleFact: { findMany, updateMany },
  } as never;

  beforeEach(() => {
    findMany.mockReset();
    updateMany.mockReset();
    applySale.mockReset();
  });

  it("acks definite pre-bootstrap sales and applies post-bootstrap sales (10 → 8 race)", async () => {
    const bootstrapStartedAt = new Date("2026-09-28T12:00:00.000Z");
    findMany.mockResolvedValue([
      {
        id: "fact-pre",
        shopifyOrderId: "gid://shopify/Order/1",
        shopifyLineItemId: "gid://shopify/LineItem/1",
        shopifyVariantId: "gid://shopify/ProductVariant/4",
        paidQuantity: 2,
        evidenceId: "ev-1",
        applyState: "UNMAPPED",
        evidence: { triggeredAt: new Date("2026-09-28T11:59:00.000Z") },
      },
      {
        id: "fact-post",
        shopifyOrderId: "gid://shopify/Order/2",
        shopifyLineItemId: "gid://shopify/LineItem/2",
        shopifyVariantId: "gid://shopify/ProductVariant/4",
        paidQuantity: 2,
        evidenceId: "ev-2",
        applyState: "UNMAPPED",
        evidence: { triggeredAt: new Date("2026-09-28T12:00:30.000Z") },
      },
    ]);
    updateMany.mockResolvedValue({ count: 1 });
    applySale.mockResolvedValue({
      status: "APPLIED",
      factId: "fact-post",
      appliedQuantity: 2,
      inventoryEventId: "evt-1",
    });

    const result = await reconcileShopifyImportBootstrapSales(
      db,
      {
        connectionId: "conn-1",
        memberId: "member-a",
        shopifyVariantId: "gid://shopify/ProductVariant/4",
        bootstrapStartedAt,
      },
      { applySale }
    );

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "fact-pre",
          applyState: { in: ["UNMAPPED", "PENDING", "FAILED"] },
        }),
        data: expect.objectContaining({ applyState: "PRE_BOOTSTRAP_ACKED" }),
      })
    );
    expect(applySale).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        line: expect.objectContaining({
          shopifyOrderId: "gid://shopify/Order/2",
          paidQuantity: 2,
        }),
      })
    );
    expect(result.preBootstrapAcked).toBe(1);
    expect(result.postBootstrapApplied).toBe(1);
  });

  it("does not pre-bootstrap-ack when triggeredAt equals cutoff (oversell guard)", async () => {
    const bootstrapStartedAt = new Date("2026-09-28T12:00:00.000Z");
    findMany.mockResolvedValue([
      {
        id: "fact-eq",
        shopifyOrderId: "gid://shopify/Order/9",
        shopifyLineItemId: "gid://shopify/LineItem/9",
        shopifyVariantId: "gid://shopify/ProductVariant/4",
        paidQuantity: 1,
        evidenceId: "ev-9",
        applyState: "UNMAPPED",
        evidence: { triggeredAt: new Date("2026-09-28T12:00:00.000Z") },
      },
    ]);
    applySale.mockResolvedValue({
      status: "APPLIED",
      factId: "fact-eq",
      appliedQuantity: 1,
      inventoryEventId: "evt-9",
    });

    const result = await reconcileShopifyImportBootstrapSales(
      db,
      {
        connectionId: "conn-1",
        memberId: "member-a",
        shopifyVariantId: "gid://shopify/ProductVariant/4",
        bootstrapStartedAt,
      },
      { applySale }
    );
    expect(updateMany).not.toHaveBeenCalled();
    expect(applySale).toHaveBeenCalled();
    expect(result.postBootstrapApplied).toBe(1);
  });

  it("treats null triggeredAt conservatively by applying SALE", async () => {
    findMany.mockResolvedValue([
      {
        id: "fact-unknown",
        shopifyOrderId: "gid://shopify/Order/3",
        shopifyLineItemId: "gid://shopify/LineItem/3",
        shopifyVariantId: "gid://shopify/ProductVariant/4",
        paidQuantity: 1,
        evidenceId: "ev-3",
        applyState: "UNMAPPED",
        evidence: { triggeredAt: null },
      },
    ]);
    applySale.mockResolvedValue({
      status: "APPLIED",
      factId: "fact-unknown",
      appliedQuantity: 1,
      inventoryEventId: "evt-2",
    });

    const result = await reconcileShopifyImportBootstrapSales(
      db,
      {
        connectionId: "conn-1",
        memberId: "member-a",
        shopifyVariantId: "gid://shopify/ProductVariant/4",
        bootstrapStartedAt: new Date("2026-09-28T12:00:00.000Z"),
      },
      { applySale }
    );
    expect(applySale).toHaveBeenCalled();
    expect(result.postBootstrapApplied).toBe(1);
    expect(result.preBootstrapAcked).toBe(0);
  });

  it("accumulates two post-bootstrap lines and skips non-matching variant identity", async () => {
    findMany.mockResolvedValue([
      {
        id: "fact-a",
        shopifyOrderId: "gid://shopify/Order/10",
        shopifyLineItemId: "gid://shopify/LineItem/10",
        shopifyVariantId: "gid://shopify/ProductVariant/4",
        paidQuantity: 1,
        evidenceId: "ev-10",
        applyState: "UNMAPPED",
        evidence: { triggeredAt: new Date("2026-09-28T12:01:00.000Z") },
      },
      {
        id: "fact-b",
        shopifyOrderId: "gid://shopify/Order/11",
        shopifyLineItemId: "gid://shopify/LineItem/11",
        shopifyVariantId: "gid://shopify/ProductVariant/4",
        paidQuantity: 2,
        evidenceId: "ev-11",
        applyState: "UNMAPPED",
        evidence: { triggeredAt: new Date("2026-09-28T12:02:00.000Z") },
      },
    ]);
    applySale
      .mockResolvedValueOnce({
        status: "APPLIED",
        factId: "fact-a",
        appliedQuantity: 1,
        inventoryEventId: "e1",
      })
      .mockResolvedValueOnce({
        status: "APPLIED",
        factId: "fact-b",
        appliedQuantity: 2,
        inventoryEventId: "e2",
      });

    const result = await reconcileShopifyImportBootstrapSales(
      db,
      {
        connectionId: "conn-1",
        memberId: "member-a",
        shopifyVariantId: "gid://shopify/ProductVariant/4",
        bootstrapStartedAt: new Date("2026-09-28T12:00:00.000Z"),
      },
      { applySale }
    );
    expect(result.postBootstrapApplied).toBe(2);
    expect(applySale).toHaveBeenCalledTimes(2);
  });
});
