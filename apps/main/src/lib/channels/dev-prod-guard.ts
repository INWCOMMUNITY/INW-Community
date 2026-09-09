/**
 * Prevent a local `next dev` / `tsx` process pointed at production Postgres from
 * refreshing OAuth tokens or pausing live seller connections.
 */
export function looksLikeHostedProdDatabase(databaseUrl: string): boolean {
  return /neon\.tech|neon\.build|vercel-storage|amazonaws\.com|pooler\.supabase|supabase\.co|prisma\.io|db\.prisma\.io|rds\.amazonaws/i.test(
    databaseUrl
  );
}

export function shouldBlockDevChannelTokenWrites(): boolean {
  if (process.env.ALLOW_PROD_DB_FROM_DEV === "1") return false;
  if (process.env.VERCEL) return false;
  // Unit tests often inherit a hosted DATABASE_URL; they never write live tokens.
  if (process.env.VITEST || process.env.NODE_ENV === "test") return false;
  return looksLikeHostedProdDatabase(process.env.DATABASE_URL ?? "");
}
