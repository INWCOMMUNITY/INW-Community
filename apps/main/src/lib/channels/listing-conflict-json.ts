/** Prisma-free conflictDetails helpers so seller-hub client pages can import them. */

export type RemoteDeletedNotice = {
  provider: string;
  detectedAt: string;
  dismissedAt?: string;
};

export function conflictDetailsAsObject(conflictDetails: unknown): Record<string, unknown> {
  let value = conflictDetails;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      return {};
    }
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return { ...(value as Record<string, unknown>) };
  }
  return {};
}

export function readRemoteDeletedNotice(conflictDetails: unknown): RemoteDeletedNotice | null {
  const raw = conflictDetailsAsObject(conflictDetails).remoteDeleted;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const rec = raw as { provider?: unknown; detectedAt?: unknown; dismissedAt?: unknown };
  if (typeof rec.provider !== "string" || !rec.provider.trim()) return null;
  return {
    provider: rec.provider.trim(),
    detectedAt: typeof rec.detectedAt === "string" ? rec.detectedAt : "",
    ...(typeof rec.dismissedAt === "string" && rec.dismissedAt ? { dismissedAt: rec.dismissedAt } : {}),
  };
}
