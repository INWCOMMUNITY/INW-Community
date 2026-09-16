/**
 * Convert description to plain text by stripping HTML.
 */
export function listingDescriptionToPlainText(
  description: string | null | undefined
): string {
  if (!description) return "";
  return description
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Truncate listing description to a preview length.
 * Simple utility that doesn't depend on channel-specific formatting.
 */
export function listingDescriptionPreview(
  description: string | null | undefined,
  maxLength = 150
): string {
  const plainText = listingDescriptionToPlainText(description);
  if (plainText.length <= maxLength) return plainText;
  return plainText.slice(0, maxLength).trim() + "...";
}
