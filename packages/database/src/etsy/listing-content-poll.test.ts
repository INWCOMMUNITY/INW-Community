import { describe, expect, it } from "vitest";
import {
  etsyListingContentPollWindowStartMs,
  isEtsyListingContentPollDue,
  etsyPollListingContentDedupeKey,
} from "./listing-content-poll";

describe("etsy listing content poll schedule", () => {
  it("aligns window starts to the interval grid", () => {
    expect(etsyListingContentPollWindowStartMs(1_790_885_737_574, 60_000)).toBe(1_790_885_700_000);
    expect(etsyListingContentPollWindowStartMs(1_790_885_700_000, 60_000)).toBe(1_790_885_700_000);
  });

  it("is due when never polled or last poll is before this window", () => {
    const windowStartMs = 1_790_885_700_000;
    expect(isEtsyListingContentPollDue({ lastPolledAt: null, windowStartMs })).toBe(true);
    expect(
      isEtsyListingContentPollDue({
        lastPolledAt: new Date(windowStartMs - 1),
        windowStartMs,
      })
    ).toBe(true);
    expect(
      isEtsyListingContentPollDue({
        lastPolledAt: new Date(windowStartMs),
        windowStartMs,
      })
    ).toBe(false);
    expect(
      isEtsyListingContentPollDue({
        lastPolledAt: new Date(windowStartMs + 30_000),
        windowStartMs,
      })
    ).toBe(false);
  });

  it("builds stable poll dedupe keys per connection window", () => {
    expect(etsyPollListingContentDedupeKey("conn-1", 1000)).toBe(
      "POLL_LISTING_CONTENT:conn-1:1000"
    );
  });
});
