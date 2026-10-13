/**
 * Etsy property names and Shopify option names for the same axis.
 * "Primary color" and "Color" are one axis. A new value is still a new variant.
 */
const MARKETPLACE_AXIS_ALIASES: readonly (readonly string[])[] = [
  ["color", "colour", "primary color", "primary colour"],
  ["material", "materials"],
  ["size"],
  ["style"],
  ["pattern"],
];

export function canonicalMarketplaceAxisName(name: string): string {
  const norm = name.trim().toLowerCase();
  if (!norm) return "";
  for (const group of MARKETPLACE_AXIS_ALIASES) {
    if (group.includes(norm)) return group[0]!;
  }
  return norm;
}

/** Stable structure key. Axis aliases compare equal; values stay distinct. */
export function marketplaceTopologyMatchKey(options: Record<string, string>): string {
  const byAxis = new Map<string, string>();
  for (const [name, value] of Object.entries(options)) {
    const axis = canonicalMarketplaceAxisName(name);
    const optionValue = String(value ?? "").trim().toLowerCase();
    if (!axis || !optionValue) continue;
    if (!byAxis.has(axis)) byAxis.set(axis, optionValue);
  }
  return [...byAxis.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([axis, optionValue]) => `${axis}=${optionValue}`)
    .join("|");
}

/** Re-canonicalize a key that was built with the raw axis name. */
export function normalizeMarketplaceTopologyMatchKey(key: string): string {
  const options: Record<string, string> = {};
  for (const part of key.split("|")) {
    const eq = part.indexOf("=");
    if (eq < 1) continue;
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (!name || !value) continue;
    options[name] = value;
  }
  return marketplaceTopologyMatchKey(options);
}
