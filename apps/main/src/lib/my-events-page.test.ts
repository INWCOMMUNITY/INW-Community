import { describe, expect, it } from "vitest";
import { eventCoverSrc, partitionMyEvents, rsvpStatusLabel, splitEventsByUpcoming, type MyEventListItem } from "./my-events-page";

function item(partial: Partial<MyEventListItem> & Pick<MyEventListItem, "id" | "date">): MyEventListItem {
  return {
    title: "Event",
    slug: "event",
    time: null,
    endTime: null,
    location: null,
    city: null,
    description: null,
    photos: [],
    calendarType: "fun_events",
    calendarLabel: "Fun Events Calendar",
    business: null,
    ...partial,
  };
}

describe("splitEventsByUpcoming", () => {
  it("puts a future date in upcoming and a past date in past", () => {
    const upcomingEvent = item({ id: "u", date: "2099-06-01T00:00:00.000Z" });
    const pastEvent = item({ id: "p", date: "2020-01-01T00:00:00.000Z" });
    const { upcoming, past } = splitEventsByUpcoming([upcomingEvent, pastEvent]);
    expect(upcoming.map((e) => e.id)).toEqual(["u"]);
    expect(past.map((e) => e.id)).toEqual(["p"]);
  });
});

describe("eventCoverSrc", () => {
  it("prefers the first photo over the calendar fallback", () => {
    expect(eventCoverSrc({ photos: ["https://img.example/e.jpg"], calendarType: "fun_events" })).toBe(
      "https://img.example/e.jpg"
    );
  });

  it("falls back to the calendar type image", () => {
    expect(eventCoverSrc({ photos: [], calendarType: "non_profit" })).toBe("/calendars/non_profit.png");
  });
});

describe("partitionMyEvents", () => {
  it("moves past saved events to ended and keeps upcoming in saved", () => {
    const upcomingEvent = item({ id: "u", date: "2099-06-01T00:00:00.000Z" });
    const pastEvent = item({ id: "p", date: "2020-01-01T00:00:00.000Z" });
    const result = partitionMyEvents([upcomingEvent, pastEvent], [], []);
    expect(result.saved.map((e) => e.id)).toEqual(["u"]);
    expect(result.ended.map((e) => e.id)).toEqual(["p"]);
  });
});

describe("rsvpStatusLabel", () => {
  it("maps accepted and maybe", () => {
    expect(rsvpStatusLabel("accepted")).toBe("Going");
    expect(rsvpStatusLabel("maybe")).toBe("Maybe");
    expect(rsvpStatusLabel(undefined)).toBeNull();
  });
});
