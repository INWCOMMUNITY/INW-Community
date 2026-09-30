import { NextRequest, NextResponse } from "next/server";
import { revokeActiveShopifyConnectionsForShop } from "database";
import { prisma } from "database";
import { readShopifyAppConfig } from "@/lib/shopify/config";
import { verifyShopifyWebhookHmac } from "@/lib/shopify/hmac";
import { normalizeShopifyShopDomain } from "@/lib/shopify/shop-domain";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const config = readShopifyAppConfig();
  if (!config) return NextResponse.json({ error: "Shopify is not configured" }, { status: 503 });
  const rawBody = await req.text();
  const hmac = req.headers.get("x-shopify-hmac-sha256");
  if (!verifyShopifyWebhookHmac(rawBody, hmac, config.clientSecret)) {
    return NextResponse.json({ error: "Invalid webhook signature" }, { status: 401 });
  }
  const topic = (req.headers.get("x-shopify-topic") ?? "").toLowerCase();
  if (topic !== "app/uninstalled") {
    return NextResponse.json({ error: "Unsupported topic" }, { status: 400 });
  }
  const headerShop = normalizeShopifyShopDomain(req.headers.get("x-shopify-shop-domain") ?? "");
  let bodyShop: string | null = null;
  try {
    const parsed = JSON.parse(rawBody) as { myshopify_domain?: unknown; domain?: unknown };
    const candidate = typeof parsed.myshopify_domain === "string" ? parsed.myshopify_domain : parsed.domain;
    bodyShop = typeof candidate === "string" ? normalizeShopifyShopDomain(candidate) : null;
  } catch {
    bodyShop = null;
  }
  const shopDomain = headerShop ?? bodyShop;
  if (!shopDomain || (bodyShop && headerShop && bodyShop !== headerShop)) {
    return NextResponse.json({ error: "Invalid shop" }, { status: 400 });
  }
  const triggeredAt = parseShopifyTriggeredAt(req.headers.get("x-shopify-triggered-at"));
  if (!triggeredAt) {
    return NextResponse.json({ error: "Invalid webhook timestamp" }, { status: 400 });
  }
  await revokeActiveShopifyConnectionsForShop(prisma, shopDomain, triggeredAt);
  return NextResponse.json({ ok: true });
}

function parseShopifyTriggeredAt(value: string | null): Date | null {
  if (!value || !value.trim()) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}
