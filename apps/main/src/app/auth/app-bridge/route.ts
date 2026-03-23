import { NextRequest, NextResponse } from "next/server";
import { encode } from "next-auth/jwt";
import { prisma } from "database";
import { isAllowedWebviewBridgePath } from "@/lib/app-webview-params";

const SESSION_MAX_AGE_SEC = 30 * 24 * 60 * 60;

function sessionCookieName(): string {
  const secure = process.env.NEXTAUTH_URL?.startsWith("https://") ?? false;
  return secure ? "__Secure-next-auth.session-token" : "next-auth.session-token";
}

function normalizeNextPath(nextParam: string): string | null {
  try {
    const decoded = decodeURIComponent(nextParam);
    if (decoded.startsWith("http://") || decoded.startsWith("https://")) {
      const u = new URL(decoded);
      return u.pathname + u.search + u.hash;
    }
    return decoded;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const nextRaw = req.nextUrl.searchParams.get("next");
  if (!code || !nextRaw) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  const nextPath = normalizeNextPath(nextRaw);
  if (!nextPath || !isAllowedWebviewBridgePath(nextPath)) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  const row = await prisma.webviewBridgeToken.findUnique({ where: { token: code } });
  if (!row || row.consumedAt || row.expiresAt < new Date()) {
    return NextResponse.redirect(new URL("/login?error=BridgeExpired", req.url));
  }

  const member = await prisma.member.findUnique({ where: { id: row.memberId } });
  if (!member || member.status === "suspended") {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  await prisma.webviewBridgeToken.update({
    where: { id: row.id },
    data: { consumedAt: new Date() },
  });

  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) {
    return NextResponse.redirect(new URL("/login?error=Config", req.url));
  }

  const jwt = await encode({
    token: {
      name: `${member.firstName} ${member.lastName}`,
      email: member.email,
      picture: member.profilePhotoUrl ?? undefined,
      sub: member.id,
      id: member.id,
    },
    secret,
    maxAge: SESSION_MAX_AGE_SEC,
  });

  const redirectTo = new URL(nextPath, req.url);
  const res = NextResponse.redirect(redirectTo);
  const secure = process.env.NEXTAUTH_URL?.startsWith("https://") ?? false;
  res.cookies.set(sessionCookieName(), jwt, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SEC,
  });
  return res;
}
