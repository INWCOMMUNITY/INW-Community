"use client";

import type { ListingBuyerFieldPublic } from "database";

export type BuyerAnswerDraft = {
  fieldId: string;
  text?: string;
  optionLabel?: string;
  files?: Array<{ url: string; label?: string | null }>;
};

export function answersPayload(
  fields: ListingBuyerFieldPublic[],
  drafts: Record<string, BuyerAnswerDraft>
) {
  return fields.map((field) => {
    const draft = drafts[field.id];
    return {
      fieldId: field.id,
      text: draft?.text ?? "",
      optionLabel: draft?.optionLabel ?? "",
      files: draft?.files ?? [],
    };
  });
}

export function ListingBuyerAnswers({
  fields,
  drafts,
  onChange,
  onUpload,
}: {
  fields: ListingBuyerFieldPublic[];
  drafts: Record<string, BuyerAnswerDraft>;
  onChange: (next: Record<string, BuyerAnswerDraft>) => void;
  onUpload: (file: File) => Promise<string>;
}) {
  if (fields.length === 0) return null;
  return (
    <div className="space-y-4" data-testid="listing-buyer-answers">
      <h3 className="text-sm font-semibold text-gray-900">Custom options</h3>
      {fields.map((field) => {
        const draft = drafts[field.id] ?? { fieldId: field.id };
        return (
          <div key={field.id} className="space-y-1">
            <p className="text-sm font-medium text-gray-900">
              {field.title}
              {field.required ? <span className="text-red-600"> *</span> : null}
            </p>
            {field.instructions ? <p className="text-xs text-gray-600">{field.instructions}</p> : null}
            {field.kind === "TEXT" ? (
              <div>
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
              <div className="space-y-2">
                {(draft.files ?? []).map((file) => (
                  <p key={file.url} className="text-xs break-all text-gray-700">
                    {file.label ? `${file.label}: ` : ""}
                    {file.url}
                  </p>
                ))}
                {(draft.files ?? []).length < (field.maxFiles ?? 1) ? (
                  <input
                    type="file"
                    accept=".jpg,.jpeg,.png,.svg,.pdf,.heic,.webp,image/*,application/pdf"
                    onChange={async (e) => {
                      const picked = e.target.files?.[0];
                      e.target.value = "";
                      if (!picked) return;
                      let url = "";
                      try {
                        url = await onUpload(picked);
                      } catch (error) {
                        window.alert(error instanceof Error ? error.message : "Upload failed");
                        return;
                      }
                      const nextFiles = [...(draft.files ?? []), { url }];
                      onChange({ ...drafts, [field.id]: { ...draft, fieldId: field.id, files: nextFiles } });
                    }}
                  />
                ) : null}
                <p className="text-xs text-gray-500">
                  Up to {field.maxFiles ?? 1} file{(field.maxFiles ?? 1) === 1 ? "" : "s"}. jpg, png, svg, pdf, or heic.
                </p>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
