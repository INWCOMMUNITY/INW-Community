import { timingSafeEqual } from "crypto";
import { SignJWT, jwtVerify } from "jose";
import type { NextRequest, NextResponse } from "next/server";

export const ADMIN_SESSION_COOKIE = "nwc_admin_session";
const JWT_ISSUER = "nwc-admin";
const JWT_EXPIRY = "12h";
const COOKIE_MAX_AGE = 12 * 60 * 60;

function getSecret() {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("NEXTAUTH_SECRET is required for admin session");
  return new TextEncoder().encode(secret);
}

export function serverAdminCode(): string | null {
  const code = process.env.ADMIN_CODE?.trim();
  return code || null;
}

export function adminCodeMatches(provided: string | null | undefined): boolean {
  const expected = serverAdminCode();
  if (!expected || !provided) return false;
  try {
    const a = Buffer.from(expected, "utf8");
    const b = Buffer.from(provided, "utf8");
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export async function signAdminSession(): Promise<string> {
  return new SignJWT({ role: "admin" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setIssuer(JWT_ISSUER)
    .setExpirationTime(JWT_EXPIRY)
    .sign(getSecret());
}

export async function verifyAdminSessionToken(token: string): Promise<boolean> {
  try {
    await jwtVerify(token, getSecret(), { issuer: JWT_ISSUER });
    return true;
  } catch {
    return false;
  }
}

export async function hasValidAdminSessionCookie(req: NextRequest): Promise<boolean> {
  const token = req.cookies.get(ADMIN_SESSION_COOKIE)?.value;
  if (!token) return false;
  return verifyAdminSessionToken(token);
}

export function applyAdminSessionCookie(res: NextResponse, token: string): void {
  const secure = process.env.NODE_ENV === "production";
  res.cookies.set(ADMIN_SESSION_COOKIE, token, {
    httpOnly: true,
    secure,
    sameSite: secure ? "none" : "lax",
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  });
}

export function clearAdminSessionCookie(res: NextResponse): void {
  const secure = process.env.NODE_ENV === "production";
  res.cookies.set(ADMIN_SESSION_COOKIE, "", {
    httpOnly: true,
    secure,
    sameSite: secure ? "none" : "lax",
    path: "/",
    maxAge: 0,
  });
}
