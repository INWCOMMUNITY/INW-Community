"use client";

import { CollapsibleListingSection } from "@/components/store-item/CollapsibleListingSection";
import {
  listingHintClass,
  listingInputClass,
  listingLabelClass,
  listingSelectClass,
} from "@/components/store-item/listing-form-styles";
import {
  ETSY_WHO_MADE_OPTIONS,
  ETSY_WHEN_MADE_OPTIONS,
  type EtsyWhenMade,
  type EtsyWhoMade,
  isEtsyWhoMade,
  normalizeEtsyWhenMade,
} from "@/lib/etsy-listing-options";

export type EtsyCategorySuggestion = {
  taxonomyId: number;
  categoryName: string;
  categoryPath?: string;
};

type EtsyListingRequirementsSectionProps = {
  etsyWhoMade: EtsyWhoMade;
  etsyWhenMade: EtsyWhenMade;
  etsyIsSupply: boolean;
  onWhoMadeChange: (value: EtsyWhoMade) => void;
  onWhenMadeChange: (value: EtsyWhenMade) => void;
  onIsSupplyChange: (value: boolean) => void;
  etsyTaxonomyId: string;
  etsyCategoryLabel: string;
  etsyCategorySearch: string;
  onEtsyCategorySearchChange: (value: string) => void;
  etsyCategorySearchError: string | null;
  etsyCategoryResults: EtsyCategorySuggestion[];
  etsySearching: boolean;
  connectionError?: string | null;
  onSelectCategory: (taxonomyId: string, label: string) => void;
  onClearCategory: () => void;
};

export function EtsyListingRequirementsSection({
  etsyWhoMade,
  etsyWhenMade,
  etsyIsSupply,
  onWhoMadeChange,
  onWhenMadeChange,
  onIsSupplyChange,
  etsyTaxonomyId,
  etsyCategoryLabel,
  etsyCategorySearch,
  onEtsyCategorySearchChange,
  etsyCategorySearchError,
  etsyCategoryResults,
  etsySearching,
  connectionError,
  onSelectCategory,
  onClearCategory,
}: EtsyListingRequirementsSectionProps) {
  const valid =
    isEtsyWhoMade(etsyWhoMade) &&
    normalizeEtsyWhenMade(etsyWhenMade) != null &&
    Boolean(etsyTaxonomyId);
  const badge = valid ? "Ready" : "Required";
  const badgeColor = valid ? "#16a34a" : "#dc2626";

  return (
    <CollapsibleListingSection
      title="Etsy Listing Requirements"
      subtitle="Category and details required to publish on Etsy"
      icon="storefront-outline"
      defaultExpanded={!valid}
      badge={badge}
      badgeColor={badgeColor}
    >
      <p className={listingHintClass}>
        Etsy requires a category and these details to publish. A shipping profile must be set in
        Sync Stores.
      </p>

      {connectionError ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
          <p className="font-medium">Etsy connection needs attention</p>
          <p className="mt-1 text-xs">{connectionError}</p>
          <a href="/seller-hub/channels" className="mt-2 inline-block text-xs font-semibold underline">
            Open Sync Stores to reconnect Etsy →
          </a>
        </div>
      ) : null}

      <div>
        <p className="text-sm font-semibold text-gray-900 mb-2">Etsy category</p>
        {etsyTaxonomyId ? (
          <div className="flex items-center justify-between gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-900 truncate">
                {etsyCategoryLabel || `Etsy category #${etsyTaxonomyId}`}
              </p>
              <p className="text-xs text-gray-500">Etsy category #{etsyTaxonomyId}</p>
            </div>
            <button
              type="button"
              onClick={onClearCategory}
              className="text-sm text-red-600 hover:underline shrink-0"
            >
              Change
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <input
              type="text"
              value={etsyCategorySearch}
              onChange={(e) => onEtsyCategorySearchChange(e.target.value)}
              placeholder="Search Etsy categories (e.g. wall clocks, jewelry)…"
              className={listingInputClass}
              disabled={Boolean(connectionError)}
            />
            {!connectionError ? (
              <p className={listingHintClass}>Type at least 2 characters to search.</p>
            ) : null}
            {etsySearching && <p className="text-xs text-gray-500">Searching Etsy…</p>}
            {etsyCategorySearchError ? (
              <p className="text-xs text-red-600" role="alert">
                {etsyCategorySearchError}
              </p>
            ) : null}
            {!etsySearching &&
            !etsyCategorySearchError &&
            etsyCategorySearch.trim().length >= 2 &&
            etsyCategoryResults.length === 0 ? (
              <p className="text-xs text-gray-500">No categories found. Try different keywords.</p>
            ) : null}
            {etsyCategoryResults.length > 0 && (
              <ul className="max-h-56 overflow-y-auto rounded-lg border border-gray-200 divide-y divide-gray-100">
                {etsyCategoryResults.map((c) => (
                  <li key={c.taxonomyId}>
                    <button
                      type="button"
                      onClick={() =>
                        onSelectCategory(String(c.taxonomyId), c.categoryPath || c.categoryName)
                      }
                      className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50"
                    >
                      <span className="font-medium text-gray-900">{c.categoryName}</span>
                      {c.categoryPath && c.categoryPath !== c.categoryName ? (
                        <span className="block text-xs text-gray-500 truncate">{c.categoryPath}</span>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      <fieldset className="space-y-2">
        <legend className={`${listingLabelClass} mb-1`}>Who made it?</legend>
        <div className="space-y-2">
          {ETSY_WHO_MADE_OPTIONS.map((opt) => (
            <label key={opt.value} className="flex items-center gap-2 text-sm text-gray-800 cursor-pointer">
              <input
                type="radio"
                name="etsyWhoMade"
                value={opt.value}
                checked={etsyWhoMade === opt.value}
                onChange={() => onWhoMadeChange(opt.value)}
                className="accent-[var(--color-primary)]"
              />
              {opt.label}
            </label>
          ))}
        </div>
      </fieldset>

      <div>
        <label htmlFor="etsyWhenMade" className={listingLabelClass}>
          When was it made?
        </label>
        <select
          id="etsyWhenMade"
          value={etsyWhenMade}
          onChange={(e) => onWhenMadeChange(e.target.value as EtsyWhenMade)}
          className={listingSelectClass}
        >
          {ETSY_WHEN_MADE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <label className="flex items-center gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={etsyIsSupply}
          onChange={(e) => onIsSupplyChange(e.target.checked)}
          className="h-4 w-4 accent-[var(--color-primary)]"
        />
        <span className="text-sm text-gray-800">This is a craft supply or tool</span>
      </label>
    </CollapsibleListingSection>
  );
}
