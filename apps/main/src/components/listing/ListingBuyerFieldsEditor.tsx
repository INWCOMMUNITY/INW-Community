"use client";

import { useState } from "react";

const LISTING_BUYER_FIELD_MAX = 5;
const OPTION_LABEL_MAX = 20;
const FILE_LABEL_MAX = 45;
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
  /** Aligned with `options`. Missing entries are required. Used for labeled file uploads. */
  optionRequired?: boolean[];
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
    .map((label, index) => ({
      label: label.trim(),
      required: field.optionRequired?.[index] !== false,
      index,
    }))
    .filter((option) => option.label)
    .map((option) => {
      const metaIndex = meta.findIndex((row, i) => !used.has(i) && row.label === option.label);
      if (metaIndex >= 0) used.add(metaIndex);
      return {
        label: option.label,
        required: option.required,
        etsyOptionId: metaIndex >= 0 ? meta[metaIndex]?.etsyOptionId ?? null : null,
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

function FileLabelEditor({
  labels,
  requiredFlags,
  onChange,
}: {
  labels: string[];
  requiredFlags: boolean[];
  onChange: (labels: string[], requiredFlags: boolean[]) => void;
}) {
  const [draft, setDraft] = useState("");

  function addValue() {
    const val = draft.trim().slice(0, FILE_LABEL_MAX);
    if (!val || labels.length >= 10) return;
    onChange([...labels, val], [...requiredFlags, true]);
    setDraft("");
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-gray-600">
        Name each file. Uncheck Required when that photo is optional, such as a second or third dog.
      </p>
      {labels.map((value, index) => (
        <div key={`${value}-${index}`} className="flex flex-wrap items-center gap-2">
          <input
            className="min-w-[8rem] flex-1 border rounded px-2 py-1.5 text-sm"
            maxLength={FILE_LABEL_MAX}
            value={value}
            aria-label={`File ${index + 1} name`}
            onChange={(e) => {
              const next = [...labels];
              next[index] = e.target.value.slice(0, FILE_LABEL_MAX);
              onChange(next, requiredFlags);
            }}
          />
          <label className="flex items-center gap-1.5 text-sm text-gray-800">
            <input
              type="checkbox"
              checked={requiredFlags[index] !== false}
              onChange={(e) => {
                const next = labels.map((_, i) => requiredFlags[i] !== false);
                next[index] = e.target.checked;
                onChange(labels, next);
              }}
            />
            Required
          </label>
          <button
            type="button"
            className="text-sm text-red-600"
            onClick={() =>
              onChange(
                labels.filter((_, i) => i !== index),
                requiredFlags.filter((_, i) => i !== index)
              )
            }
          >
            Remove
          </button>
        </div>
      ))}
      {labels.length < 10 ? (
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={draft}
            maxLength={FILE_LABEL_MAX}
            onChange={(e) => setDraft(e.target.value.slice(0, FILE_LABEL_MAX))}
            placeholder="Dog #1"
            className="w-40 border rounded px-2 py-1 text-sm"
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              addValue();
            }}
          />
          <button type="button" className="text-sm font-semibold text-[var(--color-primary)]" onClick={addValue}>
            Add file name
          </button>
        </div>
      ) : null}
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
          {field.kind === "DROPDOWN" ? (
            <OptionChipsEditor
              labels={field.options}
              maxCount={DROPDOWN_OPTIONS_MAX}
              onChange={(options) => {
                const next = [...fields];
                next[index] = { ...field, options };
                onChange(next);
              }}
            />
          ) : null}
          {field.kind === "FILE" && field.labelEachFile ? (
            <FileLabelEditor
              labels={field.options}
              requiredFlags={field.optionRequired ?? []}
              onChange={(options, optionRequired) => {
                const next = [...fields];
                next[index] = {
                  ...field,
                  options,
                  optionRequired,
                  maxFiles: String(Math.min(10, Math.max(1, options.length || 1))),
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
                    const count = Math.min(10, Math.max(1, field.options.length || Number(field.maxFiles) || 1));
                    next[index] = {
                      ...field,
                      labelEachFile,
                      maxFiles: labelEachFile ? String(count) : field.maxFiles,
                      optionRequired: labelEachFile
                        ? field.options.map((_, i) => field.optionRequired?.[i] !== false)
                        : field.optionRequired,
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
