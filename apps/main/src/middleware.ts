import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Allow admin app (localhost:3001) to call main app APIs
const ADMIN_ORIGINS = [
  "http://localhost:3001",
  "http://127.0.0.1:3001",
];

// Rate limit store for login attempts (best-effort in serverless)
const loginAttempts = new Map<string, number[]>();
const LOGIN_WINDOW_MS = 60 * 1000; // 1 minute
const MAX_LOGIN_ATTEMPTS = 10;

function getClientIp(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.headers.get("x-real-ip")?.trim() ?? "unknown";
}

function checkLoginRateLimit(ip: string): boolean {
  const now = Date.now();
  const cutoff = now - LOGIN_WINDOW_MS;
  let attempts = loginAttempts.get(ip) ?? [];
  attempts = attempts.filter((t) => t > cutoff);
  if (attempts.length >= MAX_LOGIN_ATTEMPTS) return false;
  attempts.push(now);
  loginAttempts.set(ip, attempts);
  return true;
}

function corsHeaders(req: NextRequest) {
  const origin = req.headers.get("origin");
  const allowOrigin =
    origin && ADMIN_ORIGINS.includes(origin) ? origin : ADMIN_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, x-admin-code",
    "Access-Control-Max-Age": "86400",
  };
}

export function middleware(req: NextRequest) {
  // Rate limit login attempts (brute-force protection)
  if (req.method === "POST" && req.nextUrl.pathname === "/api/auth/callback/credentials") {
    const ip = getClientIp(req);
    if (!checkLoginRateLimit(ip)) {
      return NextResponse.json(
        { error: "Too many login attempts. Please try again in a minute." },
        { status: 429 }
      );
    }
  }

  if (!req.nextUrl.pathname.startsWith("/api/admin")) {
    return NextResponse.next();
  }

  const headers = corsHeaders(req);

  if (req.method === "OPTIONS") {
    return new NextResponse(null, { status: 204, headers });
  }

  const res = NextResponse.next();
  Object.entries(headers).forEach(([k, v]) => res.headers.set(k, v));
  return res;
}
