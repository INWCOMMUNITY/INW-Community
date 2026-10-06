import { createSign, generateKeyPairSync } from "crypto";
import { describe, expect, it, vi } from "vitest";
import {
  beginWixListingImportAttempt,
  persistWixInstall,
  restockWixCanceledOrder,
} from "database";
import { mintWixAccessToken } from "./client";
import { verifyWixWebhook } from "./webhook-verify";

describe("mintWixAccessToken", () => {
  it("posts snake_case client credentials to the oauth2 token endpoint", async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(JSON.stringify({ access_token: "token-1" }), { status: 200 });
    });

    const result = await mintWixAccessToken({
      appId: "app-id",
      appSecret: "app-secret",
      instanceId: "instance-1",
      fetchImpl,
    });

    expect(result.accessToken).toBe("token-1");
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://www.wixapis.com/oauth2/token");
    expect(JSON.parse(String(init.body))).toEqual({
      grant_type: "client_credentials",
      client_id: "app-id",
      client_secret: "app-secret",
      instance_id: "instance-1",
    });
  });
});

describe("Wix install URL", () => {
  it("uses app-installer and postInstallationUrl", async () => {
    const { WIX_OAUTH_AUTHORIZE_URL } = await import("./constants");
    expect(WIX_OAUTH_AUTHORIZE_URL).toBe("https://www.wix.com/app-installer");
  });
});

describe("verifyWixWebhook", () => {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = publicKey.export({ type: "spki", format: "pem" }).toString();

  function signJwt(payload: unknown): string {
    const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
    const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const signer = createSign("RSA-SHA256");
    signer.update(`${header}.${body}`);
    signer.end();
    return `${header}.${body}.${signer.sign(privateKey).toString("base64url")}`;
  }

  it("rejects an unsigned body when no public key is configured", () => {
    const result = verifyWixWebhook({
      rawBody: JSON.stringify({ instanceId: "inst", eventType: "order" }),
      publicKey: null,
    });
    expect(result.valid).toBe(false);
  });

  it("rejects a JWT signed with a different key", () => {
    const other = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const header = Buffer.from(JSON.stringify({ alg: "RS256" })).toString("base64url");
    const body = Buffer.from(JSON.stringify({ instanceId: "inst", eventType: "order" })).toString(
      "base64url"
    );
    const signer = createSign("RSA-SHA256");
    signer.update(`${header}.${body}`);
    signer.end();
    const token = `${header}.${body}.${signer.sign(other.privateKey).toString("base64url")}`;
    const result = verifyWixWebhook({ rawBody: token, publicKey: pem });
    expect(result.valid).toBe(false);
  });

  it("accepts a verified JWT and uses the event time", () => {
    const token = signJwt({
      iat: 1_700_000_000,
      data: JSON.stringify({
        instanceId: "inst-1",
        eventType: "wix.ecom.v1.order_approved",
        data: JSON.stringify({ id: "order-1", lineItems: [] }),
      }),
    });
    const result = verifyWixWebhook({ rawBody: token, publicKey: pem });
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.instanceId).toBe("inst-1");
    expect(result.topic).toBe("wix.ecom.v1.order_approved");
    expect(result.triggeredAt.toISOString()).toBe(new Date(1_700_000_000 * 1000).toISOString());
    expect(result.event).toMatchObject({ id: "order-1" });
  });
});

describe("persistWixInstall", () => {
  it("updates the same connection row on reconnect", async () => {
    const rows: Array<Record<string, unknown>> = [];
    const db = {
      wixConnection: {
        findFirst: async ({ where }: { where: Record<string, unknown> }) => {
          return (
            rows.find((row) => {
              if (where.siteId && row.siteId !== where.siteId) return false;
              if (where.status && row.status !== where.status) return false;
              const memberId = where.memberId as { not?: string } | string | undefined;
              if (memberId && typeof memberId === "object" && "not" in memberId) {
                return row.memberId !== memberId.not;
              }
              if (typeof memberId === "string" && row.memberId !== memberId) return false;
              return true;
            }) ?? null
          );
        },
        updateMany: async () => ({ count: 0 }),
        update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const row = rows.find((item) => item.id === where.id);
          if (!row) throw new Error("missing");
          Object.assign(row, data);
          return row;
        },
        create: async ({ data }: { data: Record<string, unknown> }) => {
          const row = { id: "conn-1", disconnectedAt: null, ...data };
          rows.push(row);
          return row;
        },
      },
    };

    const first = await persistWixInstall(db as never, {
      memberId: "member-1",
      instanceId: "inst-old",
      siteId: "site-1",
      shopName: "Shop",
      catalogVersion: "V3_CATALOG",
    });
    const second = await persistWixInstall(db as never, {
      memberId: "member-1",
      instanceId: "inst-new",
      siteId: "site-1",
      shopName: "Shop renamed",
      catalogVersion: "V1_CATALOG",
    });

    expect(second.id).toBe(first.id);
    expect(second.instanceId).toBe("inst-new");
    expect(second.catalogVersion).toBe("V1_CATALOG");
    expect(rows).toHaveLength(1);
  });
});

describe("beginWixListingImportAttempt", () => {
  it("resets a failed attempt instead of inserting a second row", async () => {
    const attempt = {
      id: "attempt-1",
      wixConnectionId: "conn-1",
      wixProductId: "prod-1",
      status: "FAILED",
      listingLinkId: null,
      storeItemId: null,
      memberId: "member-1",
    };
    let creates = 0;
    const db = {
      wixListingImportAttempt: {
        findFirst: async () => attempt,
        findUnique: async () => attempt,
        updateMany: async ({ data }: { data: Record<string, unknown> }) => {
          Object.assign(attempt, data);
          return { count: 1 };
        },
        create: async () => {
          creates += 1;
          throw new Error("should not create");
        },
      },
    };

    const result = await beginWixListingImportAttempt(db as never, {
      wixConnectionId: "conn-1",
      memberId: "member-1",
      wixProductId: "prod-1",
      stockMode: "PHYSICAL",
    });

    expect(result.status).toBe("STARTED");
    expect(attempt.status).toBe("STARTED");
    expect(creates).toBe(0);
  });
});

describe("restockWixCanceledOrder", () => {
  it("marks the sale fact RESTOCKED after a successful restock", async () => {
    const fact = {
      id: "fact-1",
      storeVariantId: "variant-1",
      appliedQuantity: 2,
      wixOrderId: "order-1",
      wixLineItemId: "line-1",
      applyState: "APPLIED",
    };
    const updates: Array<Record<string, unknown>> = [];
    const db = {
      wixOrderLineSaleFact: {
        findMany: async () => [fact],
      },
      $transaction: async (fn: (tx: unknown) => Promise<void>) => {
        await fn({
          wixOrderLineSaleFact: {
            update: async ({ data }: { data: Record<string, unknown> }) => {
              updates.push(data);
              fact.applyState = String(data.applyState);
            },
          },
        });
      },
    };

    const result = await restockWixCanceledOrder(
      db as never,
      { connectionId: "conn-1", wixOrderId: "order-1" },
      { restock: async () => ({ onHand: 2, quantity: 2 }) }
    );

    expect(result.restocked).toBe(1);
    expect(fact.applyState).toBe("RESTOCKED");
    expect(updates).toEqual([{ applyState: "RESTOCKED" }]);
  });

  it("leaves the sale fact APPLIED when restock throws", async () => {
    const fact = {
      id: "fact-1",
      storeVariantId: "variant-1",
      appliedQuantity: 1,
      wixOrderId: "order-1",
      wixLineItemId: "line-1",
      applyState: "APPLIED",
    };
    const db = {
      wixOrderLineSaleFact: {
        findMany: async () => [fact],
        update: async () => {
          throw new Error("fact should stay APPLIED");
        },
      },
      $transaction: async (fn: (tx: unknown) => Promise<void>) => {
        await fn({
          wixOrderLineSaleFact: {
            update: async () => {
              throw new Error("should not update");
            },
          },
        });
      },
    };

    const result = await restockWixCanceledOrder(
      db as never,
      { connectionId: "conn-1", wixOrderId: "order-1" },
      {
        restock: async () => {
          throw new Error("cannot restock");
        },
      }
    );

    expect(result.restocked).toBe(0);
    expect(fact.applyState).toBe("APPLIED");
  });
});
