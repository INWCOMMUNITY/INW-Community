/**
 * Content moderation utilities for INW Community.
 * Enforces member rules: no cannabis, sexual products, alcohol, political merch;
 * slurs blocked everywhere; profanity allowed in messages/comments; business names with profanity require admin approval.
 */

// Prohibited product categories for seller listings
export const PROHIBITED_PRODUCT_CATEGORIES = [
  "cannabis",
  "marijuana",
  "weed",
  "thc",
  "cbd",
  "sexual",
  "adult",
  "sex",
  "alcohol",
  "beer",
  "wine",
  "liquor",
  "spirits",
  "political",
  "campaign",
  "election",
  "merchandise",
  "propaganda",
] as const;

// Profanity (for business name approval flow - not blocked in messages/comments)
const PROFANITY_BLOCKLIST = new Set(
  [
    "fuck", "shit", "ass", "bitch", "damn", "crap", "dick", "cock",
    "pussy", "bastard", "slut", "whore", "cunt", "rape", "molest",
  ].map((w) => w.toLowerCase())
);

// Slur blocklist - always blocked in all contexts
const SLUR_BLOCKLIST = new Set(
  [
    "nigger", "nigga", "fag", "faggot", "faggots", "tranny", "retard",
    "retarded", "chink", "spic", "kike", "raghead", "wetback",
  ].map((w) => w.toLowerCase())
);

export type ModerationContext =
  | "comment"
  | "product_title"
  | "product_description"
  | "business_name"
  | "message";

export interface ModerationResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Check if title, category, or description contains prohibited product categories.
 */
export function containsProhibitedCategory(
  title: string,
  category: string | null | undefined,
  description: string | null | undefined
): boolean {
  const combined = [title, category, description]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return PROHIBITED_PRODUCT_CATEGORIES.some((term) => {
    const re = new RegExp(`\\b${escapeRegex(term)}\\b`, "i");
    return re.test(combined);
  });
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Extract words from text for blocklist checking.
 */
function getWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function containsBlocklistWord(text: string, blocklist: Set<string>): string | null {
  const words = getWords(text);
  for (const word of words) {
    if (blocklist.has(word)) return word;
    // Check substrings for compound slurs
    for (const blocked of blocklist) {
      if (word.includes(blocked) || blocked.includes(word)) return blocked;
    }
  }
  return null;
}

/**
 * Validate text for content policy compliance.
 */
export function validateText(
  text: string,
  context: ModerationContext
): ModerationResult {
  if (!text || typeof text !== "string") {
    return { allowed: true };
  }

  const trimmed = text.trim();
  if (!trimmed) return { allowed: true };

  // Slurs are always blocked in any context
  const slur = containsBlocklistWord(trimmed, SLUR_BLOCKLIST);
  if (slur) {
    return {
      allowed: false,
      reason: "This content contains language that is not allowed on our platform.",
    };
  }

  // Comments and messages: allow profanity, only block slurs (already done above)
  if (context === "comment" || context === "message") {
    return { allowed: true };
  }

  // Business name: slurs blocked above. Profanity allowed but requires admin approval (handled in API).
  if (context === "business_name") {
    return { allowed: true };
  }

  // Product title and description: block profanity
  if (context === "product_title" || context === "product_description") {
    const profanity = containsBlocklistWord(trimmed, PROFANITY_BLOCKLIST);
    if (profanity) {
      return {
        allowed: false,
        reason:
          context === "product_title"
            ? "Please remove inappropriate language from the title."
            : "Please remove inappropriate language from the description.",
      };
    }
  }

  return { allowed: true };
}

/** Check if text contains profanity (for business name admin-approval flow). Slurs must be checked separately via validateText. */
export function containsProfanity(text: string): boolean {
  if (!text || typeof text !== "string") return false;
  return containsBlocklistWord(text.trim(), PROFANITY_BLOCKLIST) !== null;
}
