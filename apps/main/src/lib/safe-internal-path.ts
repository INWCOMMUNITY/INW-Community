/**
 * Allow only same-origin relative paths (open-redirect safe) for post-auth redirects.
 */
export function safeInternalPath(next: string | null | undefined, fallback: string): string {
  if (next == null || typeof next !== "string") return fallback;
  const t = next.trim();
  if (!t.startsWith("/") || t.startsWith("//") || /\s/.test(t)) {
    return fallback;
  }
  if (t.includes("://")) return fallback;
  return t;
}
