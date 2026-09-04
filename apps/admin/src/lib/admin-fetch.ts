export const MAIN_SITE_URL =
  process.env.NEXT_PUBLIC_MAIN_SITE_URL || "http://localhost:3000";

/** Browser calls to main /api/admin/* — auth is the httpOnly session cookie, never a public code. */
export function adminFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.delete("x-admin-code");
  return fetch(input, { ...init, credentials: "include", headers });
}

/** Server-only header for admin RSC / scripts. Never import this into a client component. */
export function serverAdminHeaders(): HeadersInit {
  const code = process.env.ADMIN_CODE?.trim();
  if (!code) {
    throw new Error("ADMIN_CODE is not configured");
  }
  return { "x-admin-code": code };
}
