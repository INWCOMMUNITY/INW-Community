import type { NextRequest } from "next/server";

/**
 * Verify admin authentication via x-admin-code header.
 * ADMIN_CODE must be set in env; no fallback for security.
 */
export function requireAdmin(req: NextRequest): boolean {
  const code = process.env.ADMIN_CODE;
  if (!code) return false;
  return req.headers.get("x-admin-code") === code;
}
