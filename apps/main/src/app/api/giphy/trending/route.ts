import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, getClientIdentifier } from "@/lib/rate-limit";

const GIPHY_API_KEY =
  process.env.GIPHY_API_KEY ??
  process.env.EXPO_PUBLIC_GIPHY_API_KEY_IOS ??
  process.env.EXPO_PUBLIC_GIPHY_API_KEY_ANDROID ??
  "";

export async function GET(req: NextRequest) {
  const { allowed } = checkRateLimit(`giphy-trending:${getClientIdentifier(req)}`, { max: 40 });
  if (!allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }
  if (!GIPHY_API_KEY) {
    return NextResponse.json({ error: "GIF search is unavailable" }, { status: 503 });
  }
  const limit = Math.min(parseInt(req.nextUrl.searchParams.get("limit") ?? "24", 10) || 24, 50);
  try {
    const res = await fetch(
      `https://api.giphy.com/v1/gifs/trending?api_key=${GIPHY_API_KEY}&limit=${limit}&rating=g`
    );
    const data = await res.json();
    if (!res.ok) {
      return NextResponse.json({ error: "Failed to fetch GIFs" }, { status: 502 });
    }
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: "Failed to fetch GIFs" }, { status: 500 });
  }
}
