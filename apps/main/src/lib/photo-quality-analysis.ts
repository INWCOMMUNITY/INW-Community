/**
 * Photo Quality Analysis
 * Analyzes listing photos for quality issues like resolution, aspect ratio, and file size.
 */

import sharp from "sharp";

export interface PhotoAnalysisResult {
  url: string;
  width?: number;
  height?: number;
  sizeBytes?: number;
  format?: string;
  issues: string[];
  quality: "good" | "acceptable" | "poor";
}

export interface PhotoAnalysisOptions {
  minWidth?: number;
  minHeight?: number;
  maxAspectRatio?: number;
  minFileSize?: number;
  preferredFormats?: string[];
}

const DEFAULT_OPTIONS: PhotoAnalysisOptions = {
  minWidth: 500,
  minHeight: 500,
  maxAspectRatio: 3,
  minFileSize: 10 * 1024, // 10KB minimum
  preferredFormats: ["jpeg", "jpg", "webp", "png"],
};

/**
 * Resolve a potentially relative photo URL to an absolute URL.
 */
function resolvePhotoUrl(url: string): string {
  if (url.startsWith("http://") || url.startsWith("https://")) {
    return url;
  }
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://www.inwcommunity.com";
  return url.startsWith("/") ? `${baseUrl}${url}` : `${baseUrl}/${url}`;
}

/**
 * Fetch image metadata using Sharp.
 */
async function getImageMetadata(url: string): Promise<{
  width?: number;
  height?: number;
  sizeBytes?: number;
  format?: string;
  error?: string;
}> {
  try {
    const resolvedUrl = resolvePhotoUrl(url);
    const response = await fetch(resolvedUrl, {
      headers: {
        "User-Agent": "INWCommunity-PhotoAnalysis/1.0",
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      return { error: `Failed to fetch image: ${response.status}` };
    }

    const buffer = await response.arrayBuffer();
    const sizeBytes = buffer.byteLength;

    const metadata = await sharp(Buffer.from(buffer)).metadata();

    return {
      width: metadata.width,
      height: metadata.height,
      sizeBytes,
      format: metadata.format,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("timeout") || msg.includes("aborted")) {
      return { error: "Image took too long to load" };
    }
    return { error: `Could not analyze image: ${msg.substring(0, 50)}` };
  }
}

/**
 * Analyze a single photo for quality issues.
 */
export async function analyzePhoto(
  url: string,
  options: PhotoAnalysisOptions = DEFAULT_OPTIONS
): Promise<PhotoAnalysisResult> {
  const issues: string[] = [];
  const opts = { ...DEFAULT_OPTIONS, ...options };

  const metadata = await getImageMetadata(url);

  if (metadata.error) {
    return {
      url,
      issues: [metadata.error],
      quality: "poor",
    };
  }

  const { width, height, sizeBytes, format } = metadata;

  // Resolution checks
  if (width && height) {
    const minDim = Math.min(width, height);
    const maxDim = Math.max(width, height);

    if (minDim < (opts.minWidth ?? 500)) {
      issues.push(`Image resolution is low (${width}x${height}). Use at least 500px on the shortest side.`);
    } else if (minDim < 800) {
      issues.push(`Image could be higher resolution (${width}x${height}). 800px+ recommended.`);
    }

    // Aspect ratio check
    const aspectRatio = maxDim / minDim;
    if (aspectRatio > (opts.maxAspectRatio ?? 3)) {
      issues.push(`Extreme aspect ratio (${aspectRatio.toFixed(1)}:1). Consider cropping to a more standard ratio.`);
    }
  }

  // File size check
  if (sizeBytes !== undefined) {
    if (sizeBytes < (opts.minFileSize ?? 10240)) {
      issues.push("Image file is very small - may be low quality or a placeholder.");
    }
  }

  // Format check
  if (format) {
    const preferredFormats = opts.preferredFormats ?? ["jpeg", "jpg", "webp", "png"];
    if (!preferredFormats.includes(format.toLowerCase())) {
      issues.push(`Image format (${format}) may not display well. JPEG or WebP recommended.`);
    }
  }

  // Determine overall quality
  let quality: "good" | "acceptable" | "poor";
  if (issues.length === 0) {
    quality = "good";
  } else if (issues.some((i) => i.includes("low") || i.includes("very small") || i.includes("Could not"))) {
    quality = "poor";
  } else {
    quality = "acceptable";
  }

  return {
    url,
    width,
    height,
    sizeBytes,
    format,
    issues,
    quality,
  };
}

/**
 * Analyze all photos in a listing.
 */
export async function analyzePhotos(
  urls: string[],
  options: PhotoAnalysisOptions = DEFAULT_OPTIONS
): Promise<PhotoAnalysisResult[]> {
  if (!urls || urls.length === 0) {
    return [];
  }

  // Analyze in parallel with concurrency limit
  const CONCURRENCY = 3;
  const results: PhotoAnalysisResult[] = [];

  for (let i = 0; i < urls.length; i += CONCURRENCY) {
    const batch = urls.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map((url) => analyzePhoto(url, options))
    );
    results.push(...batchResults);
  }

  return results;
}

/**
 * Get a summary of photo quality for a listing.
 */
export function getPhotoQualitySummary(results: PhotoAnalysisResult[]): {
  totalPhotos: number;
  goodPhotos: number;
  acceptablePhotos: number;
  poorPhotos: number;
  overallQuality: "good" | "acceptable" | "poor";
  topIssues: string[];
} {
  const totalPhotos = results.length;
  const goodPhotos = results.filter((r) => r.quality === "good").length;
  const acceptablePhotos = results.filter((r) => r.quality === "acceptable").length;
  const poorPhotos = results.filter((r) => r.quality === "poor").length;

  // Collect unique issues
  const issueCount = new Map<string, number>();
  for (const result of results) {
    for (const issue of result.issues) {
      const normalized = issue.split(".")[0]; // Take first sentence
      issueCount.set(normalized, (issueCount.get(normalized) ?? 0) + 1);
    }
  }

  // Sort by frequency and take top 3
  const topIssues = Array.from(issueCount.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([issue]) => issue);

  // Determine overall quality
  let overallQuality: "good" | "acceptable" | "poor";
  if (poorPhotos > 0 || totalPhotos === 0) {
    overallQuality = "poor";
  } else if (acceptablePhotos > goodPhotos) {
    overallQuality = "acceptable";
  } else {
    overallQuality = "good";
  }

  return {
    totalPhotos,
    goodPhotos,
    acceptablePhotos,
    poorPhotos,
    overallQuality,
    topIssues,
  };
}
