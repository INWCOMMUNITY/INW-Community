"use client";

import { useState } from "react";

const LISTING_BUYER_FIELD_MAX = 5;
const OPTION_LABEL_MAX = 20;
const DROPDOWN_OPTIONS_MAX = 30;

export type BuyerFieldDraft = {
  kind: "TEXT" | "DROPDOWN" | "FILE";
  title: string;
  instructions: string;
  required: boolean;
  maxCharacters: string;
  maxFiles: string;
  labelEachFile: boolean;
  options: string[];
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
    options: [],
  };
}

function optionsWithIds(field: BuyerFieldDraft) {
  const meta = field.optionMeta ?? [];
  const used = new Set<number>();
  return field.options
    .map((label) => label.trim())
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
    options: (row.options ?? []).map((option) => option.label).filter(Boolean),
    optionMeta: (row.options ?? []).map((option) => ({
      label: option.label,
      etsyOptionId: option.etsyOptionId ?? null,
    })),
    etsyQuestionId: row.etsyQuestionId ?? null,
  }));
}

function kindLabel(kind: BuyerFieldDraft["kind"]) {
  if (kind === "TEXT") return "Text Box";
  if (kind === "DROPDOWN") return "List of Options";
  return "File Upload";
}

function OptionChipsEditor({
  labels,
  onChange,
  maxCount,
}: {
  labels: string[];
  onChange: (next: string[]) => void;
  maxCount: number;
}) {
  const [draft, setDraft] = useState("");

  function addValue() {
    const val = draft.trim().slice(0, OPTION_LABEL_MAX);
    if (!val) return;
    if (labels.length >= maxCount) return;
    if (labels.some((label) => label.toLowerCase() === val.toLowerCase())) {
      setDraft("");
      return;
    }
    onChange([...labels, val]);
    setDraft("");
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-gray-600">Options (max {OPTION_LABEL_MAX} characters each)</p>
      <div className="flex flex-wrap gap-2 items-center">
        {labels.map((value, vi) => (
          <span
            key={`${value}-${vi}`}
            className="inline-flex items-center gap-1 bg-white border border-gray-300 rounded px-2 py-1 text-sm"
          >
            {value}
            <button
              type="button"
              onClick={() => onChange(labels.filter((_, j) => j !== vi))}
              className="text-red-500 hover:text-red-700 font-bold leading-none"
              aria-label={`Remove ${value}`}
            >
              ×
            </button>
          </span>
        ))}
        {labels.length < maxCount ? (
          <>
            <input
              type="text"
              value={draft}
              maxLength={OPTION_LABEL_MAX}
              onChange={(e) => setDraft(e.target.value.slice(0, OPTION_LABEL_MAX))}
              placeholder="+ Add option"
              className="w-32 border rounded px-2 py-1 text-sm"
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                addValue();
              }}
            />
            <button
              type="button"
              className="text-sm font-semibold text-[var(--color-primary)]"
              onClick={addValue}
            >
              Add
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
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
            <span className="text-sm font-medium text-gray-900">{kindLabel(field.kind)}</span>
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
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-xs text-gray-600">Character limit (1–1024)</span>
              <input
                className="w-32 border rounded px-2 py-1.5 text-sm"
                inputMode="numeric"
                value={field.maxCharacters}
                onChange={(e) => {
                  const next = [...fields];
                  next[index] = { ...field, maxCharacters: e.target.value.replace(/[^\d]/g, "") };
                  onChange(next);
                }}
              />
            </div>
          ) : null}
          {field.kind === "DROPDOWN" || (field.kind === "FILE" && field.labelEachFile) ? (
            <OptionChipsEditor
              labels={field.options}
              maxCount={field.kind === "DROPDOWN" ? DROPDOWN_OPTIONS_MAX : 10}
              onChange={(options) => {
                const next = [...fields];
                const maxFiles =
                  field.kind === "FILE" && field.labelEachFile
                    ? String(Math.min(10, Math.max(1, options.length || Number(field.maxFiles) || 1)))
                    : field.maxFiles;
                next[index] = {
                  ...field,
                  options,
                  ...(field.kind === "FILE" ? { maxFiles } : {}),
                };
                onChange(next);
              }}
            />
          ) : null}
          {field.kind === "FILE" ? (
            <div className="flex flex-wrap gap-4 items-center">
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-xs text-gray-600">Number of files (1–10)</span>
                <input
                  className="w-24 border rounded px-2 py-1.5 text-sm"
                  inputMode="numeric"
                  value={field.maxFiles}
                  disabled={field.labelEachFile}
                  title={
                    field.labelEachFile
                      ? "Matches the number of file labels"
                      : undefined
                  }
                  onChange={(e) => {
                    const next = [...fields];
                    next[index] = { ...field, maxFiles: e.target.value.replace(/[^\d]/g, "") };
                    onChange(next);
                  }}
                />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={field.labelEachFile}
                  onChange={(e) => {
                    const labelEachFile = e.target.checked;
                    const next = [...fields];
                    next[index] = {
                      ...field,
                      labelEachFile,
                      maxFiles: labelEachFile
                        ? String(Math.min(10, Math.max(1, field.options.length || Number(field.maxFiles) || 1)))
                        : field.maxFiles,
                    };
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
          <button
            type="button"
            className="action-pill action-pill-sm btn-pill-outline"
            onClick={() => onChange([...fields, emptyBuyerField("TEXT")])}
          >
            + Text Box
          </button>
          <button
            type="button"
            className="action-pill action-pill-sm btn-pill-outline"
            onClick={() => onChange([...fields, emptyBuyerField("DROPDOWN")])}
          >
            + List of Options
          </button>
          <button
            type="button"
            className="action-pill action-pill-sm btn-pill-outline"
            disabled={fileTaken}
            onClick={() => onChange([...fields, emptyBuyerField("FILE")])}
          >
            + File Upload
          </button>
        </div>
      ) : null}
    </div>
  );
}
