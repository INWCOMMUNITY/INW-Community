"use client";

import { useState } from "react";
import {
  listingHintClass,
  listingInputClass,
  listingLabelClass,
  listingSelectClass,
} from "@/components/store-item/listing-form-styles";
import { ebayAspectUsesDropdown, isOftenRequiredEbayAspectName } from "@/lib/channels/ebay/aspect-prep";
import { EBAY_ASPECT_VALUE_MAX, type ListingAspect } from "@/lib/listing-limits";

export type EbayCategoryAspectField = {
  name: string;
  required: boolean;
  mode: "FREE_TEXT" | "SELECTION_ONLY";
  cardinality: "SINGLE" | "MULTI";
  suggestedValues: string[];
};

const OTHER_VALUE = "__ebay_other__";

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
  const [otherOpen, setOtherOpen] = useState<Record<number, boolean>>({});

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
          Pick the value eBay lists for this category. Required fields are marked with *.
        </p>
      </div>
      {aspects.map((row, index) => {
        const schema = categoryAspects.find(
          (aspect) => aspect.name.trim().toLowerCase() === row.name.trim().toLowerCase()
        );
        const required = Boolean(schema?.required) || isOftenRequiredEbayAspectName(row.name);
        const suggestions = schema?.suggestedValues ?? [];
        const useDropdown = ebayAspectUsesDropdown(schema);
        const isSelectionOnly = schema?.mode === "SELECTION_ONLY" && suggestions.length > 0;
        const isMulti = schema?.cardinality === "MULTI";
        const valueInList = suggestions.some((option) => option === row.value);
        const showOther =
          useDropdown &&
          !isSelectionOnly &&
          (otherOpen[index] || (Boolean(row.value.trim()) && !valueInList));
        const selectValue = valueInList ? row.value : showOther ? OTHER_VALUE : "";
        const listId = `list-on-ebay-aspect-${index}`;
        return (
          <div key={`${row.name}-${index}`}>
            <label className={listingLabelClass} htmlFor={`list-on-ebay-aspect-value-${index}`}>
              {row.name}
              {required ? " *" : ""}
            </label>
            {useDropdown ? (
              <>
                <select
                  id={`list-on-ebay-aspect-value-${index}`}
                  value={selectValue}
                  onChange={(e) => {
                    const next = e.target.value;
                    if (next === OTHER_VALUE) {
                      setOtherOpen((prev) => ({ ...prev, [index]: true }));
                      if (valueInList) onAspectValueChange(index, "");
                      return;
                    }
                    setOtherOpen((prev) => ({ ...prev, [index]: false }));
                    onAspectValueChange(index, next);
                  }}
                  className={`${listingSelectClass} ${required && !row.value.trim() ? "border-red-400" : ""}`}
                  disabled={disabled}
                >
                  <option value="">{required ? "Select value (required)" : "Select value"}</option>
                  {suggestions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                  {!isSelectionOnly ? <option value={OTHER_VALUE}>Other…</option> : null}
                </select>
                {showOther ? (
                  <input
                    type="text"
                    value={valueInList ? "" : row.value}
                    maxLength={EBAY_ASPECT_VALUE_MAX}
                    onChange={(e) => onAspectValueChange(index, e.target.value)}
                    placeholder={required ? "Enter a value (required)" : "Enter a value"}
                    className={`${listingInputClass} mt-2 ${required && !row.value.trim() ? "border-red-400" : ""}`}
                    disabled={disabled}
                  />
                ) : null}
              </>
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
