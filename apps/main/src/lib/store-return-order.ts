/** Deterministic "latest StoreReturn" Prisma orderBy: newest createdAt, then greatest id. */
export const LATEST_STORE_RETURN_ORDER_BY: Array<
  { createdAt: "desc" } | { id: "desc" }
> = [{ createdAt: "desc" }, { id: "desc" }];

/**
 * In-memory pick matching LATEST_STORE_RETURN_ORDER_BY (createdAt DESC, id DESC).
 * Used when an array is already loaded and [0] must remain deterministic.
 */
export function pickLatestStoreReturn<T extends { id: string; createdAt: Date | string }>(
  returns: T[] | null | undefined
): T | null {
  if (!returns || returns.length === 0) return null;
  const sorted = [...returns].sort((a, b) => {
    const tb = new Date(b.createdAt).getTime();
    const ta = new Date(a.createdAt).getTime();
    if (tb !== ta) return tb - ta;
    // id DESC (greatest lexical id first)
    if (a.id < b.id) return 1;
    if (a.id > b.id) return -1;
    return 0;
  });
  return sorted[0] ?? null;
}
