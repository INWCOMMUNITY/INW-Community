import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getClientIdentifier } from "@/lib/rate-limit";

const WINDOW_MS = 60 * 1000;
const MAX_REQUESTS = 60;
const store = new Map<string, number[]>();

function checkAnalyticsRateLimit(key: string): boolean {
  const now = Date.now();
  const cutoff = now - WINDOW_MS;
  let timestamps = store.get(key) ?? [];
  timestamps = timestamps.filter((t) => t > cutoff);
  store.set(key, timestamps);
  if (timestamps.length >= MAX_REQUESTS) return false;
  timestamps.push(now);
  return true;
}

export async function POST(req: NextRequest) {
  const ip = getClientIdentifier(req);
  if (!checkAnalyticsRateLimit(ip)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  try {
    const body = (await req.json()) as Record<string, unknown>;
    const event = body.event as string;
    const source = body.source as string;

    if (!event || !source) {
      return NextResponse.json({ error: "event and source required" }, { status: 400 });
    }
    if (!["pageview", "app_open", "web_vitals"].includes(event)) {
      return NextResponse.json({ error: "Invalid event" }, { status: 400 });
    }
    if (!["web", "ios", "android"].includes(source)) {
      return NextResponse.json({ error: "Invalid source" }, { status: 400 });
    }

    const path = typeof body.path === "string" ? body.path : null;
    const name = typeof body.name === "string" ? body.name : null;
    const value = typeof body.value === "number" ? body.value : null;

    await prisma.analyticsEvent.create({
      data: { event, source, path, name, value },
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[analytics/track]", e);
    return NextResponse.json({ error: "Failed to track" }, { status: 500 });
  }
}
