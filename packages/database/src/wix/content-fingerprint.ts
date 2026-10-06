import { createHash } from "crypto";

export function normalizeWixTitle(title: string | null | undefined): string {
  return (title ?? "").replace(/\s+/g, " ").trim();
}

export function normalizeWixDescription(description: string | null | undefined): string {
  return (description ?? "").trim();
}

export function normalizeWixPhotoUrls(photos: unknown): string[] {
  if (!Array.isArray(photos)) return [];
  return photos
    .filter((p): p is string => typeof p === "string")
    .map((p) => p.trim())
    .filter(Boolean);
}

export function wixProductContentFingerprint(input: {
  title: string;
  description: string | null;
  photos: string[];
  priceCents: number;
}): string {
  const payload = JSON.stringify({
    title: normalizeWixTitle(input.title),
    description: normalizeWixDescription(input.description),
    photos: normalizeWixPhotoUrls(input.photos),
    priceCents: input.priceCents,
  });
  return createHash("sha256").update(payload, "utf8").digest("hex").slice(0, 64);
}

export function wixVariantContentFingerprint(input: {
  priceCents: number;
  sku: string | null;
}): string {
  const payload = JSON.stringify({
    priceCents: input.priceCents,
    sku: (input.sku ?? "").trim() || null,
  });
  return createHash("sha256").update(payload, "utf8").digest("hex").slice(0, 64);
}
