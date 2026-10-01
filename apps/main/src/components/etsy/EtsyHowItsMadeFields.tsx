"use client";

import {
  ETSY_WHEN_MADE_LABELS,
  ETSY_WHEN_MADE_VALUES,
  ETSY_WHO_MADE_LABELS,
  ETSY_WHO_MADE_VALUES,
  type EtsyWhenMade,
  type EtsyWhoMade,
} from "@/lib/etsy/how-its-made-ui";
import { ListingFormSection } from "@/components/store-item/ListingFormSection";
import { listingInputClass, listingLabelClass } from "@/components/store-item/listing-form-styles";

export type EtsyHowItsMadeFormValue = {
  etsyWhoMade: EtsyWhoMade | "";
  etsyWhenMade: EtsyWhenMade | "";
  etsyIsSupply: boolean | null;
  etsyTaxonomyId: string;
};

type Props = {
  value: EtsyHowItsMadeFormValue;
  onChange: (next: EtsyHowItsMadeFormValue) => void;
  /** When true, when-made is auto-derived as made_to_order. */
  madeToOrder: boolean;
  /** When true, render fields without an outer ListingFormSection (parent owns the shell). */
  embedded?: boolean;
};

/**
 * Etsy Shop Manager “How it's made” required fields, collected on INW listings
 * before CREATE_LISTING can succeed.
 */
export function EtsyHowItsMadeFields({ value, onChange, madeToOrder, embedded = false }: Props) {
  const body = (
    <>
      <p className="text-sm text-neutral-600 mb-3">
        Matches Etsy’s Who made it / What is it / When was it made. Required before Apps Airport can
        publish this listing.
      </p>
      <fieldset className="space-y-2">
        <legend className={listingLabelClass}>Who made it? *</legend>
        {ETSY_WHO_MADE_VALUES.map((who) => (
          <label key={who} className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="etsyWhoMade"
              checked={value.etsyWhoMade === who}
              onChange={() => onChange({ ...value, etsyWhoMade: who })}
            />
            <span className="text-sm">{ETSY_WHO_MADE_LABELS[who]}</span>
          </label>
        ))}
      </fieldset>

      <fieldset className="space-y-2 mt-4">
        <legend className={listingLabelClass}>What is it? *</legend>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="radio"
            name="etsyIsSupply"
            checked={value.etsyIsSupply === false}
            onChange={() => onChange({ ...value, etsyIsSupply: false })}
          />
          <span className="text-sm">A finished product</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="radio"
            name="etsyIsSupply"
            checked={value.etsyIsSupply === true}
            onChange={() => onChange({ ...value, etsyIsSupply: true })}
          />
          <span className="text-sm">A supply or tool to make things</span>
        </label>
      </fieldset>

      <div className="mt-4">
        <label className={listingLabelClass} htmlFor="etsyWhenMade">
          When was it made? *
        </label>
        {madeToOrder ? (
          <p className="text-sm text-neutral-600">
            Made to order (from your inventory setting).
          </p>
        ) : (
          <select
            id="etsyWhenMade"
            className={`${listingInputClass} max-w-md`}
            value={value.etsyWhenMade}
            onChange={(e) =>
              onChange({
                ...value,
                etsyWhenMade: (e.target.value || "") as EtsyWhenMade | "",
              })
            }
          >
            <option value="">When was it made?</option>
            {ETSY_WHEN_MADE_VALUES.filter((w) => w !== "made_to_order").map((when) => (
              <option key={when} value={when}>
                {ETSY_WHEN_MADE_LABELS[when]}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="mt-4">
        <label className={listingLabelClass} htmlFor="etsyTaxonomyId">
          Etsy taxonomy ID
        </label>
        <input
          id="etsyTaxonomyId"
          type="text"
          inputMode="numeric"
          className={`${listingInputClass} max-w-xs`}
          value={value.etsyTaxonomyId}
          onChange={(e) =>
            onChange({
              ...value,
              etsyTaxonomyId: e.target.value.replace(/\D/g, "").slice(0, 12),
            })
          }
          placeholder="Optional if shop default is set"
        />
        <p className="mt-1 text-xs text-neutral-500">
          Leave blank to use your Etsy connection default taxonomy.
        </p>
      </div>
    </>
  );

  if (embedded) return <div className="space-y-1">{body}</div>;

  return (
    <ListingFormSection
      title="Etsy: How it’s made"
      description="Required to list this item on Etsy. Matches Etsy’s Who made it / What is it / When was it made."
    >
      {body}
    </ListingFormSection>
  );
}

export function emptyEtsyHowItsMadeFormValue(
  existing?: {
    etsyWhoMade?: string | null;
    etsyWhenMade?: string | null;
    etsyIsSupply?: boolean | null;
    etsyTaxonomyId?: number | null;
  } | null
): EtsyHowItsMadeFormValue {
  const who =
    existing?.etsyWhoMade &&
    (ETSY_WHO_MADE_VALUES as readonly string[]).includes(existing.etsyWhoMade)
      ? (existing.etsyWhoMade as EtsyWhoMade)
      : "";
  const when =
    existing?.etsyWhenMade &&
    (ETSY_WHEN_MADE_VALUES as readonly string[]).includes(existing.etsyWhenMade)
      ? (existing.etsyWhenMade as EtsyWhenMade)
      : "";
  return {
    etsyWhoMade: who,
    etsyWhenMade: when,
    etsyIsSupply: typeof existing?.etsyIsSupply === "boolean" ? existing.etsyIsSupply : null,
    etsyTaxonomyId:
      typeof existing?.etsyTaxonomyId === "number" && existing.etsyTaxonomyId > 0
        ? String(existing.etsyTaxonomyId)
        : "",
  };
}
