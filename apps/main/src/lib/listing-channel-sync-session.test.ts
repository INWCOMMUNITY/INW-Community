import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { consumeListingChannelSync, persistListingChannelSync } from "./listing-channel-sync-session";

describe("listing channel sync session", () => {
  const mem = new Map<string, string>();

  beforeEach(() => {
    mem.clear();
    vi.stubGlobal("sessionStorage", {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => {
        mem.set(k, v);
      },
      removeItem: (k: string) => {
        mem.delete(k);
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("round-trips mixed publish results for the edit page", () => {
    persistListingChannelSync("item-1", [
      { provider: "etsy", ok: true },
      { provider: "ebay", ok: false, error: "SKU invalid" },
    ]);
    expect(consumeListingChannelSync("item-1")).toEqual([
      { provider: "etsy", ok: true },
      { provider: "ebay", ok: false, error: "SKU invalid" },
    ]);
    expect(consumeListingChannelSync("item-1")).toBeUndefined();
  });
});
