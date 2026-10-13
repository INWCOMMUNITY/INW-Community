import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./connection-request", () => ({
  etsyConnectionRequest: vi.fn(),
}));

import { prisma } from "database";
import { etsyConnectionRequest } from "./connection-request";
import { pushEtsyListingPersonalization } from "./personalization";

const ok = {
  ok: true as const,
  class: "SUCCESS" as const,
  httpStatus: 200,
  data: { personalization_questions: [] },
  message: "ok",
  retryAfterMs: null,
  rateLimit: null,
};

describe("pushEtsyListingPersonalization", () => {
  beforeEach(() => {
    vi.spyOn(prisma.listingBuyerField, "findMany").mockReset();
    vi.spyOn(prisma.etsyListingLink, "findFirst").mockReset();
    vi.spyOn(prisma.etsyListingLink, "updateMany").mockReset();
    vi.mocked(prisma.etsyListingLink.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.etsyListingLink.updateMany).mockResolvedValue({ count: 0 });
    vi.mocked(etsyConnectionRequest).mockReset();
  });

  it("posts a full replace that keeps question_id", async () => {
    vi.mocked(prisma.listingBuyerField.findMany).mockResolvedValue([
      {
        kind: "TEXT",
        title: "Specifics",
        instructions: "Name",
        required: true,
        maxCharacters: 256,
        maxFiles: null,
        labelEachFile: false,
        etsyQuestionId: "42",
        options: [],
      },
    ] as never);
    vi.mocked(etsyConnectionRequest).mockResolvedValue(ok);

    const result = await pushEtsyListingPersonalization({
      connectionId: "conn-1",
      memberId: "m1",
      shopId: "99",
      etsyListingId: "555",
      storeItemId: "item-1",
    });

    expect(result).toBeNull();
    expect(etsyConnectionRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        path: "/shops/99/listings/555/personalization",
        query: { supports_multiple_personalization_questions: true },
        body: {
          personalization_questions: [
            expect.objectContaining({
              question_id: 42,
              question_type: "text_input",
              question_text: "Specifics",
            }),
          ],
        },
      })
    );
  });

  it("deletes personalization when the listing has no custom options", async () => {
    vi.mocked(prisma.listingBuyerField.findMany).mockResolvedValue([] as never);
    vi.mocked(etsyConnectionRequest).mockResolvedValue({ ...ok, httpStatus: 200 });

    const result = await pushEtsyListingPersonalization({
      connectionId: "conn-1",
      memberId: "m1",
      shopId: "99",
      etsyListingId: "555",
      storeItemId: "item-1",
    });

    expect(result).toBeNull();
    expect(etsyConnectionRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "DELETE",
        path: "/shops/99/listings/555/personalization",
      })
    );
  });

  it("does not delete Etsy personalization when the import never read it", async () => {
    vi.mocked(prisma.listingBuyerField.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.etsyListingLink.findFirst).mockResolvedValue({
      personalizationAuthoritative: false,
    } as never);
    vi.mocked(etsyConnectionRequest).mockResolvedValue({
      ok: false,
      class: "TRANSIENT",
      httpStatus: 500,
      data: null,
      message: "Etsy personalization was not read",
      retryAfterMs: null,
      rateLimit: null,
    });

    const result = await pushEtsyListingPersonalization({
      connectionId: "conn-1",
      memberId: "m1",
      shopId: "99",
      etsyListingId: "555",
      storeItemId: "item-1",
    });

    expect(result).toBeNull();
    expect(etsyConnectionRequest).toHaveBeenCalledWith(
      expect.objectContaining({ method: "GET" })
    );
    expect(etsyConnectionRequest).not.toHaveBeenCalledWith(
      expect.objectContaining({ method: "DELETE" })
    );
  });
});
