import { Image, type ImageContentFit, type ImageProps } from "expo-image";
import { type StyleProp, type ImageStyle } from "react-native";
import { optimizedImageUri } from "@/lib/optimized-image";

/**
 * App-wide image component. Wraps expo-image with caching + a placeholder +
 * a short fade so cached photos appear instantly and first loads feel smooth,
 * and routes remote sources through the Next.js optimizer for smaller, faster
 * downloads (see lib/optimized-image.ts).
 *
 * Use this instead of react-native's `Image` for remote images. For local
 * `require(...)` assets keep using react-native `Image`.
 */

type ResizeMode = "cover" | "contain" | "center" | "stretch";

const RESIZE_TO_CONTENT_FIT: Record<ResizeMode, ImageContentFit> = {
  cover: "cover",
  contain: "contain",
  center: "none",
  stretch: "fill",
};

const PLACEHOLDER_COLOR = "#e9e9e9";

export type AppImageProps = {
  /** Remote image URL (http(s) or site-relative path). */
  uri: string | null | undefined;
  style?: StyleProp<ImageStyle>;
  /** On-screen width in dp; used to request a right-sized optimized source. */
  targetWidth?: number;
  /** Optimizer quality 1-100 (default 70). */
  quality?: number;
  /** Maps to expo-image contentFit. Mirrors RN Image's resizeMode. */
  resizeMode?: ResizeMode;
  /** Fade-in duration in ms (default 150). Pass 0 to disable. */
  transition?: number;
  /** Stable key for recycling in lists/carousels. */
  recyclingKey?: string;
  /** Solid color shown until the image draws. */
  placeholderColor?: string;
  priority?: ImageProps["priority"];
  blurRadius?: number;
  tintColor?: string;
  accessibilityLabel?: string;
  onLoad?: ImageProps["onLoad"];
  onError?: ImageProps["onError"];
  pointerEvents?: ImageProps["pointerEvents"];
};

export function AppImage({
  uri,
  style,
  targetWidth,
  quality,
  resizeMode = "cover",
  transition = 150,
  recyclingKey,
  placeholderColor = PLACEHOLDER_COLOR,
  priority,
  blurRadius,
  tintColor,
  accessibilityLabel,
  onLoad,
  onError,
  pointerEvents,
}: AppImageProps) {
  const optimized = optimizedImageUri(uri, {
    displayWidth: targetWidth,
    quality,
  });

  return (
    <Image
      source={optimized ? { uri: optimized } : undefined}
      style={[{ backgroundColor: placeholderColor }, style]}
      contentFit={RESIZE_TO_CONTENT_FIT[resizeMode]}
      cachePolicy="memory-disk"
      transition={transition}
      recyclingKey={recyclingKey ?? uri ?? undefined}
      priority={priority}
      blurRadius={blurRadius}
      tintColor={tintColor}
      accessibilityLabel={accessibilityLabel}
      onLoad={onLoad}
      onError={onError}
      pointerEvents={pointerEvents}
    />
  );
}

/**
 * Prefetch optimized image URLs into the cache (e.g. upcoming feed photos).
 * Silently ignores failures.
 */
export function prefetchImages(
  uris: Array<string | null | undefined>,
  opts: { targetWidth?: number; quality?: number } = {}
): void {
  const urls = uris
    .map((u) => optimizedImageUri(u, { displayWidth: opts.targetWidth, quality: opts.quality }))
    .filter((u): u is string => typeof u === "string" && u.startsWith("http"));
  if (urls.length === 0) return;
  void Image.prefetch(urls, { cachePolicy: "memory-disk" });
}
