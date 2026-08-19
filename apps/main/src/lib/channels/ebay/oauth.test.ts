import { describe, expect, it } from "vitest";
import { EbayApiError } from "./errors";
import { withEbayApplicationTokenRetry } from "./oauth";

describe("withEbayApplicationTokenRetry", () => {
  it("retries once after HTTP 401", async () => {
    let calls = 0;
    const result = await withEbayApplicationTokenRetry(
      async () => {
        calls += 1;
        if (calls === 1) {
          throw new EbayApiError("unauthorized", 401, null, "/taxonomy");
        }
        return "ok";
      },
      async () => "token"
    );
    expect(result).toBe("ok");
    expect(calls).toBe(2);
  });

  it("does not retry non-401 errors", async () => {
    let calls = 0;
    await expect(
      withEbayApplicationTokenRetry(
        async () => {
          calls += 1;
          throw new EbayApiError("nope", 500, null, "/taxonomy");
        },
        async () => "token"
      )
    ).rejects.toMatchObject({ status: 500 });
    expect(calls).toBe(1);
  });
});
