import { beforeEach, describe, expect, it, vi } from "vitest";

const { etsyDelete, etsyForm, etsyGet, setEtsyConnectionContext, EtsyApiError } = vi.hoisted(() => {
  class EtsyApiError extends Error {
    status: number;
    body: unknown;
    constructor(message: string, status: number, body: unknown = null) {
      super(message);
      this.name = "EtsyApiError";
      this.status = status;
      this.body = body;
    }
  }
  return {
    etsyDelete: vi.fn(),
    etsyForm: vi.fn(),
    etsyGet: vi.fn(),
    setEtsyConnectionContext: vi.fn(),
    EtsyApiError,
  };
});

vi.mock("./client", () => ({
  EtsyApiError,
  etsyDelete,
  etsyForm,
  etsyGet,
  setEtsyConnectionContext,
}));

import { endEtsyListing } from "./end-listing";

describe("endEtsyListing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("no-ops when the listing is already gone", async () => {
    etsyGet.mockResolvedValueOnce(null);
    await endEtsyListing({ accessToken: "t", shopId: "1", listingId: "9" });
    expect(etsyDelete).not.toHaveBeenCalled();
    expect(etsyForm).not.toHaveBeenCalled();
  });

  it("deletes an active listing", async () => {
    etsyGet.mockResolvedValueOnce({ state: "active", quantity: 1 });
    etsyDelete.mockResolvedValueOnce(undefined);
    etsyGet.mockResolvedValueOnce(null);
    await endEtsyListing({ accessToken: "t", shopId: "1", listingId: "9" });
    expect(etsyDelete).toHaveBeenCalledWith("t", "/listings/9");
    expect(etsyForm).not.toHaveBeenCalled();
  });

  it("deactivates when delete is rejected and listing becomes inactive", async () => {
    etsyGet.mockResolvedValueOnce({ state: "active", quantity: 2 });
    etsyDelete.mockRejectedValueOnce(new EtsyApiError("conflict", 409));
    etsyForm.mockResolvedValueOnce({});
    etsyDelete.mockRejectedValueOnce(new EtsyApiError("still conflict", 409));
    etsyGet.mockResolvedValueOnce({ state: "inactive", quantity: 2 });
    await endEtsyListing({ accessToken: "t", shopId: "1", listingId: "9" });
    expect(etsyForm).toHaveBeenCalledWith(
      "t",
      "/shops/1/listings/9",
      "PATCH",
      expect.objectContaining({ state: "inactive", quantity: 2 })
    );
  });

  it("throws when the listing stays active", async () => {
    etsyGet.mockResolvedValue({ state: "active", quantity: 1 });
    etsyDelete.mockRejectedValue(new EtsyApiError("forbidden", 403));
    etsyForm.mockResolvedValue({});
    await expect(
      endEtsyListing({ accessToken: "t", shopId: "1", listingId: "9" })
    ).rejects.toThrow(/still active/i);
  });
});
