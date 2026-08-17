"use client";

import { CollapsibleListingSection } from "@/components/store-item/CollapsibleListingSection";
import {
  listingHintClass,
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

type EtsyListingRequirementsSectionProps = {
  etsyWhoMade: EtsyWhoMade;
  etsyWhenMade: EtsyWhenMade;
  etsyIsSupply: boolean;
  onWhoMadeChange: (value: EtsyWhoMade) => void;
  onWhenMadeChange: (value: EtsyWhenMade) => void;
  onIsSupplyChange: (value: boolean) => void;
};

export function EtsyListingRequirementsSection({
  etsyWhoMade,
  etsyWhenMade,
  etsyIsSupply,
  onWhoMadeChange,
  onWhenMadeChange,
  onIsSupplyChange,
}: EtsyListingRequirementsSectionProps) {
  const valid =
    isEtsyWhoMade(etsyWhoMade) && normalizeEtsyWhenMade(etsyWhenMade) != null;
  const badge = valid ? "Ready" : "Required";
  const badgeColor = valid ? "#16a34a" : "#dc2626";

  return (
    <CollapsibleListingSection
      title="Etsy Listing Requirements"
      subtitle="Details required to publish on Etsy"
      icon="storefront-outline"
      defaultExpanded={!valid}
      badge={badge}
      badgeColor={badgeColor}
    >
      <p className={listingHintClass}>
        Etsy requires these to publish. A shipping profile must be set in Sync Stores.
      </p>

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
