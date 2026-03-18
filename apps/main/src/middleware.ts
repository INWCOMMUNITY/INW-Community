import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Allow admin app to call main app /api/admin (CORS). Production admin URL from env.
function getAdminOrigins(): string[] {
  const base = ["http://localhost:3001", "http://127.0.0.1:3001"];
  const env = process.env.ADMIN_APP_ORIGIN?.trim();
  if (!env) return base;
  return [...base, ...env.split(",").map((o) => o.trim()).filter(Boolean)];
}

// Allow mobile app (Expo web, dev client) to call /api/* from different origin (CORS).
function getMobileOrigins(): string[] {
  return [
    "http://localhost:8082",
    "http://127.0.0.1:8082",
    "http://192.168.0.127:8082",
  ];
}

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
  const origins = getAdminOrigins();
  const origin = req.headers.get("origin");
  const allowOrigin =
    origin && origins.includes(origin) ? origin : origins[0];
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, x-admin-code",
    "Access-Control-Max-Age": "86400",
  };
}

function mobileCorsHeaders(req: NextRequest) {
  const origins = getMobileOrigins();
  const origin = req.headers.get("origin");
  const allowOrigin =
    origin && origins.includes(origin) ? origin : origins[0];
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, Accept, Authorization, x-admin-code",
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

  // CORS for admin app (/api/admin only)
  if (req.nextUrl.pathname.startsWith("/api/admin")) {
    const headers = corsHeaders(req);
    if (req.method === "OPTIONS") {
      return new NextResponse(null, { status: 204, headers });
    }
    const res = NextResponse.next();
    Object.entries(headers).forEach(([k, v]) => res.headers.set(k, v));
    return res;
  }

  // CORS for mobile app (Expo web / dev client) calling any /api/*
  const pathname = req.nextUrl.pathname;
  if (pathname.startsWith("/api/")) {
    const origin = req.headers.get("origin");
    const mobileOrigins = getMobileOrigins();
    if (origin && mobileOrigins.includes(origin)) {
      const headers = mobileCorsHeaders(req);
      if (req.method === "OPTIONS") {
        return new NextResponse(null, { status: 204, headers });
      }
      const res = NextResponse.next();
      Object.entries(headers).forEach(([k, v]) => res.headers.set(k, v));
      return res;
    }
  }

  return NextResponse.next();
}
