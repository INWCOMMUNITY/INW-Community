"use client";

import { createPortal } from "react-dom";
import { useLockBodyScroll } from "@/lib/scroll-lock";
import { StoreItemForm } from "./StoreItemForm";

interface CreateListingModalProps {
  open: boolean;
  onClose: () => void;
}

export function CreateListingModal({ open, onClose }: CreateListingModalProps) {
  useLockBodyScroll(open);

  if (!open) return null;

  const modal = (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-black/70 isolate overflow-hidden"
      aria-modal="true"
      role="dialog"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="relative z-[301] w-full max-w-2xl max-h-[90vh] flex flex-col rounded-lg bg-white shadow-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 flex items-center justify-between border-b border-gray-200 px-4 py-3 bg-white">
          <h2 className="text-xl font-bold">List a Resale Item</h2>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded hover:bg-gray-100 text-gray-600"
            aria-label="Close"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
              <path fillRule="evenodd" d="M5.47 5.47a.75.75 0 011.06 0L12 10.94l5.47-5.47a.75.75 0 111.06 1.06L13.06 12l5.47 5.47a.75.75 0 11-1.06 1.06L12 13.06l-5.47 5.47a.75.75 0 01-1.06-1.06L10.94 12 5.47 6.53a.75.75 0 010-1.06z" clipRule="evenodd" />
            </svg>
          </button>
        </div>
        <div className="flex-1 min-h-0 p-4 overflow-y-auto bg-white flex flex-col items-center">
          <p className="text-gray-600 text-sm mb-4 text-center">
            Your item will appear on Community Resale. Buyers can make offers and message you.
          </p>
          <div className="w-full flex justify-center">
            <StoreItemForm
              resaleOnly
              successRedirect="/resale-hub/listings"
            />
          </div>
        </div>
      </div>
    </div>
  );

  if (typeof document !== "undefined") {
    return createPortal(modal, document.body);
  }
  return modal;
}
