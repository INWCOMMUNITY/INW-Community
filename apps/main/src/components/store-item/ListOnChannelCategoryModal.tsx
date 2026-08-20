"use client";

import { useEffect, useMemo, useState } from "react";
import { useLockBodyScroll } from "@/lib/scroll-lock";
import { ChannelCategorySearchField } from "@/components/store-item/ChannelCategorySearchField";
import {
  listingHintClass,
  listingLabelClass,
  listingSelectClass,
} from "@/components/store-item/listing-form-styles";
import {
  ETSY_WHEN_MADE_OPTIONS,
  ETSY_WHO_MADE_OPTIONS,
  isEtsyWhoMade,
  normalizeEtsyWhenMade,
  type EtsyWhenMade,
  type EtsyWhoMade,
} from "@/lib/etsy-listing-options";
import {
  itemNeedsEtsyListingDetails,
  mergeListOnCategoryAssignment,
  type ListOnCategoryAssignment,
  type ListOnCategoryStep,
} from "@/lib/list-on-channel-category";

type ListOnChannelCategoryModalProps = {
  steps: ListOnCategoryStep[];
  onClose: () => void;
  onComplete: (assignments: ListOnCategoryAssignment[]) => Promise<void> | void;
};

export function ListOnChannelCategoryModal({
  steps,
  onClose,
  onComplete,
}: ListOnChannelCategoryModalProps) {
  const [index, setIndex] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [assignmentsByItem, setAssignmentsByItem] = useState<Record<string, ListOnCategoryAssignment>>(
    {}
  );
  const [categoryId, setCategoryId] = useState("");
  const [categoryLabel, setCategoryLabel] = useState("");
  const [etsyWhoMade, setEtsyWhoMade] = useState<EtsyWhoMade>("i_did");
  const [etsyWhenMade, setEtsyWhenMade] = useState<EtsyWhenMade>("made_to_order");

  useLockBodyScroll(true);

  const step = steps[index];

  useEffect(() => {
    if (!step) return;
    if (step.provider === "etsy" && step.item.etsyTaxonomyId) {
      setCategoryId(String(step.item.etsyTaxonomyId));
      setCategoryLabel("");
    } else if (step.provider === "ebay" && step.item.ebayCategoryId) {
      setCategoryId(String(step.item.ebayCategoryId));
      setCategoryLabel("");
    } else {
      setCategoryId("");
      setCategoryLabel("");
    }
    setEtsyWhoMade(isEtsyWhoMade(step.item.etsyWhoMade) ? step.item.etsyWhoMade : "i_did");
    setEtsyWhenMade(normalizeEtsyWhenMade(step.item.etsyWhenMade) ?? "made_to_order");
    setError(null);
  }, [
    index,
    step?.item.id,
    step?.provider,
    step?.item.etsyTaxonomyId,
    step?.item.ebayCategoryId,
    step?.item.etsyWhoMade,
    step?.item.etsyWhenMade,
  ]);
  const isLast = index === steps.length - 1;
  const providerLabel = step?.provider === "etsy" ? "Etsy" : "eBay";
  const showEtsyDetails = step?.provider === "etsy" && itemNeedsEtsyListingDetails(step.item);
  const canContinue =
    Boolean(categoryId) &&
    (step?.provider !== "etsy" ||
      !showEtsyDetails ||
      (isEtsyWhoMade(etsyWhoMade) && normalizeEtsyWhenMade(etsyWhenMade) != null));

  const photo = step?.item.photos?.[0];

  const progressLabel = useMemo(() => {
    if (steps.length <= 1) return null;
    return `${index + 1} of ${steps.length}`;
  }, [index, steps.length]);

  function assignmentFromStep(): ListOnCategoryAssignment | null {
    if (!step || !categoryId) return null;
    const patch: ListOnCategoryAssignment = { storeItemId: step.item.id };
    if (step.provider === "etsy") {
      patch.etsyTaxonomyId = Number(categoryId);
      if (showEtsyDetails) {
        patch.etsyWhoMade = etsyWhoMade;
        patch.etsyWhenMade = etsyWhenMade;
      }
    } else {
      patch.ebayCategoryId = Number(categoryId);
    }
    return patch;
  }

  async function goNext() {
    const patch = assignmentFromStep();
    if (!patch || !step) return;
    const nextMap = {
      ...assignmentsByItem,
      [step.item.id]: mergeListOnCategoryAssignment(assignmentsByItem[step.item.id], patch),
    };
    setAssignmentsByItem(nextMap);
    if (!isLast) {
      setIndex((i) => i + 1);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onComplete(Object.values(nextMap));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not list this item.");
      setSubmitting(false);
    }
  }

  if (!step) return null;

  return (
    <div className="fixed inset-0 z-[260] flex items-center justify-center p-4 bg-black/40" role="dialog">
      <button type="button" className="absolute inset-0" aria-label="Close" onClick={onClose} disabled={submitting} />
      <div
        className="relative z-10 w-full max-w-md rounded-xl border-2 bg-white p-5 shadow-xl max-h-[90vh] overflow-y-auto"
        style={{ borderColor: "var(--color-primary)" }}
      >
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <h3 className="text-base font-bold" style={{ color: "var(--color-heading)" }}>
              Select {providerLabel} category
            </h3>
            {progressLabel ? <p className="text-xs text-gray-500 mt-0.5">{progressLabel}</p> : null}
          </div>
        </div>

        <div className="flex items-center gap-3 mb-4">
          {photo ? (
            <img src={photo} alt="" className="w-12 h-12 object-cover rounded" />
          ) : (
            <div className="w-12 h-12 bg-gray-200 rounded shrink-0" />
          )}
          <p className="text-sm font-medium text-gray-900 line-clamp-2">{step.item.title}</p>
        </div>

        <p className={`${listingHintClass} mb-3`}>
          {providerLabel} needs a category before this item can be listed.
        </p>

        <ChannelCategorySearchField
          provider={step.provider}
          selectedId={categoryId}
          selectedLabel={categoryLabel}
          onSelect={(choice) => {
            setCategoryId(choice.id);
            setCategoryLabel(choice.path || choice.name);
          }}
          onClear={() => {
            setCategoryId("");
            setCategoryLabel("");
          }}
          disabled={submitting}
        />

        {showEtsyDetails ? (
          <div className="mt-4 space-y-3">
            <fieldset className="space-y-2">
              <legend className={`${listingLabelClass} mb-1`}>Who made it?</legend>
              {ETSY_WHO_MADE_OPTIONS.map((opt) => (
                <label key={opt.value} className="flex items-center gap-2 text-sm text-gray-800">
                  <input
                    type="radio"
                    name="listOnEtsyWhoMade"
                    checked={etsyWhoMade === opt.value}
                    onChange={() => setEtsyWhoMade(opt.value)}
                    className="accent-[var(--color-primary)]"
                    disabled={submitting}
                  />
                  {opt.label}
                </label>
              ))}
            </fieldset>
            <div>
              <label htmlFor="listOnEtsyWhenMade" className={listingLabelClass}>
                When was it made?
              </label>
              <select
                id="listOnEtsyWhenMade"
                value={etsyWhenMade}
                onChange={(e) => setEtsyWhenMade(e.target.value as EtsyWhenMade)}
                className={listingSelectClass}
                disabled={submitting}
              >
                {ETSY_WHEN_MADE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        ) : null}

        {error ? (
          <p className="text-sm text-red-600 mt-3" role="alert">
            {error}
          </p>
        ) : null}

        <div className="flex justify-end gap-2 mt-5">
          <button type="button" className="text-sm px-3 py-2 text-gray-600" disabled={submitting} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn text-sm" disabled={submitting || !canContinue} onClick={() => void goNext()}>
            {submitting ? "Listing…" : isLast ? "List" : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}
