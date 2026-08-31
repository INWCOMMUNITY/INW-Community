"use client";

import {
  listingHintClass,
  listingInputClass,
  listingLabelClass,
  listingSelectClass,
} from "@/components/store-item/listing-form-styles";
import { EBAY_ASPECT_VALUE_MAX, type ListingAspect } from "@/lib/listing-limits";

export type EbayCategoryAspectField = {
  name: string;
  required: boolean;
  mode: "FREE_TEXT" | "SELECTION_ONLY";
  cardinality: "SINGLE" | "MULTI";
  suggestedValues: string[];
};

export function EbayAspectFields({
  aspects,
  categoryAspects,
  loading,
  error,
  disabled,
  onAspectValueChange,
}: {
  aspects: ListingAspect[];
  categoryAspects: EbayCategoryAspectField[];
  loading?: boolean;
  error?: string | null;
  disabled?: boolean;
  onAspectValueChange: (index: number, value: string) => void;
}) {
  if (loading) {
    return <p className={`${listingHintClass} mt-3`}>Loading required item specifics…</p>;
  }
  if (error) {
    return (
      <p className="text-sm text-red-600 mt-3" role="alert">
        {error}
      </p>
    );
  }
  if (aspects.length === 0) {
    return (
      <p className={`${listingHintClass} mt-3`}>This category has no required item specifics.</p>
    );
  }

  return (
    <div className="mt-4 space-y-3">
      <div>
        <p className={listingLabelClass}>Item specifics</p>
        <p className={listingHintClass}>
          Fill in the details eBay requires for this category. Required fields are marked with *.
        </p>
      </div>
      {aspects.map((row, index) => {
        const schema = categoryAspects.find(
          (aspect) => aspect.name.trim().toLowerCase() === row.name.trim().toLowerCase()
        );
        const required = Boolean(schema?.required);
        const suggestions = schema?.suggestedValues ?? [];
        const isSelectionOnly = schema?.mode === "SELECTION_ONLY" && suggestions.length > 0;
        const isMulti = schema?.cardinality === "MULTI";
        const listId = `list-on-ebay-aspect-${index}`;
        return (
          <div key={`${row.name}-${index}`}>
            <label className={listingLabelClass} htmlFor={`list-on-ebay-aspect-value-${index}`}>
              {row.name}
              {required ? " *" : ""}
            </label>
            {isSelectionOnly ? (
              <select
                id={`list-on-ebay-aspect-value-${index}`}
                value={row.value}
                onChange={(e) => onAspectValueChange(index, e.target.value)}
                className={`${listingSelectClass} ${required && !row.value.trim() ? "border-red-400" : ""}`}
                disabled={disabled}
              >
                <option value="">{required ? "Select value (required)" : "Select value"}</option>
                {suggestions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            ) : (
              <>
                <input
                  id={`list-on-ebay-aspect-value-${index}`}
                  type="text"
                  value={row.value}
                  maxLength={EBAY_ASPECT_VALUE_MAX}
                  list={suggestions.length > 0 ? listId : undefined}
                  onChange={(e) => onAspectValueChange(index, e.target.value)}
                  placeholder={
                    isMulti
                      ? required
                        ? "Values (comma-separated, required)"
                        : "Values (comma-separated)"
                      : required
                        ? "Value (required)"
                        : "Value"
                  }
                  className={`${listingInputClass} ${required && !row.value.trim() ? "border-red-400" : ""}`}
                  disabled={disabled}
                />
                {suggestions.length > 0 ? (
                  <datalist id={listId}>
                    {suggestions.map((option) => (
                      <option key={option} value={option} />
                    ))}
                  </datalist>
                ) : null}
                {isMulti ? (
                  <p className={listingHintClass}>Separate multiple values with commas.</p>
                ) : null}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
