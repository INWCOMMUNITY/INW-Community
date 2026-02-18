/**
 * Check if blob storage is available. On Vercel, BLOB_READ_WRITE_TOKEN is required;
 * the filesystem fallback does not work (read-only).
 */
export function requireBlobStorage(): { ok: true } | { ok: false; error: string; status: number } {
  if (process.env.BLOB_READ_WRITE_TOKEN) return { ok: true };
  if (process.env.VERCEL) {
    return {
      ok: false,
      error: "Photo upload is not configured. Add Vercel Blob: Vercel Dashboard → Your Project → Storage → Connect Storage → Blob → Create.",
      status: 503,
    };
  }
  return { ok: true };
}
