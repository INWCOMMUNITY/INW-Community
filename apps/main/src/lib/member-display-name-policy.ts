import { Filter } from "bad-words";

/** Matches signup placeholder when first/last are not collected yet */
export const MEMBER_NAME_PLACEHOLDER = "Pending";

export const MEMBER_DISPLAY_NAME_REJECTED_MESSAGE =
  "Please use a first and last name without offensive language.";

/**
 * Tokens that are real given names or surnames but appear on generic profanity lists.
 * Whole-token match only (case-insensitive).
 */
const ALLOWED_NAME_TOKENS = new Set(
  [
    "wang",
    "phuc",
    "gaylord",
    "dick",
    "dong",
    "ho",
    "long",
    "hung",
    "kok",
    "cho",
  ].map((s) => s.toLowerCase())
);

/** Extra multi-token or compound insults not always caught as single words */
const EXTRA_BLOCKLIST = [
  "dickwad",
  "dickhead",
  "dumbass",
  "jackass",
  "smartass",
  "assman",
  "assface",
  "fuckface",
  "shithead",
  "motherfucker",
  "motherfuckers",
  "fuckoff",
  "fuckofff",
  "cocksucker",
  "cunty",
  "rapey",
  "rapist",
  "nazi",
  "hitler",
  "kkk",
  "isis",
];

const filter = new Filter();
filter.addWords(...EXTRA_BLOCKLIST);

function tokenizeNameSegment(segment: string): string[] {
  return segment
    .trim()
    .split(/[\s'-]+/u)
    .map((t) => t.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter(Boolean);
}

function tokenIsProfane(token: string): boolean {
  const lower = token.toLowerCase();
  if (ALLOWED_NAME_TOKENS.has(lower)) return false;
  return filter.isProfane(token);
}

/**
 * Validates member first + last name for profanity and obvious abusive / hate patterns.
 * Skips empty segments and the {@link MEMBER_NAME_PLACEHOLDER} used for incomplete signups.
 */
export function validateMemberDisplayNameFields(
  firstName: string,
  lastName: string
): string | null {
  const f = firstName.trim();
  const l = lastName.trim();

  const segments: string[] = [];
  if (f && f !== MEMBER_NAME_PLACEHOLDER) segments.push(f);
  if (l && l !== MEMBER_NAME_PLACEHOLDER) segments.push(l);
  const combined = [f, l].filter((x) => x && x !== MEMBER_NAME_PLACEHOLDER).join(" ").trim();
  if (combined) segments.push(combined);

  for (const segment of segments) {
    if (filter.isProfane(segment)) return MEMBER_DISPLAY_NAME_REJECTED_MESSAGE;
    for (const tok of tokenizeNameSegment(segment)) {
      if (tokenIsProfane(tok)) return MEMBER_DISPLAY_NAME_REJECTED_MESSAGE;
    }
  }

  return null;
}
