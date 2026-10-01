import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("./connection-request", () => ({
  etsyConnectionRequest: vi.fn(),
}));

import { etsyConnectionRequest } from "./connection-request";
import { resolveEtsyReadinessStateId } from "./readiness-state";

describe("resolveEtsyReadinessStateId", () => {
  beforeEach(() => {
    vi.mocked(etsyConnectionRequest).mockReset();
  });

  it("uses an existing ready_to_ship profile when available", async () => {
    vi.mocked(etsyConnectionRequest).mockResolvedValueOnce({
      ok: true,
      class: "SUCCESS",
      httpStatus: 200,
      data: {
        results: [
          { readiness_state_id: 11, readiness_state: "made_to_order" },
          { readiness_state_id: 22, readiness_state: "ready_to_ship" },
        ],
      },
      message: "ok",
      retryAfterMs: null,
      rateLimit: null,
    });

    const result = await resolveEtsyReadinessStateId({
      connectionId: "c1",
      memberId: "m1",
      shopId: "99",
      whenMade: "2020_2026",
      inventoryTracking: "tracked",
    });

    expect(result).toEqual({
      ok: true,
      readinessStateId: "22",
      readinessState: "ready_to_ship",
      created: false,
    });
    expect(etsyConnectionRequest).toHaveBeenCalledTimes(1);
  });

  it("creates a made_to_order profile when the shop has none", async () => {
    vi.mocked(etsyConnectionRequest)
      .mockResolvedValueOnce({
        ok: true,
        class: "SUCCESS",
        httpStatus: 200,
        data: { results: [] },
        message: "ok",
        retryAfterMs: null,
        rateLimit: null,
      })
      .mockResolvedValueOnce({
        ok: true,
        class: "SUCCESS",
        httpStatus: 200,
        data: { readiness_state_id: 55, readiness_state: "made_to_order" },
        message: "ok",
        retryAfterMs: null,
        rateLimit: null,
      });

    const result = await resolveEtsyReadinessStateId({
      connectionId: "c1",
      memberId: "m1",
      shopId: "99",
      whenMade: "made_to_order",
      inventoryTracking: "made_to_order",
    });

    expect(result).toEqual({
      ok: true,
      readinessStateId: "55",
      readinessState: "made_to_order",
      created: true,
    });
    expect(etsyConnectionRequest).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        method: "POST",
        bodyEncoding: "form",
        body: expect.objectContaining({ readiness_state: "made_to_order" }),
      })
    );
  });
});
