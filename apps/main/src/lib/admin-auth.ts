import type { NextRequest } from "next/server";
import { getServerSession } from "@/lib/auth";

/**
 * Verify admin authentication via x-admin-code header OR valid admin session.
 * Accepts either ADMIN_CODE header (for scripts/cron / standalone admin) or a
 * session where isAdmin is true (same rules as `app/admin/layout.tsx`).
 */
export async function requireAdmin(req: NextRequest): Promise<boolean> {
  const code = process.env.ADMIN_CODE?.trim();
  if (code && req.headers.get("x-admin-code") === code) return true;

  const adminEmail = process.env.ADMIN_EMAIL?.trim();
  if (!adminEmail) return false;

  const session = await getServerSession();
  const user = session?.user as { email?: string; isAdmin?: boolean } | undefined;
  if (!user) return false;
  if (user.isAdmin === true) return true;
  return !!user.email && user.email.toLowerCase() === adminEmail.toLowerCase();
}
