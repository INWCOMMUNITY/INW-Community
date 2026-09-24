import { NextRequest, NextResponse } from "next/server";
import { ingestShopifyWebhookEvidence, prisma } from "database";
import { readShopifyAppConfig } from "@/lib/shopify/config";
import { verifyShopifyWebhookHmac } from "@/lib/shopify/hmac";
import { normalizeShopifyShopDomain } from "@/lib/shopify/shop-domain";

export const dynamic = "force-dynamic";

function parseTriggeredAt(value: string | null): Date | null {
  if (!value || !value.trim()) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

/**
 * Generic Shopify webhook evidence inbox.
 * Verifies HMAC, persists evidence, enqueues processing job. No Admin API calls.
 * Does not replace the dedicated app/uninstalled route.
 */
export async function POST(req: NextRequest) {
  const config = readShopifyAppConfig();
  if (!config) return NextResponse.json({ error: "Shopify is not configured" }, { status: 503 });

  const rawBody = await req.text();
  const hmac = req.headers.get("x-shopify-hmac-sha256");
  if (!verifyShopifyWebhookHmac(rawBody, hmac, config.clientSecret)) {
    return NextResponse.json({ error: "Invalid webhook signature" }, { status: 401 });
  }

  const webhookId = req.headers.get("x-shopify-webhook-id")?.trim() ?? "";
  if (!webhookId) {
    return NextResponse.json({ error: "Missing webhook id" }, { status: 400 });
  }

  const triggeredAt = parseTriggeredAt(req.headers.get("x-shopify-triggered-at"));
  if (!triggeredAt) {
    return NextResponse.json({ error: "Invalid webhook timestamp" }, { status: 400 });
  }

  const topic = (req.headers.get("x-shopify-topic") ?? "").trim().toLowerCase();
  if (!topic) {
    return NextResponse.json({ error: "Missing topic" }, { status: 400 });
  }

  const headerShop = normalizeShopifyShopDomain(req.headers.get("x-shopify-shop-domain") ?? "");
  let bodyShop: string | null = null;
  try {
    const parsed = JSON.parse(rawBody) as { myshopify_domain?: unknown; domain?: unknown };
    const candidate =
      typeof parsed.myshopify_domain === "string"
        ? parsed.myshopify_domain
        : typeof parsed.domain === "string"
          ? parsed.domain
          : null;
    bodyShop = candidate ? normalizeShopifyShopDomain(candidate) : null;
  } catch {
    bodyShop = null;
  }
  const shopDomain = headerShop ?? bodyShop;
  if (!shopDomain || (bodyShop && headerShop && bodyShop !== headerShop)) {
    return NextResponse.json({ error: "Invalid shop" }, { status: 400 });
  }

  const result = await ingestShopifyWebhookEvidence(prisma, {
    shopDomain,
    topic,
    webhookId,
    eventId: req.headers.get("x-shopify-event-id"),
    triggeredAt,
    apiVersion: req.headers.get("x-shopify-api-version"),
    rawBody,
  });

  return NextResponse.json({
    ok: true,
    duplicate: result.status === "DUPLICATE",
    evidenceId: result.evidence.id,
    jobId: result.jobId,
  });
}
