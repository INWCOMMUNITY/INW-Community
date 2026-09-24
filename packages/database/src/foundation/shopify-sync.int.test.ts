import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMember } from "./fixtures";
import { foundationTestDatabaseUrl } from "./local-url";
import {
  disconnectShopifyConnection,
  persistShopifyInstall,
} from "../shopify/connection";
import {
  hashShopifyWebhookPayload,
  ingestShopifyWebhookEvidence,
} from "../shopify/evidence";
import {
  claimNextShopifySyncJob,
  completeShopifySyncJobDead,
  completeShopifySyncJobRetry,
  completeShopifySyncJobSuccess,
  enqueueShopifySyncJob,
  ShopifySyncJobConflictError,
} from "../shopify/jobs";

let prisma: PrismaClient;

beforeAll(() => {
  prisma = new PrismaClient({
    datasources: { db: { url: foundationTestDatabaseUrl() } },
    log: ["error"],
  });
});

afterAll(async () => {
  await prisma?.$disconnect();
});

async function activeConnection(memberId: string, shop: string, connectedAt: Date, shopId: string) {
  return persistShopifyInstall(prisma, {
    memberId,
    shopDomain: shop,
    shopId,
    accessTokenEncrypted: "cipher-access",
    refreshTokenEncrypted: "cipher-refresh",
    accessTokenExpiresAt: new Date("2026-09-24T02:00:00Z"),
    refreshTokenExpiresAt: new Date("2026-12-23T00:00:00Z"),
    grantedScopes: "write_products,write_inventory,read_orders,read_locations",
    primaryLocationId: "gid://shopify/Location/1",
    connectedAt,
  });
}

describe("shopify sync infrastructure", () => {
  it("persists evidence, binds generations, and claims jobs safely", async () => {
    const seller = await createMember(prisma, "s3");
    const shop = `s3-${seller.id.slice(-8)}.myshopify.com`;
    const shopId = `gid://shopify/Shop/${seller.id.replace(/\D/g, "").slice(0, 8) || "3301"}`;
    const beforeVariants = await prisma.storeVariant.count();
    const beforeStates = await prisma.inventoryState.count();
    const beforeEvents = await prisma.inventoryEvent.count();
    const beforeOrders = await prisma.storeOrder.count();
    const beforeLinks = await prisma.shopifyListingLink.count();

    const gen1 = await activeConnection(
      seller.id,
      shop,
      new Date("2026-09-24T12:00:00Z"),
      shopId
    );
    const body = JSON.stringify({ myshopify_domain: shop, id: 99 });
    const hash = hashShopifyWebhookPayload(body);

    const created = await ingestShopifyWebhookEvidence(prisma, {
      shopDomain: shop,
      topic: "products/update",
      webhookId: `wh-${seller.id}-1`,
      eventId: `evt-${seller.id}`,
      triggeredAt: new Date("2026-09-24T12:30:00Z"),
      apiVersion: "2026-07",
      rawBody: body,
    });
    expect(created.status).toBe("CREATED");
    expect(created.evidence.shopifyConnectionId).toBe(gen1.id);
    expect(created.evidence.payloadHash).toBe(hash);
    expect(created.evidence.processState).toBe("RECEIVED");
    expect(created.jobId).toBeTruthy();

    const dup = await ingestShopifyWebhookEvidence(prisma, {
      shopDomain: shop,
      topic: "products/update",
      webhookId: `wh-${seller.id}-1`,
      eventId: `evt-${seller.id}`,
      triggeredAt: new Date("2026-09-24T12:30:00Z"),
      rawBody: body,
    });
    expect(dup.status).toBe("DUPLICATE");
    expect(dup.evidence.id).toBe(created.evidence.id);
    expect(dup.jobId).toBe(created.jobId);
    expect(await prisma.shopifyProviderEvidence.count({ where: { webhookId: `wh-${seller.id}-1` } })).toBe(
      1
    );
    expect(await prisma.shopifySyncJob.count({ where: { evidenceId: created.evidence.id } })).toBe(1);

    const otherDelivery = await ingestShopifyWebhookEvidence(prisma, {
      shopDomain: shop,
      topic: "products/update",
      webhookId: `wh-${seller.id}-2`,
      eventId: `evt-${seller.id}`,
      triggeredAt: new Date("2026-09-24T12:45:00Z"),
      rawBody: body,
    });
    expect(otherDelivery.status).toBe("CREATED");
    expect(otherDelivery.evidence.eventId).toBe(`evt-${seller.id}`);

    await disconnectShopifyConnection(prisma, { memberId: seller.id, connectionId: gen1.id });
    const gen2 = await activeConnection(
      seller.id,
      shop,
      new Date("2026-09-24T14:00:00Z"),
      shopId
    );
    expect(gen2.generation).toBe(2);

    const stale = await ingestShopifyWebhookEvidence(prisma, {
      shopDomain: shop,
      topic: "products/update",
      webhookId: `wh-${seller.id}-stale`,
      eventId: `evt-stale`,
      triggeredAt: new Date("2026-09-24T12:50:00Z"),
      rawBody: body,
    });
    expect(stale.evidence.shopifyConnectionId).toBe(gen1.id);
    expect(stale.evidence.shopifyConnectionId).not.toBe(gen2.id);

    const current = await ingestShopifyWebhookEvidence(prisma, {
      shopDomain: shop,
      topic: "products/update",
      webhookId: `wh-${seller.id}-current`,
      triggeredAt: new Date("2026-09-24T14:30:00Z"),
      rawBody: body,
    });
    expect(current.evidence.shopifyConnectionId).toBe(gen2.id);

    const unknown = await ingestShopifyWebhookEvidence(prisma, {
      shopDomain: `unknown-${seller.id.slice(-6)}.myshopify.com`,
      topic: "products/update",
      webhookId: `wh-${seller.id}-unknown`,
      triggeredAt: new Date("2026-09-24T15:00:00Z"),
      rawBody: JSON.stringify({ myshopify_domain: `unknown-${seller.id.slice(-6)}.myshopify.com` }),
    });
    expect(unknown.evidence.shopifyConnectionId).toBeNull();
    expect(unknown.evidence.processState).toBe("IGNORED");
    expect(unknown.jobId).toBeNull();
    expect(await prisma.shopifyConnection.count({ where: { shopDomain: unknown.evidence.shopDomain } })).toBe(
      0
    );

    const uninstall = await ingestShopifyWebhookEvidence(prisma, {
      shopDomain: shop,
      topic: "app/uninstalled",
      webhookId: `wh-${seller.id}-uninstall`,
      triggeredAt: new Date("2026-09-24T14:40:00Z"),
      rawBody: body,
    });
    expect(uninstall.evidence.processState).toBe("IGNORED");
    expect(uninstall.jobId).toBeNull();

    // Isolate later claim assertions from leftover evidence jobs (including prior test runs).
    await prisma.shopifySyncJob.updateMany({
      where: {
        OR: [
          { shopifyConnectionId: { in: [gen1.id, gen2.id] } },
          { state: { in: ["PENDING", "RETRY_WAIT", "RUNNING"] } },
        ],
      },
      data: {
        state: "SUCCEEDED",
        nextAttemptAt: new Date("2099-01-01T00:00:00Z"),
        completedAt: new Date(),
        leaseOwner: null,
        leaseToken: null,
        leaseExpiresAt: null,
      },
    });

    const jobA = await enqueueShopifySyncJob(prisma, {
      shopifyConnectionId: gen2.id,
      kind: "PROCESS_PROVIDER_EVIDENCE",
      dedupeKey: `manual-${seller.id}`,
      payload: { n: 1 },
    });
    const jobAAgain = await enqueueShopifySyncJob(prisma, {
      shopifyConnectionId: gen2.id,
      kind: "PROCESS_PROVIDER_EVIDENCE",
      dedupeKey: `manual-${seller.id}`,
      payload: { n: 1 },
    });
    expect(jobAAgain.id).toBe(jobA.id);
    await expect(
      enqueueShopifySyncJob(prisma, {
        shopifyConnectionId: gen2.id,
        kind: "PROCESS_PROVIDER_EVIDENCE",
        dedupeKey: `manual-${seller.id}`,
        payload: { n: 2 },
      })
    ).rejects.toBeInstanceOf(ShopifySyncJobConflictError);

    const dueJobB = await enqueueShopifySyncJob(prisma, {
      shopifyConnectionId: gen2.id,
      kind: "PROCESS_PROVIDER_EVIDENCE",
      dedupeKey: `manual-b-${seller.id}`,
      payload: { n: "b" },
    });
    expect(dueJobB.id).not.toBe(jobA.id);

    const [claim1, claim2] = await Promise.all([
      claimNextShopifySyncJob(prisma, { workerId: "w1", leaseMs: 60_000 }),
      claimNextShopifySyncJob(prisma, { workerId: "w2", leaseMs: 60_000 }),
    ]);
    expect(claim1).not.toBeNull();
    expect(claim2).not.toBeNull();
    expect(claim1!.id).not.toBe(claim2!.id);
    expect(new Set([claim1!.id, claim2!.id])).toEqual(new Set([jobA.id, dueJobB.id]));

    expect(await completeShopifySyncJobSuccess(prisma, claim1!)).toBe(true);
    expect(
      (await prisma.shopifySyncJob.findUniqueOrThrow({ where: { id: claim1!.id } })).state
    ).toBe("SUCCEEDED");
    expect(await completeShopifySyncJobSuccess(prisma, claim2!)).toBe(true);

    const solo = await enqueueShopifySyncJob(prisma, {
      shopifyConnectionId: gen2.id,
      kind: "PROCESS_PROVIDER_EVIDENCE",
      dedupeKey: `solo-${seller.id}`,
      payload: { t: "solo" },
    });
    const [soloA, soloB] = await Promise.all([
      claimNextShopifySyncJob(prisma, { workerId: "solo-a", leaseMs: 60_000 }),
      claimNextShopifySyncJob(prisma, { workerId: "solo-b", leaseMs: 60_000 }),
    ]);
    const soloClaims = [soloA, soloB].filter(Boolean);
    expect(soloClaims).toHaveLength(1);
    expect(soloClaims[0]!.id).toBe(solo.id);
    expect(await completeShopifySyncJobSuccess(prisma, soloClaims[0]!)).toBe(true);

    const retryJob = await enqueueShopifySyncJob(prisma, {
      shopifyConnectionId: gen2.id,
      kind: "PROCESS_PROVIDER_EVIDENCE",
      dedupeKey: `retry-${seller.id}`,
      payload: { t: "retry" },
      maxAttempts: 2,
    });
    const retryClaim = await claimNextShopifySyncJob(prisma, { workerId: "retry-w", leaseMs: 60_000 });
    expect(retryClaim?.id).toBe(retryJob.id);
    expect(
      await completeShopifySyncJobRetry(prisma, retryClaim!, {
        outcome: "RETRY",
        errorClass: "TRANSIENT_PROVIDER",
        errorCode: "TMP",
        errorMessage: "temporary",
        retryAt: new Date("2026-09-24T16:00:00Z"),
      })
    ).toBe(true);
    expect(
      (await prisma.shopifySyncJob.findUniqueOrThrow({ where: { id: retryJob.id } })).state
    ).toBe("RETRY_WAIT");

    await prisma.shopifySyncJob.update({
      where: { id: retryJob.id },
      data: { nextAttemptAt: new Date("2026-09-24T12:00:00Z") },
    });
    const retryClaim2 = await claimNextShopifySyncJob(prisma, {
      workerId: "retry-w2",
      leaseMs: 60_000,
      now: new Date("2026-09-24T16:01:00Z"),
    });
    expect(retryClaim2?.id).toBe(retryJob.id);
    expect(
      await completeShopifySyncJobRetry(prisma, retryClaim2!, {
        outcome: "RETRY",
        errorClass: "TRANSIENT_PROVIDER",
      })
    ).toBe(true);
    expect(
      (await prisma.shopifySyncJob.findUniqueOrThrow({ where: { id: retryJob.id } })).state
    ).toBe("DEAD");

    const deadJob = await enqueueShopifySyncJob(prisma, {
      shopifyConnectionId: gen2.id,
      kind: "PROCESS_PROVIDER_EVIDENCE",
      dedupeKey: `dead-${seller.id}`,
      payload: { t: "dead" },
    });
    const deadClaim = await claimNextShopifySyncJob(prisma, { workerId: "dead-w", leaseMs: 60_000 });
    expect(deadClaim?.dedupeKey).toBe(deadJob.dedupeKey);
    expect(
      await completeShopifySyncJobDead(prisma, deadClaim!, {
        outcome: "DEAD",
        errorClass: "GRAPHQL_PERMANENT",
        errorCode: "NOPE",
      })
    ).toBe(true);

    const leaseJob = await enqueueShopifySyncJob(prisma, {
      shopifyConnectionId: gen2.id,
      kind: "PROCESS_PROVIDER_EVIDENCE",
      dedupeKey: `lease-${seller.id}`,
      payload: { t: "lease" },
    });
    const staleClaim = await claimNextShopifySyncJob(prisma, {
      workerId: "stale-owner",
      leaseMs: 1,
    });
    expect(staleClaim?.id).toBe(leaseJob.id);
    await new Promise((r) => setTimeout(r, 5));
    const reclaim = await claimNextShopifySyncJob(prisma, {
      workerId: "new-owner",
      leaseMs: 60_000,
      now: new Date(Date.now() + 1000),
    });
    expect(reclaim?.id).toBe(leaseJob.id);
    expect(reclaim?.leaseOwner).toBe("new-owner");
    expect(await completeShopifySyncJobSuccess(prisma, staleClaim!)).toBe(false);
    expect(await completeShopifySyncJobSuccess(prisma, reclaim!)).toBe(true);
    expect(
      (await prisma.shopifySyncJob.findUniqueOrThrow({ where: { id: leaseJob.id } })).state
    ).toBe("SUCCEEDED");

    expect(claim1!.shopifyConnectionId).toBe(gen2.id);
    expect(claim2!.shopifyConnectionId).toBe(gen2.id);

    expect(await prisma.storeVariant.count()).toBe(beforeVariants);
    expect(await prisma.inventoryState.count()).toBe(beforeStates);
    expect(await prisma.inventoryEvent.count()).toBe(beforeEvents);
    expect(await prisma.storeOrder.count()).toBe(beforeOrders);
    expect(await prisma.shopifyListingLink.count()).toBe(beforeLinks);
  });

  it("converges concurrent duplicate webhook deliveries to one evidence and one job", async () => {
    const seller = await createMember(prisma, "s3-race");
    const shop = `s3r-${seller.id.slice(-8)}.myshopify.com`;
    const shopId = `gid://shopify/Shop/${seller.id.replace(/\D/g, "").slice(0, 8) || "4401"}`;
    const connection = await activeConnection(
      seller.id,
      shop,
      new Date("2026-09-24T12:00:00Z"),
      shopId
    );
    const beforeVariants = await prisma.storeVariant.count();
    const beforeStates = await prisma.inventoryState.count();
    const beforeEvents = await prisma.inventoryEvent.count();
    const beforeOrders = await prisma.storeOrder.count();
    const beforeLinks = await prisma.shopifyListingLink.count();

    const webhookId = `wh-race-${seller.id}`;
    const eventId = `evt-race-${seller.id}`;
    const body = JSON.stringify({ myshopify_domain: shop, id: 42 });
    const input = {
      shopDomain: shop,
      topic: "products/update",
      webhookId,
      eventId,
      triggeredAt: new Date("2026-09-24T12:15:00Z"),
      apiVersion: "2026-07",
      rawBody: body,
    };

    const [a, b] = await Promise.all([
      ingestShopifyWebhookEvidence(prisma, input),
      ingestShopifyWebhookEvidence(prisma, input),
    ]);

    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual(["CREATED", "DUPLICATE"]);
    expect(a.evidence.id).toBe(b.evidence.id);
    expect(a.jobId).toBeTruthy();
    expect(b.jobId).toBe(a.jobId);
    expect(a.evidence.shopifyConnectionId).toBe(connection.id);
    expect(a.evidence.processState).toBe("RECEIVED");
    expect(a.evidence.processState).not.toBe("ERROR");

    expect(await prisma.shopifyProviderEvidence.count({ where: { webhookId } })).toBe(1);
    expect(await prisma.shopifySyncJob.count({ where: { evidenceId: a.evidence.id } })).toBe(1);
    expect(
      (
        await prisma.shopifySyncJob.findUniqueOrThrow({
          where: { evidenceId: a.evidence.id },
        })
      ).kind
    ).toBe("PROCESS_PROVIDER_EVIDENCE");

    const otherWebhook = await ingestShopifyWebhookEvidence(prisma, {
      ...input,
      webhookId: `wh-race-${seller.id}-b`,
    });
    expect(otherWebhook.status).toBe("CREATED");
    expect(otherWebhook.evidence.eventId).toBe(eventId);
    expect(otherWebhook.evidence.id).not.toBe(a.evidence.id);
    expect(await prisma.shopifyProviderEvidence.count({ where: { eventId } })).toBe(2);

    expect(await prisma.storeVariant.count()).toBe(beforeVariants);
    expect(await prisma.inventoryState.count()).toBe(beforeStates);
    expect(await prisma.inventoryEvent.count()).toBe(beforeEvents);
    expect(await prisma.storeOrder.count()).toBe(beforeOrders);
    expect(await prisma.shopifyListingLink.count()).toBe(beforeLinks);
  });
});
