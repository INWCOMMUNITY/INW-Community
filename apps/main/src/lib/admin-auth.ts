import type { NextRequest } from "next/server";
import { getServerSession } from "@/lib/auth";
import { adminCodeMatches, hasValidAdminSessionCookie } from "@/lib/admin-session";

/**
 * Verify admin authentication via:
 * 1. HttpOnly admin session cookie (standalone admin app after /api/admin/session)
 * 2. x-admin-code matching server-only ADMIN_CODE (RSC / scripts — never a public env)
 * 3. NextAuth session where isAdmin is true (embedded /admin)
 */
export async function requireAdmin(req: NextRequest): Promise<boolean> {
  if (await hasValidAdminSessionCookie(req)) return true;
  if (adminCodeMatches(req.headers.get("x-admin-code"))) return true;

  const adminEmail = process.env.ADMIN_EMAIL?.trim();
  if (!adminEmail) return false;

  const session = await getServerSession();
  const user = session?.user as { email?: string; isAdmin?: boolean } | undefined;
  if (!user) return false;
  if (user.isAdmin === true) return true;
  return !!user.email && user.email.toLowerCase() === adminEmail.toLowerCase();
}
