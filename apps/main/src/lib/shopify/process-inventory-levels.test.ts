import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("database", async () => {
  const actual = await vi.importActual<typeof import("database")>("database");
  return {
    ...actual,
    prisma: {
      shopifyConnection: { findUnique: vi.fn() },
      shopifyProviderEvidence: { findFirst: vi.fn(), update: vi.fn() },
    },
    applyShopifyInventoryLevelObservation: vi.fn(),
    markShopifyEvidenceIgnored: vi.fn(),
    assertShopifyInventoryItemGid: actual.assertShopifyInventoryItemGid,
  };
});

import {
  applyShopifyInventoryLevelObservation,
  markShopifyEvidenceIgnored,
  prisma,
} from "database";
import { handleShopifyInventoryLevelsEvidence } from "./process-inventory-levels";

const connection = {
  id: "conn-1",
  memberId: "m1",
  status: "ACTIVE",
  primaryLocationId: "gid://shopify/Location/1",
};

const evidence = {
  id: "ev-1",
  shopifyConnectionId: "conn-1",
  topic: "inventory_levels/update",
  rawBody: JSON.stringify({
    inventory_item_id: 99,
    location_id: 1,
    available: 2,
    admin_graphql_api_id: "gid://shopify/InventoryLevel/1?inventory_item_id=99",
  }),
  processState: "RECEIVED",
};

const claim = {
  id: "job-1",
  shopifyConnectionId: "conn-1",
  kind: "PROCESS_PROVIDER_EVIDENCE" as const,
  dedupeKey: "x",
  evidenceId: "ev-1",
  payload: {},
  payloadHash: "h",
  state: "RUNNING" as const,
  attemptCount: 1,
  maxAttempts: 8,
  leaseOwner: "w",
  leaseToken: "t",
  leaseExpiresAt: new Date("2099-01-01"),
};

describe("inventory_levels WAITING_ORDER recovery", () => {
  beforeEach(() => {
    vi.mocked(prisma.shopifyConnection.findUnique).mockReset();
    vi.mocked(prisma.shopifyProviderEvidence.findFirst).mockReset();
    vi.mocked(prisma.shopifyProviderEvidence.update).mockReset();
    vi.mocked(applyShopifyInventoryLevelObservation).mockReset();
    vi.mocked(markShopifyEvidenceIgnored).mockReset();
  });

  it("retries without finalizing evidence while ORDERS_PAID is pending", async () => {
    vi.mocked(prisma.shopifyConnection.findUnique).mockResolvedValue(connection as never);
    vi.mocked(prisma.shopifyProviderEvidence.findFirst).mockResolvedValue({ id: "ord-pending" } as never);
    vi.mocked(applyShopifyInventoryLevelObservation).mockResolvedValue({
      status: "WAITING_ORDER",
      code: "WAITING_ORDER_CAUSALITY",
    });

    const result = await handleShopifyInventoryLevelsEvidence(claim, evidence as never);
    expect(result).toMatchObject({
      outcome: "RETRY",
      errorCode: "WAITING_ORDER_CAUSALITY",
    });
    expect(prisma.shopifyProviderEvidence.update).not.toHaveBeenCalled();
  });

  it("finalizes evidence after sale-explained observation", async () => {
    vi.mocked(prisma.shopifyConnection.findUnique).mockResolvedValue(connection as never);
    vi.mocked(prisma.shopifyProviderEvidence.findFirst).mockResolvedValue(null);
    vi.mocked(applyShopifyInventoryLevelObservation).mockResolvedValue({
      status: "SALE_EXPLAINED",
    });
    vi.mocked(prisma.shopifyProviderEvidence.update).mockResolvedValue({} as never);

    const result = await handleShopifyInventoryLevelsEvidence(claim, evidence as never);
    expect(result).toEqual({ outcome: "SUCCESS" });
    expect(prisma.shopifyProviderEvidence.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "ev-1" },
        data: expect.objectContaining({ processState: "PROCESSED" }),
      })
    );
  });
});
