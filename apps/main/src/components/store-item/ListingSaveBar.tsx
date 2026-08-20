"use client";

import Link from "next/link";

type ListingSaveBarProps = {
  isEdit: boolean;
  submitting: boolean;
  error?: string;
  backHref?: string;
  createHint?: string;
};

export function ListingSaveBar({
  isEdit,
  submitting,
  error,
  backHref = "/seller-hub/store/items",
  createHint,
}: ListingSaveBarProps) {
  return (
    <div className="fixed bottom-0 inset-x-0 z-40 border-t border-gray-200 bg-white/95 backdrop-blur-sm">
      <div className="max-w-5xl mx-auto px-4 py-4 flex flex-col sm:flex-row sm:items-center gap-3 sm:justify-between">
        <div className="min-w-0 flex-1">
          {error ? (
            <p className="text-sm text-red-600 truncate" role="alert">
              {error}
            </p>
          ) : (
            <p className="text-xs text-gray-500 hidden sm:block">
              {isEdit
                ? "Changes save to INW and sync to connected stores."
                : createHint ?? "List on INW and optionally publish to connected stores."}
            </p>
          )}
        </div>
        <div className="flex items-center gap-3 shrink-0 w-full sm:w-auto">
          <Link
            href={backHref}
            className="action-pill action-pill-lg btn-pill-outline flex-1 sm:flex-none justify-center min-w-[7rem] sm:min-w-[8rem]"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={submitting}
            className="action-pill action-pill-lg btn-pill-primary flex-1 sm:flex-none justify-center min-w-[9rem] sm:min-w-[10.5rem] disabled:opacity-60"
          >
            {submitting ? (
              <span className="inline-flex items-center gap-2">
                <span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                Saving…
              </span>
            ) : isEdit ? (
              "Update Item"
            ) : (
              "List Item"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
