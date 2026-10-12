import { describe, expect, it } from "vitest";
import {
  classifyEtsyContentSemantics,
  etsyRemoteWinsLastWrite,
  resolveEtsyContentClassWithLww,
} from "./content-semantic";

describe("etsyRemoteWinsLastWrite", () => {
  const now = new Date("2026-10-12T20:00:00.000Z");

  it("prefers remote when there is no local desire timestamp", () => {
    expect(etsyRemoteWinsLastWrite(new Date("2026-10-12T19:00:00.000Z"), null, now)).toBe(true);
  });

  it("prefers the more recent timestamp (tie → remote)", () => {
    const t = new Date("2026-10-12T19:30:00.000Z");
    expect(etsyRemoteWinsLastWrite(t, t, now)).toBe(true);
    expect(
      etsyRemoteWinsLastWrite(
        new Date("2026-10-12T19:40:00.000Z"),
        new Date("2026-10-12T19:30:00.000Z"),
        now
      )
    ).toBe(true);
    expect(
      etsyRemoteWinsLastWrite(
        new Date("2026-10-12T19:20:00.000Z"),
        new Date("2026-10-12T19:30:00.000Z"),
        now
      )
    ).toBe(false);
  });
});

describe("resolveEtsyContentClassWithLww", () => {
  const now = new Date("2026-10-12T20:00:00.000Z");
  const A = "fp-a";
  const B = "fp-b";
  const C = "fp-c";

  it("breaks fingerprint CONFLICT with most-recent-edit wins", () => {
    const conflict = classifyEtsyContentSemantics({
      base: A,
      local: B,
      remote: C,
      hasLocalSemanticEdit: true,
    });
    expect(conflict).toBe("CONFLICT");
    expect(
      resolveEtsyContentClassWithLww(conflict, {
        remoteUpdatedAt: new Date("2026-10-12T19:50:00.000Z"),
        localDesiredAt: new Date("2026-10-12T19:00:00.000Z"),
        now,
      })
    ).toBe("REMOTE_ONLY");
    expect(
      resolveEtsyContentClassWithLww(conflict, {
        remoteUpdatedAt: new Date("2026-10-12T19:00:00.000Z"),
        localDesiredAt: new Date("2026-10-12T19:50:00.000Z"),
        now,
      })
    ).toBe("LOCAL_ONLY");
  });
});
