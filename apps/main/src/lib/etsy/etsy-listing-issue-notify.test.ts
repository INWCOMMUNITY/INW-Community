import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("database", async () => {
  const actual = await vi.importActual<typeof import("database")>("database");
  return {
    ...actual,
    prisma: {
      storeItem: { findUnique: vi.fn() },
      etsyConnection: { findUnique: vi.fn() },
      etsyListingLink: { findUnique: vi.fn() },
    },
  };
});

vi.mock("@/lib/seller-activity-log", () => ({
  logSellerActivityOnce: vi.fn(async () => true),
}));

vi.mock("@/lib/send-push-notification", () => ({
  sendPushNotification: vi.fn(async () => undefined),
}));

import { prisma } from "database";
import { logSellerActivityOnce } from "@/lib/seller-activity-log";
import { sendPushNotification } from "@/lib/send-push-notification";
import { notifyEtsySyncJobDeadOnce } from "./listing-issue-notify";

describe("notifyEtsySyncJobDeadOnce", () => {
  beforeEach(() => {
    vi.mocked(prisma.storeItem.findUnique).mockReset();
    vi.mocked(prisma.etsyConnection.findUnique).mockReset();
    vi.mocked(prisma.etsyListingLink.findUnique).mockReset();
    vi.mocked(logSellerActivityOnce).mockReset();
    vi.mocked(sendPushNotification).mockReset();
    vi.mocked(logSellerActivityOnce).mockResolvedValue(true);
    vi.mocked(prisma.storeItem.findUnique).mockResolvedValue({ title: "Mug" } as never);
  });

  it("notifies for unmapped CREATE_LISTING failures using create-job subject", async () => {
    vi.mocked(prisma.etsyConnection.findUnique).mockResolvedValue({
      id: "conn-1",
      memberId: "m1",
    } as never);
    vi.mocked(prisma.etsyListingLink.findUnique).mockResolvedValue(null);

    const result = await notifyEtsySyncJobDeadOnce({
      claim: {
        id: "job-9",
        etsyConnectionId: "conn-1",
        kind: "CREATE_LISTING",
        payload: { storeItemId: "item-1", storeVariantId: "var-1" },
      },
      result: {
        errorClass: "PERMANENT",
        errorCode: "Etsy API 400",
        errorMessage: "A readiness_state_id is required for physical listings",
      },
    });

    expect(result).toEqual({ created: true });
    expect(logSellerActivityOnce).toHaveBeenCalledWith(
      expect.objectContaining({
        memberId: "m1",
        entityId: "item-1",
        action: "sync_error",
        dedupeKey: expect.stringContaining("create-job:job-9"),
      })
    );
    expect(sendPushNotification).toHaveBeenCalledWith(
      "m1",
      expect.objectContaining({
        title: "Etsy listing needs attention",
      })
    );
  });

  it("skips evidence jobs", async () => {
    const result = await notifyEtsySyncJobDeadOnce({
      claim: {
        id: "job-1",
        etsyConnectionId: "conn-1",
        kind: "PROCESS_PROVIDER_EVIDENCE",
        payload: { storeItemId: "item-1" },
      },
      result: { errorClass: "PERMANENT", errorMessage: "x" },
    });
    expect(result).toEqual({ created: false });
    expect(logSellerActivityOnce).not.toHaveBeenCalled();
  });
});
