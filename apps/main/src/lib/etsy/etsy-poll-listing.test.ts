import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("database", async () => {
  const actual = await vi.importActual<typeof import("database")>("database");
  return {
    ...actual,
    prisma: {
      etsyConnection: { findUnique: vi.fn() },
      etsyListingLink: { findMany: vi.fn(), update: vi.fn() },
      storeVariant: { count: vi.fn(), findMany: vi.fn() },
      etsyVariantMap: { count: vi.fn() },
      storeItem: { findFirst: vi.fn() },
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<void>) => fn({})),
    },
    applyEtsyListingContentInbound: vi.fn(),
    applyEtsyListingInventoryInbound: vi.fn(),
    markEtsyListingContentPollComplete: vi.fn(),
    enqueueEtsySyncJob: vi.fn(),
  };
});

vi.mock("./connection-request", () => ({
  etsyConnectionRequest: vi.fn(),
}));

import {
  applyEtsyListingContentInbound,
  markEtsyListingContentPollComplete,
  prisma,
} from "database";
import { etsyConnectionRequest } from "./connection-request";
import { handleEtsyPollListingContentJob } from "./poll-listing-content";

const claim = {
  id: "job-poll",
  etsyConnectionId: "conn-1",
  kind: "POLL_LISTING_CONTENT" as const,
  dedupeKey: "POLL_LISTING_CONTENT:conn-1:1",
  evidenceId: null,
  payload: { connectionId: "conn-1", windowStartMs: 1 },
  payloadHash: null,
  state: "RUNNING" as const,
  attemptCount: 1,
  maxAttempts: 8,
  leaseOwner: "w1",
  leaseToken: "tok",
  leaseExpiresAt: new Date("2099-01-01T00:00:00Z"),
};

function okListing() {
  return {
    ok: true as const,
    class: "SUCCESS" as const,
    httpStatus: 200,
    data: { title: "Hat", description: "d", state: "active", images: [] },
    message: "ok",
    retryAfterMs: null,
    rateLimit: null,
  };
}

function okInventory() {
  return {
    ok: true as const,
    class: "SUCCESS" as const,
    httpStatus: 200,
    data: {
      products: [
        {
          product_id: 1,
          sku: "a",
          offerings: [
            {
              offering_id: 2,
              quantity: 1,
              is_enabled: true,
              price: { amount: 100, divisor: 100 },
            },
          ],
        },
      ],
    },
    message: "ok",
    retryAfterMs: null,
    rateLimit: null,
  };
}

describe("etsy POLL_LISTING_CONTENT handler", () => {
  beforeEach(() => {
    vi.mocked(prisma.etsyConnection.findUnique).mockReset();
    vi.mocked(prisma.etsyListingLink.findMany).mockReset();
    vi.mocked(prisma.etsyListingLink.update).mockReset();
    vi.mocked(prisma.storeVariant.count).mockReset();
    vi.mocked(etsyConnectionRequest).mockReset();
    vi.mocked(applyEtsyListingContentInbound).mockReset();
    vi.mocked(markEtsyListingContentPollComplete).mockReset();
    vi.mocked(prisma.etsyConnection.findUnique).mockResolvedValue({
      id: "conn-1",
      memberId: "m1",
      shopId: "99",
      status: "ACTIVE",
    } as never);
    vi.mocked(prisma.storeVariant.count).mockResolvedValue(1);
    vi.mocked(prisma.storeVariant.findMany).mockResolvedValue([{ options: {} }] as never);
    vi.mocked(prisma.etsyVariantMap.count).mockResolvedValue(1);
  });

  it("records a listing 400 and continues the rest of the shop poll", async () => {
    vi.mocked(prisma.etsyListingLink.findMany).mockResolvedValue([
      {
        id: "link-bad",
        etsyListingId: "111",
        storeItemId: "item-bad",
        importSource: "ETSY_IMPORT",
        remoteListingState: "active",
      },
      {
        id: "link-ok",
        etsyListingId: "222",
        storeItemId: "item-ok",
        importSource: "ETSY_IMPORT",
        remoteListingState: "active",
      },
    ] as never);
    vi.mocked(etsyConnectionRequest)
      .mockResolvedValueOnce({
        ok: false,
        class: "PERMANENT",
        httpStatus: 400,
        data: null,
        message: "property ids 100 are deprecated",
        retryAfterMs: null,
        rateLimit: null,
      })
      .mockResolvedValueOnce(okListing())
      .mockResolvedValueOnce(okInventory());

    const result = await handleEtsyPollListingContentJob(claim);
    expect(result).toEqual({ outcome: "SUCCESS" });
    expect(prisma.etsyListingLink.update).toHaveBeenCalledWith({
      where: { id: "link-bad" },
      data: expect.objectContaining({
        issueCode: "LISTING_POLL_FAILED",
        issueMessage: "property ids 100 are deprecated",
      }),
    });
    expect(applyEtsyListingContentInbound).toHaveBeenCalledTimes(1);
    expect(markEtsyListingContentPollComplete).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ connectionId: "conn-1" })
    );
  });

  it("stops the poll on a connection-level auth failure", async () => {
    vi.mocked(prisma.etsyListingLink.findMany).mockResolvedValue([
      {
        id: "link-bad",
        etsyListingId: "111",
        storeItemId: "item-bad",
        importSource: "ETSY_IMPORT",
        remoteListingState: "active",
      },
    ] as never);
    vi.mocked(etsyConnectionRequest).mockResolvedValueOnce({
      ok: false,
      class: "AUTH",
      httpStatus: 401,
      data: null,
      message: "token rejected",
      retryAfterMs: null,
      rateLimit: null,
    });

    const result = await handleEtsyPollListingContentJob(claim);
    expect(result).toMatchObject({
      outcome: "DEAD",
      errorClass: "AUTH",
      errorMessage: "token rejected",
    });
    expect(prisma.etsyListingLink.update).not.toHaveBeenCalled();
    expect(markEtsyListingContentPollComplete).not.toHaveBeenCalled();
  });
});
