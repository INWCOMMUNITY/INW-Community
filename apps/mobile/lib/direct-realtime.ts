import { API_BASE } from "./api";

let warnedMissingRealtimeUrl = false;

function isLoopbackHost(host: string): boolean {
  return host === "127.0.0.1" || host === "localhost" || host === "[::1]";
}

/** Home / office LAN (and emulator special hosts), not public internet */
function isPrivateOrLanHost(host: string): boolean {
  if (isLoopbackHost(host)) return true;
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  return host.endsWith(".local");
}

/**
 * Socket.IO server URL. Production must set EXPO_PUBLIC_REALTIME_URL (e.g. wss://realtime.yourdomain.com).
 *
 * If you set EXPO_PUBLIC_REALTIME_URL=http://127.0.0.1:3007 but EXPO_PUBLIC_API_URL uses your PC's LAN IP
 * (physical device on Wi‑Fi), 127.0.0.1 would point at the phone — we rewrite the host to match the API host.
 */
export function getDirectRealtimeUrl(): string | null {
  let apiHostname: string | null = null;
  try {
    apiHostname = new URL(API_BASE).hostname;
  } catch {
    apiHostname = null;
  }

  const explicitRaw = process.env.EXPO_PUBLIC_REALTIME_URL?.trim().replace(/\/+$/, "");

  if (explicitRaw) {
    try {
      const u = new URL(explicitRaw.startsWith("http") ? explicitRaw : `http://${explicitRaw}`);
      const port = u.port || process.env.EXPO_PUBLIC_REALTIME_PORT?.trim() || "3007";
      if (
        apiHostname &&
        isLoopbackHost(u.hostname) &&
        !isLoopbackHost(apiHostname) &&
        isPrivateOrLanHost(apiHostname)
      ) {
        if (typeof __DEV__ !== "undefined" && __DEV__) {
          console.log(
            `[chat] Realtime URL: using API host ${apiHostname}:${port} (was loopback in EXPO_PUBLIC_REALTIME_URL — required on a physical device)`
          );
        }
        return `${u.protocol}//${apiHostname}:${port}`;
      }
    } catch {
      /* use raw */
    }
    return explicitRaw;
  }

  try {
    const u = new URL(API_BASE);
    if (u.hostname === "www.inwcommunity.com" || u.hostname === "inwcommunity.com") {
      if (typeof __DEV__ !== "undefined" && __DEV__ && !warnedMissingRealtimeUrl) {
        warnedMissingRealtimeUrl = true;
        console.warn(
          "[chat] Set EXPO_PUBLIC_REALTIME_URL to your deployed Socket.IO origin (wss://…). Live messaging is disabled until then."
        );
      }
      return null;
    }
    const port = process.env.EXPO_PUBLIC_REALTIME_PORT?.trim() || "3007";
    return `${u.protocol}//${u.hostname}:${port}`;
  } catch {
    return null;
  }
}
