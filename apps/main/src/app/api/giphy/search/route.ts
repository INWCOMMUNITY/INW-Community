import { NextRequest, NextResponse } from "next/server";

const GIPHY_API_KEY =
  process.env.GIPHY_API_KEY ??
  process.env.EXPO_PUBLIC_GIPHY_API_KEY_IOS ??
  process.env.EXPO_PUBLIC_GIPHY_API_KEY_ANDROID ??
  "";

export async function GET(req: NextRequest) {
  if (!GIPHY_API_KEY) {
    return NextResponse.json({ error: "GIPHY API key not configured" }, { status: 500 });
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
      return NextResponse.json(
        { error: data.meta?.msg ?? "GIPHY API error" },
        { status: res.status }
      );
    }
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message ?? "Failed to search GIFs" },
      { status: 500 }
    );
  }
}
