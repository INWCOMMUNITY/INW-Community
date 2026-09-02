import { afterEach, describe, expect, it } from "vitest";
import { createHash } from "crypto";
import {
  buildEbayWebhookUrl,
  ebayCommerceChallengeResponse,
  ebayWebhookEnvelopeIsTrusted,
  ebayWebhookUrlIsSecured,
  redactEbayWebhookUrl,
  verifyEbayWebhook,
} from "./webhook";

const ORIGINAL_SECRET = process.env.EBAY_WEBHOOK_SECRET;

afterEach(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.EBAY_WEBHOOK_SECRET;
  else process.env.EBAY_WEBHOOK_SECRET = ORIGINAL_SECRET;
});

describe("buildEbayWebhookUrl", () => {
  it("appends the current secret as a query param", () => {
    process.env.EBAY_WEBHOOK_SECRET = "correct-secret";
    expect(buildEbayWebhookUrl("https://www.inwcommunity.com")).toBe(
      "https://www.inwcommunity.com/api/channels/ebay/webhook?secret=correct-secret"
    );
  });

  it("omits secret when it is not configured", () => {
    delete process.env.EBAY_WEBHOOK_SECRET;
    expect(buildEbayWebhookUrl("https://www.inwcommunity.com/")).toBe(
      "https://www.inwcommunity.com/api/channels/ebay/webhook"
    );
  });
});

describe("ebayWebhookUrlIsSecured", () => {
  it("is true only when the stored URL carries the current secret", () => {
    process.env.EBAY_WEBHOOK_SECRET = "correct-secret";
    expect(
      ebayWebhookUrlIsSecured(
        "https://www.inwcommunity.com/api/channels/ebay/webhook?secret=correct-secret"
      )
    ).toBe(true);
    expect(
      ebayWebhookUrlIsSecured("https://www.inwcommunity.com/api/channels/ebay/webhook")
    ).toBe(false);
    expect(
      ebayWebhookUrlIsSecured(
        "https://www.inwcommunity.com/api/channels/ebay/webhook?secret=wrong"
      )
    ).toBe(false);
  });
});

describe("redactEbayWebhookUrl", () => {
  it("masks the secret query value", () => {
    expect(
      redactEbayWebhookUrl(
        "https://www.inwcommunity.com/api/channels/ebay/webhook?secret=correct-secret"
      )
    ).toBe("https://www.inwcommunity.com/api/channels/ebay/webhook?secret=***");
  });
});

describe("verifyEbayWebhook", () => {
  it("rejects when no secret configured", () => {
    delete process.env.EBAY_WEBHOOK_SECRET;
    const req = { nextUrl: { searchParams: { get: () => "some-secret" } } };
    expect(verifyEbayWebhook(req)).toBe(false);
  });

  it("rejects when secret does not match", () => {
    process.env.EBAY_WEBHOOK_SECRET = "correct-secret";
    const req = { nextUrl: { searchParams: { get: () => "wrong-secret" } } };
    expect(verifyEbayWebhook(req)).toBe(false);
  });

  it("accepts when secret matches", () => {
    process.env.EBAY_WEBHOOK_SECRET = "correct-secret";
    const req = {
      nextUrl: { searchParams: { get: (k: string) => (k === "secret" ? "correct-secret" : null) } },
    };
    expect(verifyEbayWebhook(req)).toBe(true);
  });
});

describe("ebayWebhookEnvelopeIsTrusted", () => {
  it("accepts a parseable ping with item or seller id when the query secret is missing", () => {
    expect(
      ebayWebhookEnvelopeIsTrusted({ parseable: true, itemId: "394295737513", ebayUserId: null })
    ).toBe(true);
    expect(
      ebayWebhookEnvelopeIsTrusted({ parseable: true, itemId: null, ebayUserId: "seller1" })
    ).toBe(true);
  });

  it("rejects an empty or unparseable body", () => {
    expect(
      ebayWebhookEnvelopeIsTrusted({ parseable: false, itemId: "394295737513", ebayUserId: null })
    ).toBe(false);
    expect(
      ebayWebhookEnvelopeIsTrusted({ parseable: true, itemId: null, ebayUserId: null })
    ).toBe(false);
  });
});

describe("ebayCommerceChallengeResponse", () => {
  it("hashes challengeCode + token + endpoint in that order", () => {
    const endpoint = "https://www.inwcommunity.com/api/channels/ebay/webhook?secret=abc";
    expect(ebayCommerceChallengeResponse("challenge-1", "verify-token", endpoint)).toBe(
      createHash("sha256")
        .update("challenge-1")
        .update("verify-token")
        .update(endpoint)
        .digest("hex")
    );
  });
});
