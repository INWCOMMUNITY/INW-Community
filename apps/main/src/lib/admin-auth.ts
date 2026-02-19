import type { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

/**
 * Verify admin authentication via x-admin-code header OR valid admin session.
 * Accepts either ADMIN_CODE header (for scripts/cron) or session where user.email === ADMIN_EMAIL.
 */
export async function requireAdmin(req: NextRequest): Promise<boolean> {
  const code = process.env.ADMIN_CODE;
  if (code && req.headers.get("x-admin-code") === code) return true;
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail) return false;
  // Pass request context so session is resolved from the incoming request's cookies
  const reqContext = {
    headers: Object.fromEntries(req.headers.entries()),
    cookies: Object.fromEntries(req.cookies.getAll().map((c) => [c.name, c.value])),
  };
  const resContext = { getHeader: () => {}, setCookie: () => {}, setHeader: () => {} };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const session = await getServerSession(reqContext as any, resContext as any, authOptions);
  const user = session?.user as { email?: string } | undefined;
  return !!user?.email && user.email.toLowerCase() === adminEmail.toLowerCase();
}
