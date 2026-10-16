export type BuyerFieldKind = "TEXT" | "DROPDOWN" | "FILE";

export type BuyerFieldDraft = {
  kind: BuyerFieldKind;
  title: string;
  instructions: string;
  required: boolean;
  maxCharacters: string;
  maxFiles: string;
  labelEachFile: boolean;
  options: string[];
  optionRequired?: boolean[];
  etsyQuestionId?: string | null;
  optionMeta?: Array<{ label: string; etsyOptionId?: string | null }>;
};

export type PublicBuyerField = {
  id: string;
  kind: BuyerFieldKind;
  title: string;
  instructions?: string | null;
  required: boolean;
  maxCharacters?: number | null;
  maxFiles?: number | null;
  labelEachFile?: boolean;
  options: Array<{ id: string; label: string; required?: boolean }>;
};

export function emptyBuyerField(kind: BuyerFieldKind): BuyerFieldDraft {
  return {
    kind,
    title: "",
    instructions: "",
    required: true,
    maxCharacters: "256",
    maxFiles: "",
    labelEachFile: false,
    options: [],
  };
}

export function buyerFieldsFromExisting(
  rows: Array<{
    kind: BuyerFieldKind;
    title: string;
    instructions?: string | null;
    required: boolean;
    maxCharacters?: number | null;
    maxFiles?: number | null;
    labelEachFile?: boolean;
    etsyQuestionId?: string | null;
    options?: Array<{ label: string; required?: boolean; etsyOptionId?: string | null }>;
  }> | null | undefined
): BuyerFieldDraft[] {
  return (rows ?? []).map((row) => ({
    kind: row.kind,
    title: row.title ?? "",
    instructions: row.instructions ?? "",
    required: row.required !== false,
    maxCharacters: row.maxCharacters != null ? String(row.maxCharacters) : "256",
    maxFiles: row.maxFiles != null ? String(row.maxFiles) : "1",
    labelEachFile: row.labelEachFile === true,
    options: (row.options ?? []).map((option) => option.label).filter(Boolean),
    optionRequired: (row.options ?? [])
      .filter((option) => option.label)
      .map((option) => option.required !== false),
    optionMeta: (row.options ?? []).map((option) => ({
      label: option.label,
      etsyOptionId: option.etsyOptionId ?? null,
    })),
    etsyQuestionId: row.etsyQuestionId ?? null,
  }));
}

function optionsWithIds(field: BuyerFieldDraft) {
  const meta = field.optionMeta ?? [];
  const used = new Set<number>();
  return field.options
    .map((label, index) => ({ label: label.trim(), required: field.optionRequired?.[index] !== false }))
    .filter((option) => option.label)
    .map((option) => {
      const index = meta.findIndex((row, i) => !used.has(i) && row.label === option.label);
      if (index >= 0) used.add(index);
      return {
        label: option.label,
        required: option.required,
        etsyOptionId: index >= 0 ? meta[index]?.etsyOptionId ?? null : null,
      };
    });
}

export function buyerFieldsToPayload(fields: BuyerFieldDraft[]) {
  return fields.map((field) => ({
    kind: field.kind,
    title: field.title.trim(),
    instructions: field.kind === "DROPDOWN" ? null : field.instructions.trim() || null,
    required: field.required,
    maxCharacters: field.kind === "TEXT" ? Number(field.maxCharacters) : null,
    maxFiles:
      field.kind === "FILE"
        ? Math.min(10, Math.max(1, Number(field.maxFiles) || 1))
        : null,
    labelEachFile: field.kind === "FILE" && field.labelEachFile,
    etsyQuestionId: field.etsyQuestionId ?? null,
    options: field.kind === "TEXT" ? [] : optionsWithIds(field),
  }));
}

export type BuyerResponseView = {
  title: string;
  kind: "TEXT" | "DROPDOWN" | "FILE";
  text: string | null;
  optionLabel: string | null;
  files: Array<{ url: string; label: string | null }>;
};

export function parseBuyerResponseViews(raw: unknown): BuyerResponseView[] {
  if (!Array.isArray(raw)) return [];
  const views: BuyerResponseView[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as {
      title?: string;
      kind?: string;
      text?: string | null;
      optionLabel?: string | null;
      files?: Array<{ url?: string; label?: string | null }>;
    };
    if (row.kind !== "TEXT" && row.kind !== "DROPDOWN" && row.kind !== "FILE") continue;
    views.push({
      title: row.title?.trim() || "Custom option",
      kind: row.kind,
      text: typeof row.text === "string" ? row.text : null,
      optionLabel: typeof row.optionLabel === "string" ? row.optionLabel : null,
      files: (row.files ?? [])
        .filter((file) => typeof file?.url === "string" && file.url.trim())
        .map((file) => ({
          url: file.url!.trim(),
          label: file.label?.trim() || null,
        })),
    });
  }
  return views;
}

export function formatBuyerResponseLines(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      if (!entry || typeof entry !== "object") return "";
      const rec = entry as {
        title?: string;
        kind?: string;
        text?: string;
        optionLabel?: string;
        files?: Array<{ url?: string; label?: string | null }>;
      };
      const title = rec.title || "Custom option";
      if (rec.kind === "TEXT") return `${title}: ${rec.text ?? ""}`;
      if (rec.kind === "DROPDOWN") return `${title}: ${rec.optionLabel ?? ""}`;
      const files = (rec.files ?? [])
        .map((file) => (file.label ? `${file.label}: ${file.url ?? ""}` : file.url ?? ""))
        .filter(Boolean);
      return files.length ? `${title}: ${files.join(", ")}` : "";
    })
    .filter(Boolean);
}
