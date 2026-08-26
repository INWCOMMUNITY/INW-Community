export function buildFriendSuggestionReasons(opts: {
  mutualCount: number;
  sameCity: boolean;
  sharedGroupNames: string[];
  sharedBusinessCount: number;
}): string[] {
  const reasons: string[] = [];
  if (opts.mutualCount > 0) {
    reasons.push(`${opts.mutualCount} mutual friend${opts.mutualCount === 1 ? "" : "s"}`);
  }
  if (opts.sameCity) reasons.push("Same city");
  if (opts.sharedGroupNames.length === 1) {
    reasons.push(`In ${opts.sharedGroupNames[0]}`);
  } else if (opts.sharedGroupNames.length > 1) {
    reasons.push(`In ${opts.sharedGroupNames.length} groups`);
  }
  if (opts.sharedBusinessCount > 0) {
    reasons.push("Follows the same shops");
  }
  return reasons.slice(0, 3);
}

const AVATAR_COLORS = ["#5F6955", "#3E432F", "#6B5344", "#7A6B4A", "#4A5C4E", "#8B6914"];

export function initialsAvatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

export function truncateBio(bio: string | null | undefined, max = 80): string | null {
  const text = bio?.replace(/\s+/g, " ").trim();
  if (!text) return null;
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}
