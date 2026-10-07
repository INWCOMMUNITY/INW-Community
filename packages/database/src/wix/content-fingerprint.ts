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
    .map((p) => stablePhotoUrl(p.trim()))
    .filter(Boolean);
}

function stablePhotoUrl(url: string): string {
  const withoutQuery = url.split("?")[0] ?? url;
  return withoutQuery.replace(/\/+$/, "");
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

function choiceRecord(options: unknown): Record<string, string> {
  if (!options || typeof options !== "object" || Array.isArray(options)) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(options as Record<string, unknown>)) {
    const name = key.trim().toLowerCase();
    const choice = typeof value === "string" ? value.trim().toLowerCase() : "";
    if (name && choice) out[name] = choice;
  }
  return out;
}

/** Stable hash of option axis names and choice values. Price and SKU are not included. */
export function wixTopologyFingerprint(variants: Array<{ options: unknown }>): string {
  const axes = new Map<string, Set<string>>();
  for (const variant of variants) {
    for (const [name, value] of Object.entries(choiceRecord(variant.options))) {
      const values = axes.get(name) ?? new Set<string>();
      values.add(value);
      axes.set(name, values);
    }
  }
  const canonical = [...axes.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, values]) => `${name}=${[...values].sort().join(",")}`)
    .join("|");
  return createHash("sha256").update(canonical, "utf8").digest("hex").slice(0, 64);
}
