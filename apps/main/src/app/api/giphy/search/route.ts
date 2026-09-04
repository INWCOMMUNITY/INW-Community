import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, getClientIdentifier } from "@/lib/rate-limit";

const GIPHY_API_KEY =
  process.env.GIPHY_API_KEY ??
  process.env.EXPO_PUBLIC_GIPHY_API_KEY_IOS ??
  process.env.EXPO_PUBLIC_GIPHY_API_KEY_ANDROID ??
  "";

export async function GET(req: NextRequest) {
  const { allowed } = checkRateLimit(`giphy-search:${getClientIdentifier(req)}`, { max: 40 });
  if (!allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }
  if (!GIPHY_API_KEY) {
    return NextResponse.json({ error: "GIF search is unavailable" }, { status: 503 });
  }
  const q = req.nextUrl.searchParams.get("q") ?? "";
  const offset = Math.min(parseInt(req.nextUrl.searchParams.get("offset") ?? "0", 10) || 0, 4999);
  const limit = Math.min(parseInt(req.nextUrl.searchParams.get("limit") ?? "24", 10) || 24, 50);

  if (!q.trim()) {
    return NextResponse.json({ data: [], meta: {}, pagination: {} });
  }

  try {
    const res = await fetch(
      `https://api.giphy.com/v1/gifs/search?api_key=${GIPHY_API_KEY}&q=${encodeURIComponent(q)}&limit=${limit}&offset=${offset}&rating=g`
    );
    const data = await res.json();
    if (!res.ok) {
      return NextResponse.json({ error: "Failed to search GIFs" }, { status: 502 });
    }
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: "Failed to search GIFs" }, { status: 500 });
  }
}
