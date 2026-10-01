import { describe, expect, it } from "vitest";
import { classifyEtsyContentSemantics } from "database";

describe("classifyEtsyContentSemantics", () => {
  it("classifies unchanged, remote-only, local-only, and conflict", () => {
    expect(
      classifyEtsyContentSemantics({ base: "a", local: "a", remote: "a" })
    ).toBe("UNCHANGED");
    expect(
      classifyEtsyContentSemantics({ base: "a", local: "a", remote: "b" })
    ).toBe("REMOTE_ONLY");
    expect(
      classifyEtsyContentSemantics({ base: "a", local: "b", remote: "a" })
    ).toBe("LOCAL_ONLY");
    expect(
      classifyEtsyContentSemantics({ base: "a", local: "b", remote: "c" })
    ).toBe("CONFLICT");
    expect(
      classifyEtsyContentSemantics({ base: "a", local: "b", remote: "b" })
    ).toBe("CONVERGED");
  });

  it("bootstraps null base without local edits as remote-only", () => {
    expect(
      classifyEtsyContentSemantics({
        base: null,
        local: "x",
        remote: "y",
        hasLocalSemanticEdit: false,
      })
    ).toBe("REMOTE_ONLY");
    expect(
      classifyEtsyContentSemantics({
        base: null,
        local: "x",
        remote: "y",
        hasLocalSemanticEdit: true,
      })
    ).toBe("CONFLICT");
  });
});
