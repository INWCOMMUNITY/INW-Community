"use client";

import { useEffect, useState } from "react";
import type { ListingBuyerFieldPublic } from "database/src/public-buyer-fields";

export type BuyerAnswerDraft = {
  fieldId: string;
  text?: string;
  optionLabel?: string;
  files?: Array<{ url: string; label?: string | null; name?: string | null }>;
};

export function answersPayload(
  fields: ListingBuyerFieldPublic[],
  drafts: Record<string, BuyerAnswerDraft>
) {
  return fields.map((field) => {
    const draft = drafts[field.id];
    const files =
      field.kind === "FILE" && field.labelEachFile && field.options.length > 0
        ? field.options.flatMap((option, index) => {
            const file = draft?.files?.[index];
            return file?.url ? [{ url: file.url, label: option.label }] : [];
          })
        : (draft?.files ?? []).filter((file) => file.url);
    const labeledComplete =
      field.kind !== "FILE" ||
      !field.labelEachFile ||
      field.options.length === 0 ||
      files.length === field.options.length;
    return {
      fieldId: field.id,
      text: draft?.text ?? "",
      optionLabel: draft?.optionLabel ?? "",
      files: labeledComplete ? files : [],
    };
  });
}

function fileSlots(field: ListingBuyerFieldPublic): Array<{ key: string; label: string }> {
  if (field.labelEachFile && field.options.length > 0) {
    return field.options.map((option) => ({ key: option.id, label: option.label }));
  }
  const count = Math.min(10, Math.max(1, field.maxFiles ?? 1));
  return Array.from({ length: count }, (_, index) => ({
    key: `${field.id}-file-${index}`,
    label: "Add a file",
  }));
}

function BuyerFileSlot({
  label,
  savedUrl,
  savedName,
  onUpload,
  onUploaded,
  onRemove,
}: {
  label: string;
  savedUrl?: string;
  savedName?: string | null;
  onUpload: (file: File, onProgress: (percent: number) => void) => Promise<string>;
  onUploaded: (url: string, fileName: string) => void;
  onRemove: () => void;
}) {
  const [progress, setProgress] = useState<number | null>(null);
  const [pickedName, setPickedName] = useState<string | null>(null);
  const uploading = progress != null;
  const fileName = savedName || pickedName;

  useEffect(() => {
    if (savedUrl && progress === 100) setProgress(null);
  }, [savedUrl, progress]);

  return (
    <div className="relative flex min-h-12 items-center gap-3 rounded-lg border border-dashed border-neutral-300 bg-neutral-100 px-3 py-2.5">
      <input
        type="file"
        aria-label={label}
        accept=".jpg,.jpeg,.png,.svg,.pdf,.heic,.webp,image/*,application/pdf"
        disabled={uploading}
        className="absolute inset-0 cursor-pointer opacity-0 disabled:cursor-default"
        onChange={async (e) => {
          const picked = e.target.files?.[0];
          e.target.value = "";
          if (!picked) return;
          setPickedName(picked.name);
          setProgress(4);
          try {
            const url = await onUpload(picked, (percent) => {
              setProgress(Math.max(4, Math.min(99, percent)));
            });
            setProgress(100);
            onUploaded(url, picked.name);
          } catch (error) {
            setProgress(null);
            setPickedName(savedName ?? null);
            window.alert(error instanceof Error ? error.message : "Upload failed");
          }
        }}
      />
      <span className="w-4 text-center text-lg leading-none text-neutral-700" aria-hidden>
        +
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center text-sm text-neutral-800">
          {label}
          {savedUrl && !uploading ? (
            <span
              className="ml-2 text-2xl font-semibold leading-none"
              style={{ color: "var(--color-earth)" }}
              aria-label="Uploaded"
            >
              ✓
            </span>
          ) : null}
        </span>
        {fileName ? (
          <span className="mt-0.5 block truncate text-xs text-neutral-600">{fileName}</span>
        ) : null}
      </span>
      {savedUrl && !uploading ? (
        <button
          type="button"
          className="relative z-10 text-xs text-neutral-600 underline"
          onClick={() => {
            setPickedName(null);
            onRemove();
          }}
        >
          Remove
        </button>
      ) : null}
      {uploading ? (
        <div
          className="absolute inset-x-3 bottom-1.5 h-1 overflow-hidden rounded-full bg-neutral-200"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress ?? 0}
          aria-label={`Uploading ${label}`}
        >
          <div
            className="h-full transition-[width] duration-150"
            style={{ width: `${progress ?? 0}%`, backgroundColor: "var(--color-earth)" }}
          />
        </div>
      ) : null}
    </div>
  );
}

export function ListingBuyerAnswers({
  fields,
  drafts,
  onChange,
  onUpload,
}: {
  fields: ListingBuyerFieldPublic[];
  drafts: Record<string, BuyerAnswerDraft>;
  onChange: (
    next:
      | Record<string, BuyerAnswerDraft>
      | ((prev: Record<string, BuyerAnswerDraft>) => Record<string, BuyerAnswerDraft>)
  ) => void;
  onUpload: (file: File, onProgress: (percent: number) => void) => Promise<string>;
}) {
  if (fields.length === 0) return null;
  return (
    <div className="flex flex-col gap-5" data-testid="listing-buyer-answers">
      <p className="text-sm font-medium text-gray-900">Custom Options</p>
      {fields.map((field) => {
        const draft = drafts[field.id] ?? { fieldId: field.id };
        return (
          <div key={field.id} className="flex flex-col gap-1">
            <p className="text-sm font-medium text-gray-900">
              {field.title}
              {field.required ? <span className="text-red-600"> *</span> : null}
            </p>
            {field.instructions ? <p className="text-xs text-gray-600">{field.instructions}</p> : null}
            {field.kind === "TEXT" ? (
              <div className="flex flex-col gap-0.5">
                <textarea
                  className="w-full border rounded px-2 py-1.5 text-sm"
                  maxLength={field.maxCharacters ?? 1024}
                  value={draft.text ?? ""}
                  onChange={(e) =>
                    onChange({ ...drafts, [field.id]: { ...draft, fieldId: field.id, text: e.target.value } })
                  }
                />
                <p className="text-xs text-gray-500 text-right">
                  {(draft.text ?? "").length}/{field.maxCharacters ?? 1024}
                </p>
              </div>
            ) : null}
            {field.kind === "DROPDOWN" ? (
              <select
                className="w-full border rounded px-2 py-1.5 text-sm"
                value={draft.optionLabel ?? ""}
                onChange={(e) =>
                  onChange({
                    ...drafts,
                    [field.id]: { ...draft, fieldId: field.id, optionLabel: e.target.value },
                  })
                }
              >
                <option value="">Select an option</option>
                {field.options.map((option) => (
                  <option key={option.id} value={option.label}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : null}
            {field.kind === "FILE" ? (
              <div className="flex flex-col gap-2">
                {fileSlots(field).map((slot, index) => (
                  <BuyerFileSlot
                    key={slot.key}
                    label={slot.label}
                    savedUrl={draft.files?.[index]?.url}
                    savedName={draft.files?.[index]?.name}
                    onUpload={onUpload}
                    onUploaded={(url, fileName) => {
                      onChange((prev) => {
                        const current = prev[field.id] ?? { fieldId: field.id };
                        const nextFiles = [...(current.files ?? [])];
                        nextFiles[index] = {
                          url,
                          label: field.labelEachFile ? slot.label : null,
                          name: fileName,
                        };
                        return {
                          ...prev,
                          [field.id]: { ...current, fieldId: field.id, files: nextFiles },
                        };
                      });
                    }}
                    onRemove={() => {
                      onChange((prev) => {
                        const current = prev[field.id] ?? { fieldId: field.id };
                        const nextFiles = [...(current.files ?? [])];
                        delete nextFiles[index];
                        return {
                          ...prev,
                          [field.id]: { ...current, fieldId: field.id, files: nextFiles },
                        };
                      });
                    }}
                  />
                ))}
                <p className="text-xs text-gray-500">jpg, png, svg, pdf, or heic.</p>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
