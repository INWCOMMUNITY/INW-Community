import { afterEach, describe, expect, it, vi } from "vitest";
import { EbayApiError, ebayGet, parseRetryAfterMs, takeEbayCallWarnings } from "./client";

describe("parseRetryAfterMs", () => {
  it("parses delay-seconds and caps at 30s", () => {
    expect(parseRetryAfterMs("2")).toBe(2000);
    expect(parseRetryAfterMs("120")).toBe(30_000);
    expect(parseRetryAfterMs("0")).toBe(0);
  });

  it("parses HTTP-date Retry-After", () => {
    const now = Date.parse("Wed, 19 Aug 2026 19:00:00 GMT");
    expect(parseRetryAfterMs("Wed, 19 Aug 2026 19:00:05 GMT", now)).toBe(5000);
  });

  it("returns null for missing or invalid values", () => {
    expect(parseRetryAfterMs(null)).toBeNull();
    expect(parseRetryAfterMs("")).toBeNull();
    expect(parseRetryAfterMs("not-a-date")).toBeNull();
  });
});

describe("ebayGet warnings and retries", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    takeEbayCallWarnings();
  });

  it("logs and stores warnings on HTTP 200", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            sku: "abc",
            warnings: [{ errorId: 25007, longMessage: "Title truncated." }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      )
    );
    const body = await ebayGet<{ sku: string }>("token", "/sell/inventory/v1/inventory_item/abc");
    expect(body.sku).toBe("abc");
    const warnings = takeEbayCallWarnings();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.longMessage).toBe("Title truncated.");
  });

  it("logs known 200 warning codes at info instead of warn", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            sku: "abc",
            warnings: [
              { errorId: 25401, longMessage: "Condition dropped because the category does not support it." },
              { errorId: 25402, longMessage: "Offer already published; business policies unchanged." },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      )
    );
    await ebayGet("token", "/sell/inventory/v1/inventory_item/abc");
    expect(warn).not.toHaveBeenCalled();
    expect(info.mock.calls.some((call) => String(call[0]).includes("REST 200 known warnings"))).toBe(
      true
    );
    } finally {
      warn.mockRestore();
      info.mockRestore();
    }
  });

  it("does not retry a 429 without Retry-After", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          errors: [{ errorId: 2001, message: "The request limit has been reached for the resource." }],
        }),
        { status: 429, headers: { "Content-Type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(ebayGet("token", "/commerce/taxonomy/v1/category_tree/0")).rejects.toBeInstanceOf(
      EbayApiError
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("honors Retry-After on 429 then succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("rate limited", { status: 429, headers: { "Retry-After": "0" } })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );
    vi.stubGlobal("fetch", fetchMock);
    const body = await ebayGet<{ ok: boolean }>("token", "/sell/inventory/v1/inventory_item/abc");
    expect(body.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws EbayApiError after retries are exhausted", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("nope", { status: 503, headers: { "Retry-After": "0" } }))
    );
    await expect(ebayGet("token", "/sell/inventory/v1/inventory_item/abc")).rejects.toBeInstanceOf(
      EbayApiError
    );
  });
});
