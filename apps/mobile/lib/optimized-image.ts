import { PixelRatio } from "react-native";

/**
 * Image URL optimization for the mobile app.
 *
 * Routes remote image URLs through the main app's Next.js image optimizer
 * (`/_next/image`), which is already enabled in apps/main/next.config.js with
 * `remotePatterns` allowing all hosts. The optimizer returns CDN-cached
 * WebP/AVIF sized to what is actually rendered on screen, typically cutting
 * image bytes by 80-95% versus the full-resolution originals stored in blob.
 */

const API_BASE = process.env.EXPO_PUBLIC_API_URL || "https://www.inwcommunity.com";
const SITE_BASE = API_BASE.replace(/\/api.*$/, "").replace(/\/$/, "");

/**
 * Widths the Next.js optimizer will accept. Must stay in sync with
 * `deviceSizes` + `imageSizes` in apps/main/next.config.js. A requested width
 * that is not in this set returns HTTP 400 from `/_next/image`.
 */
const ALLOWED_WIDTHS = [
  16, 32, 48, 64, 96, 128, 256, 384, 512, 640, 750, 828, 1080, 1200, 1920,
  2048,
];

/** Largest source width we will ever request (avoids huge optimizer work). */
const MAX_WIDTH = 2048;

function snapWidth(width: number): number {
  for (const allowed of ALLOWED_WIDTHS) {
    if (allowed >= width) return allowed;
  }
  return ALLOWED_WIDTHS[ALLOWED_WIDTHS.length - 1];
}

/** Resolve a possibly-relative path against the site origin. */
export function toAbsoluteUri(url: string): string {
  if (url.startsWith("http")) return url;
  return `${SITE_BASE}${url.startsWith("/") ? "" : "/"}${url}`;
}

function isOptimizable(url: string): boolean {
  if (!url) return false;
  if (
    url.startsWith("data:") ||
    url.startsWith("file:") ||
    url.startsWith("content:") ||
    url.startsWith("blob:") ||
    url.startsWith("asset:")
  ) {
    return false;
  }
  // Already an optimizer URL — don't double-wrap.
  if (url.includes("/_next/image")) return false;
  return true;
}

export type OptimizedImageOptions = {
  /**
   * On-screen (logical) width of the image slot in dp. The source width is
   * computed by multiplying by the device pixel ratio (capped at 3x).
   */
  displayWidth?: number;
  /** Explicit source pixel width. Takes precedence over displayWidth. */
  width?: number;
  /** JPEG/WebP quality 1-100. Defaults to 70 (good balance for photos). */
  quality?: number;
};

/**
 * Build an optimized image URL for a remote source. Returns local/data URIs
 * and already-optimized URLs unchanged.
 */
export function optimizedImageUri(
  url: string | null | undefined,
  opts: OptimizedImageOptions = {}
): string | undefined {
  if (!url) return undefined;
  if (!isOptimizable(url)) return url;

  const abs = toAbsoluteUri(url);
  if (!abs.startsWith("http")) return abs;

  const dpr = Math.min(PixelRatio.get(), 3);
  const sourceWidth =
    opts.width ?? (opts.displayWidth ? Math.round(opts.displayWidth * dpr) : undefined);

  const w = snapWidth(Math.min(sourceWidth ?? 1080, MAX_WIDTH));
  const q = Math.min(100, Math.max(1, Math.round(opts.quality ?? 70)));

  return `${SITE_BASE}/_next/image?url=${encodeURIComponent(abs)}&w=${w}&q=${q}`;
}
