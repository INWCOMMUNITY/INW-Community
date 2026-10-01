import { createHmac } from "crypto";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildEtsyWebhookSignedContent,
  decodeEtsyWebhookSigningKey,
  verifyEtsyWebhookSignature,
} from "./webhook-signature";
import { normalizeEtsyWebhookTopic } from "database";

const ingest = vi.fn();

vi.mock("database", async (importOriginal) => {
  const actual = await importOriginal<typeof import("database")>();
  return {
    ...actual,
    prisma: {},
    ingestEtsyWebhookEvidence: (...args: unknown[]) => ingest(...args),
  };
});

vi.mock("@/lib/etsy/config", () => ({
  readEtsyAppConfig: () => ({
    apiKey: "key",
    clientSecret: "secret",
    clientId: "key",
    appUrl: "https://app.example.com",
    redirectUri: "https://app.example.com/api/etsy/oauth/callback",
    providerEvidenceWebhookUri: "https://app.example.com/api/etsy/webhooks/inbox",
    scopes: ["listings_r"],
  }),
}));

import { POST as inboxPost } from "@/app/api/etsy/webhooks/inbox/route";

const SECRET = "whsec_" + Buffer.from("test-signing-key-bytes!!").toString("base64");

function sign(webhookId: string, timestamp: string, body: string) {
  const key = decodeEtsyWebhookSigningKey(SECRET)!;
  const content = buildEtsyWebhookSignedContent(webhookId, timestamp, body);
  return createHmac("sha256", key).update(content, "utf8").digest("base64");
}

describe("etsy webhook signature", () => {
  it("accepts a valid signature and rejects tampering / stale timestamps", () => {
    const body = JSON.stringify({ event_type: "order.paid", shop_id: 99 });
    const webhookId = "msg_1";
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = sign(webhookId, timestamp, body);

    expect(
      verifyEtsyWebhookSignature({
        rawBody: body,
        webhookId,
        webhookTimestamp: timestamp,
        webhookSignature: `v1,${signature}`,
        signingSecret: SECRET,
      })
    ).toBe(true);

    expect(
      verifyEtsyWebhookSignature({
        rawBody: body + "x",
        webhookId,
        webhookTimestamp: timestamp,
        webhookSignature: signature,
        signingSecret: SECRET,
      })
    ).toBe(false);

    expect(
      verifyEtsyWebhookSignature({
        rawBody: body,
        webhookId,
        webhookTimestamp: String(Math.floor(Date.now() / 1000) - 10_000),
        webhookSignature: signature,
        signingSecret: SECRET,
      })
    ).toBe(false);
  });

  it("normalizes ORDER_PAID style topics", () => {
    expect(normalizeEtsyWebhookTopic("ORDER_PAID")).toBe("order.paid");
    expect(normalizeEtsyWebhookTopic("order.canceled")).toBe("order.canceled");
  });
});

describe("etsy webhook inbox route", () => {
  beforeEach(() => {
    process.env.ETSY_WEBHOOK_SECRET = SECRET;
    ingest.mockReset();
    ingest.mockResolvedValue({
      status: "CREATED",
      evidence: { id: "ev-1" },
      jobId: "job-1",
    });
  });

  it("rejects invalid signature before ingest and accepts a valid delivery", async () => {
    const body = JSON.stringify({ event_type: "order.paid", shop_id: 42, receipt_id: 7 });
    const webhookId = "wh-etsy-1";
    const timestamp = String(Math.floor(Date.now() / 1000));

    const bad = await inboxPost(
      new NextRequest("https://app.example.com/api/etsy/webhooks/inbox", {
        method: "POST",
        headers: {
          "webhook-id": webhookId,
          "webhook-timestamp": timestamp,
          "webhook-signature": "nope",
        },
        body,
      })
    );
    expect(bad.status).toBe(401);
    expect(ingest).not.toHaveBeenCalled();

    const signature = sign(webhookId, timestamp, body);
    const good = await inboxPost(
      new NextRequest("https://app.example.com/api/etsy/webhooks/inbox", {
        method: "POST",
        headers: {
          "webhook-id": webhookId,
          "webhook-timestamp": timestamp,
          "webhook-signature": signature,
        },
        body,
      })
    );
    expect(good.status).toBe(200);
    expect(ingest).toHaveBeenCalledTimes(1);
    expect(ingest.mock.calls[0][1]).toMatchObject({
      shopId: "42",
      topic: "order.paid",
      webhookId,
    });
  });
});
