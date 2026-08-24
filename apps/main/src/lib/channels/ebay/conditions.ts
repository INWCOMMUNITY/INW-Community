/**
 * eBay category-specific item conditions (Metadata API + Inventory API ConditionEnum).
 */

import type { SyncStoreItem } from "../types";
import { inventoryPutLetterGradeIsNumeric } from "./aspect-prep";
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

/**
 * Pick an Inventory API condition enum valid for the offer category.
 * Falls back from stored override / INW defaults to category-allowed values.
 */
export function resolveEbaySyncConditionFromChoices(
  item: Pick<SyncStoreItem, "condition" | "ebayConditionEnum">,
  choices: EbayConditionChoice[]
): { conditionEnum: string; autoCorrected: boolean } {
  const requested = resolveEbayInventoryCondition(item);
  if (choices.length === 0) {
    return { conditionEnum: requested, autoCorrected: false };
  }

  const allowed = new Set(choices.map((c) => c.enum));
  if (allowed.has(requested)) {
    return { conditionEnum: requested, autoCorrected: false };
  }

  const { newEnum, usedEnum } = pickDefaultConditionChoices(choices);
  const corrected = item.condition === "used" ? usedEnum : newEnum;
  if (allowed.has(corrected)) {
    return { conditionEnum: corrected, autoCorrected: true };
  }

  return { conditionEnum: choices[0]!.enum, autoCorrected: true };
}

/** Fetch category policy and resolve a valid sync condition enum. */
export async function resolveEbaySyncCondition(
  accessToken: string,
  item: Pick<SyncStoreItem, "condition" | "ebayConditionEnum">,
  categoryId: string | null
): Promise<{ conditionEnum: string; autoCorrected: boolean }> {
  if (!categoryId?.trim()) {
    return { conditionEnum: resolveEbayInventoryCondition(item), autoCorrected: false };
  }

  try {
    const choices = await fetchEbayCategoryConditions(accessToken, categoryId);
    return resolveEbaySyncConditionFromChoices(item, choices);
  } catch {
    return { conditionEnum: resolveEbayInventoryCondition(item), autoCorrected: false };
  }
}

type MetadataConditionRow = {
  conditionId?: string | number;
  conditionDescription?: string;
  conditionDisplayName?: string;
  conditionDescriptors?: MetadataDescriptorRow[];
};

type MetadataDescriptorRow = {
  conditionDescriptorId?: string | number;
  conditionDescriptorName?: string;
  conditionDescriptorHelpText?: string;
  conditionDescriptorConstraint?: { aspectRequired?: boolean };
  conditionDescriptorValues?: {
    conditionDescriptorValueId?: string | number;
    conditionDescriptorValueName?: string;
  }[];
};

export type EbayConditionDescriptorMeta = {
  descriptorId: string;
  name: string;
  required: boolean;
  values: { id: string; label: string }[];
};

export type EbayInventoryConditionDescriptor = {
  name: string;
  values: string[];
  additionalInfo?: string;
};

const DESCRIPTOR_ASPECT_ALIASES: Record<string, string[]> = {
  grader: ["professional grader", "grader", "certification", "certification service"],
  grade: ["numerical grade", "letter grade", "grade"],
  certification: ["certification number", "cert number", "cert #"],
};

function normalizeDescriptorKey(value: string): string {
  return value.trim().toLowerCase();
}

function pickAspectValues(
  aspects: Record<string, string[]>,
  aliases: string[]
): string[] {
  for (const alias of aliases) {
    for (const [name, values] of Object.entries(aspects)) {
      if (normalizeDescriptorKey(name) === alias) {
        return values.map((v) => v.trim()).filter(Boolean);
      }
    }
  }
  return [];
}

function resolveDescriptorValueId(
  meta: EbayConditionDescriptorMeta,
  aspectValues: string[],
  options?: { allowNumericLetterGrade?: boolean }
): string | null {
  const isLetterGradeDescriptor = /letter grade/.test(normalizeDescriptorKey(meta.name));
  for (const aspectValue of aspectValues) {
    const normalized = normalizeDescriptorKey(aspectValue);
    if (
      isLetterGradeDescriptor &&
      /^\d{1,2}$/.test(normalized) &&
      !options?.allowNumericLetterGrade
    ) {
      continue;
    }
    const exact = meta.values.find((v) => normalizeDescriptorKey(v.label) === normalized);
    if (exact) return exact.id;
    const partial = meta.values.find(
      (v) =>
        normalizeDescriptorKey(v.label).includes(normalized) ||
        normalized.includes(normalizeDescriptorKey(v.label))
    );
    if (partial) return partial.id;
  }
  return null;
}

function descriptorKind(name: string): "grader" | "grade" | "certification" | "other" {
  const key = normalizeDescriptorKey(name);
  if (/grader|certification service/.test(key)) return "grader";
  if (/grade|card condition/.test(key)) return "grade";
  if (/certification number|cert number|cert #/.test(key)) return "certification";
  return "other";
}

/** Parse condition descriptor metadata from Metadata API policy rows. */
export function parseConditionDescriptorMetadata(
  rows: MetadataConditionRow[]
): EbayConditionDescriptorMeta[] {
  const out: EbayConditionDescriptorMeta[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    for (const descriptor of row.conditionDescriptors ?? []) {
      const descriptorId = String(descriptor.conditionDescriptorId ?? "").trim();
      const name = descriptor.conditionDescriptorName?.trim();
      if (!descriptorId || !name || seen.has(descriptorId)) continue;
      seen.add(descriptorId);
      out.push({
        descriptorId,
        name,
        required: Boolean(descriptor.conditionDescriptorConstraint?.aspectRequired),
        values: (descriptor.conditionDescriptorValues ?? [])
          .map((value) => ({
            id: String(value.conditionDescriptorValueId ?? "").trim(),
            label: value.conditionDescriptorValueName?.trim() ?? "",
          }))
          .filter((value) => value.id && value.label),
      });
    }
  }
  return out;
}

export async function fetchConditionDescriptorMetadata(
  accessToken: string,
  categoryId: string
): Promise<EbayConditionDescriptorMeta[]> {
  const { descriptors } = await fetchItemConditionPolicy(accessToken, categoryId);
  return descriptors;
}

function parseGradePrefixFromAspects(productAspects: Record<string, string[]>): string | null {
  for (const g of pickAspectValues(productAspects, ["grade"])) {
    const m = g.trim().match(/\b(MS|PR|PF|SP|AU|XF|VF|F|VG|G|AG)[\s-]*(\d{1,2})\b/i);
    if (m) return m[1]!.toUpperCase();
  }
  return null;
}

function parseGradePrefixFromTitle(title: string): string | null {
  const m = title.trim().match(/\b(MS|PR|PF|SP|AU|XF|VF|F|VG|G|AG)[\s-]*(\d{1,2})\b/i);
  return m ? m[1]!.toUpperCase() : null;
}

function normalizeLetterGradePrefix(prefix: string): string {
  const upper = prefix.toUpperCase();
  // eBay coin metadata uses PR; slabs/titles may say PF for proof.
  if (upper === "PF") return "PR";
  return upper;
}

function letterGradeDescriptorValues(
  productAspects: Record<string, string[]>,
  title?: string,
  categoryId?: string | null
): string[] {
  const letter = pickAspectValues(productAspects, ["letter grade"]);
  if (inventoryPutLetterGradeIsNumeric(categoryId)) {
    // Dime wire Letter grade aspect is numeric (69). Condition descriptors still use the
    // grade prefix (PR) paired with Numerical grade (69) — never reuse numerical value IDs.
    const prefix =
      parseGradePrefixFromAspects(productAspects) ??
      (title ? parseGradePrefixFromTitle(title) : null);
    if (prefix) return [normalizeLetterGradePrefix(prefix)];
    return [];
  }
  if (letter.length > 0 && !/^\d{1,2}$/.test(letter[0]!)) {
    return [normalizeLetterGradePrefix(letter[0]!)];
  }
  const prefix =
    parseGradePrefixFromAspects(productAspects) ??
    (title ? parseGradePrefixFromTitle(title) : null);
  if (prefix) return [normalizeLetterGradePrefix(prefix)];
  return [];
}

function findDescriptorMeta(
  metadata: EbayConditionDescriptorMeta[],
  pattern: RegExp
): EbayConditionDescriptorMeta | undefined {
  return metadata.find((meta) => pattern.test(normalizeDescriptorKey(meta.name)));
}

function conditionDescriptorsHaveDuplicateGradeValueIds(
  descriptors: EbayInventoryConditionDescriptor[],
  metadata: EbayConditionDescriptorMeta[]
): boolean {
  const letterMeta = findDescriptorMeta(metadata, /letter grade/);
  const numericalMeta = findDescriptorMeta(metadata, /numerical grade|numeric grade/);
  if (!letterMeta || !numericalMeta) return false;
  const letter = descriptors.find((row) => row.name === letterMeta.descriptorId);
  const numerical = descriptors.find((row) => row.name === numericalMeta.descriptorId);
  if (!letter?.values[0] || !numerical?.values[0]) return false;
  return letter.values[0] === numerical.values[0];
}

function aspectValuesForDescriptorName(
  descriptorName: string,
  productAspects: Record<string, string[]>,
  title?: string,
  categoryId?: string | null
): string[] {
  const key = normalizeDescriptorKey(descriptorName);
  if (/professional grader|^grader$|certification service/.test(key)) {
    return pickAspectValues(productAspects, DESCRIPTOR_ASPECT_ALIASES.grader);
  }
  if (/letter grade/.test(key)) {
    return letterGradeDescriptorValues(productAspects, title, categoryId);
  }
  if (/numerical grade|numeric grade/.test(key)) {
    return pickAspectValues(productAspects, ["numerical grade", "numeric grade"]);
  }
  if (/^grade$/.test(key)) {
    const letter = pickAspectValues(productAspects, ["letter grade"]);
    const numeric = pickAspectValues(productAspects, ["numerical grade", "numeric grade"]);
    const grade = pickAspectValues(productAspects, ["grade"]);
    if (letter.length > 0 && numeric.length > 0) {
      return [`${letter[0]} ${numeric[0]}`.trim()];
    }
    return numeric.length > 0 ? numeric : letter.length > 0 ? letter : grade;
  }
  if (/certification number|cert number|cert #/.test(key)) {
    return pickAspectValues(productAspects, DESCRIPTOR_ASPECT_ALIASES.certification);
  }
  return pickAspectValues(productAspects, [descriptorName]);
}

export function readLiveConditionDescriptors(
  live: Record<string, unknown> | null | undefined
): EbayInventoryConditionDescriptor[] | undefined {
  const rows = live?.conditionDescriptors;
  if (!Array.isArray(rows) || rows.length === 0) return undefined;
  const out: EbayInventoryConditionDescriptor[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const name = String((row as { name?: unknown }).name ?? "").trim();
    const values = (row as { values?: unknown }).values;
    if (!name || !Array.isArray(values)) continue;
    const cleaned = values.map((v) => String(v).trim()).filter(Boolean);
    if (cleaned.length === 0) continue;
    const additionalInfo = (row as { additionalInfo?: unknown }).additionalInfo;
    out.push({
      name,
      values: cleaned,
      ...(typeof additionalInfo === "string" && additionalInfo.trim()
        ? { additionalInfo: additionalInfo.trim() }
        : {}),
    });
  }
  return out.length > 0 ? out : undefined;
}

/** Build Inventory API conditionDescriptors from product aspects when category requires them. */
export function buildConditionDescriptorsFromAspects(
  productAspects: Record<string, string[]>,
  metadata: EbayConditionDescriptorMeta[],
  title?: string,
  categoryId?: string | null
): EbayInventoryConditionDescriptor[] | undefined {
  if (metadata.length === 0) return undefined;
  const descriptors: EbayInventoryConditionDescriptor[] = [];

  for (const meta of metadata) {
    const aspectValues = aspectValuesForDescriptorName(meta.name, productAspects, title, categoryId);
    if (aspectValues.length === 0) continue;
    const valueId = resolveDescriptorValueId(meta, aspectValues);
    if (!valueId) continue;
    const kind = descriptorKind(meta.name);
    const row: EbayInventoryConditionDescriptor = {
      name: meta.descriptorId,
      values: [valueId],
    };
    if (kind === "certification") {
      row.additionalInfo = aspectValues[0];
    }
    descriptors.push(row);
  }

  return descriptors.length > 0 ? descriptors : undefined;
}

/** Log-friendly summary of conditionDescriptors with metadata labels when available. */
export function summarizeConditionDescriptors(
  descriptors: EbayInventoryConditionDescriptor[] | undefined,
  metadata: EbayConditionDescriptorMeta[] = []
): Array<{ id: string; name: string; valueId: string; valueLabel: string | null }> {
  if (!descriptors?.length) return [];
  return descriptors.map((descriptor) => {
    const meta = metadata.find((row) => row.descriptorId === descriptor.name);
    const valueId = descriptor.values[0] ?? "";
    const valueLabel = meta?.values.find((value) => value.id === valueId)?.label ?? null;
    return {
      id: descriptor.name,
      name: meta?.name ?? descriptor.name,
      valueId,
      valueLabel,
    };
  });
}

export function preserveOrBuildConditionDescriptorsOnBody(
  body: Record<string, unknown>,
  live: Record<string, unknown> | null | undefined,
  productAspects: Record<string, string[]>,
  metadata: EbayConditionDescriptorMeta[],
  title?: string,
  categoryId?: string | null
): Record<string, unknown> {
  const built = buildConditionDescriptorsFromAspects(productAspects, metadata, title, categoryId);
  if (built && built.length > 0) {
    if (conditionDescriptorsHaveDuplicateGradeValueIds(built, metadata)) {
      const liveDescriptors = readLiveConditionDescriptors(live ?? undefined);
      if (liveDescriptors?.length) {
        return { ...body, conditionDescriptors: liveDescriptors };
      }
    }
    return { ...body, conditionDescriptors: built };
  }
  const liveDescriptors = readLiveConditionDescriptors(live ?? undefined);
  if (liveDescriptors) {
    return { ...body, conditionDescriptors: liveDescriptors };
  }
  return body;
}

export function appendConditionDescriptorsToInventoryBody(
  body: Record<string, unknown>,
  productAspects: Record<string, string[]>,
  metadata: EbayConditionDescriptorMeta[],
  title?: string,
  categoryId?: string | null
): Record<string, unknown> {
  const descriptors = buildConditionDescriptorsFromAspects(
    productAspects,
    metadata,
    title,
    categoryId
  );
  if (!descriptors) return body;
  return { ...body, conditionDescriptors: descriptors };
}

type MetadataPolicyResponse = {
  itemConditionPolicies?: {
    categoryId?: string;
    itemConditions?: MetadataConditionRow[];
  }[];
};

async function fetchConditionPolicyRows(
  accessToken: string,
  categoryId: string
): Promise<MetadataConditionRow[]> {
  const id = categoryId.trim();
  if (!id) return [];

  const url =
    `https://api.ebay.com/sell/metadata/v1/marketplace/${encodeURIComponent(EBAY_MARKETPLACE_ID)}` +
    `/get_item_condition_policies?filter=${encodeURIComponent(`categoryIds:{${id}}`)}`;

  const res = await ebayGet<MetadataPolicyResponse>(accessToken, url);
  const policy =
    res.itemConditionPolicies?.find((p) => p.categoryId === id) ?? res.itemConditionPolicies?.[0];
  return policy?.itemConditions ?? [];
}

export async function fetchItemConditionPolicy(
  accessToken: string,
  categoryId: string
): Promise<{ descriptors: EbayConditionDescriptorMeta[]; hasConditions: boolean }> {
  const rows = await fetchConditionPolicyRows(accessToken, categoryId);
  return {
    descriptors: parseConditionDescriptorMetadata(rows),
    hasConditions: rows.length > 0,
  };
}

/** Fetch allowed item conditions for an eBay leaf category (Metadata API). */
export async function fetchEbayCategoryConditions(
  accessToken: string,
  categoryId: string
): Promise<EbayConditionChoice[]> {
  const rows = await fetchConditionPolicyRows(accessToken, categoryId);

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
