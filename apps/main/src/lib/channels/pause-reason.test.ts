import { describe, expect, it } from "vitest";
import {
  classifyChannelPauseReason,
  connectionHealthUx,
  nextRecoverAt,
} from "./pause-reason";

describe("classifyChannelPauseReason", () => {
  it("classifies invalid_grant as reconnect", () => {
    expect(classifyChannelPauseReason(new Error("invalid_grant"))).toBe("invalid_grant");
  });

  it("classifies decrypt failures as platform key", () => {
    expect(classifyChannelPauseReason("token could not be decrypted")).toBe("decrypt_failure");
  });

  it("classifies Shopify offline token as reconnect, not delayed", () => {
    expect(
      classifyChannelPauseReason(
        new Error("Shopify offline token expired or was revoked. Reconnect your Shopify store.")
      )
    ).toBe("no_refresh_token");
  });

  it("classifies unknown errors as delayed (unknown_permanent)", () => {
    expect(classifyChannelPauseReason(new Error("ETIMEDOUT"))).toBe("unknown_permanent");
  });
});

describe("nextRecoverAt", () => {
  const from = Date.parse("2026-08-25T12:00:00.000Z");

  it("backs off invalid_grant instead of retrying every 5 minutes", () => {
    expect(nextRecoverAt("invalid_grant", 0, from).getTime() - from).toBe(15 * 60 * 1000);
    expect(nextRecoverAt("invalid_grant", 1, from).getTime() - from).toBe(60 * 60 * 1000);
  });

  it("holds decrypt failures for a day", () => {
    expect(nextRecoverAt("decrypt_failure", 0, from).getTime() - from).toBe(24 * 60 * 60 * 1000);
  });
});

describe("connectionHealthUx", () => {
  it("asks sellers to reconnect on invalid_grant", () => {
    const ux = connectionHealthUx({ status: "error", lastError: "invalid_grant" });
    expect(ux.kind).toBe("reconnect");
  });

  it("tells sellers not to reconnect on platform key failures", () => {
    const ux = connectionHealthUx({
      status: "error",
      lastError: "token could not be decrypted",
    });
    expect(ux.kind).toBe("platform_key");
    expect(ux.message).toMatch(/do not reconnect/i);
  });

  it("shows delayed for transient unknown errors", () => {
    const ux = connectionHealthUx({ status: "error", lastError: "fetch failed" });
    expect(ux.kind).toBe("delayed");
  });
});
