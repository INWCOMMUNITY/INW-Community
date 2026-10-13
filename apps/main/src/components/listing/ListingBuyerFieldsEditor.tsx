"use client";

const LISTING_BUYER_FIELD_MAX = 5;

export type BuyerFieldDraft = {
  kind: "TEXT" | "DROPDOWN" | "FILE";
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

export function emptyBuyerField(kind: BuyerFieldDraft["kind"]): BuyerFieldDraft {
  return {
    kind,
    title: "",
    instructions: "",
    required: true,
    maxCharacters: "256",
    maxFiles: kind === "FILE" ? "1" : "",
    labelEachFile: false,
    optionsText: kind === "DROPDOWN" ? "" : "",
  };
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
  return fields.map((field) => {
    const options = optionsWithIds(field);
    return {
      kind: field.kind,
      title: field.title.trim(),
      instructions: field.kind === "DROPDOWN" ? null : field.instructions.trim() || null,
      required: field.required,
      maxCharacters: field.kind === "TEXT" ? Number(field.maxCharacters) : null,
      maxFiles: field.kind === "FILE" ? Number(field.maxFiles) : null,
      labelEachFile: field.kind === "FILE" && field.labelEachFile,
      etsyQuestionId: field.etsyQuestionId ?? null,
      options: field.kind === "TEXT" ? [] : options,
    };
  });
}

export function buyerFieldsFromExisting(
  rows: Array<{
    kind: "TEXT" | "DROPDOWN" | "FILE";
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

export function ListingBuyerFieldsEditor({
  fields,
  onChange,
}: {
  fields: BuyerFieldDraft[];
  onChange: (next: BuyerFieldDraft[]) => void;
}) {
  const fileTaken = fields.some((field) => field.kind === "FILE");
  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600">
        Collect details from buyers — text, a choice, or files. These do not change your inventory.
        Up to {LISTING_BUYER_FIELD_MAX}. One file upload per listing. Synced to Etsy custom options.
      </p>
      {fields.map((field, index) => (
        <div key={index} className="rounded-lg border border-gray-200 p-3 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-semibold text-gray-900">
              {field.kind === "TEXT" ? "Text box" : field.kind === "DROPDOWN" ? "List of options" : "File upload"}
            </span>
            <button
              type="button"
              className="text-sm text-red-600"
              onClick={() => onChange(fields.filter((_, i) => i !== index))}
            >
              Remove
            </button>
          </div>
          <label className="block text-xs text-gray-600">
            Field title
            <input
              className="mt-1 w-full border rounded px-2 py-1.5 text-sm"
              maxLength={45}
              value={field.title}
              onChange={(e) => {
                const next = [...fields];
                next[index] = { ...field, title: e.target.value };
                onChange(next);
              }}
            />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={field.required}
              onChange={(e) => {
                const next = [...fields];
                next[index] = { ...field, required: e.target.checked };
                onChange(next);
              }}
            />
            Required
          </label>
          {field.kind !== "DROPDOWN" ? (
            <label className="block text-xs text-gray-600">
              Instructions (optional)
              <textarea
                className="mt-1 w-full border rounded px-2 py-1.5 text-sm"
                maxLength={120}
                rows={2}
                value={field.instructions}
                onChange={(e) => {
                  const next = [...fields];
                  next[index] = { ...field, instructions: e.target.value };
                  onChange(next);
                }}
              />
            </label>
          ) : null}
          {field.kind === "TEXT" ? (
            <label className="block text-xs text-gray-600">
              Character limit (1–1024)
              <input
                className="mt-1 w-32 border rounded px-2 py-1.5 text-sm"
                inputMode="numeric"
                value={field.maxCharacters}
                onChange={(e) => {
                  const next = [...fields];
                  next[index] = { ...field, maxCharacters: e.target.value.replace(/[^\d]/g, "") };
                  onChange(next);
                }}
              />
            </label>
          ) : null}
          {field.kind === "DROPDOWN" || (field.kind === "FILE" && field.labelEachFile) ? (
            <label className="block text-xs text-gray-600">
              {field.kind === "DROPDOWN" ? "Options, one per line (max 20 characters)" : "File labels, one per line"}
              <textarea
                className="mt-1 w-full border rounded px-2 py-1.5 text-sm"
                rows={3}
                value={field.optionsText}
                onChange={(e) => {
                  const next = [...fields];
                  next[index] = { ...field, optionsText: e.target.value };
                  onChange(next);
                }}
              />
            </label>
          ) : null}
          {field.kind === "FILE" ? (
            <div className="flex flex-wrap gap-4 items-end">
              <label className="block text-xs text-gray-600">
                Number of files (1–10)
                <input
                  className="mt-1 w-24 border rounded px-2 py-1.5 text-sm"
                  inputMode="numeric"
                  value={field.maxFiles}
                  onChange={(e) => {
                    const next = [...fields];
                    next[index] = { ...field, maxFiles: e.target.value.replace(/[^\d]/g, "") };
                    onChange(next);
                  }}
                />
              </label>
              <label className="flex items-center gap-2 text-sm pb-1">
                <input
                  type="checkbox"
                  checked={field.labelEachFile}
                  onChange={(e) => {
                    const next = [...fields];
                    next[index] = { ...field, labelEachFile: e.target.checked };
                    onChange(next);
                  }}
                />
                Label each file
              </label>
            </div>
          ) : null}
        </div>
      ))}
      {fields.length < LISTING_BUYER_FIELD_MAX ? (
        <div className="flex flex-wrap gap-2">
          <button type="button" className="action-pill action-pill-sm btn-pill-outline" onClick={() => onChange([...fields, emptyBuyerField("TEXT")])}>
            + Text box
          </button>
          <button type="button" className="action-pill action-pill-sm btn-pill-outline" onClick={() => onChange([...fields, emptyBuyerField("DROPDOWN")])}>
            + List of options
          </button>
          <button
            type="button"
            className="action-pill action-pill-sm btn-pill-outline"
            disabled={fileTaken}
            onClick={() => onChange([...fields, emptyBuyerField("FILE")])}
          >
            + File upload
          </button>
        </div>
      ) : null}
    </div>
  );
}
