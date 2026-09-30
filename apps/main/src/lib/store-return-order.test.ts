import { describe, expect, it } from "vitest";
import { pickLatestStoreReturn } from "./store-return-order";

describe("pickLatestStoreReturn (Unit 5E)", () => {
  it("returns null for empty", () => {
    expect(pickLatestStoreReturn([])).toBeNull();
    expect(pickLatestStoreReturn(null)).toBeNull();
  });

  it("picks the single return", () => {
    const only = { id: "a", createdAt: "2026-01-01T00:00:00.000Z" };
    expect(pickLatestStoreReturn([only])?.id).toBe("a");
  });

  it("picks newest createdAt", () => {
    const older = { id: "z-high-id", createdAt: "2026-01-01T00:00:00.000Z" };
    const newer = { id: "a-low-id", createdAt: "2026-01-02T00:00:00.000Z" };
    expect(pickLatestStoreReturn([older, newer])?.id).toBe("a-low-id");
    expect(pickLatestStoreReturn([newer, older])?.id).toBe("a-low-id");
  });

  it("same createdAt → greatest id wins regardless of insertion order", () => {
    const ts = "2026-06-01T12:00:00.000Z";
    const low = { id: "ret_aaa", createdAt: ts };
    const high = { id: "ret_zzz", createdAt: ts };
    expect(pickLatestStoreReturn([low, high])?.id).toBe("ret_zzz");
    expect(pickLatestStoreReturn([high, low])?.id).toBe("ret_zzz");
  });

  it("historical terminal + newer active → newer chosen", () => {
    const declined = {
      id: "old",
      createdAt: "2026-01-01T00:00:00.000Z",
      status: "declined",
    };
    const requested = {
      id: "new",
      createdAt: "2026-02-01T00:00:00.000Z",
      status: "requested",
    };
    expect(pickLatestStoreReturn([declined, requested])?.id).toBe("new");
  });

  it("same timestamp mixed statuses → id DESC still deterministic", () => {
    const ts = "2026-06-01T12:00:00.000Z";
    const a = { id: "id_a", createdAt: ts, status: "declined" };
    const b = { id: "id_b", createdAt: ts, status: "requested" };
    expect(pickLatestStoreReturn([a, b])?.id).toBe("id_b");
    expect(pickLatestStoreReturn([b, a])?.id).toBe("id_b");
  });
});
