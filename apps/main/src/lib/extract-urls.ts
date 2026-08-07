const URL_REGEX = /https?:\/\/[^\s<>"{}|\\^`[\]]+/gi;

export function extractFirstUrl(content: string | null | undefined): string | null {
  if (!content) return null;
  const match = content.match(URL_REGEX);
  return match?.[0] ?? null;
}

export function extractAllUrls(content: string | null | undefined): string[] {
  if (!content) return [];
  return content.match(URL_REGEX) ?? [];
}
