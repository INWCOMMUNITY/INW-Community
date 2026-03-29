/**
 * Base URL for Socket.IO (browser and server). Same host as REALTIME_PUBLISH_URL in practice.
 */
export function normalizeRealtimeHttpUrl(input: string): string {
  const s = input.trim().replace(/\/+$/, "");
  if (s.startsWith("wss://")) return `https://${s.slice(6)}`;
  if (s.startsWith("ws://")) return `http://${s.slice(5)}`;
  if (s.startsWith("http://") || s.startsWith("https://")) return s;
  return `https://${s}`;
}

/** Resolve URL clients should use to open a Socket.IO connection (no secrets). */
export function resolvePublicRealtimeSocketUrl(): string | null {
  const raw =
    process.env.NEXT_PUBLIC_REALTIME_URL?.trim().replace(/\/+$/, "") ||
    process.env.REALTIME_PUBLISH_URL?.trim().replace(/\/+$/, "") ||
    "";
  if (!raw) return null;
  return normalizeRealtimeHttpUrl(raw);
}
