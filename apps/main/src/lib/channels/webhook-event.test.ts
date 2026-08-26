import { describe, expect, it } from "vitest";
import { isStaleWebhookEvent } from "./webhook-event";

describe("isStaleWebhookEvent", () => {
  const now = Date.parse("2026-08-25T20:00:00.000Z");

  it("replays pending events older than 5 minutes", () => {
    expect(isStaleWebhookEvent("pending", new Date(now - 6 * 60 * 1000), now)).toBe(true);
    expect(isStaleWebhookEvent("pending", new Date(now - 60 * 1000), now)).toBe(false);
  });

  it("replays processing events older than 10 minutes", () => {
    expect(isStaleWebhookEvent("processing", new Date(now - 11 * 60 * 1000), now)).toBe(true);
    expect(isStaleWebhookEvent("processing", new Date(now - 2 * 60 * 1000), now)).toBe(false);
  });

  it("does not replay completed events", () => {
    expect(isStaleWebhookEvent("completed", new Date(now - 60 * 60 * 1000), now)).toBe(false);
  });
});
