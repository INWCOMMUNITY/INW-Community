import { describe, expect, it } from "vitest";
import {
  buildBusinessBackLink,
  buildBusinessHref,
  getBusinessReferrer,
} from "./business-referrer";

function params(entries: Record<string, string>) {
  const search = new URLSearchParams(entries);
  return { get: (name: string) => search.get(name) };
}

describe("getBusinessReferrer", () => {
  it("defaults to the directory", () => {
    expect(getBusinessReferrer(params({}))).toEqual({ type: "directory" });
  });

  it("reads saved businesses and feed", () => {
    expect(getBusinessReferrer(params({ from: "my-businesses" }))).toEqual({ type: "my-businesses" });
    expect(getBusinessReferrer(params({ from: "feed" }))).toEqual({ type: "feed" });
  });

  it("requires memberId for profile referrers", () => {
    expect(getBusinessReferrer(params({ from: "member-profile" }))).toEqual({ type: "directory" });
    expect(getBusinessReferrer(params({ from: "member-profile", memberId: "abc" }))).toEqual({
      type: "member-profile",
      memberId: "abc",
    });
  });
});

describe("buildBusinessHref", () => {
  it("keeps directory URLs canonical", () => {
    expect(buildBusinessHref("acme", { type: "directory" })).toBe("/support-local/acme");
  });

  it("adds from= for saved businesses", () => {
    expect(buildBusinessHref("acme", { type: "my-businesses" })).toBe(
      "/support-local/acme?from=my-businesses"
    );
  });
});

describe("buildBusinessBackLink", () => {
  it("returns My Businesses from saved list", () => {
    expect(buildBusinessBackLink({ type: "my-businesses" })).toEqual({
      href: "/my-community/businesses",
      label: "Back to My Businesses",
    });
  });

  it("returns Support Local by default", () => {
    expect(buildBusinessBackLink({ type: "directory" })).toEqual({
      href: "/support-local",
      label: "Back to Support Local",
    });
  });
});
