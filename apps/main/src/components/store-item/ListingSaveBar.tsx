"use client";

import Link from "next/link";
import { IonIcon } from "@/components/IonIcon";

type ListingSaveBarProps = {
  isEdit: boolean;
  /** Show Save as Draft when creating, or when editing an existing draft. */
  showSaveAsDraft?: boolean;
  submitting: boolean;
  savingDraft?: boolean;
  error?: string;
  backHref?: string;
  createHint?: string;
  onSaveAsDraft?: () => void;
};

export function ListingSaveBar({
  isEdit,
  showSaveAsDraft,
  submitting,
  savingDraft,
  error,
  backHref = "/seller-hub/store/items",
  createHint,
  onSaveAsDraft,
}: ListingSaveBarProps) {
  const isBusy = submitting || savingDraft;
  const canSaveDraft = Boolean(onSaveAsDraft && (showSaveAsDraft ?? !isEdit));

  return (
    <div className="fixed bottom-0 inset-x-0 z-40 border-t border-gray-200 bg-white/95 backdrop-blur-sm">
      <div className="mx-auto px-4 py-4 flex flex-col items-center gap-2">
        {error ? (
          <p className="text-sm text-red-600 text-center max-w-xl" role="alert">
            {error}
          </p>
        ) : (
          <p className="text-xs text-gray-500 text-center hidden sm:block">
            {isEdit
              ? "Changes save to INW and sync to connected stores."
              : createHint ?? "List on INW and optionally publish to connected stores."}
          </p>
        )}
        <div className="flex items-center justify-center gap-3 flex-wrap w-full">
          <Link
            href={backHref}
            className="action-pill action-pill-lg btn-pill-outline justify-center min-w-[7rem] sm:min-w-[8rem]"
          >
            Cancel
          </Link>
          {canSaveDraft ? (
            <button
              type="button"
              disabled={isBusy}
              onClick={onSaveAsDraft}
              className="action-pill action-pill-lg justify-center min-w-[8rem] sm:min-w-[9rem] disabled:opacity-60 inline-flex items-center gap-2 !text-white"
              style={{ backgroundColor: "var(--color-earth)", borderColor: "var(--color-earth)" }}
            >
              {savingDraft ? (
                <span className="inline-flex items-center gap-2">
                  <span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                  Saving…
                </span>
              ) : (
                <>
                  <IonIcon name="document-outline" size={18} />
                  Save as Draft
                </>
              )}
            </button>
          ) : null}
          <button
            type="submit"
            disabled={isBusy}
            className="action-pill action-pill-lg btn-pill-primary justify-center min-w-[9rem] sm:min-w-[10.5rem] disabled:opacity-60"
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
