export type BuyerFieldKind = "TEXT" | "DROPDOWN" | "FILE";

export type BuyerFieldDraft = {
  kind: BuyerFieldKind;
  title: string;
  instructions: string;
  required: boolean;
  maxCharacters: string;
  maxFiles: string;
  labelEachFile: boolean;
  optionsText: string;
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
  options: Array<{ id: string; label: string }>;
};

export function emptyBuyerField(kind: BuyerFieldKind): BuyerFieldDraft {
  return {
    kind,
    title: "",
    instructions: "",
    required: true,
    maxCharacters: "256",
    maxFiles: "1",
    labelEachFile: false,
    optionsText: "",
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
    options?: Array<{ label: string; etsyOptionId?: string | null }>;
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
    optionsText: (row.options ?? []).map((option) => option.label).join("\n"),
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
  return field.optionsText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((label) => {
      const index = meta.findIndex((option, i) => !used.has(i) && option.label === label);
      if (index >= 0) used.add(index);
      return {
        label,
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
    maxFiles: field.kind === "FILE" ? Number(field.maxFiles) : null,
    labelEachFile: field.kind === "FILE" && field.labelEachFile,
    etsyQuestionId: field.etsyQuestionId ?? null,
    options: field.kind === "TEXT" ? [] : optionsWithIds(field),
  }));
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
