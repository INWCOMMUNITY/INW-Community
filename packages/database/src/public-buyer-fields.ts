/**
 * Pure helpers for public listing custom options.
 * No Prisma / Node imports — storefront pages must not pull the database barrel.
 */

export type ListingBuyerFieldKind = "TEXT" | "DROPDOWN" | "FILE";

export type ListingBuyerFieldPublic = {
  id: string;
  kind: ListingBuyerFieldKind;
  title: string;
  instructions: string | null;
  required: boolean;
  maxCharacters: number | null;
  maxFiles: number | null;
  labelEachFile: boolean;
  options: Array<{ id: string; label: string; required: boolean }>;
};

export type ListingBuyerFieldRow = {
  id: string;
  kind: ListingBuyerFieldKind;
  title: string;
  instructions: string | null;
  required: boolean;
  maxCharacters: number | null;
  maxFiles: number | null;
  labelEachFile: boolean;
  etsyQuestionId?: string | null;
  options: Array<{
    id: string;
    label: string;
    required?: boolean;
    etsyOptionId?: string | null;
    position?: number;
  }>;
};

function sortFields<T extends { position?: number }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
}

export function publicBuyerFieldsFromRows(
  rows: Array<ListingBuyerFieldRow & { position: number }>
): ListingBuyerFieldPublic[] {
  return sortFields(rows).map((row) => ({
    id: row.id,
    kind: row.kind,
    title: row.title,
    instructions: row.instructions,
    required: row.required,
    maxCharacters: row.maxCharacters,
    maxFiles: row.maxFiles,
    labelEachFile: row.labelEachFile,
    options: [...row.options]
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
      .map((option) => ({
        id: option.id,
        label: option.label,
        required: option.required !== false,
      })),
  }));
}
