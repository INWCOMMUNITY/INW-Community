import type { Prisma, PrismaClient } from "@prisma/client";
import type {
  ListingBuyerFieldKind,
  ListingBuyerFieldPublic,
} from "./public-buyer-fields";

export {
  publicBuyerFieldsFromRows,
  type ListingBuyerFieldKind,
  type ListingBuyerFieldPublic,
  type ListingBuyerFieldRow,
} from "./public-buyer-fields";

/** Etsy receipt variations with this property id are personalization, not inventory. */
export const ETSY_PERSONALIZATION_PROPERTY_ID = 54;

export const LISTING_BUYER_FIELD_MAX = 5;
export const LISTING_BUYER_TITLE_MAX = 45;
export const LISTING_BUYER_INSTRUCTIONS_MAX = 120;
export const LISTING_BUYER_TEXT_CHARS_MIN = 1;
export const LISTING_BUYER_TEXT_CHARS_MAX = 1024;
export const LISTING_BUYER_DROPDOWN_OPTIONS_MAX = 30;
export const LISTING_BUYER_DROPDOWN_LABEL_MAX = 20;
export const LISTING_BUYER_FILE_LABEL_MAX = 45;
export const LISTING_BUYER_FILES_MIN = 1;
export const LISTING_BUYER_FILES_MAX = 10;

export type ListingBuyerFieldOptionInput = {
  id?: string | null;
  label: string;
  etsyOptionId?: string | null;
};

export type ListingBuyerFieldInput = {
  id?: string | null;
  kind: ListingBuyerFieldKind;
  title: string;
  instructions?: string | null;
  required?: boolean;
  maxCharacters?: number | null;
  maxFiles?: number | null;
  labelEachFile?: boolean;
  etsyQuestionId?: string | null;
  options?: ListingBuyerFieldOptionInput[];
};

export type NormalizedListingBuyerField = {
  id?: string;
  kind: ListingBuyerFieldKind;
  title: string;
  instructions: string | null;
  required: boolean;
  maxCharacters: number | null;
  maxFiles: number | null;
  labelEachFile: boolean;
  etsyQuestionId: string | null;
  options: Array<{ id?: string; label: string; etsyOptionId: string | null }>;
};

export type BuyerFieldFileAnswer = { url: string; label?: string | null };

export type BuyerFieldResponse = {
  fieldId: string;
  title: string;
  kind: ListingBuyerFieldKind;
  text?: string | null;
  optionLabel?: string | null;
  files?: BuyerFieldFileAnswer[];
};

export type EtsyPersonalizationQuestion = {
  question_id?: number | null;
  question_type: string;
  question_text: string;
  instructions?: string | null;
  required?: boolean;
  max_allowed_characters?: number | null;
  max_allowed_files?: number | null;
  options?: Array<{ option_id?: number | null; label?: string | null }> | null;
};

export type ValidateBuyerFieldsResult =
  | { ok: true; fields: NormalizedListingBuyerField[] }
  | { ok: false; error: string };

function startsOk(value: string): boolean {
  return /^[A-Za-z0-9]/.test(value);
}

function tooManyAcronymWords(value: string): boolean {
  const hits = value.split(/\s+/).filter((word) => /^[A-Z]{3,}[^a-z]*$/.test(word));
  return hits.length > 1;
}

function checkTitle(title: string, label: string): string | null {
  if (title.length < 1 || title.length > LISTING_BUYER_TITLE_MAX) {
    return `${label} title must be 1–${LISTING_BUYER_TITLE_MAX} characters.`;
  }
  if (!startsOk(title)) return `${label} title must start with a letter or number.`;
  if (tooManyAcronymWords(title)) {
    return `${label} title can have at most one word of 3+ capital letters.`;
  }
  return null;
}

function checkInstructions(text: string, label: string): string | null {
  if (text.length > LISTING_BUYER_INSTRUCTIONS_MAX) {
    return `${label} instructions must be ${LISTING_BUYER_INSTRUCTIONS_MAX} characters or fewer.`;
  }
  if (text.length > 0 && !startsOk(text)) {
    return `${label} instructions must start with a letter or number.`;
  }
  if (tooManyAcronymWords(text)) {
    return `${label} instructions can have at most one word of 3+ capital letters.`;
  }
  return null;
}

export function validateListingBuyerFields(raw: unknown): ValidateBuyerFieldsResult {
  if (raw == null) return { ok: true, fields: [] };
  if (!Array.isArray(raw)) return { ok: false, error: "Custom options must be a list." };
  if (raw.length > LISTING_BUYER_FIELD_MAX) {
    return { ok: false, error: `A listing can have at most ${LISTING_BUYER_FIELD_MAX} custom options.` };
  }

  const fields: NormalizedListingBuyerField[] = [];
  let fileCount = 0;
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") {
      return { ok: false, error: "Each custom option needs a type and title." };
    }
    const rec = entry as ListingBuyerFieldInput;
    const kind = rec.kind;
    if (kind !== "TEXT" && kind !== "DROPDOWN" && kind !== "FILE") {
      return { ok: false, error: "Custom option type must be text, a list of options, or a file upload." };
    }
    const title = typeof rec.title === "string" ? rec.title.trim() : "";
    const titleError = checkTitle(title, "Custom option");
    if (titleError) return { ok: false, error: titleError };
    const instructionsRaw = typeof rec.instructions === "string" ? rec.instructions.trim() : "";
    const required = rec.required === true;
    const etsyQuestionId =
      typeof rec.etsyQuestionId === "string" && rec.etsyQuestionId.trim()
        ? rec.etsyQuestionId.trim()
        : null;
    const id = typeof rec.id === "string" && rec.id.trim() ? rec.id.trim() : undefined;

    if (kind === "TEXT") {
      const instructionsError = instructionsRaw ? checkInstructions(instructionsRaw, "Text box") : null;
      if (instructionsError) return { ok: false, error: instructionsError };
      const maxCharacters = Number(rec.maxCharacters);
      if (
        !Number.isInteger(maxCharacters) ||
        maxCharacters < LISTING_BUYER_TEXT_CHARS_MIN ||
        maxCharacters > LISTING_BUYER_TEXT_CHARS_MAX
      ) {
        return {
          ok: false,
          error: `Text box character limit must be ${LISTING_BUYER_TEXT_CHARS_MIN}–${LISTING_BUYER_TEXT_CHARS_MAX}.`,
        };
      }
      fields.push({
        id,
        kind,
        title,
        instructions: instructionsRaw || null,
        required,
        maxCharacters,
        maxFiles: null,
        labelEachFile: false,
        etsyQuestionId,
        options: [],
      });
      continue;
    }

    if (kind === "DROPDOWN") {
      if (instructionsRaw) {
        return { ok: false, error: "A list of options cannot include instructions." };
      }
      const options = normalizeOptionLabels(rec.options, LISTING_BUYER_DROPDOWN_LABEL_MAX, "Option");
      if (!options.ok) return options;
      if (options.labels.length < 1 || options.labels.length > LISTING_BUYER_DROPDOWN_OPTIONS_MAX) {
        return {
          ok: false,
          error: `A list of options needs 1–${LISTING_BUYER_DROPDOWN_OPTIONS_MAX} choices.`,
        };
      }
      fields.push({
        id,
        kind,
        title,
        instructions: null,
        required,
        maxCharacters: null,
        maxFiles: null,
        labelEachFile: false,
        etsyQuestionId,
        options: options.labels,
      });
      continue;
    }

    fileCount += 1;
    if (fileCount > 1) {
      return { ok: false, error: "A listing can have only one file upload custom option." };
    }
    const instructionsError = instructionsRaw ? checkInstructions(instructionsRaw, "File upload") : null;
    if (instructionsError) return { ok: false, error: instructionsError };
    const maxFiles = Number(rec.maxFiles);
    const labelEachFile = rec.labelEachFile === true;
    if (!Number.isInteger(maxFiles) || maxFiles < LISTING_BUYER_FILES_MIN || maxFiles > LISTING_BUYER_FILES_MAX) {
      return { ok: false, error: `File upload allows ${LISTING_BUYER_FILES_MIN}–${LISTING_BUYER_FILES_MAX} files.` };
    }
    if (labelEachFile && maxFiles < 2) {
      return { ok: false, error: "Labeling each file needs at least 2 files." };
    }
    const options = labelEachFile
      ? normalizeOptionLabels(rec.options, LISTING_BUYER_FILE_LABEL_MAX, "File label", true)
      : { ok: true as const, labels: [] };
    if (!options.ok) return options;
    if (labelEachFile && options.labels.length !== maxFiles) {
      return { ok: false, error: "Labeled file upload needs one label per file." };
    }
    if (!labelEachFile && Array.isArray(rec.options) && rec.options.length > 0) {
      return { ok: false, error: "Turn on “label each file” to name individual uploads." };
    }
    fields.push({
      id,
      kind,
      title,
      instructions: instructionsRaw || null,
      required,
      maxCharacters: null,
      maxFiles,
      labelEachFile,
      etsyQuestionId,
      options: options.labels,
    });
  }

  return { ok: true, fields };
}

function normalizeOptionLabels(
  raw: ListingBuyerFieldOptionInput[] | undefined,
  maxLen: number,
  noun: string,
  allowDuplicate = false
):
  | { ok: true; labels: NormalizedListingBuyerField["options"] }
  | { ok: false; error: string } {
  if (!Array.isArray(raw)) return { ok: true, labels: [] };
  const labels: NormalizedListingBuyerField["options"] = [];
  const seen = new Set<string>();
  for (const option of raw) {
    const label = typeof option?.label === "string" ? option.label.trim() : "";
    if (!label) continue;
    if (label.length > maxLen) {
      return { ok: false, error: `${noun} labels must be 1–${maxLen} characters.` };
    }
    const key = label.toLowerCase();
    if (!allowDuplicate && seen.has(key)) return { ok: false, error: `${noun} labels must be unique.` };
    seen.add(key);
    labels.push({
      id: typeof option.id === "string" && option.id.trim() ? option.id.trim() : undefined,
      label,
      etsyOptionId:
        typeof option.etsyOptionId === "string" && option.etsyOptionId.trim()
          ? option.etsyOptionId.trim()
          : null,
    });
  }
  return { ok: true, labels };
}

export function buyerFieldsDefinitionFingerprint(fields: NormalizedListingBuyerField[]): string {
  return JSON.stringify(
    fields.map((field) => ({
      kind: field.kind,
      title: field.title,
      instructions: field.instructions,
      required: field.required,
      maxCharacters: field.maxCharacters,
      maxFiles: field.maxFiles,
      labelEachFile: field.labelEachFile,
      options: field.options.map((option) => option.label),
    }))
  );
}

export function validateBuyerResponses(
  fields: ListingBuyerFieldPublic[],
  raw: unknown
): { ok: true; responses: BuyerFieldResponse[] } | { ok: false; error: string } {
  if (fields.length === 0) {
    if (raw == null || (Array.isArray(raw) && raw.length === 0)) return { ok: true, responses: [] };
    return { ok: false, error: "This listing does not collect custom options." };
  }
  if (!Array.isArray(raw)) return { ok: false, error: "Custom option answers are required." };
  const byId = new Map(raw.map((entry) => {
    const rec = entry as { fieldId?: unknown };
    return [typeof rec.fieldId === "string" ? rec.fieldId : "", entry];
  }));
  const responses: BuyerFieldResponse[] = [];
  for (const field of fields) {
    const entry = byId.get(field.id) as
      | { text?: unknown; optionLabel?: unknown; files?: unknown }
      | undefined;
    if (field.kind === "TEXT") {
      const text = typeof entry?.text === "string" ? entry.text.trim() : "";
      if (!text && field.required) return { ok: false, error: `${field.title} is required.` };
      if (text && field.maxCharacters != null && text.length > field.maxCharacters) {
        return { ok: false, error: `${field.title} must be ${field.maxCharacters} characters or fewer.` };
      }
      if (text) responses.push({ fieldId: field.id, title: field.title, kind: "TEXT", text });
      continue;
    }
    if (field.kind === "DROPDOWN") {
      const optionLabel = typeof entry?.optionLabel === "string" ? entry.optionLabel.trim() : "";
      if (!optionLabel && field.required) return { ok: false, error: `Choose ${field.title}.` };
      if (optionLabel && !field.options.some((option) => option.label === optionLabel)) {
        return { ok: false, error: `${field.title} has an unknown choice.` };
      }
      if (optionLabel) {
        responses.push({ fieldId: field.id, title: field.title, kind: "DROPDOWN", optionLabel });
      }
      continue;
    }
    const files = parseFileAnswers(entry?.files);
    if (!files.ok) return files;
    if (field.labelEachFile) {
      if (files.files.length === 0 && field.required) {
        return { ok: false, error: `${field.title} needs a file for each label.` };
      }
      if (files.files.length > 0) {
        const expected = field.options.map((option) => option.label);
        if (files.files.length !== expected.length) {
          return { ok: false, error: `${field.title} needs one file per label.` };
        }
        for (let i = 0; i < expected.length; i += 1) {
          const file = files.files[i]!;
          if ((file.label ?? expected[i]) !== expected[i] && file.label && file.label !== expected[i]) {
            return { ok: false, error: `${field.title} file labels do not match.` };
          }
          file.label = expected[i];
        }
      }
    } else if (field.required && files.files.length < 1) {
      return { ok: false, error: `${field.title} needs at least one file.` };
    }
    const cap = field.maxFiles ?? LISTING_BUYER_FILES_MAX;
    if (files.files.length > cap) {
      return { ok: false, error: `${field.title} allows up to ${cap} files.` };
    }
    if (files.files.length > 0) {
      responses.push({ fieldId: field.id, title: field.title, kind: "FILE", files: files.files });
    }
  }
  return { ok: true, responses };
}

function parseFileAnswers(
  raw: unknown
): { ok: true; files: BuyerFieldFileAnswer[] } | { ok: false; error: string } {
  if (raw == null) return { ok: true, files: [] };
  if (!Array.isArray(raw)) return { ok: false, error: "File answers must be a list." };
  const files: BuyerFieldFileAnswer[] = [];
  for (const entry of raw) {
    const url = typeof entry === "string" ? entry : (entry as { url?: unknown })?.url;
    const trimmed = typeof url === "string" ? url.trim() : "";
    if (!/^https:\/\//i.test(trimmed) && !trimmed.startsWith("/uploads/")) {
      return { ok: false, error: "Each uploaded file needs a secure https URL." };
    }
    const label =
      entry && typeof entry === "object" && typeof (entry as { label?: unknown }).label === "string"
        ? (entry as { label: string }).label.trim()
        : null;
    files.push({ url: trimmed.slice(0, 2000), label });
  }
  return { ok: true, files };
}

export { buyerResponsesFingerprint } from "./buyer-response-fingerprint";

export function parseStoredBuyerResponses(raw: unknown): BuyerFieldResponse[] {
  if (!Array.isArray(raw)) return [];
  const out: BuyerFieldResponse[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const rec = entry as BuyerFieldResponse;
    if (typeof rec.fieldId !== "string" || !rec.fieldId) continue;
    if (rec.kind !== "TEXT" && rec.kind !== "DROPDOWN" && rec.kind !== "FILE") continue;
    out.push({
      fieldId: rec.fieldId,
      title: typeof rec.title === "string" ? rec.title : "Custom option",
      kind: rec.kind,
      text: typeof rec.text === "string" ? rec.text : null,
      optionLabel: typeof rec.optionLabel === "string" ? rec.optionLabel : null,
      files: Array.isArray(rec.files)
        ? rec.files
            .filter((file) => file && typeof file.url === "string")
            .map((file) => ({ url: file.url, label: file.label ?? null }))
        : [],
    });
  }
  return out;
}

export function formatBuyerResponseLines(raw: unknown): string[] {
  return parseStoredBuyerResponses(raw).map((row) => {
    if (row.kind === "TEXT") return `${row.title}: ${row.text ?? ""}`;
    if (row.kind === "DROPDOWN") return `${row.title}: ${row.optionLabel ?? ""}`;
    const files = (row.files ?? []).map((file) => file.label ? `${file.label}: ${file.url}` : file.url);
    return `${row.title}: ${files.join(", ")}`;
  });
}

type BuyerFieldDb = PrismaClient | Prisma.TransactionClient;

export async function replaceListingBuyerFields(
  db: BuyerFieldDb,
  storeItemId: string,
  fields: NormalizedListingBuyerField[],
  options?: { personalizationDirty?: boolean }
): Promise<void> {
  await db.listingBuyerField.deleteMany({ where: { storeItemId } });
  for (let position = 0; position < fields.length; position += 1) {
    const field = fields[position]!;
    await db.listingBuyerField.create({
      data: {
        storeItemId,
        position,
        kind: field.kind,
        title: field.title,
        instructions: field.instructions,
        required: field.required,
        maxCharacters: field.maxCharacters,
        maxFiles: field.maxFiles,
        labelEachFile: field.labelEachFile,
        etsyQuestionId: field.etsyQuestionId,
        options: {
          create: field.options.map((option, optionPosition) => ({
            position: optionPosition,
            label: option.label,
            etsyOptionId: option.etsyOptionId,
          })),
        },
      },
    });
  }
  await db.etsyListingLink.updateMany({
    where: { storeItemId },
    data: {
      personalizationAuthoritative: true,
      personalizationDirty: options?.personalizationDirty === true,
    },
  });
}

export function etsyPersonalizationFieldsMatch(
  local: NormalizedListingBuyerField[],
  remote: NormalizedListingBuyerField[]
): boolean {
  if (buyerFieldsDefinitionFingerprint(local) !== buyerFieldsDefinitionFingerprint(remote)) return false;
  if (local.length !== remote.length) return false;
  return local.every((field, index) => {
    const other = remote[index];
    if (!other) return false;
    if ((field.etsyQuestionId ?? null) !== (other.etsyQuestionId ?? null)) return false;
    return field.options.every(
      (option, optionIndex) =>
        (option.etsyOptionId ?? null) === (other.options[optionIndex]?.etsyOptionId ?? null)
    );
  });
}

/** Etsy custom-option edits apply unless an INW edit is still waiting to push. */
export function shouldApplyEtsyPersonalizationInbound(input: {
  observed: boolean;
  mappedOk: boolean;
  localDirty: boolean;
  same: boolean;
}): boolean {
  return input.observed && input.mappedOk && !input.localDirty && !input.same;
}

function fitEtsyPersonalizationText(value: string, max: number): string {
  let text = value.trim().replace(/^[^A-Za-z0-9]+/, "");
  if (text.length > max) text = text.slice(0, max).trim();
  return text;
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isInteger(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function uniqueOptionLabels<T extends { label: string }>(options: T[]): T[] {
  const seen = new Set<string>();
  const labels: T[] = [];
  for (const option of options) {
    const key = option.label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    labels.push(option);
  }
  return labels;
}

export function buyerFieldsFromEtsyQuestions(
  questions: EtsyPersonalizationQuestion[] | null | undefined
): ValidateBuyerFieldsResult {
  if (!questions || questions.length === 0) return { ok: true, fields: [] };
  const mapped: ListingBuyerFieldInput[] = [];
  for (const question of questions) {
    const type = String(question.question_type ?? "").trim().toLowerCase();
    const title = fitEtsyPersonalizationText(String(question.question_text ?? ""), LISTING_BUYER_TITLE_MAX);
    if (!title) continue;
    const etsyQuestionId =
      question.question_id != null && Number.isFinite(Number(question.question_id))
        ? String(question.question_id)
        : null;
    const instructions = fitEtsyPersonalizationText(
      String(question.instructions ?? ""),
      LISTING_BUYER_INSTRUCTIONS_MAX
    );
    const options = (question.options ?? [])
      .map((option) => ({
        label: fitEtsyPersonalizationText(
          String(option?.label ?? ""),
          type === "labeled_upload" ? LISTING_BUYER_FILE_LABEL_MAX : LISTING_BUYER_DROPDOWN_LABEL_MAX
        ),
        etsyOptionId:
          option?.option_id != null && Number.isFinite(Number(option.option_id))
            ? String(option.option_id)
            : null,
      }))
      .filter((option) => option.label);
    const uniqueOptions = uniqueOptionLabels(options).slice(0, LISTING_BUYER_DROPDOWN_OPTIONS_MAX);
    if (type === "text_input") {
      mapped.push({
        kind: "TEXT",
        title,
        instructions: instructions || null,
        required: question.required === true,
        maxCharacters: clampInt(
          question.max_allowed_characters,
          LISTING_BUYER_TEXT_CHARS_MIN,
          LISTING_BUYER_TEXT_CHARS_MAX,
          256
        ),
        etsyQuestionId,
      });
    } else if (type === "dropdown") {
      if (uniqueOptions.length < 1) continue;
      mapped.push({
        kind: "DROPDOWN",
        title,
        required: question.required === true,
        etsyQuestionId,
        options: uniqueOptions,
      });
    } else if (type === "unlabeled_upload" || type === "labeled_upload") {
      if (mapped.some((field) => field.kind === "FILE")) continue;
      if (type === "labeled_upload") {
        const fileOptions = options.slice(0, LISTING_BUYER_FILES_MAX);
        if (fileOptions.length < 2) continue;
        mapped.push({
          kind: "FILE",
          title,
          instructions: instructions || null,
          required: question.required === true,
          maxFiles: fileOptions.length,
          labelEachFile: true,
          etsyQuestionId,
          options: fileOptions,
        });
      } else {
        mapped.push({
          kind: "FILE",
          title,
          instructions: instructions || null,
          required: question.required === true,
          maxFiles: clampInt(question.max_allowed_files, LISTING_BUYER_FILES_MIN, LISTING_BUYER_FILES_MAX, 1),
          labelEachFile: false,
          etsyQuestionId,
        });
      }
    }
    if (mapped.length >= LISTING_BUYER_FIELD_MAX) break;
  }
  if (mapped.length === 0) {
    return { ok: false, error: "Etsy personalization could not be read into custom options." };
  }
  return validateListingBuyerFields(mapped);
}

export function etsyPersonalizationWriteBody(fields: NormalizedListingBuyerField[]): {
  personalization_questions: Array<Record<string, unknown>>;
} {
  return {
    personalization_questions: fields.map((field) => {
      const questionId = field.etsyQuestionId && /^\d+$/.test(field.etsyQuestionId)
        ? Number(field.etsyQuestionId)
        : undefined;
      const base: Record<string, unknown> = {
        ...(questionId != null ? { question_id: questionId } : {}),
        question_text: field.title,
        required: field.required,
      };
      if (field.kind === "TEXT") {
        return {
          ...base,
          question_type: "text_input",
          instructions: field.instructions,
          max_allowed_characters: field.maxCharacters,
        };
      }
      if (field.kind === "DROPDOWN") {
        return {
          ...base,
          question_type: "dropdown",
          options: field.options.map((option) => ({
            ...(option.etsyOptionId && /^\d+$/.test(option.etsyOptionId)
              ? { option_id: Number(option.etsyOptionId) }
              : {}),
            label: option.label,
          })),
        };
      }
      const labeled = field.labelEachFile;
      return {
        ...base,
        question_type: labeled ? "labeled_upload" : "unlabeled_upload",
        instructions: field.instructions,
        max_allowed_files: field.maxFiles,
        ...(labeled
          ? {
              options: field.options.map((option) => ({
                ...(option.etsyOptionId && /^\d+$/.test(option.etsyOptionId)
                  ? { option_id: Number(option.etsyOptionId) }
                  : {}),
                label: option.label,
              })),
            }
          : {}),
      };
    }),
  };
}

export type EtsyReceiptVariation = {
  property_id?: number | string | null;
  formatted_name?: string | null;
  formatted_value?: string | null;
  property_name?: string | null;
  values?: string[] | null;
  question_id?: number | string | null;
};

export type EtsyPersonalizationAnswer = {
  questionId: string | null;
  name: string;
  value: string;
};

export function splitEtsyReceiptVariations(variations: EtsyReceiptVariation[] | null | undefined): {
  inventoryOptions: Record<string, string>;
  personalization: EtsyPersonalizationAnswer[];
} {
  const inventoryOptions: Record<string, string> = {};
  const personalization: EtsyPersonalizationAnswer[] = [];
  for (const variation of variations ?? []) {
    const propertyId = Number(variation.property_id);
    const name = (variation.formatted_name || variation.property_name || "").trim();
    const value = (
      variation.formatted_value ||
      (Array.isArray(variation.values) ? variation.values[0] : "") ||
      ""
    ).trim();
    if (propertyId === ETSY_PERSONALIZATION_PROPERTY_ID) {
      if (!name && !value) continue;
      const questionId =
        variation.question_id != null && String(variation.question_id).trim()
          ? String(variation.question_id).trim()
          : null;
      personalization.push({ questionId, name: name || "Personalization", value });
      continue;
    }
    if (name && value) inventoryOptions[name] = value;
  }
  return { inventoryOptions, personalization };
}
