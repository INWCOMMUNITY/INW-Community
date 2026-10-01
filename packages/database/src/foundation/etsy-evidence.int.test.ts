import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMember } from "./fixtures";
import { foundationTestDatabaseUrl } from "./local-url";
import { persistEtsyInstall } from "../etsy/connection";
import {
  ingestEtsyWebhookEvidence,
  resolveEtsyConnectionForWebhook,
} from "../etsy/evidence";
import { claimNextEtsySyncJob, completeEtsySyncJobSuccess } from "../etsy/jobs";

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

describe("etsy provider evidence foundation", () => {
  it("binds generation, dedupes webhook id, and claims PROCESS_PROVIDER_EVIDENCE", async () => {
    const seller = await createMember(prisma, "etsy-ev");
    const shopId = `8${seller.id.replace(/\D/g, "").slice(-7) || "7654321"}`;
    const connectedAt = new Date("2026-09-30T12:00:00Z");

    const connection = await persistEtsyInstall(prisma, {
      memberId: seller.id,
      etsyUserId: `3${shopId.slice(-6)}`,
      shopId,
      shopName: "Evidence Shop",
      accessTokenEncrypted: "cipher-a",
      refreshTokenEncrypted: "cipher-r",
      accessTokenExpiresAt: new Date("2026-09-30T13:00:00Z"),
      refreshTokenExpiresAt: new Date("2026-12-29T00:00:00Z"),
      grantedScopes: "listings_r listings_w shops_r transactions_r",
      connectedAt,
    });

    const bound = await resolveEtsyConnectionForWebhook(prisma, {
      shopId,
      triggeredAt: new Date("2026-09-30T12:30:00Z"),
    });
    expect(bound).toBe(connection.id);

    const rawBody = JSON.stringify({
      event_type: "order.paid",
      shop_id: Number(shopId),
      receipt_id: 55,
    });

    const created = await ingestEtsyWebhookEvidence(prisma, {
      shopId,
      topic: "order.paid",
      webhookId: `wh-${seller.id.slice(-10)}`,
      triggeredAt: new Date("2026-09-30T12:30:00Z"),
      rawBody,
    });
    expect(created.status).toBe("CREATED");
    expect(created.jobId).toBeTruthy();
    expect(created.evidence.processState).toBe("RECEIVED");

    const dup = await ingestEtsyWebhookEvidence(prisma, {
      shopId,
      topic: "order.paid",
      webhookId: `wh-${seller.id.slice(-10)}`,
      triggeredAt: new Date("2026-09-30T12:31:00Z"),
      rawBody,
    });
    expect(dup.status).toBe("DUPLICATE");
    expect(dup.jobId).toBe(created.jobId);

    const queued = await prisma.etsySyncJob.findUniqueOrThrow({
      where: { id: created.jobId! },
    });
    expect(queued.kind).toBe("PROCESS_PROVIDER_EVIDENCE");
    expect(queued.evidenceId).toBe(created.evidence.id);
    expect(queued.state).toBe("PENDING");

    // Make this job the only due row for the claim test.
    await prisma.etsySyncJob.updateMany({
      where: {
        id: { not: queued.id },
        state: { in: ["PENDING", "RETRY_WAIT"] },
      },
      data: { nextAttemptAt: new Date("2099-01-01T00:00:00Z") },
    });
    await prisma.etsySyncJob.update({
      where: { id: queued.id },
      data: { nextAttemptAt: new Date("2020-01-01T00:00:00Z") },
    });

    const claim = await claimNextEtsySyncJob(prisma, { workerId: "test-etsy" });
    expect(claim?.kind).toBe("PROCESS_PROVIDER_EVIDENCE");
    expect(claim?.evidenceId).toBe(created.evidence.id);
    if (claim) {
      await expect(completeEtsySyncJobSuccess(prisma, claim)).resolves.toBe(true);
    }
  });
});
