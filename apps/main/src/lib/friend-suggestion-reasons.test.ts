import { describe, expect, it } from "vitest";
import {
  buildFriendSuggestionReasons,
  initialsAvatarColor,
  truncateBio,
} from "./friend-suggestion-reasons";

describe("buildFriendSuggestionReasons", () => {
  it("lists mutual friends, city, and a shared group", () => {
    expect(
      buildFriendSuggestionReasons({
        mutualCount: 3,
        sameCity: true,
        sharedGroupNames: ["Inland Gardeners"],
        sharedBusinessCount: 2,
      })
    ).toEqual(["3 mutual friends", "Same city", "In Inland Gardeners"]);
  });

  it("uses singular mutual friend and group count", () => {
    expect(
      buildFriendSuggestionReasons({
        mutualCount: 1,
        sameCity: false,
        sharedGroupNames: ["A", "B"],
        sharedBusinessCount: 0,
      })
    ).toEqual(["1 mutual friend", "In 2 groups"]);
  });
});

describe("truncateBio", () => {
  it("returns null for empty bio", () => {
    expect(truncateBio("  ")).toBeNull();
  });

  it("ellipsis long bios", () => {
    const out = truncateBio("x".repeat(90), 80);
    expect(out?.endsWith("…")).toBe(true);
    expect(out?.length).toBe(80);
  });
});

describe("initialsAvatarColor", () => {
  it("is stable for the same name", () => {
    expect(initialsAvatarColor("Donivan Floyd")).toBe(initialsAvatarColor("Donivan Floyd"));
  });
});
