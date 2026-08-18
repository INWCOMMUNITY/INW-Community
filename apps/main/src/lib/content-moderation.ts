/**
 * Content moderation utilities for INW Community.
 * Enforces member rules: no cannabis, sexual products, alcohol, political merch;
 * slurs blocked everywhere; profanity allowed in messages/comments; business names with profanity require admin approval.
 */

import { listingDescriptionToPlainText } from "./channels/rich-description";

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

/** Read-only lists for admin UI (full list, test word, quiz). */
export function getRestrictedWordingForAdmin(): {
  prohibitedCategories: readonly string[];
  profanity: string[];
  slurs: string[];
} {
  return {
    prohibitedCategories: PROHIBITED_PRODUCT_CATEGORIES,
    profanity: Array.from(PROFANITY_BLOCKLIST),
    slurs: Array.from(SLUR_BLOCKLIST),
  };
}

export type ModerationContext =
  | "comment"
  | "product_title"
  | "product_description"
  | "business_name"
  | "message";

export interface ModerationResult {
  allowed: boolean;
  reason?: string;
  /** Blocklist term(s) that triggered the rejection (e.g. "shit"). */
  matchedTerms?: string[];
  /** Word(s) from the submitted text that matched (e.g. "shit", or "class" before ass-substring fix). */
  matchedWords?: string[];
}

export type ModerationMatch = {
  term: string;
  word: string;
};

/**
 * Check if title, category, or description contains prohibited product categories.
 */
export function containsProhibitedCategory(
  title: string,
  category: string | null | undefined,
  description: string | null | undefined,
  secondaryCategory?: string | null | undefined
): boolean {
  const combined = [title, category, secondaryCategory, description]
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

function findBlocklistMatches(text: string, blocklist: Set<string>): ModerationMatch[] {
  const matches: ModerationMatch[] = [];
  const seen = new Set<string>();
  for (const word of getWords(text)) {
    if (blocklist.has(word) && !seen.has(word)) {
      seen.add(word);
      matches.push({ term: word, word });
    }
  }
  return matches;
}

function containsBlocklistWord(text: string, blocklist: Set<string>): string | null {
  const match = findBlocklistMatches(text, blocklist)[0];
  return match?.term ?? null;
}

/** Inspect text for policy violations; returns every blocklist hit for UI highlighting. */
export function findModerationMatches(
  text: string,
  context: ModerationContext
): ModerationMatch[] {
  if (!text || typeof text !== "string") return [];

  const trimmed = text.trim();
  if (!trimmed) return [];

  const textForCheck =
    context === "product_description"
      ? listingDescriptionToPlainText(trimmed) ?? trimmed
      : trimmed;

  const slurs = findBlocklistMatches(textForCheck, SLUR_BLOCKLIST);
  if (slurs.length > 0) return slurs;

  if (context === "comment" || context === "message" || context === "business_name") {
    return [];
  }

  if (context === "product_title" || context === "product_description") {
    return findBlocklistMatches(textForCheck, PROFANITY_BLOCKLIST);
  }

  return [];
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

  const textForCheck =
    context === "product_description"
      ? listingDescriptionToPlainText(trimmed) ?? trimmed
      : trimmed;

  const slurMatches = findBlocklistMatches(textForCheck, SLUR_BLOCKLIST);
  if (slurMatches.length > 0) {
    return {
      allowed: false,
      reason: "This content contains language that is not allowed on our platform.",
      matchedTerms: slurMatches.map((m) => m.term),
      matchedWords: slurMatches.map((m) => m.word),
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

  // Product title and description: block profanity (whole-word match only)
  if (context === "product_title" || context === "product_description") {
    const profanityMatches = findBlocklistMatches(textForCheck, PROFANITY_BLOCKLIST);
    if (profanityMatches.length > 0) {
      return {
        allowed: false,
        reason:
          context === "product_title"
            ? "Please remove inappropriate language from the title."
            : "Please remove inappropriate language from the description.",
        matchedTerms: profanityMatches.map((m) => m.term),
        matchedWords: profanityMatches.map((m) => m.word),
      };
    }
  }

  return { allowed: true };
}

/** Append flagged word list to a moderation rejection for seller-facing errors. */
export function formatModerationErrorMessage(result: ModerationResult): string {
  const base = result.reason ?? "Invalid content.";
  const words = result.matchedWords?.filter(Boolean);
  if (!words?.length) return base;
  const unique = [...new Set(words)];
  return `${base} Flagged word(s): ${unique.map((w) => `"${w}"`).join(", ")}.`;
}

/** Check if text contains profanity (for business name admin-approval flow). Slurs must be checked separately via validateText. */
export function containsProfanity(text: string): boolean {
  if (!text || typeof text !== "string") return false;
  return containsBlocklistWord(text.trim(), PROFANITY_BLOCKLIST) !== null;
}
