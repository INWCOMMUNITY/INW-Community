import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getClientIdentifier } from "@/lib/rate-limit";

const WINDOW_MS = 60 * 1000;
const MAX_REQUESTS = 120;
const store = new Map<string, number[]>();

function checkRateLimit(key: string): boolean {
  const now = Date.now();
  const cutoff = now - WINDOW_MS;
  let timestamps = store.get(key) ?? [];
  timestamps = timestamps.filter((t) => t > cutoff);
  store.set(key, timestamps);
  if (timestamps.length >= MAX_REQUESTS) return false;
  timestamps.push(now);
  return true;
}

const VALID_EVENT_TYPES = [
  "listing_view",
  "storefront_view",
  "cart_add",
  "purchase",
  "offer_received",
] as const;

const VALID_PROVIDERS = ["ebay", "etsy", "shopify", "wix", "inwc"] as const;
const VALID_SOURCES = ["web", "mobile", "external"] as const;

type EventType = (typeof VALID_EVENT_TYPES)[number];
type Provider = (typeof VALID_PROVIDERS)[number];
type Source = (typeof VALID_SOURCES)[number];

interface TrackEventBody {
  eventType: EventType;
  storeItemId?: string;
  provider?: Provider;
  source?: Source;
  metadata?: Record<string, unknown>;
}

export async function POST(req: NextRequest) {
  const ip = getClientIdentifier(req);
  if (!checkRateLimit(`seller-analytics:${ip}`)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  try {
    const body = (await req.json()) as TrackEventBody;
    const { eventType, storeItemId, provider, source, metadata } = body;

    if (!eventType || !VALID_EVENT_TYPES.includes(eventType)) {
      return NextResponse.json(
        { error: "Invalid eventType", valid: VALID_EVENT_TYPES },
        { status: 400 }
      );
    }

    if (provider && !VALID_PROVIDERS.includes(provider)) {
      return NextResponse.json(
        { error: "Invalid provider", valid: VALID_PROVIDERS },
        { status: 400 }
      );
    }

    if (source && !VALID_SOURCES.includes(source)) {
      return NextResponse.json(
        { error: "Invalid source", valid: VALID_SOURCES },
        { status: 400 }
      );
    }

    let memberId: string | null = null;

    if (storeItemId) {
      const item = await prisma.storeItem.findUnique({
        where: { id: storeItemId },
        select: { memberId: true },
      });
      if (!item) {
        return NextResponse.json({ error: "Store item not found" }, { status: 404 });
      }
      memberId = item.memberId;
    } else if (eventType === "storefront_view") {
      const businessSlug = (metadata as Record<string, unknown>)?.businessSlug as string;
      if (businessSlug) {
        const business = await prisma.business.findUnique({
          where: { slug: businessSlug },
          select: { memberId: true },
        });
        if (business) {
          memberId = business.memberId;
        }
      }
    }

    if (!memberId) {
      return NextResponse.json(
        { error: "Could not determine seller from event" },
        { status: 400 }
      );
    }

    await prisma.sellerAnalyticsEvent.create({
      data: {
        memberId,
        storeItemId: storeItemId ?? null,
        eventType,
        provider: provider ?? "inwc",
        source: source ?? "web",
        metadata: metadata !== undefined ? (metadata as object) : undefined,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = String(e);
    const isDbUnreachable = /P1001|ECONNREFUSED|connect|Can't reach database server/i.test(msg);
    if (isDbUnreachable) {
      console.warn("[seller-analytics/track] database unreachable, event dropped");
      return NextResponse.json({ ok: false, skipped: true }, { status: 503 });
    }
    console.error("[seller-analytics/track]", e);
    return NextResponse.json({ error: "Failed to track" }, { status: 500 });
  }
}
