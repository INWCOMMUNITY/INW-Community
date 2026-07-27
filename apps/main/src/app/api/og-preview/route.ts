import { NextRequest, NextResponse } from "next/server";
import { fetchOGPreview } from "@/lib/og-preview";

const BLOCKED_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^\[::1\]$/,
  /^0\./,
];

function isBlockedUrl(urlStr: string): boolean {
  try {
    const parsed = new URL(urlStr);
    return BLOCKED_HOST_PATTERNS.some((p) => p.test(parsed.hostname));
  } catch {
    return true;
  }
}

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");

  if (!url) {
    return NextResponse.json({ error: "Missing url parameter" }, { status: 400 });
  }

  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    return NextResponse.json(
      { error: "URL must start with http:// or https://" },
      { status: 400 }
    );
  }

  if (isBlockedUrl(url)) {
    return NextResponse.json({ error: "URL not allowed" }, { status: 400 });
  }

  const preview = await fetchOGPreview(url);

  return NextResponse.json(preview ?? {}, {
    headers: {
      "Cache-Control": "public, max-age=86400",
    },
  });
}
