import { describe, expect, it } from "vitest";
import { buildEventBackLink, buildEventHref, getEventReferrer } from "./event-referrer";

function params(entries: Record<string, string>) {
  const search = new URLSearchParams(entries);
  return { get: (name: string) => search.get(name) };
}

describe("getEventReferrer", () => {
  it("defaults to calendars", () => {
    expect(getEventReferrer(params({}))).toEqual({ type: "calendars" });
  });

  it("reads my-events tab", () => {
    expect(getEventReferrer(params({ from: "my-events", tab: "ended" }))).toEqual({
      type: "my-events",
      tab: "ended",
    });
  });

  it("reads local-events calendar type", () => {
    expect(getEventReferrer(params({ from: "local-events", calendarType: "non_profit" }))).toEqual({
      type: "local-events",
      calendarType: "non_profit",
    });
  });
});

describe("buildEventHref", () => {
  it("adds from= for my events ended", () => {
    expect(buildEventHref("survivor-games", { type: "my-events", tab: "ended" })).toBe(
      "/events/survivor-games?from=my-events&tab=ended"
    );
  });

  it("omits saved tab from the query", () => {
    expect(buildEventHref("survivor-games", { type: "my-events", tab: "saved" })).toBe(
      "/events/survivor-games?from=my-events"
    );
  });
});

describe("buildEventBackLink", () => {
  it("returns My Events with the ended tab", () => {
    expect(buildEventBackLink({ type: "my-events", tab: "ended" })).toEqual({
      href: "/my-community/events?tab=ended",
      label: "Back to My Events",
    });
  });

  it("returns Calendars by default", () => {
    expect(buildEventBackLink({ type: "calendars" })).toEqual({
      href: "/calendars",
      label: "Back to Calendars",
    });
  });
});
