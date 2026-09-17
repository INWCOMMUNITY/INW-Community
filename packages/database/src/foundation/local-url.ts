/** Refuse any connection string that is not an explicit local disposable Postgres. */

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

export function assertLocalFoundationDatabaseUrl(url: string): URL {
  const trimmed = url.trim();
  if (!trimmed) {
    throw new Error("Foundation tests require an explicit local DATABASE_URL.");
  }
  if (/neon|amazonaws|railway|vercel|render\.com|supabase|psdb\.cloud|db\.prisma/i.test(trimmed)) {
    throw new Error("Refusing remote-looking DATABASE_URL for foundation tests.");
  }
  const parsed = new URL(trimmed);
  if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") {
    throw new Error(`Unexpected database protocol: ${parsed.protocol}`);
  }
  if (!LOCAL_HOSTS.has(parsed.hostname)) {
    throw new Error(`Refusing non-local DATABASE_URL host: ${parsed.hostname}`);
  }
  return parsed;
}

export function foundationTestDatabaseUrl(): string {
  const url = process.env.FOUNDATION_TEST_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim() || "";
  assertLocalFoundationDatabaseUrl(url);
  return url;
}
