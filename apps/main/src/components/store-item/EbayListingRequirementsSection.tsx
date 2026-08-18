"use client";

import { useMemo } from "react";
import { CollapsibleListingSection } from "@/components/store-item/CollapsibleListingSection";
import {
  listingHintClass,
  listingInputClass,
} from "@/components/store-item/listing-form-styles";
import {
  EBAY_ASPECT_NAME_MAX,
  EBAY_ASPECT_VALUE_MAX,
  MAX_ASPECTS,
  type ListingAspect,
} from "@/lib/listing-limits";

type EbayCategorySuggestion = {
  categoryId: string;
  categoryName: string;
  categoryPath?: string;
};

type EbayCategoryAspect = {
  name: string;
  required: boolean;
  mode: "FREE_TEXT" | "SELECTION_ONLY";
  cardinality: "SINGLE" | "MULTI";
  suggestedValues: string[];
};

type EbayListingRequirementsSectionProps = {
  ebayCategoryId: string;
  ebayCategoryLabel: string;
  ebayCategorySearch: string;
  onEbayCategorySearchChange: (value: string) => void;
  ebayCategorySearchError: string | null;
  ebayCategoryResults: EbayCategorySuggestion[];
  ebaySearching: boolean;
  /** When set, tokens are unusable — show reconnect guidance instead of search. */
  connectionError?: string | null;
  categorySearchEnabled?: boolean;
  onSelectCategory: (categoryId: string, label: string) => void;
  onClearCategory: () => void;
  aspects: ListingAspect[];
  onAspectNameChange: (index: number, name: string) => void;
  onAspectValueChange: (index: number, value: string) => void;
  onRemoveAspect: (index: number) => void;
  onAddAspect: () => void;
  isRequiredAspect: (name: string) => boolean;
  suggestionsForAspect: (name: string) => string[];
  categoryAspects: EbayCategoryAspect[];
  /** Imported eBay listings — specifics are display-only (managed on eBay). */
  readOnlyAspects?: boolean;
};

export function EbayListingRequirementsSection({
  ebayCategoryId,
  ebayCategoryLabel,
  ebayCategorySearch,
  onEbayCategorySearchChange,
  ebayCategorySearchError,
  ebayCategoryResults,
  ebaySearching,
  connectionError,
  categorySearchEnabled = true,
  onSelectCategory,
  onClearCategory,
  aspects,
  onAspectNameChange,
  onAspectValueChange,
  onRemoveAspect,
  onAddAspect,
  isRequiredAspect,
  suggestionsForAspect,
  categoryAspects,
  readOnlyAspects = false,
}: EbayListingRequirementsSectionProps) {
  const missingRequiredCount = useMemo(() => {
    if (readOnlyAspects || !ebayCategoryId) return 0;
    const filled = aspects
      .map((a) => ({ name: a.name.trim().toLowerCase(), value: a.value.trim() }))
      .filter((a) => a.name && a.value);
    return categoryAspects
      .filter((a) => a.required)
      .filter((a) => !filled.some((f) => f.name === a.name.trim().toLowerCase())).length;
  }, [aspects, categoryAspects, ebayCategoryId]);

  const badge =
    readOnlyAspects && ebayCategoryId
      ? "From eBay"
      : !ebayCategoryId
        ? "Category required"
        : missingRequiredCount > 0
          ? `${missingRequiredCount} required`
          : "Ready";
  const badgeColor =
    readOnlyAspects && ebayCategoryId
      ? "#2563eb"
      : !ebayCategoryId || missingRequiredCount > 0
        ? "#dc2626"
        : "#16a34a";
  const defaultExpanded =
    readOnlyAspects ? false : !ebayCategoryId || missingRequiredCount > 0;

  return (
    <CollapsibleListingSection
      title="eBay Listing Requirements"
      subtitle="Category and item specifics required to publish on eBay"
      icon="pricetags-outline"
      defaultExpanded={defaultExpanded}
      badge={badge}
      badgeColor={badgeColor}
    >
      <p className={listingHintClass}>
        {readOnlyAspects
          ? "Item specifics are managed on eBay. Use Refresh from eBay to pull the latest values."
          : "Pick an eBay category, then fill in item specifics (Brand, Type, etc.). Required fields are marked with *."}
      </p>

      {connectionError ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
          <p className="font-medium">eBay connection needs attention</p>
          <p className="mt-1 text-xs">{connectionError}</p>
          <a href="/seller-hub/channels" className="mt-2 inline-block text-xs font-semibold underline">
            Open Sync Stores to reconnect eBay →
          </a>
        </div>
      ) : null}

      <div>
        <p className="text-sm font-semibold text-gray-900 mb-2">eBay category</p>
        {ebayCategoryId ? (
          <div className="flex items-center justify-between gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-900 truncate">
                {ebayCategoryLabel || `eBay category #${ebayCategoryId}`}
              </p>
              <p className="text-xs text-gray-500">eBay category #{ebayCategoryId}</p>
            </div>
            <button
              type="button"
              onClick={onClearCategory}
              className="text-sm text-red-600 hover:underline shrink-0"
              disabled={readOnlyAspects}
            >
              Change
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <input
              type="text"
              value={ebayCategorySearch}
              onChange={(e) => onEbayCategorySearchChange(e.target.value)}
              placeholder="Search eBay categories (e.g. US coins, sneakers)…"
              className={listingInputClass}
              disabled={!categorySearchEnabled}
            />
            {!categorySearchEnabled && !connectionError ? (
              <p className="text-xs text-gray-500">Category search is unavailable.</p>
            ) : null}
            {categorySearchEnabled ? (
              <p className={listingHintClass}>Type at least 2 characters to search.</p>
            ) : null}
            {ebaySearching && <p className="text-xs text-gray-500">Searching eBay…</p>}
            {ebayCategorySearchError ? (
              <p className="text-xs text-red-600" role="alert">
                {ebayCategorySearchError}
              </p>
            ) : null}
            {!ebaySearching &&
            !ebayCategorySearchError &&
            ebayCategorySearch.trim().length >= 2 &&
            ebayCategoryResults.length === 0 ? (
              <p className="text-xs text-gray-500">No categories found. Try different keywords.</p>
            ) : null}
            {ebayCategoryResults.length > 0 && (
              <ul className="max-h-56 overflow-y-auto rounded-lg border border-gray-200 divide-y divide-gray-100">
                {ebayCategoryResults.map((c) => (
                  <li key={c.categoryId}>
                    <button
                      type="button"
                      onClick={() => onSelectCategory(c.categoryId, c.categoryPath || c.categoryName)}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50"
                    >
                      <span className="font-medium text-gray-900">{c.categoryName}</span>
                      {c.categoryPath && c.categoryPath !== c.categoryName && (
                        <span className="block text-xs text-gray-500 truncate">{c.categoryPath}</span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {ebayCategoryId ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-gray-900">Item specifics</span>
            <span className="text-xs text-gray-500">
              {aspects.length}/{MAX_ASPECTS}
            </span>
          </div>
          {aspects
            .map((a, i) => ({ a, i }))
            .filter(({ a }) => !isRequiredAspect(a.name) || !!ebayCategoryId)
            .map(({ a, i }) => {
              const required = isRequiredAspect(a.name);
              const schema = categoryAspects.find(
                (ca) => ca.name.trim().toLowerCase() === a.name.trim().toLowerCase()
              );
              const suggestions = suggestionsForAspect(a.name);
              const isSelectionOnly = schema?.mode === "SELECTION_ONLY" && suggestions.length > 0;
              const isMulti = schema?.cardinality === "MULTI";
              const listId = `ebay-aspect-values-${i}`;
              return (
                <div key={i} className="space-y-1">
                  {required && ebayCategoryId ? (
                    <p className="text-xs font-medium text-[var(--color-primary)]">eBay Required Detail*</p>
                  ) : null}
                  <div className="flex flex-wrap gap-2 items-start">
                    <input
                      type="text"
                      value={a.name}
                      maxLength={EBAY_ASPECT_NAME_MAX}
                      onChange={(e) => onAspectNameChange(i, e.target.value)}
                      placeholder="Descriptor (e.g. Brand)"
                      readOnly={readOnlyAspects || (required && !!ebayCategoryId)}
                      className={`flex-1 min-w-[120px] border rounded px-2 py-1.5 text-sm ${
                        readOnlyAspects || (required && ebayCategoryId) ? "bg-gray-50 text-gray-800" : ""
                      }`}
                    />
                    <div className="flex-1 min-w-[120px]">
                      {isSelectionOnly && !readOnlyAspects ? (
                        <select
                          value={a.value}
                          onChange={(e) => onAspectValueChange(i, e.target.value)}
                          className={`w-full border rounded px-2 py-1.5 text-sm ${
                            required && !a.value.trim() ? "border-red-400" : ""
                          }`}
                        >
                          <option value="">{required ? "Select value (required)" : "Select value"}</option>
                          {suggestions.map((s) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <>
                          <input
                            type="text"
                            value={a.value}
                            maxLength={EBAY_ASPECT_VALUE_MAX}
                            list={suggestions.length > 0 && !isSelectionOnly && !readOnlyAspects ? listId : undefined}
                            onChange={(e) => onAspectValueChange(i, e.target.value)}
                            readOnly={readOnlyAspects}
                            placeholder={
                              readOnlyAspects
                                ? "Value from eBay"
                                : isMulti
                                  ? required
                                    ? "Values (comma-separated, required)"
                                    : "Values (comma-separated)"
                                  : required
                                    ? "Value (required)"
                                    : "Value"
                            }
                            className={`w-full border rounded px-2 py-1.5 text-sm ${
                              readOnlyAspects ? "bg-gray-50 text-gray-800" : ""
                            } ${required && !readOnlyAspects && !a.value.trim() ? "border-red-400" : ""}`}
                          />
                          {suggestions.length > 0 && !isSelectionOnly && (
                            <datalist id={listId}>
                              {suggestions.map((s) => (
                                <option key={s} value={s} />
                              ))}
                            </datalist>
                          )}
                        </>
                      )}
                      {isMulti && !isSelectionOnly ? (
                        <p className="text-xs text-gray-500 mt-0.5">Separate multiple values with commas.</p>
                      ) : null}
                    </div>
                    {!readOnlyAspects ? (
                      <button
                        type="button"
                        onClick={() => onRemoveAspect(i)}
                        disabled={required && !!ebayCategoryId}
                        className="text-red-500 hover:text-red-700 font-bold leading-none px-2 py-1.5 disabled:opacity-30 disabled:cursor-not-allowed"
                        aria-label="Remove detail"
                      >
                        ×
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          {!readOnlyAspects && aspects.length < MAX_ASPECTS && (
            <button
              type="button"
              onClick={onAddAspect}
              className="action-pill action-pill-sm btn-pill-outline"
            >
              + Add a detail
            </button>
          )}
        </div>
      ) : (
        <p className={listingHintClass}>Select a category to see required item specifics.</p>
      )}
    </CollapsibleListingSection>
  );
}
