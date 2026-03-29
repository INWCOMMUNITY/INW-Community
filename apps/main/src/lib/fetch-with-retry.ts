/**
 * Retry idempotent-ish fetches once on transient server errors (messages send path).
 */
export async function fetchWithRetry(
  input: RequestInfo | URL,
  init?: RequestInit,
  options?: { extraRetries?: number; retryStatuses?: number[] }
): Promise<Response> {
  const extra = options?.extraRetries ?? 1;
  const retryStatuses = options?.retryStatuses ?? [502, 503, 504];
  let res = await fetch(input, init);
  let n = 0;
  while (n < extra && retryStatuses.includes(res.status)) {
    await new Promise((r) => setTimeout(r, 400 + n * 150));
    res = await fetch(input, init);
    n += 1;
  }
  return res;
}
