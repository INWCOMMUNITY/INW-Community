/**
 * eBay category-specific item conditions (Metadata API + Inventory API ConditionEnum).
 */

import { ebayGet } from "./client";
import { EBAY_MARKETPLACE_ID } from "./config";

/** Inventory API ConditionEnum values keyed by eBay metadata condition ID. */
export const EBAY_CONDITION_ID_TO_ENUM: Record<number, string> = {
  1000: "NEW",
  1500: "NEW_OTHER",
  1750: "NEW_WITH_DEFECTS",
  2000: "CERTIFIED_REFURBISHED",
  2010: "EXCELLENT_REFURBISHED",
  2020: "VERY_GOOD_REFURBISHED",
  2030: "GOOD_REFURBISHED",
  2500: "SELLER_REFURBISHED",
  2750: "LIKE_NEW",
  3000: "USED_EXCELLENT",
  4000: "USED_VERY_GOOD",
  5000: "USED_GOOD",
  6000: "USED_ACCEPTABLE",
  7000: "FOR_PARTS_OR_NOT_WORKING",
};

export type EbayConditionGroup = "new" | "used" | "other";

export type EbayConditionChoice = {
  conditionId: number;
  enum: string;
  label: string;
  group: EbayConditionGroup;
};

export type EbayConditionPresentation =
  | {
      mode: "binary";
      newOption: EbayConditionChoice;
      usedOption: EbayConditionChoice;
      allOptions: EbayConditionChoice[];
    }
  | {
      mode: "list";
      options: EbayConditionChoice[];
      allOptions: EbayConditionChoice[];
    };

function conditionGroup(conditionId: number, label: string): EbayConditionGroup {
  if (conditionId < 2000) return "new";
  if (conditionId >= 2000 && conditionId < 7000) return "used";
  if (/\bnew\b/i.test(label) && !/used|pre-?owned|refurbished/i.test(label)) return "new";
  if (/used|pre-?owned|refurbished|good|excellent|fair|acceptable|ungraded|graded/i.test(label)) {
    return "used";
  }
  return "other";
}

export function conditionEnumFromId(conditionId: number | string | null | undefined): string | null {
  if (conditionId == null || conditionId === "") return null;
  const id = typeof conditionId === "number" ? conditionId : Number(conditionId);
  if (!Number.isFinite(id)) return null;
  return EBAY_CONDITION_ID_TO_ENUM[id] ?? null;
}

export function conditionIdFromEnum(conditionEnum: string | null | undefined): number | null {
  const key = conditionEnum?.trim().toUpperCase();
  if (!key) return null;
  for (const [id, enumVal] of Object.entries(EBAY_CONDITION_ID_TO_ENUM)) {
    if (enumVal === key) return Number(id);
  }
  return null;
}

/** Default Inventory enum from INW new/used when no category-specific override exists. */
export function defaultEbayConditionEnum(inwCondition: string | null | undefined): string {
  return inwCondition === "used" ? "USED_EXCELLENT" : "NEW";
}

export function resolveEbayInventoryCondition(args: {
  condition: string | null | undefined;
  ebayConditionEnum?: string | null;
}): string {
  const override = args.ebayConditionEnum?.trim().toUpperCase();
  if (override) return override;
  return defaultEbayConditionEnum(args.condition);
}

type MetadataConditionRow = {
  conditionId?: string | number;
  conditionDescription?: string;
  conditionDisplayName?: string;
};

type MetadataPolicyResponse = {
  itemConditionPolicies?: {
    categoryId?: string;
    itemConditions?: MetadataConditionRow[];
  }[];
};

/** Fetch allowed item conditions for an eBay leaf category (Metadata API). */
export async function fetchEbayCategoryConditions(
  accessToken: string,
  categoryId: string
): Promise<EbayConditionChoice[]> {
  const id = categoryId.trim();
  if (!id) return [];

  const url =
    `https://api.ebay.com/sell/metadata/v1/marketplace/${encodeURIComponent(EBAY_MARKETPLACE_ID)}` +
    `/get_item_condition_policies?filter=${encodeURIComponent(`categoryIds:{${id}}`)}`;

  const res = await ebayGet<MetadataPolicyResponse>(accessToken, url);
  const policy = res.itemConditionPolicies?.find((p) => p.categoryId === id) ?? res.itemConditionPolicies?.[0];
  const rows = policy?.itemConditions ?? [];

  const out: EbayConditionChoice[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const conditionId = Number(row.conditionId);
    const enumVal = conditionEnumFromId(conditionId);
    if (!enumVal || !Number.isFinite(conditionId)) continue;
    if (seen.has(enumVal)) continue;
    seen.add(enumVal);

    const label =
      row.conditionDisplayName?.trim() ||
      row.conditionDescription?.trim() ||
      enumVal.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

    out.push({
      conditionId,
      enum: enumVal,
      label,
      group: conditionGroup(conditionId, label),
    });
  }

  return out;
}

/** Pick the best default used/new enum from allowed category conditions. */
export function pickDefaultConditionChoices(choices: EbayConditionChoice[]): {
  newEnum: string;
  usedEnum: string;
} {
  const newPick =
    choices.find((c) => c.enum === "NEW") ??
    choices.find((c) => c.group === "new") ??
    choices[0];
  const usedPick =
    choices.find((c) => c.enum === "USED_EXCELLENT") ??
    choices.find((c) => c.group === "used" && c.enum.startsWith("USED_")) ??
    choices.find((c) => c.group === "used") ??
    choices.find((c) => c.enum !== newPick?.enum);

  return {
    newEnum: newPick?.enum ?? "NEW",
    usedEnum: usedPick?.enum ?? "USED_EXCELLENT",
  };
}

/** Build mobile-friendly presentation (binary New/Used when possible). */
export function presentEbayConditionChoices(choices: EbayConditionChoice[]): EbayConditionPresentation {
  if (choices.length === 0) {
    const fallbackNew: EbayConditionChoice = {
      conditionId: 1000,
      enum: "NEW",
      label: "New",
      group: "new",
    };
    const fallbackUsed: EbayConditionChoice = {
      conditionId: 3000,
      enum: "USED_EXCELLENT",
      label: "Used",
      group: "used",
    };
    return {
      mode: "binary",
      newOption: fallbackNew,
      usedOption: fallbackUsed,
      allOptions: [fallbackNew, fallbackUsed],
    };
  }

  const newOptions = choices.filter((c) => c.group === "new");
  const usedOptions = choices.filter((c) => c.group === "used");
  const otherOptions = choices.filter((c) => c.group === "other");

  if (otherOptions.length === 0 && newOptions.length > 0 && usedOptions.length > 0) {
    const newOption = newOptions.find((c) => c.enum === "NEW") ?? newOptions[0]!;
    const usedOption =
      usedOptions.find((c) => c.enum === "USED_EXCELLENT") ??
      usedOptions.find((c) => c.enum.startsWith("USED_")) ??
      usedOptions[0]!;
    return {
      mode: "binary",
      newOption: { ...newOption, label: "New" },
      usedOption: { ...usedOption, label: "Used" },
      allOptions: choices,
    };
  }

  return { mode: "list", options: choices, allOptions: choices };
}

export function inwConditionFromEbayEnum(conditionEnum: string | null | undefined): "new" | "used" {
  const id = conditionIdFromEnum(conditionEnum);
  if (id != null && id < 2000) return "new";
  if (id != null && id >= 2000 && id < 7000) return "used";
  const key = conditionEnum?.toUpperCase() ?? "";
  if (key.startsWith("NEW") || key === "LIKE_NEW") return "new";
  return "used";
}

export function isEbayConditionSyncError(message: string | null | undefined): boolean {
  if (!message?.trim()) return false;
  return /\b25021\b|invalid item condition|condition id is invalid/i.test(message);
}
