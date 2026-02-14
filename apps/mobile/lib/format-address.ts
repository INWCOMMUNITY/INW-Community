/**
 * Format shipping/delivery address for display.
 * Ported from apps/main/src/lib/format-address.ts
 */
export function formatShippingAddress(addr: unknown): string {
  if (!addr || typeof addr !== "object") return "";
  const a = addr as Record<string, string>;
  const parts: string[] = [];
  if (a.name) parts.push(a.name);
  if (a.street ?? a.address) parts.push((a.street ?? a.address) as string);
  if (a.street2) parts.push(a.street2);
  if (a.aptOrSuite) parts.push(a.aptOrSuite);
  const cityStateZip = [a.city, a.state, a.zip].filter(Boolean).join(", ");
  if (cityStateZip) parts.push(cityStateZip);
  if (a.country && a.country !== "US") parts.push(a.country);
  return parts.join("\n");
}
