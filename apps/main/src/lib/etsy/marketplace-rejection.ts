import { ETSY_WHEN_MADE_LABELS, type EtsyWhenMade } from "./how-its-made-ui";

/** When-made values Etsy treats as vintage (about 20 years or older). */
const VINTAGE_WHEN_MADE = new Set<string>([
  "before_1700",
  "1700s",
  "1800s",
  "1900s",
  "1910s",
  "1920s",
  "1930s",
  "1940s",
  "1950s",
  "1960s",
  "1970s",
  "1980s",
  "1990s",
  "2000_2006",
  "before_2007",
]);

export type EtsyMarketplaceHow = {
  whoMade?: string | null;
  whenMade?: string | null;
  isSupply?: boolean | null;
};

/** Finished goods made by another company, and not old enough to be vintage. */
export function requiresEtsyProductionPartner(how: EtsyMarketplaceHow): boolean {
  if (how.whoMade !== "someone_else") return false;
  if (how.isSupply === true) return false;
  if (how.whenMade && VINTAGE_WHEN_MADE.has(how.whenMade)) return false;
  return true;
}

export const ETSY_PRODUCTION_PARTNER_DRAFT_MESSAGE =
  "We saved this as a draft on Etsy and connected it to your INW listing. INW will keep the two in sync, so you do not need to import it. Another company made this item and it is not vintage, so Etsy still needs a production partner on that draft. Open the draft in your Etsy shop, add the production partner, and publish it there. Your details are already on the INW listing, so you do not need to enter them again.";

export const ETSY_PRODUCTION_PARTNER_REQUIRED_MESSAGE =
  "Etsy would not save this item, even as a draft. Another company made it and it is not vintage, so your Etsy shop needs a production partner before Etsy will accept it. We moved this listing to Drafts on INW. Everything you already entered is still there. You do not need to fill it out again, and you do not need to import it. Add a production partner in your Etsy shop. Then open this same draft on INW and choose List on Etsy. INW will create the Etsy draft and start syncing this listing. After that, open the draft in your Etsy shop, confirm the production partner, and publish it there.";

function joinAnd(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}

function whenPhrase(whenMade: string): string | null {
  if (!(whenMade in ETSY_WHEN_MADE_LABELS)) return null;
  if (whenMade === "made_to_order") return "made to order";
  const label = ETSY_WHEN_MADE_LABELS[whenMade as EtsyWhenMade];
  if (VINTAGE_WHEN_MADE.has(whenMade)) return `from ${label} (vintage)`;
  return `from ${label}`;
}

/**
 * Plain-language replacement for Etsy's invalid_marketplace rejection.
 * Returns null when the raw message is a different error.
 */
export function explainEtsyMarketplaceRejection(
  rawMessage: string,
  how?: EtsyMarketplaceHow | null
): string | null {
  if (!/invalid_marketplace|cannot sell this item on Etsy/i.test(rawMessage)) return null;

  if (requiresEtsyProductionPartner(how ?? {})) {
    return ETSY_PRODUCTION_PARTNER_REQUIRED_MESSAGE;
  }

  const intro =
    "Etsy did not list this item. Etsy only accepts something you or your shop made, a vintage item about 20 years or older, or a craft supply.";
  const action =
    "On the listing, change How it's made so it matches one of those, then try List on Etsy again.";

  const who = how?.whoMade ?? null;
  const when = how?.whenMade ?? null;
  const isSupply = how?.isSupply;
  const bits: string[] = [];
  if (who === "someone_else") bits.push("made by another company or person");
  else if (who === "i_did") bits.push("made by you");
  else if (who === "collective") bits.push("made by a member of your shop");
  if (when) {
    const phrase = whenPhrase(when);
    if (phrase) bits.push(phrase);
  }
  if (isSupply === true) bits.push("a craft supply");
  else if (isSupply === false) bits.push("a finished product rather than a craft supply");

  if (bits.length === 0) return `${intro} ${action}`;
  return `${intro} This listing is marked as ${joinAnd(bits)}, so it does not qualify. ${action}`;
}

/** Keep other Etsy errors unchanged. Rewrite the marketplace rejection for sellers. */
export function sellerEtsyErrorMessage(
  rawMessage: string | null | undefined,
  how?: EtsyMarketplaceHow | null
): string | null {
  if (rawMessage == null) return null;
  return explainEtsyMarketplaceRejection(rawMessage, how) ?? rawMessage;
}
