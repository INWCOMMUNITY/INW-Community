import { NextResponse } from "next/server";
import { prisma, ingestWixWebhookEvidence } from "database";
import { verifyWixWebhook } from "@/lib/wix/webhook-verify";
import { isWixConfigured, readWixAppConfig } from "@/lib/wix/config";
import { drainWixSyncJobs } from "@/lib/wix/worker";

export const dynamic = "force-dynamic";

/**
 * POST /api/wix/webhook
 * Receives Wix webhook JWTs and ingests the decoded event for processing.
 */
export async function POST(request: Request): Promise<Response> {
  if (!isWixConfigured()) {
    return NextResponse.json({ error: "Wix not configured" }, { status: 503 });
  }

  const config = readWixAppConfig();
  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return NextResponse.json({ error: "Failed to read body" }, { status: 400 });
  }

  if (!rawBody.trim()) {
    return NextResponse.json({ error: "Empty body" }, { status: 400 });
  }

  const allowUnsigned = process.env.WIX_WEBHOOK_ALLOW_UNSIGNED === "true";
  const verification = verifyWixWebhook({
    rawBody,
    publicKey: config?.webhookPublicKey ?? null,
    allowUnsigned,
  });

  if (!verification.valid) {
    console.warn("Wix webhook verification failed:", verification.error);
    return NextResponse.json({ error: verification.error }, { status: 401 });
  }

  try {
    const result = await ingestWixWebhookEvidence(prisma, {
      webhookId: verification.webhookId,
      topic: verification.topic,
      rawBody: JSON.stringify(verification.event),
      instanceId: verification.instanceId,
      siteId: verification.siteId,
      eventId: verification.eventId,
      triggeredAt: verification.triggeredAt,
    });

    if (result.status === "DUPLICATE") {
      return NextResponse.json({ status: "duplicate" });
    }

    if (result.status === "CONNECTION_NOT_FOUND") {
      console.warn("Wix webhook for unconnected instance:", verification.instanceId);
      return NextResponse.json({ status: "unconnected" });
    }

    console.info("WIX_WEBHOOK_INGESTED", {
      webhookId: verification.webhookId,
      topic: verification.topic,
      instanceId: verification.instanceId,
      evidenceId: result.evidenceId,
      jobId: result.jobId,
    });

    await drainWixSyncJobs({ maxJobs: 6, workerId: `wix-webhook-${result.evidenceId}` });

    return NextResponse.json({ status: "accepted", evidenceId: result.evidenceId });
  } catch (error) {
    console.error("Wix webhook ingestion error:", error);
    return NextResponse.json({ error: "Ingestion failed" }, { status: 500 });
  }
}

/**
 * GET /api/wix/webhook
 * Health check.
 */
export async function GET(): Promise<Response> {
  return NextResponse.json({ status: "ok", service: "wix-webhook" });
}
