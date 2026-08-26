"use client";

type FulfillmentActionBarProps = {
  selectedCount: number;
  totalCount: number;
  elementsLoading: boolean;
  shippoSurfaceOpen: boolean;
  shippingConnected: boolean | null;
  onPurchaseLabels: () => void;
  onPrintSlips: () => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  slipsDisabled?: boolean;
};

export function FulfillmentActionBar({
  selectedCount,
  totalCount,
  elementsLoading,
  shippoSurfaceOpen,
  shippingConnected,
  onPurchaseLabels,
  onPrintSlips,
  onSelectAll,
  onClearSelection,
  slipsDisabled,
}: FulfillmentActionBarProps) {
  if (selectedCount === 0) return null;

  const labelsDisabled =
    elementsLoading || shippoSurfaceOpen || selectedCount === 0 || shippingConnected !== true;

  return (
    <div className="fixed bottom-0 inset-x-0 z-40 border-t border-gray-200 bg-white/95 backdrop-blur-sm no-print">
      <div className="max-w-[var(--max-width)] mx-auto px-4 py-4 flex flex-col sm:flex-row sm:items-center gap-3 sm:justify-between">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-gray-900">
            {selectedCount} of {totalCount} selected
          </p>
          <p className="text-xs text-gray-500 hidden sm:block">
            Same-buyer orders combine into one Shippo purchase per buyer.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0 w-full sm:w-auto">
          <button
            type="button"
            onClick={onClearSelection}
            className="action-pill action-pill-lg btn-pill-outline flex-1 sm:flex-none justify-center min-w-[6rem]"
          >
            Clear
          </button>
          <button
            type="button"
            onClick={onSelectAll}
            className="action-pill action-pill-lg btn-pill-outline flex-1 sm:flex-none justify-center min-w-[6rem]"
          >
            Select all
          </button>
          <button
            type="button"
            onClick={onPrintSlips}
            disabled={slipsDisabled || selectedCount === 0}
            className="action-pill action-pill-lg btn-pill-outline flex-1 sm:flex-none justify-center min-w-[7rem] disabled:opacity-50"
          >
            Print Slips
          </button>
          <button
            type="button"
            onClick={onPurchaseLabels}
            disabled={labelsDisabled}
            className="action-pill action-pill-lg btn-pill-primary flex-1 sm:flex-none justify-center min-w-[9rem] disabled:opacity-50"
          >
            {elementsLoading ? "Opening…" : "Purchase Labels"}
          </button>
        </div>
      </div>
    </div>
  );
}
