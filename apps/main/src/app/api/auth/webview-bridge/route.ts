import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { prisma } from "database";
import { getBearerToken, verifyMobileToken } from "@/lib/mobile-auth";
import { isAllowedWebviewBridgePath } from "@/lib/app-webview-params";

const BRIDGE_TTL_MS = 5 * 60 * 1000;

export async function POST(req: NextRequest) {
  try {
    const bearer = getBearerToken(req);
    if (!bearer) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const payload = await verifyMobileToken(bearer);
    if (!payload) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await req.json().catch(() => ({}))) as { next?: string };
    const next = typeof body.next === "string" ? body.next.trim() : "";
    if (!next.startsWith("/")) {
      return NextResponse.json({ error: "Invalid next path" }, { status: 400 });
    }
    if (!isAllowedWebviewBridgePath(next)) {
      return NextResponse.json({ error: "Path not allowed for webview bridge" }, { status: 400 });
    }

    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + BRIDGE_TTL_MS);

    await prisma.webviewBridgeToken.create({
      data: { token, memberId: payload.id, expiresAt },
    });

    const origin = new URL(req.url).origin;
    const redirectUrl = `${origin}/auth/app-bridge?code=${encodeURIComponent(token)}&next=${encodeURIComponent(next)}`;

    return NextResponse.json({ redirectUrl });
  } catch (e) {
    console.error("webview-bridge POST", e);
    return NextResponse.json({ error: "Could not create bridge session" }, { status: 500 });
  }
}
