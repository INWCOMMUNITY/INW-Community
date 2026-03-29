import { resolvePublicRealtimeSocketUrl } from "@/lib/realtime-socket-url";

/**
 * Non-secret flags for verifying live-chat env wiring (dev or admin-only API).
 */
export function getRealtimeEnvStatus(): {
  nextPublicRealtimeUrl: boolean;
  realtimePublishUrl: boolean;
  realtimePublishSecret: boolean;
  nextAuthSecretForDevFallback: boolean;
  vercel: boolean;
  /** True if the site can tell the browser where Socket.IO lives (public var or publish URL fallback). */
  socketUrlForBrowser: boolean;
} {
  return {
    nextPublicRealtimeUrl: Boolean(process.env.NEXT_PUBLIC_REALTIME_URL?.trim()),
    realtimePublishUrl: Boolean(process.env.REALTIME_PUBLISH_URL?.trim()),
    realtimePublishSecret: Boolean(process.env.REALTIME_PUBLISH_SECRET?.trim()),
    nextAuthSecretForDevFallback: Boolean(process.env.NEXTAUTH_SECRET?.trim()),
    vercel: Boolean(process.env.VERCEL),
    socketUrlForBrowser: Boolean(resolvePublicRealtimeSocketUrl()),
  };
}

/** Mirrors resolve logic in realtime-publish.ts (no network I/O). */
export function publishPipelineLikelyWorks(): boolean {
  const isProd = process.env.NODE_ENV === "production";
  const base =
    process.env.REALTIME_PUBLISH_URL?.trim().replace(/\/+$/, "") ||
    (isProd ? "" : "http://127.0.0.1:3007");
  const secret =
    process.env.REALTIME_PUBLISH_SECRET?.trim() ||
    (isProd ? "" : process.env.NEXTAUTH_SECRET?.trim() || "");
  return Boolean(base && secret);
}
